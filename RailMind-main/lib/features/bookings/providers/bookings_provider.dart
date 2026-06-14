import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../services/local_storage_service.dart';

class BookingsNotifier extends Notifier<List<Map<String, dynamic>>> {
  late final LocalStorageService _storage;

  @override
  List<Map<String, dynamic>> build() {
    _storage = ref.watch(localStorageServiceProvider);
    return _storage.getBookings();
  }

  Future<void> bookTicket(Map<String, dynamic> booking) async {
    await _storage.addBooking(booking);
    // Reload state reactively
    state = _storage.getBookings();
  }

  Future<void> cancelBooking(String bookingId) async {
    await _storage.deleteBooking(bookingId);
    // Reload state reactively
    state = _storage.getBookings();
  }
}

final bookingsProvider = NotifierProvider<BookingsNotifier, List<Map<String, dynamic>>>(() {
  return BookingsNotifier();
});
