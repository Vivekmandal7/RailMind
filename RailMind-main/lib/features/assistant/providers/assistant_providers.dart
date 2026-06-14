import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../services/ai_assistant_service.dart';
import '../../../services/train_info_service.dart';
import '../../bookings/providers/bookings_provider.dart';
import '../../map/providers/map_providers.dart';

final aiAssistantServiceProvider = Provider<AiAssistantService>((ref) {
  final service = AiAssistantService();
  ref.onDispose(service.dispose);
  return service;
});

final trainInfoServiceProvider = Provider<TrainInfoService>((ref) {
  final service = TrainInfoService();
  ref.onDispose(service.dispose);
  return service;
});

/// State for the AI chat: the message list plus whether a reply is pending.
class AssistantState {
  final List<ChatMessage> messages;
  final bool thinking;

  const AssistantState({this.messages = const [], this.thinking = false});

  AssistantState copyWith({List<ChatMessage>? messages, bool? thinking}) =>
      AssistantState(
        messages: messages ?? this.messages,
        thinking: thinking ?? this.thinking,
      );
}

class AssistantController extends Notifier<AssistantState> {
  @override
  AssistantState build() {
    return AssistantState(messages: [
      ChatMessage(
        role: 'assistant',
        content:
            'Hi, I\'m **RailMind AI** 🚄\n\nYour smart travel co-pilot. Ask me '
            'to find trains, explain delays, estimate fares, check PNR status '
            'or order a meal to your seat.',
      ),
    ]);
  }

  /// Builds a short live-context string for the model from current app data.
  String _buildContext() {
    final buf = StringBuffer();
    final routes = ref.read(liveTrainRoutesProvider).value ?? const [];
    if (routes.isNotEmpty) {
      final sample = routes.take(4).map((r) =>
          '${r.id} ${r.name} (${r.status}${r.delayMin > 0 ? ', +${r.delayMin}m' : ''})');
      buf.writeln('Trains live now: ${sample.join('; ')}.');
    }
    final bookings = ref.read(bookingsProvider);
    final upcoming =
        bookings.where((b) => b['isUpcoming'] == true).toList();
    if (upcoming.isNotEmpty) {
      final b = upcoming.first;
      buf.writeln(
          'User\'s upcoming journey: ${b['trainId']} ${b['trainName']} from '
          '${b['fromStation']} to ${b['toStation']} (${b['status']}).');
    }
    return buf.toString();
  }

  Future<void> send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || state.thinking) return;

    final history = [
      ...state.messages,
      ChatMessage(role: 'user', content: trimmed),
    ];
    state = state.copyWith(messages: history, thinking: true);

    final service = ref.read(aiAssistantServiceProvider);
    final reply = await service.reply(history, context: _buildContext());

    state = state.copyWith(
      messages: [
        ...state.messages,
        ChatMessage(role: 'assistant', content: reply),
      ],
      thinking: false,
    );
  }

  void clear() => state = build();
}

final assistantControllerProvider =
    NotifierProvider<AssistantController, AssistantState>(
        AssistantController.new);
