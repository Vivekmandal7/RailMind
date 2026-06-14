import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

/// A formatted tax invoice for a completed/booked journey, with share.
Future<void> showInvoiceSheet(BuildContext context, Map<String, dynamic> trip) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _InvoiceSheet(trip: trip),
  );
}

class _InvoiceSheet extends StatelessWidget {
  const _InvoiceSheet({required this.trip});
  final Map<String, dynamic> trip;

  int get _baseFare {
    switch ((trip['travelClass'] ?? 'General').toString()) {
      case '2nd AC':
        return 1450;
      case '3rd AC':
        return 980;
      case 'Sleeper':
        return 420;
      default:
        return 180;
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final muted = theme.colorScheme.onSurfaceVariant;
    final base = _baseFare;
    final convenience = 25;
    final gst = (base * 0.05).round();
    final total = base + convenience + gst;

    return SafeArea(
      child: Container(
        margin: const EdgeInsets.all(12),
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
        decoration: BoxDecoration(
          color: theme.colorScheme.surface,
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.receipt_long, color: theme.colorScheme.secondary),
                const SizedBox(width: 8),
                Text('Tax Invoice',
                    style: theme.textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold)),
                const Spacer(),
                Text('#${trip['pnr']}',
                    style: TextStyle(color: muted, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 4),
            Text('RailMind Railways • GSTIN 27AABCR1234M1Z5',
                style: TextStyle(color: muted, fontSize: 11)),
            const Divider(height: 24),
            Text('${trip['trainId']}  ${trip['trainName']}',
                style: const TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(
                '${trip['fromStation']} → ${trip['toStation']}  •  ${trip['date']}',
                style: TextStyle(color: muted, fontSize: 12)),
            const SizedBox(height: 16),
            _row(context, 'Base fare (${trip['travelClass'] ?? 'General'})',
                '₹$base'),
            _row(context, 'Convenience fee', '₹$convenience'),
            _row(context, 'GST (5%)', '₹$gst'),
            const Divider(height: 24),
            _row(context, 'Total paid', '₹$total', bold: true),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => Share.share(
                      'RailMind invoice ${trip['pnr']}\n'
                      '${trip['trainId']} ${trip['trainName']}\n'
                      '${trip['fromStation']} → ${trip['toStation']} • ${trip['date']}\n'
                      'Total paid: ₹$total',
                      subject: 'RailMind Invoice',
                    ),
                    icon: const Icon(Icons.share, size: 18),
                    label: const Text('Share'),
                    style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14)),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton.icon(
                    onPressed: () => Navigator.of(context).pop(),
                    icon: const Icon(Icons.check, size: 18),
                    label: const Text('Done'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: theme.colorScheme.secondary,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _row(BuildContext context, String label, String value,
      {bool bold = false}) {
    final style = TextStyle(
      fontWeight: bold ? FontWeight.bold : FontWeight.normal,
      fontSize: bold ? 16 : 14,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [Text(label, style: style), Text(value, style: style)],
      ),
    );
  }
}
