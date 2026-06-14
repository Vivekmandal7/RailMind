import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/eticket_sheet.dart';
import '../models/train_route_model.dart';
import '../providers/map_providers.dart';

class MapScreen extends ConsumerStatefulWidget {
  const MapScreen({super.key});

  @override
  ConsumerState<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends ConsumerState<MapScreen>
    with SingleTickerProviderStateMixin {
  late final MapController _mapController;
  late final AnimationController _mapAnimationController;
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();
  int _mapStyleIndex = 0;
  bool _didInitialFit = false;
  bool _follow = true; // keep the tracked train centered as it moves
  String? _lastTrackedTrainId;
  Marker? _userMarker;

  @override
  void initState() {
    super.initState();
    _mapController = MapController();
    _mapAnimationController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    );
  }

  @override
  void dispose() {
    _mapController.dispose();
    _mapAnimationController.dispose();
    _searchController.dispose();
    _searchFocusNode.dispose();
    super.dispose();
  }

  void _animatedMapMove(LatLng destLocation, double destZoom) {
    final latTween = Tween<double>(
        begin: _mapController.camera.center.latitude,
        end: destLocation.latitude);
    final lngTween = Tween<double>(
        begin: _mapController.camera.center.longitude,
        end: destLocation.longitude);
    final zoomTween =
        Tween<double>(begin: _mapController.camera.zoom, end: destZoom);
    final animation = CurvedAnimation(
        parent: _mapAnimationController, curve: Curves.fastOutSlowIn);
    _mapAnimationController.reset();
    _mapAnimationController
      ..removeListener(_moveListener)
      ..addListener(_moveListener);
    _latTween = latTween;
    _lngTween = lngTween;
    _zoomTween = zoomTween;
    _moveAnimation = animation;
    _mapAnimationController.forward();
  }

  Tween<double>? _latTween, _lngTween, _zoomTween;
  Animation<double>? _moveAnimation;
  void _moveListener() {
    final a = _moveAnimation;
    if (a == null) return;
    _mapController.move(
      LatLng(_latTween!.evaluate(a), _lngTween!.evaluate(a)),
      _zoomTween!.evaluate(a),
    );
  }

  String _getTileUrl(bool isDark) {
    if (_mapStyleIndex == 1) {
      return 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    } else if (_mapStyleIndex == 2) {
      return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    }
    return isDark
        ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  }

  bool _usesSubdomains() => _mapStyleIndex != 2;

