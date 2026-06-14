import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../services/local_storage_service.dart';

class SearchHistoryNotifier extends Notifier<List<Map<String, dynamic>>> {
  late final LocalStorageService _storage;

  @override
  List<Map<String, dynamic>> build() {
    _storage = ref.watch(localStorageServiceProvider);
    return _storage.getSearchHistory();
  }

  Future<void> saveSearch(String from, String to) async {
    await _storage.addSearchQuery(from, to);
    state = _storage.getSearchHistory();
  }

  Future<void> clearHistory() async {
    await _storage.clearSearchHistory();
    state = [];
  }
}

final searchHistoryProvider = NotifierProvider<SearchHistoryNotifier, List<Map<String, dynamic>>>(() {
  return SearchHistoryNotifier();
});
