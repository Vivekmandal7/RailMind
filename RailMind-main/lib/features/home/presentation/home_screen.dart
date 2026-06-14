import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/theme/app_theme.dart';
import '../../../core/widgets/eticket_sheet.dart';
import '../../../core/widgets/ui_kit.dart';
import '../../auth/providers/auth_providers.dart';
import '../../map/models/train_route_model.dart';
import '../../map/providers/map_providers.dart';
import '../../navigation/providers/navigation_provider.dart';
import '../../bookings/providers/bookings_provider.dart';
import '../../services/service_sheets.dart';
import '../../tools/tools_sheets.dart';
import '../providers/search_history_provider.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fromController = TextEditingController();
  final _toController = TextEditingController();
  final _dateController = TextEditingController();
  String _selectedClass = 'General';
  List<TrainRoute>? _searchResults;
  bool _hasSearched = false;

  void _searchTrains() {
    final fromText = _fromController.text.trim().toLowerCase();
    final toText = _toController.text.trim().toLowerCase();

    if (fromText.isEmpty || toText.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
            content: Text('Please enter both origin and destination stations.')),
      );
      return;
    }

    final routes = ref.read(liveTrainRoutesProvider).value ?? const [];
    final results = routes.where((train) {
      final fromIndex = train.stations
          .indexWhere((s) => s.name.toLowerCase().contains(fromText));
      final toIndex = train.stations
          .indexWhere((s) => s.name.toLowerCase().contains(toText));
      return fromIndex != -1 && toIndex != -1 && fromIndex < toIndex;
    }).toList();

    setState(() {
      _searchResults = results;
      _hasSearched = true;
    });
    ref
        .read(searchHistoryProvider.notifier)
        .saveSearch(_fromController.text, _toController.text);
  }

  @override
  void initState() {
    super.initState();
    _dateController.text = DateFormat('dd MMM yyyy').format(DateTime.now());
  }

  @override
  void dispose() {
    _fromController.dispose();
    _toController.dispose();
    _dateController.dispose();
    super.dispose();
  }

  void _swapStations() {
    setState(() {
      final temp = _fromController.text;
      _fromController.text = _toController.text;
      _toController.text = temp;
    });
  }

  Future<void> _selectDate(BuildContext context) async {
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: DateTime.now(),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 90)),
    );
    if (picked != null) {
      setState(() {
        _dateController.text = DateFormat('dd MMM yyyy').format(picked);
      });
    }
  }

  void _trackTrain(String trainId) {
    ref.read(selectedTrainNumberProvider.notifier).select(trainId);
    ref.read(navigationIndexProvider.notifier).setIndex(2);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final userModelAsync = ref.watch(currentUserProvider);

    final Color primaryColor = theme.colorScheme.primary;
    final Color secondaryColor = theme.colorScheme.secondary;
    final Color surfaceContainerLow =
        theme.inputDecorationTheme.fillColor ?? const Color(0xFFF2F4F7);
    final Color textMuted = theme.colorScheme.onSurfaceVariant;

    return Stack(
      children: [
        const Positioned.fill(child: NeonBackground()),
        Scaffold(
          backgroundColor: Colors.transparent,
          body: SafeArea(
            bottom: false,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildHeader(theme, userModelAsync),
                  const SizedBox(height: 20),
                  _buildSearchCard(theme, primaryColor, secondaryColor,
                      surfaceContainerLow, textMuted),
                  if (_hasSearched) ...[
                    const SizedBox(height: 24),
                    _buildSearchResults(
                        theme, primaryColor, secondaryColor, textMuted),
                  ],
                  const SizedBox(height: 24),
                  _buildAiBanner(theme),
                  const SizedBox(height: 24),
                  SectionHeader(
                    title: 'Upcoming Journey',
                    icon: Icons.event_outlined,
                    action: 'View all',
                    onAction: () =>
                        ref.read(navigationIndexProvider.notifier).setIndex(1),
                  ),
                  const SizedBox(height: 12),
                  _buildUpcomingCard(
                      theme, primaryColor, secondaryColor, textMuted),
                  const SizedBox(height: 24),
                  const SectionHeader(
                      title: 'Quick Tools', icon: Icons.grid_view_rounded),
                  const SizedBox(height: 12),
                  _buildServiceGrid(theme, primaryColor, textMuted),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildHeader(ThemeData theme, AsyncValue userModelAsync) {
    final name = userModelAsync.maybeWhen(
      data: (user) => user?.name?.toString().split(' ').first,
      orElse: () => null,
    );
    final hour = DateTime.now().hour;
    final greeting = hour < 12
        ? 'Good morning'
        : hour < 17
            ? 'Good afternoon'
            : 'Good evening';
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  ShaderMask(
                    shaderCallback: (r) =>
                        AppTheme.neonGradient.createShader(r),
                    child: const Icon(Icons.travel_explore,
                        color: Colors.white, size: 22),
                  ),
                  const SizedBox(width: 8),
                  Text('RailMind',
                      style: theme.textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800, letterSpacing: 0.5)),
                ],
              ),
              const SizedBox(height: 6),
              Text(
                name != null ? '$greeting, $name' : greeting,
                style: TextStyle(
                    color: theme.colorScheme.onSurfaceVariant, fontSize: 13),
              ),
            ],
          ),
        ),
        IconButton(
          onPressed: () =>
              ref.read(authControllerProvider.notifier).signOut(),
          tooltip: 'Sign out',
          icon: const Icon(Icons.logout_rounded, size: 20),
        ),
      ],
    );
  }

  Widget _buildAiBanner(ThemeData theme) {
    return GestureDetector(
      onTap: () => ref.read(navigationIndexProvider.notifier).setIndex(3),
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          gradient: AppTheme.violetGradient,
          borderRadius: BorderRadius.circular(22),
          boxShadow: AppTheme.neonGlow(AppTheme.neonPurple, opacity: 0.35),
        ),
        child: Row(
          children: [
            Container(
              width: 46,
              height: 46,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.18),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Icon(Icons.auto_awesome,
                  color: Colors.white, size: 24),
            ),
            const SizedBox(width: 14),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Ask RailMind AI',
                      style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 16)),
                  SizedBox(height: 2),
                  Text('Find trains, fares, delays & more — instantly',
                      style:
                          TextStyle(color: Colors.white70, fontSize: 12.5)),
                ],
              ),
            ),
            const Icon(Icons.arrow_forward_rounded, color: Colors.white),
          ],
        ),
      ),
    );
  }

  Widget _buildSearchCard(ThemeData theme, Color primaryColor,
      Color secondaryColor, Color surfaceContainerLow, Color textMuted) {
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Where are you heading?',
                  style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold, color: primaryColor)),
              const SizedBox(height: 12),
              TextFormField(
                controller: _fromController,
                decoration: InputDecoration(
                  hintText: 'From Station',
                  prefixIcon: const Icon(Icons.location_on_outlined),
                  filled: true,
                  fillColor: surfaceContainerLow,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 12),
                ),
              ),
              Center(
                child: InkWell(
                  onTap: _swapStations,
                  borderRadius: BorderRadius.circular(20),
                  child: Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.secondaryContainer
                          .withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(Icons.swap_vert, color: secondaryColor, size: 20),
                  ),
                ),
              ),
              TextFormField(
                controller: _toController,
                decoration: InputDecoration(
                  hintText: 'To Station',
                  prefixIcon: const Icon(Icons.near_me_outlined),
                  filled: true,
                  fillColor: surfaceContainerLow,
                  contentPadding: const EdgeInsets.symmetric(
                      horizontal: 16, vertical: 12),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextFormField(
                      controller: _dateController,
                      readOnly: true,
                      onTap: () => _selectDate(context),
                      decoration: InputDecoration(
                        prefixIcon:
                            const Icon(Icons.calendar_today_outlined, size: 18),
                        filled: true,
                        fillColor: surfaceContainerLow,
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 10),
                        border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide.none),
                      ),
                      style: theme.textTheme.labelMedium
                          ?.copyWith(color: theme.colorScheme.onSurface),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Container(
                      padding:
                          const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                      decoration: BoxDecoration(
                        color: surfaceContainerLow,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                            color: theme.colorScheme.outlineVariant
                                .withValues(alpha: 0.5),
                            width: 1),
                      ),
                      child: DropdownButtonHideUnderline(
                        child: DropdownButton<String>(
                          value: _selectedClass,
                          isExpanded: true,
                          icon: const Icon(Icons.arrow_drop_down,
                              color: Colors.grey),
                          onChanged: (v) {
                            if (v != null) setState(() => _selectedClass = v);
                          },
                          items: <String>['General', 'Sleeper', '3rd AC', '2nd AC']
                              .map((value) => DropdownMenuItem(
                                    value: value,
                                    child: Text(value,
                                        style: theme.textTheme.labelMedium
                                            ?.copyWith(
                                                color: theme
                                                    .colorScheme.onSurface)),
                                  ))
                              .toList(),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              _buildRecentSearches(theme, secondaryColor, textMuted),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: secondaryColor,
                  foregroundColor: Colors.white,
                  minimumSize: const Size.fromHeight(52),
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12)),
                  elevation: 0,
                ),
                onPressed: _searchTrains,
                icon: const Icon(Icons.search),
                label: const Text('Search Trains'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildRecentSearches(
      ThemeData theme, Color secondaryColor, Color textMuted) {
    final history = ref.watch(searchHistoryProvider);
    if (history.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: 16),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Recent Searches',
                style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.bold, color: textMuted)),
            TextButton(
              style: TextButton.styleFrom(
                padding: EdgeInsets.zero,
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
              onPressed: () =>
                  ref.read(searchHistoryProvider.notifier).clearHistory(),
              child: Text('Clear',
                  style: TextStyle(
                      color: secondaryColor,
                      fontSize: 11,
                      fontWeight: FontWeight.bold)),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final item in history)
              ActionChip(
                label: Text('${item['from']} → ${item['to']}'),
                labelStyle: theme.textTheme.labelSmall?.copyWith(
                    color: secondaryColor,
                    fontWeight: FontWeight.w600,
                    fontSize: 11),
                backgroundColor: secondaryColor.withValues(alpha: 0.05),
                side: BorderSide(color: secondaryColor.withValues(alpha: 0.15)),
                onPressed: () {
                  _fromController.text = item['from'] ?? '';
                  _toController.text = item['to'] ?? '';
                  _searchTrains();
                },
              ),
          ],
        ),
      ],
    );
  }

  Widget _buildUpcomingCard(ThemeData theme, Color primaryColor,
      Color secondaryColor, Color textMuted) {
    final bookings = ref.watch(bookingsProvider);
    final upcoming =
        bookings.where((b) => b['isUpcoming'] == true).toList();

    if (upcoming.isEmpty) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            children: [
              Icon(Icons.event_available_outlined,
                  size: 40, color: textMuted.withValues(alpha: 0.6)),
              const SizedBox(height: 10),
              Text('No upcoming journeys',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text('Search a route above and book a ticket to see it here.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: textMuted, fontSize: 12)),
            ],
          ),
        ),
      );
    }

    final b = upcoming.first;
    final onTime = (b['status'] ?? 'ON TIME') == 'ON TIME';
    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          Container(
            decoration: const BoxDecoration(gradient: AppTheme.heroGradient),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Row(
                    children: [
                      const Icon(Icons.train, color: AppTheme.neon, size: 20),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text(
                          '${b['trainId']} ${(b['trainName'] ?? '').toString().toUpperCase()}',
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.bold,
                              fontSize: 13,
                              letterSpacing: 1.0),
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(4)),
                  child: Text('PNR: ${b['pnr']}',
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 11,
                          fontWeight: FontWeight.w600)),
                )
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(20.0),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _endpoint(theme, primaryColor, textMuted, 'DEPARTS',
                        b['departureTime'], b['fromStation']),
                    Expanded(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12.0),
                        child: Column(
                          children: [
                            Row(
                              children: [
                                _dot(secondaryColor, filled: false),
                                Expanded(
                                    child: Container(
                                        height: 1,
                                        color:
                                            theme.colorScheme.outlineVariant)),
                                _dot(secondaryColor, filled: true),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Text((b['travelClass'] ?? '').toString().toUpperCase(),
                                style: TextStyle(
                                    color: secondaryColor,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.5)),
                          ],
                        ),
                      ),
                    ),
                    _endpoint(theme, primaryColor, textMuted, 'ARRIVES',
                        b['arrivalTime'], b['toStation'],
                        end: true),
                  ],
                ),
                const SizedBox(height: 20),
                Divider(height: 1, color: theme.colorScheme.outlineVariant),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        _dot(
                            onTime
                                ? AppTheme.successGreen
                                : const Color(0xFFFF3B30),
                            filled: true),
                        const SizedBox(width: 8),
                        Text(b['status'] ?? 'ON TIME',
                            style: TextStyle(
                                color: onTime
                                    ? AppTheme.successGreen
                                    : const Color(0xFFFF3B30),
                                fontWeight: FontWeight.bold,
                                fontSize: 12)),
                      ],
                    ),
                    Row(
                      children: [
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor:
                                theme.colorScheme.surfaceContainerHighest,
                            foregroundColor: AppTheme.neon,
                            elevation: 0,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                                side: const BorderSide(color: AppTheme.strokeDark)),
                          ),
                          onPressed: () => _trackTrain(b['trainId'].toString()),
                          child: const Text('Track Live',
                              style: TextStyle(
                                  fontSize: 12, fontWeight: FontWeight.bold)),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.neon,
                            foregroundColor: const Color(0xFF042424),
                            elevation: 0,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8)),
                          ),
                          onPressed: () => showETicketSheet(
                              context, ETicketData.fromBooking(b)),
                          child: const Text('E-Ticket',
                              style: TextStyle(
                                  fontSize: 12, fontWeight: FontWeight.bold)),
                        ),
                      ],
                    )
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _endpoint(ThemeData theme, Color primaryColor, Color textMuted,
      String label, dynamic time, dynamic station,
      {bool end = false}) {
    return Column(
      crossAxisAlignment:
          end ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        Text(label,
            style: TextStyle(
                color: textMuted, fontSize: 11, fontWeight: FontWeight.w600)),
        const SizedBox(height: 4),
        Text((time ?? '--:--').toString(),
            style: theme.textTheme.headlineMedium
                ?.copyWith(fontWeight: FontWeight.bold, color: primaryColor)),
        const SizedBox(height: 4),
        Text((station ?? '').toString(),
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
      ],
    );
  }

  Widget _dot(Color color, {required bool filled}) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: filled ? color : Colors.white,
        border: filled ? null : Border.all(color: color, width: 1.5),
      ),
    );
  }

  Widget _buildServiceGrid(
      ThemeData theme, Color primaryColor, Color textMuted) {
    Widget tile(IconData icon, String title, String sub, Color color,
        VoidCallback onTap) {
      return GlassCard(
        onTap: onTap,
        glowColor: color,
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            NeonIconBadge(icon: icon, color: color, size: 38),
            const SizedBox(height: 10),
            Text(title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w800, fontSize: 13.5)),
            const SizedBox(height: 2),
            Text(sub,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: textMuted, fontSize: 11, height: 1.2)),
          ],
        ),
      );
    }

    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 14,
      crossAxisSpacing: 14,
      childAspectRatio: 1.22,
      children: [
        tile(Icons.confirmation_number_outlined, 'PNR Status', 'Check booking',
            AppTheme.neonAlt, () => showPnrSheet(context)),
        tile(Icons.payments_outlined, 'Fare Estimator', 'Per class & route',
            AppTheme.neonPurple, () => showFareSheet(context)),
        tile(Icons.fastfood, 'Order Food', 'Delivered to seat', AppTheme.neon,
            () => showFoodOrderSheet(context)),
        tile(Icons.hotel, 'Lounge', 'Pre-book access', AppTheme.neonPink,
            () => showLoungeSheet(context)),
      ],
    );
  }

  Widget _buildSearchResults(ThemeData theme, Color primaryColor,
      Color secondaryColor, Color textMuted) {
    if (_searchResults == null || _searchResults!.isEmpty) {
      return Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.all(20.0),
          child: Column(
            children: [
              Icon(Icons.train_outlined,
                  size: 48, color: textMuted.withValues(alpha: 0.5)),
              const SizedBox(height: 12),
              Text('No Direct Trains Found',
                  style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold, color: primaryColor)),
              const SizedBox(height: 6),
              Text(
                'Try stations on the live corridor, e.g. "Mumbai CSMT" to "Igatpuri", or "Thane" to "Kalyan".',
                textAlign: TextAlign.center,
                style: TextStyle(color: textMuted, fontSize: 13, height: 1.4),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Available Trains (${_searchResults!.length})',
            style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold, color: primaryColor)),
        const SizedBox(height: 12),
        ListView.separated(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: _searchResults!.length,
          separatorBuilder: (_, _) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            final train = _searchResults![index];
            final fromText = _fromController.text.trim().toLowerCase();
            final toText = _toController.text.trim().toLowerCase();
            final fromStop = train.stations.firstWhere(
                (s) => s.name.toLowerCase().contains(fromText),
                orElse: () => train.stations.first);
            final toStop = train.stations.firstWhere(
                (s) => s.name.toLowerCase().contains(toText),
                orElse: () => train.stations.last);

            return _SearchResultCard(
              train: train,
              fromName: fromStop.name,
              toName: toStop.name,
              fromTime: fromStop.time,
              toTime: toStop.time,
              travelClass: _selectedClass,
              dateLabel: _dateController.text,
              primaryColor: primaryColor,
              secondaryColor: secondaryColor,
              textMuted: textMuted,
            );
          },
        ),
      ],
    );
  }
}