  Future<void> _goToMyLocation() async {
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        _toast('Location permission denied');
        return;
      }
      final pos = await Geolocator.getCurrentPosition();
      final me = LatLng(pos.latitude, pos.longitude);
      setState(() {
        _userMarker = Marker(
          point: me,
          width: 24,
          height: 24,
          child: const _MyLocationDot(),
        );
      });
      _animatedMapMove(me, 12);
    } catch (e) {
      _toast('Could not get your location');
    }
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), duration: const Duration(seconds: 2)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final routesAsync = ref.watch(liveTrainRoutesProvider);
    final selectedTrain = ref.watch(selectedTrainRouteProvider);

    return Scaffold(
      backgroundColor: theme.colorScheme.surface,
      appBar: AppBar(
        backgroundColor: theme.colorScheme.surface,
        elevation: 0.5,
        title: Text('RailMind',
            style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.bold,
                color: theme.colorScheme.primary)),
        actions: [_CorridorMenu()],
      ),
      body: routesAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => _buildErrorState(theme),
        data: (routes) {
          if (routes.isEmpty) {
            return _buildEmptyState(theme);
          }
          final train = selectedTrain ?? routes.first;
          return _buildMap(context, theme, isDark, train);
        },
      ),
    );
  }

  Widget _buildErrorState(ThemeData theme) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.cloud_off,
                size: 48, color: theme.colorScheme.onSurfaceVariant),
            const SizedBox(height: 12),
            Text('Could not load live trains',
                style: theme.textTheme.titleMedium),
            const SizedBox(height: 6),
            Text('Pull to retry or check that the backend is running.',
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => ref.invalidate(liveFrameProvider),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState(ThemeData theme) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.train_outlined,
              size: 48, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(height: 12),
          Text('No active trains right now',
              style: theme.textTheme.titleMedium),
        ],
      ),
    );
  }

  Widget _buildMap(BuildContext context, ThemeData theme, bool isDark,
      TrainRoute selectedTrain) {
    final searchResults = ref.watch(mapSearchResultsProvider);
    final liveStatus = ref.watch(liveStatusProvider);
    final primaryColor = theme.colorScheme.primary;
    final secondaryColor = theme.colorScheme.secondary;
    final textMutedColor = theme.colorScheme.onSurfaceVariant;
    final cardText = theme.colorScheme.onSurface;

    // Center on the train initially, then keep following it as it moves so the
    // live motion is unmistakable. The user can pan to break follow.
    if (_lastTrackedTrainId != selectedTrain.id) {
      _lastTrackedTrainId = selectedTrain.id;
      _didInitialFit = false;
      _follow = true;
    }

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!_didInitialFit) {
        _didInitialFit = true;
        _mapController.move(selectedTrain.currentLocation, 13);
      } else if (_follow && !_mapAnimationController.isAnimating) {
        _mapController.move(
            selectedTrain.currentLocation, _mapController.camera.zoom);
      }
    });

    return Stack(
      children: [
        Positioned.fill(
          child: FlutterMap(
            mapController: _mapController,
            options: MapOptions(
              initialCenter: selectedTrain.defaultCenter,
              initialZoom: selectedTrain.defaultZoom,
              minZoom: 2,
              maxZoom: 18,
              onTap: (_, _) => _searchFocusNode.unfocus(),
              onPositionChanged: (camera, hasGesture) {
                // A user drag breaks auto-follow so they can explore freely.
                if (hasGesture && _follow) {
                  setState(() => _follow = false);
                }
              },
            ),
            children: [
              TileLayer(
                urlTemplate: _getTileUrl(isDark),
                userAgentPackageName: 'com.example.railmind',
                subdomains: _usesSubdomains()
                    ? const ['a', 'b', 'c', 'd']
                    : const <String>[],
              ),
              PolylineLayer(
                polylines: [
                  Polyline(
                      points: selectedTrain.routePoints,
                      color: secondaryColor.withValues(alpha: 0.25),
                      strokeWidth: 8.0),
                  Polyline(
                      points: selectedTrain.routePoints,
                      color: secondaryColor,
                      strokeWidth: 3.5,
                      strokeCap: StrokeCap.round),
                  Polyline(
                      points: selectedTrain.routePoints,
                      color: Colors.white.withValues(alpha: 0.8),
                      strokeWidth: 1.5,
                      pattern: StrokePattern.dashed(segments: const [6.0, 6.0])),
                ],
              ),
              MarkerLayer(
                markers: [
                  ...selectedTrain.stations.map((station) {
                    final isFinal = station == selectedTrain.finalDestination;
                    if (isFinal) {
                      return Marker(
                        point: station.location,
                        width: 160,
                        height: 54,
                        alignment: Alignment.topCenter,
                        child: _DestinationLabel(name: station.name),
                      );
                    }
                    return Marker(
                      point: station.location,
                      width: 14,
                      height: 14,
                      child: Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: station.isPassed ? Colors.grey : secondaryColor,
                          border: Border.all(color: Colors.white, width: 2),
                        ),
                      ),
                    );
                  }),
                  ?_userMarker,
                  Marker(
                    point: selectedTrain.currentLocation,
                    width: 50,
                    height: 50,
                    child: PulsingTrainMarker(
                      color: selectedTrain.isOnTime
                          ? (isDark
                              ? AppTheme.successGreenLight
                              : AppTheme.successGreen)
                          : const Color(0xFFFF3B30),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        _buildSearchBar(theme, searchResults, cardText, textMutedColor,
            secondaryColor),
        if (liveStatus != null)
          Positioned(
            top: 74,
            left: 16,
            child: _ProvenanceBadge(status: liveStatus, source: selectedTrain.source),
          ),
        _buildMapControls(theme, primaryColor, secondaryColor, selectedTrain),
        _buildStatusCard(context, theme, selectedTrain, cardText,
            textMutedColor, secondaryColor),
      ],
    );
  }

  Widget _buildSearchBar(ThemeData theme, List<TrainRoute> searchResults,
      Color cardText, Color textMutedColor, Color secondaryColor) {
    return Positioned(
      top: 16,
      left: 16,
      right: 16,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              color: theme.colorScheme.surface.withValues(alpha: 0.96),
              borderRadius: BorderRadius.circular(12),
              border:
                  Border.all(color: theme.colorScheme.outlineVariant, width: 1),
              boxShadow: [
                BoxShadow(
                    color: Colors.black.withValues(alpha: 0.08),
                    blurRadius: 12,
                    offset: const Offset(0, 4))
              ],
            ),
            child: TextField(
              controller: _searchController,
              focusNode: _searchFocusNode,
              style: TextStyle(color: cardText, fontSize: 14),
              onChanged: (value) =>
                  ref.read(mapSearchQueryProvider.notifier).setQuery(value),
              decoration: InputDecoration(
                hintText: 'Search train by name, number or station…',
                hintStyle: TextStyle(color: textMutedColor, fontSize: 13),
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                prefixIcon: Icon(Icons.search, color: textMutedColor),
                suffixIcon: _searchController.text.isNotEmpty
                    ? IconButton(
                        icon: Icon(Icons.clear, color: textMutedColor),
                        onPressed: () {
                          _searchController.clear();
                          ref.read(mapSearchQueryProvider.notifier).clearQuery();
                        },
                      )
                    : Icon(Icons.train, color: secondaryColor),
                contentPadding: const EdgeInsets.symmetric(vertical: 14),
                filled: false,
              ),
            ),
          ),
          if (searchResults.isNotEmpty)
            Container(
              margin: const EdgeInsets.only(top: 8),
              constraints: const BoxConstraints(maxHeight: 220),
              decoration: BoxDecoration(
                color: theme.colorScheme.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                    color: theme.colorScheme.outlineVariant, width: 1),
              ),
              child: ListView.separated(
                padding: EdgeInsets.zero,
                shrinkWrap: true,
                itemCount: searchResults.length,
                separatorBuilder: (context, index) => Divider(
                    color: theme.colorScheme.outlineVariant
                        .withValues(alpha: 0.5),
                    height: 1),
                itemBuilder: (context, index) {
                  final train = searchResults[index];
                  return ListTile(
                    title: Text(train.name,
                        style: TextStyle(
                            color: cardText,
                            fontWeight: FontWeight.bold,
                            fontSize: 14)),
                    subtitle: Text(
                        'Route: ${train.stations.isEmpty ? train.id : train.stations.first.name} → ${train.stations.isEmpty ? '' : train.stations.last.name}',
                        style: TextStyle(color: textMutedColor, fontSize: 12)),
                    trailing: _StatusPill(status: train.status),
                    onTap: () {
                      ref
                          .read(selectedTrainNumberProvider.notifier)
                          .select(train.id);
                      _searchController.clear();
                      ref.read(mapSearchQueryProvider.notifier).clearQuery();
                      _searchFocusNode.unfocus();
                      _animatedMapMove(
                          train.currentLocation, train.defaultZoom + 1);
                    },
                  );
                },
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildMapControls(ThemeData theme, Color primaryColor,
      Color secondaryColor, TrainRoute selectedTrain) {
    return Positioned(
      top: 86,
      right: 16,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton.small(
            heroTag: 'follow_train_btn',
            backgroundColor:
                _follow ? secondaryColor : theme.colorScheme.surface,
            foregroundColor: _follow ? Colors.white : primaryColor,
            elevation: 4,
            tooltip: _follow ? 'Following train' : 'Follow train',
            onPressed: () {
              setState(() => _follow = true);
              _animatedMapMove(selectedTrain.currentLocation, 13);
            },
            child: Icon(Icons.gps_fixed,
                color: _follow ? Colors.white : secondaryColor),
          ),
          const SizedBox(height: 8),
          FloatingActionButton.small(
            heroTag: 'my_loc_btn',
            backgroundColor: theme.colorScheme.surface,
            foregroundColor: primaryColor,
            elevation: 4,
            tooltip: 'My location',
            onPressed: _goToMyLocation,
            child: Icon(Icons.my_location, color: secondaryColor),
          ),
          const SizedBox(height: 8),
          FloatingActionButton.small(
            heroTag: 'map_layer_btn',
            backgroundColor: theme.colorScheme.surface,
            foregroundColor: primaryColor,
            elevation: 4,
            tooltip: 'Map style',
            onPressed: () {
              setState(() => _mapStyleIndex = (_mapStyleIndex + 1) % 3);
            },
            child: Icon(Icons.layers, color: secondaryColor),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusCard(
      BuildContext context,
      ThemeData theme,
      TrainRoute selectedTrain,
      Color cardText,
      Color textMutedColor,
      Color secondaryColor) {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Container(
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          boxShadow: [
            BoxShadow(
                color: Colors.black.withValues(alpha: 0.12),
                blurRadius: 20,
                offset: const Offset(0, -6))
          ],
        ),
        child: SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 86),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 48,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                        color: theme.colorScheme.outlineVariant
                            .withValues(alpha: 0.6),
                        borderRadius: BorderRadius.circular(2)),
                  ),
                ),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('CURRENT STATUS',
                              style: TextStyle(
                                  color: textMutedColor,
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  letterSpacing: 0.5)),
                          const SizedBox(height: 4),
                          Wrap(
                            crossAxisAlignment: WrapCrossAlignment.center,
                            spacing: 8,
                            runSpacing: 4,
                            children: [
                              Text(selectedTrain.name,
                                  style: TextStyle(
                                      color: cardText,
                                      fontWeight: FontWeight.w800,
                                      fontSize: 20)),
                              _StatusPill(status: selectedTrain.status),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '${selectedTrain.id} • ${selectedTrain.speedKmh.round()} km/h'
                            '${selectedTrain.nextStationName != null ? ' • next: ${selectedTrain.nextStationName}' : ''}',
                            style:
                                TextStyle(color: textMutedColor, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(selectedTrain.eta,
                            style: TextStyle(
                                color: secondaryColor,
                                fontSize: 28,
                                fontWeight: FontWeight.bold,
                                height: 1.1)),
                        Text('Est. Arrival',
                            style: TextStyle(
                                color: textMutedColor, fontSize: 11)),
                      ],
                    )
                  ],
                ),
                const SizedBox(height: 20),
                ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 220),
                  child: SingleChildScrollView(
                    child: Column(
                      children: [
                        for (int i = 0; i < selectedTrain.stations.length; i++)
                          _buildTimelineItem(
                            context: context,
                            station: selectedTrain.stations[i],
                            isFirst: i == 0,
                            isLast: i == selectedTrain.stations.length - 1,
                            theme: theme,
                            selectedTrain: selectedTrain,
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: ElevatedButton.icon(
                        onPressed: () => _viewTicket(selectedTrain),
                        icon: const Icon(Icons.qr_code, size: 20),
                        label: const Text('View Ticket'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: secondaryColor,
                          foregroundColor: const Color(0xFF042424),
                          padding: const EdgeInsets.symmetric(vertical: 16),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(12)),
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Container(
                      decoration: BoxDecoration(
                          color: theme.colorScheme.outlineVariant
                              .withValues(alpha: 0.15),
                          borderRadius: BorderRadius.circular(12)),
                      child: IconButton(
                        icon: Icon(Icons.share, color: cardText),
                        padding: const EdgeInsets.all(16),
                        onPressed: () => _shareJourney(selectedTrain),
                      ),
                    )
                  ],
                )
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _viewTicket(TrainRoute train) {
    final from = train.stations.isEmpty ? '' : train.stations.first.name;
    final to = train.stations.isEmpty ? '' : train.stations.last.name;
    showETicketSheet(
      context,
      ETicketData(
        trainId: train.id,
        trainName: train.name,
        pnr: 'LIVE-${train.id}',
        fromStation: from,
        toStation: to,
        departureTime:
            train.stations.isEmpty ? '--:--' : train.stations.first.time,
        arrivalTime: train.eta,
        date: 'Today',
        status: train.status,
      ),
    );
  }

  void _shareJourney(TrainRoute train) {
    final from = train.stations.isEmpty ? '' : train.stations.first.name;
    final to = train.stations.isEmpty ? '' : train.stations.last.name;
    Share.share(
      'Tracking ${train.name} (${train.id}) on RailMind 🚄\n'
      '$from → $to\nStatus: ${train.status} • ETA ${train.eta}\n'
      'Speed ${train.speedKmh.round()} km/h',
    );
  }

  Widget _buildTimelineItem({
    required BuildContext context,
    required StationStop station,
    required bool isFirst,
    required bool isLast,
    required ThemeData theme,
    required TrainRoute selectedTrain,
  }) {
    final primaryColor = theme.colorScheme.primary;
    final secondaryColor = theme.colorScheme.secondary;
    final textMutedColor = theme.colorScheme.onSurfaceVariant;
    final cardText = theme.colorScheme.onSurface;

    Color nodeColor;
    Widget nodeWidget;
    final isNext = station.name == selectedTrain.nextStop?.name;

    if (station.isPassed) {
      nodeColor = textMutedColor.withValues(alpha: 0.6);
      nodeWidget = Container(
        width: 14,
        height: 14,
        decoration: BoxDecoration(shape: BoxShape.circle, color: nodeColor),
        child: const Icon(Icons.check, size: 9, color: Colors.white),
      );
    } else if (isNext) {
      nodeColor = secondaryColor;
      nodeWidget = Container(
        width: 14,
        height: 14,
        decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: secondaryColor, width: 2),
            color: theme.colorScheme.surface),
      );
    } else {
      nodeColor = primaryColor;
      nodeWidget = Container(
        width: 14,
        height: 14,
        decoration: BoxDecoration(shape: BoxShape.circle, color: primaryColor),
      );
    }

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 24,
            child: Column(
              children: [
                nodeWidget,
                if (!isLast)
                  Expanded(
                    child: Container(
                        width: 2,
                        color: station.isPassed
                            ? textMutedColor.withValues(alpha: 0.3)
                            : theme.colorScheme.outlineVariant),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(station.name,
                      style: TextStyle(
                          color: cardText,
                          fontWeight:
                              isNext ? FontWeight.bold : FontWeight.w500,
                          fontSize: 14)),
                  const SizedBox(height: 2),
                  Text(station.subtitle,
                      style: TextStyle(
                          color: isNext ? secondaryColor : textMutedColor,
                          fontSize: 11,
                          fontWeight:
                              isNext ? FontWeight.w600 : FontWeight.normal)),
                ],
              ),
            ),
          ),
          Text(station.time,
              style: TextStyle(
                  color: cardText, fontWeight: FontWeight.bold, fontSize: 14)),
        ],
      ),
    );
  }
}

