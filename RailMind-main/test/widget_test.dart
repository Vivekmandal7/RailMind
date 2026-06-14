// RailMind unit tests — cover the live-data layer that makes the app "real":
// geometry interpolation, the network DTO parsing, the live->UI mapper, and
// the e-ticket payload.

import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';

import 'package:railmind/core/geo.dart';
import 'package:railmind/core/widgets/eticket_sheet.dart';
import 'package:railmind/features/map/models/network_model.dart';
import 'package:railmind/features/map/models/live_snapshot_model.dart';
import 'package:railmind/features/map/models/train_route_model.dart';

Map<String, dynamic> _sampleNetworkJson() => {
      'corridor_id': 'test',
      'corridor_name': 'Test Corridor',
      'stations': [
        {'code': 'A', 'name': 'Alpha', 'lat': 19.0, 'lng': 73.0, 'platforms': 2},
        {'code': 'B', 'name': 'Bravo', 'lat': 19.5, 'lng': 73.5, 'platforms': 2},
      ],
      'trains': [
        {
          'number': 'T1',
          'name': 'Test Express',
          'type': 'express',
          'direction': 'UP',
          'coaches': 10,
          'capacity_pax': 1000,
          'route': ['A', 'B'],
          'polyline': [
            [73.0, 19.0],
            [73.5, 19.5],
          ],
          'cum_km': [0.0, 70.0],
          'total_km': 70.0,
        },
      ],
    };

void main() {
  group('geo.interpolateAlong', () {
    final poly = [const LatLng(19.0, 73.0), const LatLng(19.5, 73.5)];
    final cum = [0.0, 70.0];

    test('returns the start at distance 0', () {
      final p = interpolateAlong(poly, cum, 0);
      expect(p.position.latitude, closeTo(19.0, 1e-9));
      expect(p.position.longitude, closeTo(73.0, 1e-9));
    });

    test('returns the midpoint at half distance', () {
      final p = interpolateAlong(poly, cum, 35);
      expect(p.position.latitude, closeTo(19.25, 1e-6));
      expect(p.position.longitude, closeTo(73.25, 1e-6));
    });

    test('clamps beyond the end', () {
      final p = interpolateAlong(poly, cum, 999);
      expect(p.position.latitude, closeTo(19.5, 1e-9));
    });
  });

  group('NetworkModel.fromJson', () {
    test('parses stations and trains with lng/lat swap', () {
      final net = NetworkModel.fromJson(_sampleNetworkJson());
      expect(net.stations, hasLength(2));
      expect(net.trainByNumber('T1')?.name, 'Test Express');
      // polyline is [lng,lat] in JSON -> LatLng(lat,lng)
      expect(net.trains.first.polyline.first.latitude, 19.0);
      expect(net.trains.first.polyline.first.longitude, 73.0);
    });
  });

  group('TrainRoute.fromLive', () {
    final net = NetworkModel.fromJson(_sampleNetworkJson());
    final meta = net.trainByNumber('T1')!;

    TrainStateModel stateAt(double dist) => TrainStateModel(
          number: 'T1',
          status: 'running',
          active: true,
          distKm: dist,
          position: interpolateAlong(meta.polyline, meta.cumKm, dist).position,
          headingDeg: 45,
          speedKmh: 80,
          delayMin: 0,
          etaFinalSec: 9 * 3600,
          estPassengers: 700,
          nextStation: dist < 70 ? 'B' : null,
          source: 'live',
        );

    test('the marker moves as distance increases', () {
      final start = TrainRoute.fromLive(meta, stateAt(0), net, simSec: 8 * 3600);
      final later =
          TrainRoute.fromLive(meta, stateAt(35), net, simSec: 8 * 3600);
      expect(later.currentLocation.latitude,
          greaterThan(start.currentLocation.latitude));
    });

    test('passed flags reflect progress', () {
      final route =
          TrainRoute.fromLive(meta, stateAt(35), net, simSec: 8 * 3600);
      expect(route.stations.first.isPassed, isTrue); // Alpha behind us
      expect(route.stations.last.isPassed, isFalse); // Bravo ahead
      expect(route.isOnTime, isTrue);
      expect(route.source, 'live');
    });

    test('delay maps to DELAYED status', () {
      final delayed = TrainStateModel(
        number: 'T1',
        status: 'delayed',
        active: true,
        distKm: 10,
        position: meta.polyline.first,
        headingDeg: 0,
        speedKmh: 40,
        delayMin: 12,
        etaFinalSec: 9 * 3600,
        estPassengers: 700,
        source: 'sim',
      );
      final route = TrainRoute.fromLive(meta, delayed, net, simSec: 8 * 3600);
      expect(route.status, 'DELAYED');
      expect(route.delay, '12 mins');
    });
  });

  group('ETicketData', () {
    test('builds a verifiable QR payload and share text', () {
      const t = ETicketData(
        trainId: '12137',
        trainName: 'Punjab Mail',
        pnr: '428-1938502',
        fromStation: 'Mumbai CSMT',
        toStation: 'Igatpuri',
        departureTime: '08:00',
        arrivalTime: '10:45',
        date: 'Today',
        status: 'ON TIME',
      );
      expect(t.qrPayload, contains('PNR:428-1938502'));
      expect(t.qrPayload, contains('12137'));
      expect(t.shareText, contains('Punjab Mail'));
    });
  });
}
