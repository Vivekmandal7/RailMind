import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config/app_config.dart';

/// A single chat message in the assistant conversation.
class ChatMessage {
  final String role; // 'user' | 'assistant' | 'system'
  final String content;
  final DateTime time;

  ChatMessage({required this.role, required this.content, DateTime? time})
      : time = time ?? DateTime.now();

  bool get isUser => role == 'user';

  Map<String, String> toApi() => {'role': role, 'content': content};
}

/// Powers the in-app "RailMind AI" travel assistant.
///
/// * If an OpenAI-compatible key is configured (see [AppConfig.openAiApiKey])
///   it streams answers from a real LLM.
/// * Otherwise it falls back to a capable built-in "RailBot" that understands
///   common railway intents, so the feature is always useful offline.
class AiAssistantService {
  AiAssistantService({http.Client? client}) : _client = client ?? http.Client();

  final http.Client _client;

  static const String systemPrompt =
      'You are RailMind AI, a friendly, concise railway travel assistant for '
      'Indian Railways. Help users find trains, understand delays, plan '
      'journeys, check fares and PNR status, and suggest premium services like '
      'seat-delivered meals and lounge access. Keep answers short, practical '
      'and well formatted. If you are unsure of live data, say so.';

  bool get usingRealModel => AppConfig.hasAiKey;

  /// Returns the assistant reply for the given conversation [history]
  /// (most recent last). [context] is optional live info injected into the
  /// system prompt (e.g. nearby trains, the user's upcoming journey).
  Future<String> reply(List<ChatMessage> history, {String? context}) async {
    if (AppConfig.hasAiKey) {
      try {
        return await _openAiReply(history, context: context);
      } catch (_) {
        // Network / quota failure -> graceful offline answer.
        return _offlineReply(history.lastOrNull?.content ?? '', context);
      }
    }
    // Simulate a touch of latency so the typing indicator feels natural.
    await Future<void>.delayed(const Duration(milliseconds: 550));
    return _offlineReply(history.lastOrNull?.content ?? '', context);
  }

  Future<String> _openAiReply(List<ChatMessage> history,
      {String? context}) async {
    final sys = context == null
        ? systemPrompt
        : '$systemPrompt\n\nLive context you may use:\n$context';

    final res = await _client
        .post(
          Uri.parse('${AppConfig.openAiBaseUrl}/chat/completions'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${AppConfig.openAiApiKey}',
          },
          body: jsonEncode({
            'model': AppConfig.openAiModel,
            'temperature': 0.6,
            'messages': [
              {'role': 'system', 'content': sys},
              ...history.map((m) => m.toApi()),
            ],
          }),
        )
        .timeout(const Duration(seconds: 30));

    if (res.statusCode != 200) {
      throw Exception('OpenAI error ${res.statusCode}: ${res.body}');
    }
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final choices = body['choices'] as List;
    return (choices.first['message']['content'] as String).trim();
  }

  // ----------------------------------------------------------------------- //
  // Offline "RailBot" — intent-based answers so the assistant always works.
  // ----------------------------------------------------------------------- //
  String _offlineReply(String input, String? context) {
    final q = input.toLowerCase().trim();

    if (q.isEmpty) {
      return 'Ask me anything about your journey — I can find trains, explain '
          'delays, estimate fares, check PNR status or order a meal to your seat.';
    }

    if (_has(q, ['hello', 'hi', 'hey', 'namaste'])) {
      return 'Hi! I\'m RailMind AI 🚄 — your travel co-pilot. I can help you '
          'find trains, track them live, estimate fares, and more. Where are '
          'you headed?';
    }

    if (_has(q, ['delay', 'late', 'running late', 'on time'])) {
      return 'Delays usually come from track congestion, signal waits or '
          'weather. Open the **Live Map** tab to see your train\'s real-time '
          'position, speed and ETA. Trains marked **ON TIME** have no reported '
          'delay; **DELAYED** shows the minutes lost.';
    }

    if (_has(q, ['fare', 'price', 'cost', 'ticket price', 'how much'])) {
      return 'Fares depend on distance and class. As a rough guide per 100 km:\n'
          '• General ≈ ₹60\n• Sleeper ≈ ₹180\n• 3rd AC ≈ ₹520\n• 2nd AC ≈ ₹760\n\n'
          'Use the **Fare Estimator** tool on the Home tab for an exact figure '
          'on your route.';
    }

    if (_has(q, ['pnr', 'status', 'confirmed', 'waiting list', 'rac'])) {
      return 'You can check any 10-digit PNR in the **PNR Status** tool on the '
          'Home tab. It shows booking status (CNF / RAC / WL), coach, berth and '
          'live running status.';
    }

    if (_has(q, ['food', 'meal', 'eat', 'hungry', 'order'])) {
      return 'Hungry? 🍱 Tap **Order Food** on the Home tab to get a meal '
          'delivered right to your seat at the next halt — thali, biryani, '
          'dosa, snacks and beverages are available.';
    }

    if (_has(q, ['lounge', 'wait', 'rest'])) {
      return 'You can pre-book an **Executive Lounge** from the Home tab — '
          'comfortable seating, Wi-Fi and refreshments at major stations before '
          'your departure.';
    }

    if (_has(q, ['book', 'reserve', 'find train', 'search', 'trains from'])) {
      return 'To book, use the search card on the **Home** tab: enter your From '
          'and To stations, pick a date and class, then tap **Search Trains**. '
          'I\'ll show available trains with live status, and you can book or '
          'track each one.';
    }

    if (_has(q, ['track', 'live', 'where is', 'location', 'map'])) {
      return 'Head to the **Live Map** tab to watch your train move in '
          'real time, with a glowing position marker, speed, heading and a '
          'station-by-station timeline.';
    }

    if (_has(q, ['thank', 'thanks', 'great', 'awesome'])) {
      return 'Anytime! Safe travels and smooth journeys 🚆✨';
    }

    final ctxLine = context != null && context.trim().isNotEmpty
        ? '\n\nBased on what\'s live right now: $context'
        : '';

    return 'Here\'s how I can help with that: I can find trains between two '
        'stations, explain delays, estimate fares, check PNR status, and book '
        'meals or lounge access. Try asking e.g. *"trains from Mumbai to '
        'Igatpuri"* or *"fare for 2nd AC over 200 km"*.$ctxLine';
  }

  bool _has(String text, List<String> keys) =>
      keys.any((k) => text.contains(k));

  /// Handy starter prompts shown as chips in the UI.
  static const List<String> suggestedPrompts = [
    'Find trains from Mumbai to Igatpuri',
    'Why might my train be delayed?',
    'Estimate fare for 2nd AC, 250 km',
    'How do I check my PNR status?',
    'Order food to my seat',
  ];

  void dispose() => _client.close();
}
