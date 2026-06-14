import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:share_plus/share_plus.dart';

import '../theme/app_theme.dart';

/// A scannable e-ticket. Encodes the journey details into a QR payload that a
/// gate/TTE app could verify, and offers a one-tap share.
class ETicketData {
  final String trainId;
  final String trainName;
  final String pnr;
  final String fromStation;
  final String toStation;
  final String departureTime;
  final String arrivalTime;
  final String date;
  final String status;
  final String? travelClass;

  const ETicketData({
    required this.trainId,
    required this.trainName,
    required this.pnr,
    required this.fromStation,
    required this.toStation,
    required this.departureTime,
    required this.arrivalTime,
    required this.date,
    required this.status,
    this.travelClass,
  });

  factory ETicketData.fromBooking(Map<String, dynamic> b) => ETicketData(
        trainId: (b['trainId'] ?? '').toString(),
        trainName: (b['trainName'] ?? 'Train').toString(),
        pnr: (b['pnr'] ?? '').toString(),
        fromStation: (b['fromStation'] ?? '').toString(),
        toStation: (b['toStation'] ?? '').toString(),
        departureTime: (b['departureTime'] ?? '').toString(),
        arrivalTime: (b['arrivalTime'] ?? '').toString(),
        date: (b['date'] ?? '').toString(),
        status: (b['status'] ?? 'ON TIME').toString(),
        travelClass: b['travelClass']?.toString(),
      );

  /// Compact, verifiable payload for the QR code.
  String get qrPayload =>
      'RAILMIND|PNR:$pnr|TRN:$trainId|$fromStation>$toStation|$date|$departureTime';

  String get shareText =>
      'My RailMind journey 🚄\n$trainName ($trainId)\n$fromStation → $toStation\n'
      '$date • Dep $departureTime → Arr $arrivalTime\nPNR: $pnr • Status: $status';
}

Future<void> showETicketSheet(BuildContext context, ETicketData ticket) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (context) => _ETicketSheet(ticket: ticket),
  );
}

class _ETicketSheet extends StatelessWidget {
  const _ETicketSheet({required this.ticket});
  final ETicketData ticket;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final primary = theme.colorScheme.primary;
    final muted = theme.colorScheme.onSurfaceVariant;
    final onTime = ticket.status.toUpperCase() == 'ON TIME';

    return SafeArea(
      child: SingleChildScrollView(
        child: Container(
          margin: const EdgeInsets.all(12),
          padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            borderRadius: BorderRadius.circular(24),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
            Container(
              width: 48,
              height: 4,
              margin: const EdgeInsets.only(bottom: 18),
              decoration: BoxDecoration(
                color: theme.colorScheme.outlineVariant,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Row(
              children: [
                Icon(Icons.confirmation_number, color: theme.colorScheme.secondary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'E-Ticket',
                    style: theme.textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold, color: primary),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: (onTime ? AppTheme.successGreen : const Color(0xFFFF3B30))
                        .withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(100),
                  ),
                  child: Text(
                    ticket.status,
                    style: TextStyle(
                      color: onTime ? AppTheme.successGreen : const Color(0xFFFF3B30),
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: theme.colorScheme.outlineVariant),
              ),
              child: QrImageView(
                data: ticket.qrPayload,
                version: QrVersions.auto,
                size: 180,
                gapless: false,
              ),
            ),
            const SizedBox(height: 8),
            Text('PNR  ${ticket.pnr}',
                style: theme.textTheme.titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold, letterSpacing: 1.0)),
            const SizedBox(height: 16),
            Text(
              '${ticket.trainId}  ${ticket.trainName}',
              style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold, color: theme.colorScheme.secondary),
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _stop(theme, 'FROM', ticket.fromStation, ticket.departureTime),
                Icon(Icons.arrow_forward, color: muted, size: 18),
                _stop(theme, 'TO', ticket.toStation, ticket.arrivalTime,
                    end: true),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.calendar_today_outlined, size: 14, color: muted),
                const SizedBox(width: 6),
                Text(ticket.date, style: TextStyle(color: muted, fontSize: 13)),
                if (ticket.travelClass != null) ...[
                  const SizedBox(width: 12),
                  Icon(Icons.event_seat_outlined, size: 14, color: muted),
                  const SizedBox(width: 6),
                  Text(ticket.travelClass!,
                      style: TextStyle(color: muted, fontSize: 13)),
                ],
              ],
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () =>
                        Share.share(ticket.shareText, subject: 'RailMind E-Ticket'),
                    icon: const Icon(Icons.share, size: 18),
                    label: const Text('Share'),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                    ),
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
    ),
    );
  }

  Widget _stop(ThemeData theme, String label, String station, String time,
      {bool end = false}) {
    return Expanded(
      child: Column(
        crossAxisAlignment:
            end ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          Text(label,
              style: TextStyle(
                  color: theme.colorScheme.onSurfaceVariant,
                  fontSize: 10,
                  fontWeight: FontWeight.w600)),
          const SizedBox(height: 2),
          Text(time,
              style: theme.textTheme.titleMedium
                  ?.copyWith(fontWeight: FontWeight.bold)),
          Text(station,
              textAlign: end ? TextAlign.end : TextAlign.start,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12)),
        ],
      ),
    );
  }
}
