import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../services/local_storage_service.dart';

/// Saved favorite stations / routes, persisted locally.
class FavoritesNotifier extends Notifier<List<String>> {
  late final LocalStorageService _storage;

  @override
  List<String> build() {
    _storage = ref.watch(localStorageServiceProvider);
    return _storage.getFavorites();
  }

  Future<void> toggle(String value) async {
    await _storage.toggleFavorite(value);
    state = _storage.getFavorites();
  }

  bool contains(String value) => state.contains(value);
}

final favoritesProvider =
    NotifierProvider<FavoritesNotifier, List<String>>(FavoritesNotifier.new);

/// Travel preferences (default class, notification toggles), persisted locally.
class PreferencesNotifier extends Notifier<Map<String, dynamic>> {
  late final LocalStorageService _storage;

  @override
  Map<String, dynamic> build() {
    _storage = ref.watch(localStorageServiceProvider);
    final prefs = _storage.getPreferences();
    return {
      'defaultClass': prefs['defaultClass'] ?? 'General',
      'journeyAlerts': prefs['journeyAlerts'] ?? true,
      'delayAlerts': prefs['delayAlerts'] ?? true,
      'promos': prefs['promos'] ?? false,
    };
  }

  Future<void> update(String key, dynamic value) async {
    final next = {...state, key: value};
    await _storage.savePreferences(next);
    state = next;
  }
}

final preferencesProvider =
    NotifierProvider<PreferencesNotifier, Map<String, dynamic>>(
        PreferencesNotifier.new);
