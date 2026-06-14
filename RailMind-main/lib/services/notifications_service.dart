import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';

/// Thin, best-effort wrapper around Firebase Cloud Messaging.
///
/// All calls are guarded so the app keeps working where push isn't available
/// (e.g. Flutter web without a configured VAPID key / service worker, or when
/// permission is denied).
class NotificationsService {
  static String? token;

  /// Request permission and capture the device token. Safe to call once at
  /// startup; failures are swallowed.
  static Future<void> init() async {
    try {
      final messaging = FirebaseMessaging.instance;
      await messaging
          .requestPermission()
          .timeout(const Duration(seconds: 5), onTimeout: () => throw 'timeout');
      if (!kIsWeb) {
        token = await messaging.getToken();
      }
      FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        debugPrint('FCM foreground: ${message.notification?.title}');
      });
    } catch (e) {
      debugPrint('NotificationsService.init skipped: $e');
    }
  }

  static Future<void> subscribe(String topic) async {
    if (kIsWeb) return; // topic subscription unsupported on web
    try {
      await FirebaseMessaging.instance.subscribeToTopic(topic);
    } catch (e) {
      debugPrint('subscribe($topic) failed: $e');
    }
  }

  static Future<void> unsubscribe(String topic) async {
    if (kIsWeb) return;
    try {
      await FirebaseMessaging.instance.unsubscribeFromTopic(topic);
    } catch (e) {
      debugPrint('unsubscribe($topic) failed: $e');
    }
  }
}
