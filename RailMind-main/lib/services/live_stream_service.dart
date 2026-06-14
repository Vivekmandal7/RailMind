import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

import '../core/config/app_config.dart';
import '../features/map/models/live_snapshot_model.dart';

/// Connects to the backend `/stream` WebSocket and exposes a stream of
/// [TwinSnapshot] frames. The backend pushes an immediate snapshot on connect
/// and then one per tick.
///
/// The returned stream *errors* if the socket cannot be established or drops, so
/// callers can fall back to REST polling / the offline simulator.
class LiveStreamService {
  WebSocketChannel? _channel;

  Stream<TwinSnapshot> connect() {
    final controller = StreamController<TwinSnapshot>();
    WebSocketChannel channel;
    try {
      channel = WebSocketChannel.connect(Uri.parse(AppConfig.streamUrl));
    } catch (e) {
      controller.addError(e);
      controller.close();
      return controller.stream;
    }
    _channel = channel;

    // If the socket never opens, surface an error so the caller can fall back.
    channel.ready.timeout(AppConfig.connectTimeout).then((_) {
      // connected — nothing to do, frames flow through the listener below
    }).catchError((Object e) {
      if (!controller.isClosed) controller.addError(e);
    });

    channel.stream.listen(
      (dynamic message) {
        try {
          final map = json.decode(message as String) as Map<String, dynamic>;
          controller.add(TwinSnapshot.fromJson(map));
        } catch (_) {
          // ignore malformed frames
        }
      },
      onError: (Object e) {
        if (!controller.isClosed) controller.addError(e);
      },
      onDone: () {
        if (!controller.isClosed) controller.close();
      },
      cancelOnError: true,
    );

    controller.onCancel = () => dispose();
    return controller.stream;
  }

  void dispose() {
    _channel?.sink.close();
    _channel = null;
  }
}
