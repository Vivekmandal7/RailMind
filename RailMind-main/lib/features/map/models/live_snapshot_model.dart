import 'package:latlong2/latlong.dart';

/// Live state streamed over the `/stream` WebSocket (or polled from
/// `GET /snapshot`). Mirrors the backend `TwinSnapshot` / `TrainStateModel`.

class TrainStateModel {
  final String number;
  final String status; // scheduled|running|delayed|held|conflict|arrived
  final bool active;
  final double distKm; // arc-length along route
  final LatLng position;
  final double headingDeg;
  final double speedKmh;
  final int delayMin;
  final String? nextStation;
  final String? prevStation;
  final String? currentSection;
  final int? etaNextSec;
  final int etaFinalSec;
  final int estPassengers;
  final String source; // live | interpolated | predicted | sim
  final double confidence;
  final int? lastReportAgeSec;

  const TrainStateModel({
    required this.number,
    required this.status,
    required this.active,
    required this.distKm,
    required this.position,
    required this.headingDeg,
    required this.speedKmh,
    required this.delayMin,
    required this.etaFinalSec,
    required this.estPassengers,
    this.nextStation,
    this.prevStation,
    this.currentSection,
    this.etaNextSec,
    this.source = 'sim',
    this.confidence = 0.4,
    this.lastReportAgeSec,
  });

  factory TrainStateModel.fromJson(Map<String, dynamic> j) {
    final pos = j['position'] as List;
    return TrainStateModel(
      number: j['number'] as String,
      status: j['status'] as String? ?? 'running',
      active: j['active'] as bool? ?? true,
      distKm: (j['dist_km'] as num?)?.toDouble() ?? 0,
      position: LatLng(
        (pos[1] as num).toDouble(),
        (pos[0] as num).toDouble(),
      ),
      headingDeg: (j['heading_deg'] as num?)?.toDouble() ?? 0,
      speedKmh: (j['speed_kmh'] as num?)?.toDouble() ?? 0,
      delayMin: (j['delay_min'] as num?)?.toInt() ?? 0,
      nextStation: j['next_station'] as String?,
      prevStation: j['prev_station'] as String?,
      currentSection: j['current_section'] as String?,
      etaNextSec: (j['eta_next_sec'] as num?)?.toInt(),
      etaFinalSec: (j['eta_final_sec'] as num?)?.toInt() ?? 0,
      estPassengers: (j['est_passengers'] as num?)?.toInt() ?? 0,
      source: j['source'] as String? ?? 'sim',
      confidence: (j['confidence'] as num?)?.toDouble() ?? 0.4,
      lastReportAgeSec: (j['last_report_age_sec'] as num?)?.toInt(),
    );
  }
}

class LiveStatusModel {
  final String provider;
  final String origin; // live | sim
  final bool available;
  final double? updatedSecAgo;
  final int liveCount;
  final Map<String, int> sourceCounts;

  const LiveStatusModel({
    required this.provider,
    required this.origin,
    required this.available,
    this.updatedSecAgo,
    this.liveCount = 0,
    this.sourceCounts = const {},
  });

  factory LiveStatusModel.fromJson(Map<String, dynamic> j) => LiveStatusModel(
        provider: j['provider'] as String? ?? 'sim',
        origin: j['origin'] as String? ?? 'sim',
        available: j['available'] as bool? ?? false,
        updatedSecAgo: (j['updated_sec_ago'] as num?)?.toDouble(),
        liveCount: (j['live_count'] as num?)?.toInt() ?? 0,
        sourceCounts: (j['source_counts'] as Map?)?.map(
              (k, v) => MapEntry(k.toString(), (v as num).toInt()),
            ) ??
            const {},
      );
}

class TwinSnapshot {
  final String corridorId;
  final double simSec;
  final double tickHz;
  final double timeScale;
  final bool autonomous;
  final List<TrainStateModel> trains;
  final List<String> disruptions;
  final LiveStatusModel? live;

  const TwinSnapshot({
    required this.simSec,
    required this.trains,
    this.corridorId = '',
    this.tickHz = 1,
    this.timeScale = 1,
    this.autonomous = false,
    this.disruptions = const [],
    this.live,
  });

  TrainStateModel? trainByNumber(String number) {
    for (final t in trains) {
      if (t.number == number) return t;
    }
    return null;
  }

  factory TwinSnapshot.fromJson(Map<String, dynamic> j) => TwinSnapshot(
        corridorId: j['corridor_id'] as String? ?? '',
        simSec: (j['sim_sec'] as num?)?.toDouble() ?? 0,
        tickHz: (j['tick_hz'] as num?)?.toDouble() ?? 1,
        timeScale: (j['time_scale'] as num?)?.toDouble() ?? 1,
        autonomous: j['autonomous'] as bool? ?? false,
        trains: (j['trains'] as List? ?? [])
            .map((e) => TrainStateModel.fromJson(e as Map<String, dynamic>))
            .toList(),
        disruptions:
            (j['disruptions'] as List? ?? []).map((e) => e.toString()).toList(),
        live: j['live'] == null
            ? null
            : LiveStatusModel.fromJson(j['live'] as Map<String, dynamic>),
      );
}
