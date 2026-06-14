import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../providers/profile_providers.dart';
import '../../../services/notifications_service.dart';

Widget _shell(BuildContext context, Widget child) {
  final theme = Theme.of(context);
  return SafeArea(
    child: Container(
      margin: const EdgeInsets.all(12),
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(24),
      ),
      child: child,
    ),
  );
}

Widget _header(BuildContext context, IconData icon, String title) {
  final theme = Theme.of(context);
  return Padding(
    padding: const EdgeInsets.only(bottom: 12),
    child: Row(
      children: [
        Icon(icon, color: theme.colorScheme.secondary),
        const SizedBox(width: 8),
        Text(title,
            style: theme.textTheme.titleLarge
                ?.copyWith(fontWeight: FontWeight.bold)),
      ],
    ),
  );
}

Future<void> showFavoritesSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (_) => Consumer(builder: (context, ref, _) {
      final favorites = ref.watch(favoritesProvider);
      final theme = Theme.of(context);
      return _shell(
        context,
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context, Icons.favorite, 'Saved Favorites'),
            if (favorites.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: Text(
                    'No favorites yet.\nTap the heart on a station to save it.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
                  ),
                ),
              )
            else
              ...favorites.map((f) => ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.location_on,
                        color: theme.colorScheme.secondary),
                    title: Text(f),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () =>
                          ref.read(favoritesProvider.notifier).toggle(f),
                    ),
                  )),
          ],
        ),
      );
    }),
  );
}

Future<void> showPreferencesSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (_) => Consumer(builder: (context, ref, _) {
      final prefs = ref.watch(preferencesProvider);
      final notifier = ref.read(preferencesProvider.notifier);
      final theme = Theme.of(context);
      return _shell(
        context,
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context, Icons.settings_suggest, 'Travel Preferences'),
            Text('Default travel class',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: ['General', 'Sleeper', '3rd AC', '2nd AC'].map((c) {
                final selected = prefs['defaultClass'] == c;
                return ChoiceChip(
                  label: Text(c),
                  selected: selected,
                  onSelected: (_) => notifier.update('defaultClass', c),
                );
              }).toList(),
            ),
            const SizedBox(height: 8),
            Text(
              'Used to pre-select your class when searching.',
              style: TextStyle(
                  color: theme.colorScheme.onSurfaceVariant, fontSize: 12),
            ),
          ],
        ),
      );
    }),
  );
}

Future<void> showNotificationSettingsSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    backgroundColor: Colors.transparent,
    builder: (_) => Consumer(builder: (context, ref, _) {
      final prefs = ref.watch(preferencesProvider);
      final notifier = ref.read(preferencesProvider.notifier);
      void toggle(String key, String topic, bool v) {
        notifier.update(key, v);
        if (v) {
          NotificationsService.subscribe(topic);
        } else {
          NotificationsService.unsubscribe(topic);
        }
      }

      return _shell(
        context,
        Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _header(context, Icons.notifications_active, 'Notification Settings'),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Journey alerts'),
              subtitle: const Text('Boarding, platform and arrival updates'),
              value: prefs['journeyAlerts'] == true,
              onChanged: (v) => toggle('journeyAlerts', 'journey_alerts', v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Delay alerts'),
              subtitle: const Text('Get notified when a tracked train is delayed'),
              value: prefs['delayAlerts'] == true,
              onChanged: (v) => toggle('delayAlerts', 'delay_alerts', v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Offers & promotions'),
              value: prefs['promos'] == true,
              onChanged: (v) => toggle('promos', 'promos', v),
            ),
          ],
        ),
      );
    }),
  );
}

Future<void> showHelpSheet(BuildContext context) {
  final theme = Theme.of(context);
  const faqs = [
    ['How do I track a train live?',
      'Open the Map tab — the tracked train moves in real time. Use search to pick another train.'],
    ['What does the LIVE / SIM badge mean?',
      'LIVE = a real position report. SIM = schedule-based simulation when no live feed is available.'],
    ['How do I get my E-Ticket?',
      'Tap E-Ticket on any booking to show a scannable QR code you can share.'],
    ['Can I cancel a booking?',
      'Yes — open Bookings → Upcoming and tap Cancel.'],
  ];
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _shell(
      context,
      Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _header(context, Icons.help, 'Help & Support'),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final faq in faqs)
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    title: Text(faq[0],
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 14)),
                    childrenPadding:
                        const EdgeInsets.only(bottom: 12, right: 8),
                    children: [
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(faq[1],
                            style: TextStyle(
                                color: theme.colorScheme.onSurfaceVariant)),
                      ),
                    ],
                  ),
              ],
            ),
          ),
          const Divider(),
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(Icons.support_agent, color: theme.colorScheme.secondary),
            title: const Text('Contact support'),
            subtitle: const Text('support@railmind.app • 1800-111-139'),
          ),
        ],
      ),
    ),
  );
}
