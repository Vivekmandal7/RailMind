import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/ui_kit.dart';
import '../../services/train_info_service.dart';
import '../assistant/providers/assistant_providers.dart';

Future<void> showPnrSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _SheetScaffold(child: _PnrSheet()),
  );
}

Future<void> showFareSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _SheetScaffold(child: _FareSheet()),
  );
}

class _SheetScaffold extends StatelessWidget {
  const _SheetScaffold({required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
          bottom: MediaQuery.of(context).viewInsets.bottom),
      child: Container(
        margin: const EdgeInsets.all(12),
        constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.85),
        decoration: BoxDecoration(
          color: AppTheme.surfaceDark,
          borderRadius: BorderRadius.circular(26),
          border: Border.all(color: AppTheme.strokeDark),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
          child: child,
        ),
      ),
    );
  }
}

class _Handle extends StatelessWidget {
  const _Handle();
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 42,
        height: 4,
        margin: const EdgeInsets.only(bottom: 16),
        decoration: BoxDecoration(
          color: AppTheme.strokeDark,
          borderRadius: BorderRadius.circular(100),
        ),
      ),
    );
  }
}

// --------------------------------------------------------------------------- //
// PNR status
// --------------------------------------------------------------------------- //
class _PnrSheet extends ConsumerStatefulWidget {
  const _PnrSheet();
  @override
  ConsumerState<_PnrSheet> createState() => _PnrSheetState();
}

class _PnrSheetState extends ConsumerState<_PnrSheet> {
  final _controller = TextEditingController();
  PnrStatus? _result;
  bool _loading = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _check() async {
    final pnr = _controller.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (pnr.length < 6) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid 10-digit PNR number.')),
      );
      return;
    }
    setState(() => _loading = true);
    final res = await ref.read(trainInfoServiceProvider).pnrStatus(pnr);
    if (mounted) {
      setState(() {
        _result = res;
        _loading = false;
      });
    }
  }

  Color _statusColor(String s) {
    if (s.startsWith('CNF')) return AppTheme.successGreen;
    if (s.startsWith('RAC')) return AppTheme.warning;
    return AppTheme.danger;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Handle(),
          Row(
            children: [
              const NeonIconBadge(
                  icon: Icons.confirmation_number_outlined,
                  color: AppTheme.neonAlt),
              const SizedBox(width: 12),
              Text('PNR Status',
                  style: theme.textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 4),
          const Text('Check your booking & live coach position',
              style: TextStyle(color: AppTheme.textDarkMuted, fontSize: 13)),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            keyboardType: TextInputType.number,
            maxLength: 10,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: const InputDecoration(
              hintText: 'Enter 10-digit PNR',
              counterText: '',
              prefixIcon: Icon(Icons.tag),
            ),
          ),
          const SizedBox(height: 12),
          NeonButton(
            label: 'Check Status',
            icon: Icons.search,
            loading: _loading,
            onPressed: _loading ? null : _check,
          ),
          if (_result != null) ...[
            const SizedBox(height: 18),
            _resultCard(theme, _result!),
          ],
        ],
      ),
    );
  }

  Widget _resultCard(ThemeData theme, PnrStatus r) {
    return GlassCard(
      glowColor: AppTheme.neonAlt,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('${r.trainNumber}  ${r.trainName}',
                    style: const TextStyle(
                        fontWeight: FontWeight.w800, fontSize: 15)),
              ),
              StatusPill(
                label: r.chartStatus.toUpperCase(),
                color: r.chartStatus.contains('Not')
                    ? AppTheme.warning
                    : AppTheme.successGreen,
                dot: false,
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text('${r.from}  →  ${r.to}   ·   ${r.travelClass}   ·   ${r.date}',
              style: const TextStyle(
                  color: AppTheme.textDarkMuted, fontSize: 12.5)),
          const Divider(height: 24),
          ...r.passengers.map((p) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 6),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(p.label,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600, fontSize: 13)),
                          Text('Booked: ${p.bookingStatus}',
                              style: const TextStyle(
                                  color: AppTheme.textDarkMuted, fontSize: 11.5)),
                        ],
                      ),
                    ),
                    StatusPill(
                      label: p.currentStatus,
                      color: _statusColor(p.currentStatus),
                    ),
                  ],
                ),
              )),
          if (!r.isLive) ...[
            const SizedBox(height: 8),
            Text(
              'Demo data · add a rail API key to see live PNR status',
              style: TextStyle(
                  color: AppTheme.textDarkMuted.withValues(alpha: 0.8),
                  fontSize: 10.5,
                  fontStyle: FontStyle.italic),
            ),
          ],
        ],
      ),
    );
  }
}

// --------------------------------------------------------------------------- //
// Fare estimator
// --------------------------------------------------------------------------- //
class _FareSheet extends ConsumerStatefulWidget {
  const _FareSheet();
  @override
  ConsumerState<_FareSheet> createState() => _FareSheetState();
}

class _FareSheetState extends ConsumerState<_FareSheet> {
  double _distance = 200;
  int _passengers = 1;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final fares = ref
        .read(trainInfoServiceProvider)
        .estimateFares(_distance.round(), passengers: _passengers);

    return SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _Handle(),
          Row(
            children: [
              const NeonIconBadge(
                  icon: Icons.payments_outlined, color: AppTheme.neonPurple),
              const SizedBox(width: 12),
              Text('Fare Estimator',
                  style: theme.textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800)),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Distance',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              Text('${_distance.round()} km',
                  style: const TextStyle(
                      color: AppTheme.neon, fontWeight: FontWeight.w800)),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: AppTheme.neon,
              thumbColor: AppTheme.neon,
              inactiveTrackColor: AppTheme.strokeDark,
              overlayColor: AppTheme.neon.withValues(alpha: 0.2),
            ),
            child: Slider(
              value: _distance,
              min: 20,
              max: 2000,
              divisions: 99,
              onChanged: (v) => setState(() => _distance = v),
            ),
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              const Text('Passengers',
                  style: TextStyle(fontWeight: FontWeight.w600)),
              const Spacer(),
              IconButton(
                onPressed: _passengers <= 1
                    ? null
                    : () => setState(() => _passengers--),
                icon: const Icon(Icons.remove_circle_outline),
              ),
              Text('$_passengers',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 16)),
              IconButton(
                onPressed: _passengers >= 6
                    ? null
                    : () => setState(() => _passengers++),
                icon: const Icon(Icons.add_circle, color: AppTheme.neon),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ...fares.map((f) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 5),
                child: GlassCard(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: Row(
                    children: [
                      Icon(_classIcon(f.travelClass),
                          color: AppTheme.neon, size: 20),
                      const SizedBox(width: 12),
                      Text(f.travelClass,
                          style:
                              const TextStyle(fontWeight: FontWeight.w700)),
                      const Spacer(),
                      Text('₹${f.amount}',
                          style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                              color: AppTheme.neon)),
                    ],
                  ),
                ),
              )),
          const SizedBox(height: 6),
          const Text(
            'Estimated total including reservation & GST. Actual fares vary by '
            'train type and quota.',
            style: TextStyle(color: AppTheme.textDarkMuted, fontSize: 11),
          ),
        ],
      ),
    );
  }

  IconData _classIcon(String c) {
    switch (c) {
      case 'General':
        return Icons.event_seat_outlined;
      case 'Sleeper':
        return Icons.bed_outlined;
      case '1st AC':
        return Icons.king_bed_outlined;
      default:
        return Icons.ac_unit;
    }
  }
}
