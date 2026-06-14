import 'dart:math' as math;

import 'package:latlong2/latlong.dart';

/// Geometry helpers for placing trains on a polyline by arc-length (km).
/// Mirrors the interpolation the backend does in `backend/railmind/geo.py`.

class PointOnRoute {
  final LatLng position;
  final double headingDeg;
  const PointOnRoute(this.position, this.headingDeg);
}

double _bearing(LatLng a, LatLng b) {
  final lat1 = a.latitudeInRad;
  final lat2 = b.latitudeInRad;
  final dLon = (b.longitude - a.longitude) * math.pi / 180.0;
  final y = math.sin(dLon) * math.cos(lat2);
  final x = math.cos(lat1) * math.sin(lat2) -
      math.sin(lat1) * math.cos(lat2) * math.cos(dLon);
  final deg = math.atan2(y, x) * 180.0 / math.pi;
  return (deg + 360.0) % 360.0;
}

/// Returns the position + heading at arc-length [distKm] along [polyline],
/// where [cumKm] is the cumulative km at each polyline vertex.
PointOnRoute interpolateAlong(
  List<LatLng> polyline,
  List<double> cumKm,
  double distKm,
) {
  if (polyline.isEmpty) return const PointOnRoute(LatLng(0, 0), 0);
  if (polyline.length == 1) return PointOnRoute(polyline.first, 0);

  final total = cumKm.last;
  final d = distKm.clamp(0.0, total);

  // binary search for the segment containing d
  int lo = 0, hi = cumKm.length - 1;
  while (lo < hi) {
    final mid = (lo + hi) >> 1;
    if (cumKm[mid] < d) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  final i = lo == 0 ? 1 : lo;
  final segStart = cumKm[i - 1];
  final segEnd = cumKm[i];
  final segLen = (segEnd - segStart);
  final t = segLen <= 0 ? 0.0 : ((d - segStart) / segLen).clamp(0.0, 1.0);

  final a = polyline[i - 1];
  final b = polyline[i];
  final pos = LatLng(
    a.latitude + (b.latitude - a.latitude) * t,
    a.longitude + (b.longitude - a.longitude) * t,
  );
  return PointOnRoute(pos, _bearing(a, b));
}

/// Approximate arc-length (km) of the polyline vertex nearest to [point].
/// Used to project a station onto a train's route.
double nearestCumKm(
  List<LatLng> polyline,
  List<double> cumKm,
  LatLng point,
) {
  const distance = Distance();
  double best = double.infinity;
  double bestKm = 0;
  for (var i = 0; i < polyline.length; i++) {
    final d = distance.as(LengthUnit.Kilometer, polyline[i], point);
    if (d < best) {
      best = d;
      bestKm = i < cumKm.length ? cumKm[i] : 0;
    }
  }
  return bestKm;
}

/// Perlin smootherstep — realistic ease in/out (used by the offline simulator).
double smootherstep(double x) {
  final c = x.clamp(0.0, 1.0);
  return c * c * c * (c * (c * 6 - 15) + 10);
}
