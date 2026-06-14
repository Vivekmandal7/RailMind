import 'package:flutter/foundation.dart';

/// Central configuration for talking to the RailMind backend (the FastAPI
/// "digital twin" engine that lives in `backend/`).
///
/// The base URL is platform-aware so the same build "just works" in the most
/// common dev setups:
///   * Web / iOS simulator / desktop -> http://localhost:8000
///   * Android emulator              -> http://10.0.2.2:8000 (host loopback)
///
/// It can be overridden at build time with:
///   flutter run --dart-define=RAILMIND_API=http://192.168.1.50:8000
class AppConfig {
  AppConfig._();

  static const String _override =
      String.fromEnvironment('RAILMIND_API', defaultValue: '');

  /// HTTP base, e.g. `http://localhost:8000`.
  static String get apiBaseUrl {
    if (_override.isNotEmpty) return _stripTrailingSlash(_override);
    if (kIsWeb) return 'http://localhost:8000';
    if (defaultTargetPlatform == TargetPlatform.android) {
      return 'http://10.0.2.2:8000';
    }
    return 'http://localhost:8000';
  }

  /// WebSocket base derived from [apiBaseUrl] (http->ws, https->wss).
  static String get wsBaseUrl =>
      apiBaseUrl.replaceFirst(RegExp(r'^http'), 'ws');

  /// Live snapshot stream endpoint.
  static String get streamUrl => '$wsBaseUrl/stream';

  /// How often to poll `/snapshot` when the WebSocket is unavailable.
  static const Duration pollInterval = Duration(seconds: 2);

  /// How long to wait on the initial connection before falling back.
  static const Duration connectTimeout = Duration(seconds: 4);

  /// Offline asset used by the in-app simulator when the backend is unreachable.
  static const String offlineNetworkAsset = 'assets/offline/network_mumbai.json';

  static String _stripTrailingSlash(String s) =>
      s.endsWith('/') ? s.substring(0, s.length - 1) : s;

  // --------------------------------------------------------------------- //
  // AI assistant (OpenAI-compatible) configuration
  //
  // Provide a key at build/run time, e.g.:
  //   flutter run --dart-define=OPENAI_API_KEY=sk-...
  // When no key is present the assistant gracefully falls back to a built-in
  // offline "RailBot" so the feature always works.
  // --------------------------------------------------------------------- //
  static const String openAiApiKey =
      String.fromEnvironment('OPENAI_API_KEY', defaultValue: '');

  static const String openAiBaseUrl = String.fromEnvironment(
    'OPENAI_BASE_URL',
    defaultValue: 'https://api.openai.com/v1',
  );

  static const String openAiModel =
      String.fromEnvironment('OPENAI_MODEL', defaultValue: 'gpt-4o-mini');

  static bool get hasAiKey => openAiApiKey.isNotEmpty;

  // --------------------------------------------------------------------- //
  // Live Indian Railways data (RapidAPI-compatible). Optional — when absent
  // the app uses realistic generated data so every screen stays functional.
  //   flutter run --dart-define=RAIL_API_KEY=... --dart-define=RAIL_API_HOST=...
  // --------------------------------------------------------------------- //
  static const String railApiKey =
      String.fromEnvironment('RAIL_API_KEY', defaultValue: '');

  static const String railApiHost = String.fromEnvironment(
    'RAIL_API_HOST',
    defaultValue: 'irctc1.p.rapidapi.com',
  );

  static bool get hasRailKey => railApiKey.isNotEmpty;
}
