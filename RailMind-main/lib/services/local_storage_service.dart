import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../models/user_model.dart';

final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError('Initialize SharedPreferences in main.dart first');
});

final localStorageServiceProvider = Provider<LocalStorageService>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  return LocalStorageService(prefs);
});

class LocalStorageService {
  final SharedPreferences _prefs;

  LocalStorageService(this._prefs);

  // User Profile storage
  Future<void> saveUserProfile(UserModel user) async {
    await _prefs.setString('user_profile_${user.uid}', json.encode(user.toMap()));
  }

  UserModel? getUserProfile(String uid) {
    final raw = _prefs.getString('user_profile_$uid');
    if (raw == null) return null;
    try {
      final data = json.decode(raw);
      return UserModel.fromMap(Map<String, dynamic>.from(data));
    } catch (_) {
      return null;
    }
  }

  Future<void> clearUserProfile(String uid) async {
    await _prefs.remove('user_profile_$uid');
  }

  // Bookings storage
  List<Map<String, dynamic>> getBookings() {
    final rawList = _prefs.getStringList('bookings');
    if (rawList == null) {
      // Seed default sample bookings on first install
      final sampleBookings = [
        {
          'id': 'sample_upcoming_1',
          'trainId': '12137',
          'trainName': 'Punjab Mail',
          'fromStation': 'Mumbai CSMT',
          'toStation': 'Igatpuri',
          'departureTime': '08:00',
          'arrivalTime': '10:45',
          'pnr': '428-1938502',
          'date': '13 Jun 2026',
          'status': 'ON TIME',
          'travelClass': '2nd AC',
          'isUpcoming': true,
        },
        {
          'id': 'sample_past_1',
          'trainId': '12109',
          'trainName': 'Hutatma Express',
          'fromStation': 'Mumbai CSMT',
          'toStation': 'Kalyan Jn',
          'departureTime': '07:10',
          'arrivalTime': '08:05',
          'pnr': '234-8749302',
          'date': '12 May 2026',
          'status': 'COMPLETED',
          'travelClass': 'Sleeper',
          'isUpcoming': false,
        },
        {
          'id': 'sample_past_2',
          'trainId': '96501',
          'trainName': 'Kalyan Local',
          'fromStation': 'Kalyan Jn',
          'toStation': 'Mumbai CSMT',
          'departureTime': '18:20',
          'arrivalTime': '19:15',
          'pnr': '812-3450981',
          'date': '28 Apr 2026',
          'status': 'COMPLETED',
          'travelClass': 'General',
          'isUpcoming': false,
        }
      ];
      final raw = sampleBookings.map((item) => json.encode(item)).toList();
      _prefs.setStringList('bookings', raw);
      return sampleBookings;
    }

    return rawList.map((item) {
      try {
        return Map<String, dynamic>.from(json.decode(item));
      } catch (_) {
        return <String, dynamic>{};
      }
    }).where((item) => item.isNotEmpty).toList();
  }

  Future<void> addBooking(Map<String, dynamic> booking) async {
    final bookings = getBookings();
    // Check if duplicate ID
    bookings.removeWhere((item) => item['id'] == booking['id']);
    bookings.add(booking);
    final rawList = bookings.map((item) => json.encode(item)).toList();
    await _prefs.setStringList('bookings', rawList);
  }

  Future<void> deleteBooking(String bookingId) async {
    final bookings = getBookings();
    bookings.removeWhere((item) => item['id'] == bookingId);
    final rawList = bookings.map((item) => json.encode(item)).toList();
    await _prefs.setStringList('bookings', rawList);
  }

  // Search History storage
  List<Map<String, dynamic>> getSearchHistory() {
    final rawList = _prefs.getStringList('search_history') ?? [];
    return rawList.map((item) {
      try {
        return Map<String, dynamic>.from(json.decode(item));
      } catch (_) {
        return <String, dynamic>{};
      }
    }).where((item) => item.isNotEmpty).toList();
  }

  Future<void> addSearchQuery(String from, String to) async {
    final history = getSearchHistory();
    // Prevent exact duplicates
    history.removeWhere((item) =>
        item['from'].toString().toLowerCase() == from.trim().toLowerCase() &&
        item['to'].toString().toLowerCase() == to.trim().toLowerCase());

    history.insert(0, {
      'from': from.trim(),
      'to': to.trim(),
      'timestamp': DateTime.now().toIso8601String(),
    });

    // Limit search history to 5 entries
    if (history.length > 5) {
      history.removeLast();
    }

    final rawList = history.map((item) => json.encode(item)).toList();
    await _prefs.setStringList('search_history', rawList);
  }

  Future<void> clearSearchHistory() async {
    await _prefs.remove('search_history');
  }

  // Service orders (food / lounge)
  List<Map<String, dynamic>> getServiceOrders() {
    final rawList = _prefs.getStringList('service_orders') ?? [];
    return rawList.map((item) {
      try {
        return Map<String, dynamic>.from(json.decode(item));
      } catch (_) {
        return <String, dynamic>{};
      }
    }).where((item) => item.isNotEmpty).toList();
  }

  Future<void> addServiceOrder(Map<String, dynamic> order) async {
    final orders = getServiceOrders();
    orders.insert(0, order);
    await _prefs.setStringList(
        'service_orders', orders.map((o) => json.encode(o)).toList());
  }

  // Saved favorite stations / routes
  List<String> getFavorites() => _prefs.getStringList('favorites') ?? [];

  Future<void> toggleFavorite(String value) async {
    final favs = getFavorites();
    if (favs.contains(value)) {
      favs.remove(value);
    } else {
      favs.add(value);
    }
    await _prefs.setStringList('favorites', favs);
  }

  // Travel preferences (default class, home/notifications)
  Map<String, dynamic> getPreferences() {
    final raw = _prefs.getString('preferences');
    if (raw == null) return {};
    try {
      return Map<String, dynamic>.from(json.decode(raw));
    } catch (_) {
      return {};
    }
  }

  Future<void> savePreferences(Map<String, dynamic> prefs) async {
    await _prefs.setString('preferences', json.encode(prefs));
  }
}
