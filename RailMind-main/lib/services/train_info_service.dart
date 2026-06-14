import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config/app_config.dart';

/// Result of a PNR enquiry.
class PnrStatus {
  final String pnr;
  final String trainNumber;
  final String trainName;
  final String from;
  final String to;
  final String date;
  final String travelClass;
  final String chartStatus;
  final List<PnrPassenger> passengers;
  final bool isLive; // true if it came from a real API

  const PnrStatus({
    required this.pnr,
    required this.trainNumber,
    required this.trainName,
    required this.from,
    required this.to,
    required this.date,
    required this.travelClass,
    required this.chartStatus,
    required this.passengers,
    this.isLive = false,
  });
}

class PnrPassenger {
  final String label;
  final String bookingStatus;
  final String currentStatus;
  const PnrPassenger({
    required this.label,
    required this.bookingStatus,
    required this.currentStatus,
  });
}

/// Per-class fare estimate.
class FareEstimate {
  final String travelClass;
  final int distanceKm;
  final int amount;
  const FareEstimate(this.travelClass, this.distanceKm, this.amount);
}

/// Provides PNR status and fare estimates. Uses a real API when a key is set
/// (see [AppConfig.railApiKey]); otherwise returns realistic generated data so
/// the feature works offline.
class TrainInfoService {
  TrainInfoService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  bool get usingRealData => AppConfig.hasRailKey;

  static const Map<String, double> farePer100Km = {
    'General': 60,
    'Sleeper': 180,
    '3rd AC': 520,
    '2nd AC': 760,
    '1st AC': 1280,
  };

  static const List<String> _sampleTrains = [
    '12137 Punjab Mail',
    '12951 Rajdhani Express',
    '12009 Shatabdi Express',
    '12109 Hutatma Express',
    '11013 Coimbatore Express',
  ];

  static const List<String> _sampleStations = [
    'Mumbai CSMT',
    'Dadar',
    'Thane',
    'Kalyan Jn',
    'Igatpuri',
    'Nashik Road',
    'Pune Jn',
  ];

  Future<PnrStatus> pnrStatus(String pnr) async {
    final clean = pnr.replaceAll(RegExp(r'[^0-9]'), '');
    if (AppConfig.hasRailKey) {
      try {
        return await _livePnr(clean);
      } catch (_) {/* fall through to generated */}
    }
    await Future<void>.delayed(const Duration(milliseconds: 600));
    return _generatePnr(clean);
  }

  Future<PnrStatus> _livePnr(String pnr) async {
    final res = await _client.get(
      Uri.parse('https://${AppConfig.railApiHost}/api/v3/getPNRStatus?pnrNumber=$pnr'),
      headers: {
        'X-RapidAPI-Key': AppConfig.railApiKey,
        'X-RapidAPI-Host': AppConfig.railApiHost,
      },
    ).timeout(const Duration(seconds: 12));
    if (res.statusCode != 200) {
      throw Exception('PNR API ${res.statusCode}');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final data = (body['data'] ?? body) as Map<String, dynamic>;
    final list = (data['passengerList'] as List?) ?? const [];
    return PnrStatus(
      pnr: pnr,
      trainNumber: '${data['trainNumber'] ?? ''}',
      trainName: '${data['trainName'] ?? 'Train'}',
      from: '${data['boardingPoint'] ?? data['sourceStation'] ?? ''}',
      to: '${data['reservationUpto'] ?? data['destinationStation'] ?? ''}',
      date: '${data['dateOfJourney'] ?? ''}',
      travelClass: '${data['journeyClass'] ?? ''}',
      chartStatus: '${data['chartStatus'] ?? 'Chart Not Prepared'}',
      isLive: true,
      passengers: [
        for (var i = 0; i < list.length; i++)
          PnrPassenger(
            label: 'Passenger ${i + 1}',
            bookingStatus: '${list[i]['bookingStatus'] ?? '-'}',
            currentStatus: '${list[i]['currentStatus'] ?? '-'}',
          ),
      ],
    );
  }

  PnrStatus _generatePnr(String pnr) {
    final seed = pnr.isEmpty
        ? DateTime.now().millisecondsSinceEpoch
        : int.tryParse(pnr.substring(0, pnr.length.clamp(0, 9))) ??
            pnr.hashCode;
    int r(int mod) => (seed ~/ (mod + 1)) % mod;

    final train = _sampleTrains[r(_sampleTrains.length).abs()];
    final parts = train.split(' ');
    final number = parts.first;
    final name = parts.skip(1).join(' ');
    final fromIdx = r(_sampleStations.length - 2).abs();
    final from = _sampleStations[fromIdx];
    final to = _sampleStations[(fromIdx + 1 + r(3).abs()) % _sampleStations.length];
    final classes = ['Sleeper', '3rd AC', '2nd AC'];
    final cls = classes[r(classes.length).abs()];

    final paxCount = 1 + r(3).abs();
    final statuses = ['CNF', 'CNF', 'RAC', 'WL'];
    final coaches = ['S4', 'B1', 'A1', 'B2', 'S7'];
    final passengers = <PnrPassenger>[];
    for (var i = 0; i < paxCount; i++) {
      final s = statuses[(seed ~/ (i + 2)) % statuses.length];
      final coach = coaches[(seed ~/ (i + 3)) % coaches.length];
      final berth = 1 + ((seed ~/ (i + 1)) % 72);
      passengers.add(PnrPassenger(
        label: 'Passenger ${i + 1}',
        bookingStatus: s == 'WL'
            ? 'WL/${5 + (seed % 20)}'
            : s == 'RAC'
                ? 'RAC ${1 + (seed % 15)}'
                : 'CNF/$coach/$berth',
        currentStatus: s == 'WL'
            ? 'WL/${1 + (seed % 6)}'
            : s == 'RAC'
                ? 'RAC ${1 + (seed % 8)}'
                : 'CNF/$coach/$berth/${_berthType(berth)}',
      ));
    }
    final allCnf = passengers.every((p) => p.currentStatus.startsWith('CNF'));
    return PnrStatus(
      pnr: pnr.isEmpty ? '${seed.abs() % 10000000000}' : pnr,
      trainNumber: number,
      trainName: name,
      from: from,
      to: to,
      date: 'Today',
      travelClass: cls,
      chartStatus: allCnf ? 'Chart Prepared' : 'Chart Not Prepared',
      passengers: passengers,
    );
  }

  String _berthType(int b) {
    final m = b % 8;
    if (m == 1 || m == 4) return 'LB';
    if (m == 2 || m == 5) return 'MB';
    if (m == 3 || m == 6) return 'UB';
    if (m == 7) return 'SL';
    return 'SU';
  }

  /// Returns a fare estimate per class for the given [distanceKm].
  List<FareEstimate> estimateFares(int distanceKm, {int passengers = 1}) {
    final d = distanceKm.clamp(1, 5000);
    return farePer100Km.entries.map((e) {
      final base = (e.value * d / 100);
      // Reservation + GST style surcharge, rounded to nearest ₹5.
      final withFees = base * 1.12 + (e.key == 'General' ? 0 : 40);
      final total = (withFees * passengers / 5).round() * 5;
      return FareEstimate(e.key, d, total);
    }).toList();
  }

  void dispose() => _client.close();
}