/// A single search result with Book / Track actions.
class _SearchResultCard extends ConsumerWidget {
  const _SearchResultCard({
    required this.train,
    required this.fromName,
    required this.toName,
    required this.fromTime,
    required this.toTime,
    required this.travelClass,
    required this.dateLabel,
    required this.primaryColor,
    required this.secondaryColor,
    required this.textMuted,
  });

  final TrainRoute train;
  final String fromName;
  final String toName;
  final String fromTime;
  final String toTime;
  final String travelClass;
  final String dateLabel;
  final Color primaryColor;
  final Color secondaryColor;
  final Color textMuted;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final onTime = train.isOnTime;
    return Card(
      clipBehavior: Clip.antiAlias,
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          Container(
            color: secondaryColor.withValues(alpha: 0.08),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(
                  child: Row(
                    children: [
                      Icon(Icons.train, color: secondaryColor, size: 18),
                      const SizedBox(width: 8),
                      Flexible(
                        child: Text('${train.id} ${train.name.toUpperCase()}',
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                                color: primaryColor,
                                fontWeight: FontWeight.bold,
                                fontSize: 13)),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                      color: (onTime
                              ? AppTheme.successGreen
                              : const Color(0xFFFF3B30))
                          .withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(4)),
                  child: Text(train.status,
                      style: TextStyle(
                          color: onTime
                              ? AppTheme.successGreen
                              : const Color(0xFFFF3B30),
                          fontSize: 10,
                          fontWeight: FontWeight.bold)),
                )
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('DEPARTS',
                            style: TextStyle(
                                color: textMuted,
                                fontSize: 10,
                                fontWeight: FontWeight.w600)),
                        const SizedBox(height: 4),
                        Text(fromTime,
                            style: theme.textTheme.headlineSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                                color: primaryColor)),
                        const SizedBox(height: 4),
                        Text(fromName,
                            style: const TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w500)),
                      ],
                    ),
                    const Icon(Icons.arrow_forward,
                        color: Colors.grey, size: 18),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text('ARRIVES',
                            style: TextStyle(
                                color: textMuted,
                                fontSize: 10,
                                fontWeight: FontWeight.w600)),
                        const SizedBox(height: 4),
                        Text(toTime,
                            style: theme.textTheme.headlineSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                                color: primaryColor)),
                        const SizedBox(height: 4),
                        Text(toName,
                            style: const TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w500)),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Delay: ${train.delay}',
                        style: TextStyle(color: textMuted, fontSize: 11)),
                    Row(
                      children: [
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppTheme.neon,
                            foregroundColor: const Color(0xFF042424),
                            elevation: 0,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8)),
                          ),
                          onPressed: () => _book(context, ref),
                          child: const Row(
                            children: [
                              Icon(Icons.confirmation_number_outlined, size: 14),
                              SizedBox(width: 4),
                              Text('Book Ticket',
                                  style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            backgroundColor:
                                theme.colorScheme.surfaceContainerHighest,
                            foregroundColor: AppTheme.neon,
                            elevation: 0,
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(8),
                                side: const BorderSide(
                                    color: AppTheme.strokeDark)),
                          ),
                          onPressed: () {
                            ref
                                .read(selectedTrainNumberProvider.notifier)
                                .select(train.id);
                            ref
                                .read(navigationIndexProvider.notifier)
                                .setIndex(2);
                          },
                          child: const Row(
                            children: [
                              Icon(Icons.navigation_outlined, size: 14),
                              SizedBox(width: 4),
                              Text('Track Live',
                                  style: TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.bold)),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _book(BuildContext context, WidgetRef ref) async {
    final pnr =
        '${100 + (train.id.hashCode % 900)}-${1000000 + (DateTime.now().millisecond * 997) % 9000000}';
    final booking = {
      'id': '${train.id}_${DateTime.now().millisecondsSinceEpoch}',
      'trainId': train.id,
      'trainName': train.name,
      'fromStation': fromName,
      'toStation': toName,
      'departureTime': fromTime,
      'arrivalTime': toTime,
      'pnr': pnr,
      'date': dateLabel,
      'status': train.status,
      'travelClass': travelClass,
      'isUpcoming': true,
    };
    await ref.read(bookingsProvider.notifier).bookTicket(booking);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Ticket booked! PNR: $pnr'),
        action: SnackBarAction(
          label: 'View',
          textColor: Colors.white,
          onPressed: () =>
              ref.read(navigationIndexProvider.notifier).setIndex(1),
        ),
        duration: const Duration(seconds: 4),
      ),
    );
  }
}
