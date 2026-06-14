import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/config/app_config.dart';
import '../features/map/models/network_model.dart';
import '../features/map/models/live_snapshot_model.dart';

/// Thin REST client for the RailMind FastAPI backend.
class RailMindApiService {
  RailMindApiService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _client;
  final String _baseUrl;

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  /// Quick reachability probe used to decide live-vs-offline.
  Future<bool> ping() async {
    try {
      final res = await _client
          .get(_uri('/health'))
          .timeout(AppConfig.connectTimeout);
      return res.statusCode == 200;
    } catch (_) {
      return false;
    }
  }

  Future<NetworkModel> fetchNetwork() async {
    final res =
        await _client.get(_uri('/network')).timeout(AppConfig.connectTimeout);
    if (res.statusCode != 200) {
      throw RailMindApiException('GET /network failed: ${res.statusCode}');
    }
    return NetworkModel.fromJson(
        json.decode(res.body) as Map<String, dynamic>);
  }

  Future<TwinSnapshot> fetchSnapshot() async {
    final res =
        await _client.get(_uri('/snapshot')).timeout(AppConfig.connectTimeout);
    if (res.statusCode != 200) {
      throw RailMindApiException('GET /snapshot failed: ${res.statusCode}');
    }
    return TwinSnapshot.fromJson(json.decode(res.body) as Map<String, dynamic>);
  }

  Future<List<CorridorOption>> fetchCorridors() async {
    final res = await _client
        .get(_uri('/corridors'))
        .timeout(AppConfig.connectTimeout);
    if (res.statusCode != 200) {
      throw RailMindApiException('GET /corridors failed: ${res.statusCode}');
    }
    final body = json.decode(res.body) as Map<String, dynamic>;
    return (body['corridors'] as List)
        .map((e) => CorridorOption.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Switch the active backend corridor. Returns true on success.
  Future<bool> switchCorridor(String key) async {
    final res = await _client
        .post(
          _uri('/corridor'),
          headers: {'Content-Type': 'application/json'},
          body: json.encode({'key': key}),
        )
        .timeout(AppConfig.connectTimeout);
    if (res.statusCode != 200) return false;
    final body = json.decode(res.body) as Map<String, dynamic>;
    return body['ok'] == true;
  }

  void dispose() => _client.close();
}

class RailMindApiException implements Exception {
  final String message;
  RailMindApiException(this.message);
  @override
  String toString() => 'RailMindApiException: $message';
}