// --------------------------------------------------------------------------- //
// Small widgets
// --------------------------------------------------------------------------- //
class _CorridorMenu extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final corridors = ref.watch(corridorsProvider).value ?? const [];
    final theme = Theme.of(context);
    if (corridors.isEmpty) {
      return IconButton(
        icon: Icon(Icons.notifications_outlined,
            color: theme.colorScheme.primary),
        onPressed: () {},
      );
    }
    final selected = ref.watch(corridorKeyProvider);
    return PopupMenuButton<String>(
      icon: Icon(Icons.alt_route, color: theme.colorScheme.primary),
      tooltip: 'Switch corridor',
      onSelected: (key) =>
          ref.read(corridorKeyProvider.notifier).select(key),
      itemBuilder: (_) => [
        for (final c in corridors)
          PopupMenuItem(
            value: c.key,
            child: Row(
              children: [
                Icon(
                  c.key == selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                  size: 18,
                  color: theme.colorScheme.secondary,
                ),
                const SizedBox(width: 8),
                Flexible(child: Text(c.name)),
              ],
            ),
          ),
      ],
    );
  }
}

class _ProvenanceBadge extends StatelessWidget {
  const _ProvenanceBadge({required this.status, required this.source});
  final LiveStatusView status;
  final String source;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isLive = status.mode == LiveMode.live || status.mode == LiveMode.polling;
    final liveOrigin = status.live?.origin == 'live';
    final color = !isLive
        ? Colors.grey
        : liveOrigin
            ? AppTheme.successGreen
            : const Color(0xFFEA8C00);
    final label = !isLive
        ? 'SIM'
        : liveOrigin
            ? 'LIVE'
            : 'SIM FEED';
    final age = status.live?.updatedSecAgo;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(100),
        border: Border.all(color: color.withValues(alpha: 0.4)),
        boxShadow: [
          BoxShadow(
              color: Colors.black.withValues(alpha: 0.08), blurRadius: 8)
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(label,
              style: TextStyle(
                  color: color, fontSize: 10, fontWeight: FontWeight.bold)),
          if (age != null) ...[
            const SizedBox(width: 6),
            Text('• ${age.round()}s ago',
                style: TextStyle(
                    color: theme.colorScheme.onSurfaceVariant, fontSize: 10)),
          ],
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final onTime = status == 'ON TIME';
    final color = onTime ? AppTheme.successGreen : const Color(0xFFFF3B30);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(100)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: color, shape: BoxShape.circle)),
          const SizedBox(width: 4),
          Text(status,
              style: TextStyle(
                  color: color, fontSize: 10, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class _DestinationLabel extends StatelessWidget {
  const _DestinationLabel({required this.name});
  final String name;
  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(6),
            boxShadow: [
              BoxShadow(
                  color: Colors.black.withValues(alpha: 0.12),
                  blurRadius: 8,
                  offset: const Offset(0, 3))
            ],
            border: Border.all(color: theme.colorScheme.outlineVariant),
          ),
          child: Text(name,
              style: TextStyle(
                  color: theme.colorScheme.onSurface,
                  fontWeight: FontWeight.bold,
                  fontSize: 11),
              overflow: TextOverflow.ellipsis),
        ),
        const SizedBox(height: 3),
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
              color: theme.colorScheme.primary,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 1.5)),
        ),
      ],
    );
  }
}

