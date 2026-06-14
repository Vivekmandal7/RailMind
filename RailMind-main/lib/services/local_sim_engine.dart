import 'dart:async';

import '../core/geo.dart';
import '../features/map/models/network_model.dart';
import '../features/map/models/live_snapshot_model.dart';

/// In-app fallback that keeps the map alive when the backend is unreachable.
///
/// It advances every train along its real route polyline over wall-clock time
/// (ping-ponging so trains never "teleport"), producing [TwinSnapshot] frames
/// shaped identically to the live feed. Provenance is honestly tagged `sim`.
class LocalSimEngine {
  LocalSimEngine(this.network) {
    final start = DateTime.now();
    _epoch = start;
    // start-of-day seconds, used as the sim clock base so ETAs read like a clock
    _baseSimSec = start.hour * 3600 + start.minute * 60 + start.second;
    for (var i = 0; i < network.trains.length; i++) {
      final t = network.trains[i];
      _stationCum[t.number] = _projectStations(t);
      // stagger trains along their route and alternate direction
      _phaseOffsetKm[t.number] = (i * 17.0) % (t.totalKm <= 0 ? 1 : t.totalKm);
      _speedKmh[t.number] = t.type == 'local' ? 50.0 : 85.0;
    }
  }

  final NetworkModel network;
  late final DateTime _epoch;
  late final int _baseSimSec;
  final Map<String, List<MapEntry<String, double>>> _stationCum = {};
  final Map<String, double> _phaseOffsetKm = {};
  final Map<String, double> _speedKmh = {};

  /// Sim time runs faster than wall time so motion is visible.
  static const double timeScale = 30.0;

  List<MapEntry<String, double>> _projectStations(TrainStaticModel t) {
    return [
      for (final code in t.route)
        if (network.stationByCode(code) != null)
          MapEntry(
            code,
            nearestCumKm(t.polyline, t.cumKm, network.stationByCode(code)!.location),
          ),
    ];
  }

  Stream<TwinSnapshot> stream() {
    late StreamController<TwinSnapshot> controller;
    Timer? timer;
    void tick() => controller.add(_snapshot());
    controller = StreamController<TwinSnapshot>(
      onListen: () {
        tick();
        timer = Timer.periodic(const Duration(seconds: 1), (_) => tick());
      },
      onCancel: () => timer?.cancel(),
    );
    return controller.stream;
  }

  TwinSnapshot _snapshot() {
    final elapsedSec = DateTime.now().difference(_epoch).inMilliseconds / 1000.0;
    final simSec = _baseSimSec + elapsedSec * timeScale;
    final trains = <TrainStateModel>[];

    for (final t in network.trains) {
      final total = t.totalKm <= 0 ? 1.0 : t.totalKm;
      final speed = _speedKmh[t.number] ?? 80.0;
      final travelledKm =
          (_phaseOffsetKm[t.number] ?? 0) + elapsedSec * timeScale * speed / 3600.0;
      // ping-pong within [0, total]
      final cycle = travelledKm % (2 * total);
      final dist = cycle <= total ? cycle : (2 * total - cycle);
      final forward = cycle <= total;

      final p = interpolateAlong(t.polyline, t.cumKm, dist);
      final heading = forward ? p.headingDeg : (p.headingDeg + 180) % 360;

      // next/prev station from projected arc-lengths
      String? prev, next;
      final stations = _stationCum[t.number] ?? const [];
      for (final s in stations) {
        if (s.value <= dist) {
          prev = s.key;
        } else {
          next = s.key;
          break;
        }
      }

      final remainingKm = (total - dist).clamp(0.0, total);
      final etaFinalSec = (simSec + remainingKm / speed * 3600).round();

      trains.add(TrainStateModel(
        number: t.number,
        status: 'running',
        active: true,
        distKm: dist,
        position: p.position,
        headingDeg: heading,
        speedKmh: speed,
        delayMin: 0,
        prevStation: prev,
        nextStation: next,
        etaFinalSec: etaFinalSec,
        estPassengers: (t.capacityPax * 0.7).round(),
        source: 'sim',
        confidence: 0.4,
      ));
    }

    return TwinSnapshot(
      corridorId: network.corridorId,
      simSec: simSec,
      tickHz: 1,
      timeScale: timeScale,
      trains: trains,
      live: LiveStatusModel(
        provider: 'offline',
        origin: 'sim',
        available: false,
        sourceCounts: {'sim': trains.length},
      ),
    );
  }
}
