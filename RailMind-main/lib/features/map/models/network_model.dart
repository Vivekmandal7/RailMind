import 'package:latlong2/latlong.dart';

/// Static network served once over `GET /network`. Mirrors the backend
/// `NetworkModel` in `backend/railmind/models.py`.
///
/// Coordinates from the backend are `[lng, lat]` pairs; helpers here convert to
/// latlong2 `LatLng(lat, lng)` for flutter_map.

LatLng _toLatLng(List<dynamic> lngLat) =>
    LatLng((lngLat[1] as num).toDouble(), (lngLat[0] as num).toDouble());

List<double> _doubles(List<dynamic> raw) =>
    raw.map((e) => (e as num).toDouble()).toList();

class StationModel {
  final String code;
  final String name;
  final double lat;
  final double lng;
  final int platforms;

  const StationModel({
    required this.code,
    required this.name,
    required this.lat,
    required this.lng,
    this.platforms = 2,
  });

  LatLng get location => LatLng(lat, lng);

  factory StationModel.fromJson(Map<String, dynamic> j) => StationModel(
        code: j['code'] as String,
        name: j['name'] as String,
        lat: (j['lat'] as num).toDouble(),
        lng: (j['lng'] as num).toDouble(),
        platforms: (j['platforms'] as num?)?.toInt() ?? 2,
      );

  Map<String, dynamic> toJson() => {
        'code': code,
        'name': name,
        'lat': lat,
        'lng': lng,
        'platforms': platforms,
      };
}

class TrainStaticModel {
  final String number;
  final String name;
  final String type; // express | local
  final String direction; // UP | DOWN
  final int coaches;
  final int capacityPax;
  final List<String> route; // station codes
  final List<LatLng> polyline; // flattened route geometry
  final List<double> cumKm; // arc-length at each polyline vertex
  final double totalKm;

  const TrainStaticModel({
    required this.number,
    required this.name,
    required this.type,
    required this.direction,
    required this.coaches,
    required this.capacityPax,
    required this.route,
    required this.polyline,
    required this.cumKm,
    required this.totalKm,
  });

  factory TrainStaticModel.fromJson(Map<String, dynamic> j) => TrainStaticModel(
        number: j['number'] as String,
        name: j['name'] as String,
        type: j['type'] as String? ?? 'express',
        direction: j['direction'] as String? ?? 'UP',
        coaches: (j['coaches'] as num?)?.toInt() ?? 0,
        capacityPax: (j['capacity_pax'] as num?)?.toInt() ?? 0,
        route: (j['route'] as List).map((e) => e.toString()).toList(),
        polyline:
            (j['polyline'] as List).map((e) => _toLatLng(e as List)).toList(),
        cumKm: _doubles(j['cum_km'] as List),
        totalKm: (j['total_km'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => {
        'number': number,
        'name': name,
        'type': type,
        'direction': direction,
        'coaches': coaches,
        'capacity_pax': capacityPax,
        'route': route,
        'polyline': polyline.map((p) => [p.longitude, p.latitude]).toList(),
        'cum_km': cumKm,
        'total_km': totalKm,
      };
}

class NetworkModel {
  final String corridorId;
  final String corridorName;
  final List<StationModel> stations;
  final List<TrainStaticModel> trains;

  const NetworkModel({
    required this.corridorId,
    required this.corridorName,
    required this.stations,
    required this.trains,
  });

  StationModel? stationByCode(String code) {
    for (final s in stations) {
      if (s.code == code) return s;
    }
    return null;
  }

  TrainStaticModel? trainByNumber(String number) {
    for (final t in trains) {
      if (t.number == number) return t;
    }
    return null;
  }

  factory NetworkModel.fromJson(Map<String, dynamic> j) => NetworkModel(
        corridorId: j['corridor_id'] as String? ?? '',
        corridorName: j['corridor_name'] as String? ?? 'Network',
        stations: (j['stations'] as List)
            .map((e) => StationModel.fromJson(e as Map<String, dynamic>))
            .toList(),
        trains: (j['trains'] as List)
            .map((e) => TrainStaticModel.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  Map<String, dynamic> toJson() => {
        'corridor_id': corridorId,
        'corridor_name': corridorName,
        'stations': stations.map((s) => s.toJson()).toList(),
        'trains': trains.map((t) => t.toJson()).toList(),
      };
}

/// A corridor choice from `GET /corridors`.
class CorridorOption {
  final String key;
  final String name;
  const CorridorOption({required this.key, required this.name});

  factory CorridorOption.fromJson(Map<String, dynamic> j) => CorridorOption(
        key: j['key'] as String,
        name: j['name'] as String,
      );
}