class _MyLocationDot extends StatelessWidget {
  const _MyLocationDot();
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: Colors.blueAccent,
        border: Border.all(color: Colors.white, width: 3),
        boxShadow: [
          BoxShadow(color: Colors.blueAccent.withValues(alpha: 0.4), blurRadius: 8)
        ],
      ),
    );
  }
}

class PulsingTrainMarker extends StatefulWidget {
  final Color color;
  const PulsingTrainMarker({super.key, required this.color});
  @override
  State<PulsingTrainMarker> createState() => _PulsingTrainMarkerState();
}

class _PulsingTrainMarkerState extends State<PulsingTrainMarker>
    with SingleTickerProviderStateMixin {
  late final AnimationController _pulseController;
  late final Animation<double> _pulseAnimation;

  @override
  void initState() {
    super.initState();
    _pulseController =
        AnimationController(vsync: this, duration: const Duration(seconds: 2))
          ..repeat();
    _pulseAnimation = Tween<double>(begin: 8.0, end: 22.0).animate(
        CurvedAnimation(parent: _pulseController, curve: Curves.easeOut));
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _pulseAnimation,
      builder: (context, child) {
        return Stack(
          alignment: Alignment.center,
          children: [
            Container(
              width: _pulseAnimation.value * 2,
              height: _pulseAnimation.value * 2,
              decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: widget.color
                      .withValues(alpha: 1.0 - _pulseController.value)),
            ),
            Container(
              width: 14,
              height: 14,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white,
                boxShadow: [
                  BoxShadow(
                      color: Colors.black12,
                      blurRadius: 4,
                      offset: Offset(0, 1))
                ],
              ),
            ),
            Container(
              width: 9,
              height: 9,
              decoration:
                  BoxDecoration(shape: BoxShape.circle, color: widget.color),
            ),
          ],
        );
      },
    );
  }
}
