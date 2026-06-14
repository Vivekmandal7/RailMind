import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

import '../../../core/geo.dart';
import 'network_model.dart';
import 'live_snapshot_model.dart';

/// UI-facing view of a single train: its route geometry, station timeline and
/// current live state. Built by [TrainRoute.fromLive] from the backend network
/// (static geometry) + a live snapshot frame (position/eta/delay).
class StationStop {
  final String name;
  final String time;
  final String subtitle;
  final LatLng location;
  final bool isPassed;

  const StationStop({
    required this.name,
    required this.time,
    required this.subtitle,
    required this.location,
    this.isPassed = false,
  });
}

class TrainRoute {
  final String id; // train number
  final String name;
  final String status; // 'ON TIME' | 'DELAYED' | 'HELD'
  final String eta; // HH:MM final arrival
  final String delay; // 'None' | 'N mins'
  final LatLng currentLocation;
  final List<LatLng> routePoints;
  final List<StationStop> stations;
  final double defaultZoom;
  final LatLng defaultCenter;

  // live extras
  final String source; // live | interpolated | predicted | sim
  final double headingDeg;
  final double speedKmh;
  final int delayMin;
  final String? nextStationName;

  const TrainRoute({
    required this.id,
    required this.name,
    required this.status,
    required this.eta,
    required this.delay,
    required this.currentLocation,
    required this.routePoints,
    required this.stations,
    required this.defaultZoom,
    required this.defaultCenter,
    this.source = 'sim',
    this.headingDeg = 0,
    this.speedKmh = 0,
    this.delayMin = 0,
    this.nextStationName,
  });

  bool get isOnTime => status == 'ON TIME';

  StationStop? get nextStop {
    for (final station in stations) {
      if (!station.isPassed) return station;
    }
    return null;
  }

  StationStop? get finalDestination =>
      stations.isEmpty ? null : stations.last;

  /// Build the UI route from static geometry + a live state frame.
  factory TrainRoute.fromLive(
    TrainStaticModel meta,
    TrainStateModel state,
    NetworkModel network, {
    required double simSec,
  }) {
    final dist = state.distKm;
    final speed = state.speedKmh <= 1 ? 60.0 : state.speedKmh;

    final stops = <StationStop>[];
    for (final code in meta.route) {
      final st = network.stationByCode(code);
      if (st == null) continue;
      final cum = nearestCumKm(meta.polyline, meta.cumKm, st.location);
      final passed = cum <= dist + 0.05;
      final isNext = code == state.nextStation;
      final etaSec = code == meta.route.last
          ? state.etaFinalSec
          : (simSec + (cum - dist) / speed * 3600).round();
      stops.add(StationStop(
        name: st.name,
        time: passed && !isNext ? 'Departed' : _clock(etaSec),
        subtitle: passed
            ? 'Departed'
            : isNext
                ? 'Next stop'
                : 'Upcoming',
        location: st.location,
        isPassed: passed && !isNext,
      ));
    }

    final delayMin = state.delayMin;
    final status = state.status == 'held'
        ? 'HELD'
        : (delayMin > 0 || state.status == 'delayed')
            ? 'DELAYED'
            : 'ON TIME';

    final bounds = _centerZoom(meta.polyline);

    return TrainRoute(
      id: meta.number,
      name: meta.name,
      status: status,
      eta: _clock(state.etaFinalSec),
      delay: delayMin > 0 ? '$delayMin mins' : 'None',
      currentLocation: state.position,
      routePoints: meta.polyline,
      stations: stops,
      defaultCenter: bounds.center,
      defaultZoom: bounds.zoom,
      source: state.source,
      headingDeg: state.headingDeg,
      speedKmh: state.speedKmh,
      delayMin: delayMin,
      nextStationName: state.nextStation == null
          ? null
          : network.stationByCode(state.nextStation!)?.name,
    );
  }

  static String _clock(int secOfDay) {
    final s = ((secOfDay % 86400) + 86400) % 86400;
    final h = (s ~/ 3600).toString().padLeft(2, '0');
    final m = ((s % 3600) ~/ 60).toString().padLeft(2, '0');
    return '$h:$m';
  }
}

class _CenterZoom {
  final LatLng center;
  final double zoom;
  const _CenterZoom(this.center, this.zoom);
}

_CenterZoom _centerZoom(List<LatLng> poly) {
  if (poly.isEmpty) return const _CenterZoom(LatLng(19.0, 73.0), 9);
  double minLat = poly.first.latitude, maxLat = poly.first.latitude;
  double minLng = poly.first.longitude, maxLng = poly.first.longitude;
  for (final p in poly) {
    minLat = math.min(minLat, p.latitude);
    maxLat = math.max(maxLat, p.latitude);
    minLng = math.min(minLng, p.longitude);
    maxLng = math.max(maxLng, p.longitude);
  }
  final center = LatLng((minLat + maxLat) / 2, (minLng + maxLng) / 2);
  final span = math.max(maxLat - minLat, maxLng - minLng);
  double zoom;
  if (span > 6) {
    zoom = 5.0;
  } else if (span > 3) {
    zoom = 6.0;
  } else if (span > 1.5) {
    zoom = 7.5;
  } else if (span > 0.6) {
    zoom = 9.0;
  } else if (span > 0.25) {
    zoom = 10.5;
  } else {
    zoom = 11.5;
  }
  return _CenterZoom(center, zoom);
}
