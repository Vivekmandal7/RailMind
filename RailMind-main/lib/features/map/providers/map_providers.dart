import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../services/railmind_api_service.dart';
import '../../../services/live_stream_service.dart';
import '../../../services/local_sim_engine.dart';
import '../models/network_model.dart';
import '../models/live_snapshot_model.dart';
import '../models/train_route_model.dart';

/// How the current data is being sourced — drives the provenance badge.
enum LiveMode { live, polling, offline }

extension LiveModeLabel on LiveMode {
  String get label => switch (this) {
        LiveMode.live => 'LIVE',
        LiveMode.polling => 'LIVE',
        LiveMode.offline => 'SIM',
      };
}

/// One resolved frame: static geometry + the latest live state + how we got it.
class LiveFrame {
  final NetworkModel network;
  final TwinSnapshot snapshot;
  final LiveMode mode;
  const LiveFrame(this.network, this.snapshot, this.mode);
}

// --------------------------------------------------------------------------- //
// Services
// --------------------------------------------------------------------------- //
final apiServiceProvider = Provider<RailMindApiService>((ref) {
  final service = RailMindApiService();
  ref.onDispose(service.dispose);
  return service;
});

/// Selected backend corridor key (null = backend default). Switching it
/// rebuilds the live feed.
class CorridorKeyNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  Future<void> select(String key) async {
    if (key == state) return;
    final api = ref.read(apiServiceProvider);
    await api.switchCorridor(key);
    state = key;
  }
}

final corridorKeyProvider =
    NotifierProvider<CorridorKeyNotifier, String?>(CorridorKeyNotifier.new);

/// Available corridors for the switcher (empty when offline).
final corridorsProvider = FutureProvider<List<CorridorOption>>((ref) async {
  try {
    return await ref.watch(apiServiceProvider).fetchCorridors();
  } catch (_) {
    return const <CorridorOption>[];
  }
});

// --------------------------------------------------------------------------- //
// Live feed with graceful degradation: WebSocket -> REST poll -> offline sim
// --------------------------------------------------------------------------- //
final liveFrameProvider = StreamProvider.autoDispose<LiveFrame>((ref) async* {
  ref.watch(corridorKeyProvider); // re-run when the corridor changes
  final api = ref.watch(apiServiceProvider);

  final online = await api.ping();
  if (!online) {
    yield* _offlineStream(ref, await _loadOfflineNetwork());
    return;
  }

  NetworkModel network;
  try {
    network = await api.fetchNetwork();
  } catch (_) {
    yield* _offlineStream(ref, await _loadOfflineNetwork());
    return;
  }

  // 1) try the WebSocket stream
  final svc = LiveStreamService();
  ref.onDispose(svc.dispose);
  try {
    await for (final snap in svc.connect()) {
      yield LiveFrame(network, snap, LiveMode.live);
    }
  } catch (_) {
    // socket failed / dropped — fall through to polling
  }
  svc.dispose();

  // 2) poll REST while the backend stays reachable
  while (true) {
    try {
      final snap = await api.fetchSnapshot();
      yield LiveFrame(network, snap, LiveMode.polling);
    } catch (_) {
      // 3) backend went away mid-session — offline sim
      yield* _offlineStream(ref, await _loadOfflineNetwork());
      return;
    }
    await Future<void>.delayed(AppConfig.pollInterval);
  }
});

Stream<LiveFrame> _offlineStream(Ref ref, NetworkModel network) async* {
  final engine = LocalSimEngine(network);
  await for (final snap in engine.stream()) {
    yield LiveFrame(network, snap, LiveMode.offline);
  }
}

NetworkModel? _offlineCache;
Future<NetworkModel> _loadOfflineNetwork() async {
  if (_offlineCache != null) return _offlineCache!;
  final raw = await rootBundle.loadString(AppConfig.offlineNetworkAsset);
  _offlineCache = NetworkModel.fromJson(json.decode(raw) as Map<String, dynamic>);
  return _offlineCache!;
}

// --------------------------------------------------------------------------- //
// Derived UI state
// --------------------------------------------------------------------------- //
final liveTrainRoutesProvider =
    Provider.autoDispose<AsyncValue<List<TrainRoute>>>((ref) {
  return ref.watch(liveFrameProvider).whenData((f) {
    final routes = <TrainRoute>[];
    for (final state in f.snapshot.trains) {
      if (!state.active) continue;
      final meta = f.network.trainByNumber(state.number);
      if (meta == null) continue;
      routes.add(TrainRoute.fromLive(meta, state, f.network,
          simSec: f.snapshot.simSec));
    }
    routes.sort((a, b) => a.name.compareTo(b.name));
    return routes;
  });
});

/// Latest connection mode + provenance, for the badge.
typedef LiveStatusView = ({LiveMode mode, LiveStatusModel? live});

final liveStatusProvider = Provider.autoDispose<LiveStatusView?>((ref) {
  return ref.watch(liveFrameProvider).maybeWhen(
        data: (f) => (mode: f.mode, live: f.snapshot.live),
        orElse: () => null,
      );
});

/// The train number the user is tracking (null = first available).
class SelectedTrainNumberNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String number) => state = number;
  void selectTrain(TrainRoute route) => state = route.id;
}

final selectedTrainNumberProvider =
    NotifierProvider<SelectedTrainNumberNotifier, String?>(
        SelectedTrainNumberNotifier.new);

/// The currently tracked train, re-derived every tick so its marker moves.
final selectedTrainRouteProvider = Provider.autoDispose<TrainRoute?>((ref) {
  final routesAsync = ref.watch(liveTrainRoutesProvider);
  final selected = ref.watch(selectedTrainNumberProvider);
  return routesAsync.maybeWhen(
    data: (routes) {
      if (routes.isEmpty) return null;
      if (selected != null) {
        for (final r in routes) {
          if (r.id == selected) return r;
        }
      }
      // Default to a clearly-moving train at a believable speed so the map is
      // obviously "live" (avoid stationary trains and sim speed outliers).
      TrainRoute? best;
      for (final r in routes) {
        if (r.speedKmh < 5 || r.speedKmh > 140) continue; // skip stopped/outliers
        if (best == null || r.speedKmh > best.speedKmh) best = r;
      }
      // Fall back to anything moving, then to the first train.
      best ??= routes.where((r) => r.speedKmh >= 5).fold<TrainRoute?>(
          null, (b, r) => b == null || r.speedKmh > b.speedKmh ? r : b);
      return best ?? routes.first;
    },
    orElse: () => null,
  );
});

// --------------------------------------------------------------------------- //
// Search
// --------------------------------------------------------------------------- //
class MapSearchQueryNotifier extends Notifier<String> {
  @override
  String build() => '';
  void setQuery(String query) => state = query;
  void clearQuery() => state = '';
}

final mapSearchQueryProvider =
    NotifierProvider<MapSearchQueryNotifier, String>(MapSearchQueryNotifier.new);

final mapSearchResultsProvider = Provider.autoDispose<List<TrainRoute>>((ref) {
  final query = ref.watch(mapSearchQueryProvider).trim().toLowerCase();
  if (query.isEmpty) return const [];
  final routes = ref.watch(liveTrainRoutesProvider).value ?? const [];
  return routes.where((train) {
    return train.name.toLowerCase().contains(query) ||
        train.id.toLowerCase().contains(query) ||
        train.stations.any((s) => s.name.toLowerCase().contains(query));
  }).toList();
});
