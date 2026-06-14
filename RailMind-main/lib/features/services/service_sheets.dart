import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../services/local_storage_service.dart';

/// Premium passenger services — seat-delivered food and lounge pre-booking.
/// Both flows let the user make a real selection and persist a confirmed order.

Future<void> showFoodOrderSheet(BuildContext context, {String? trainName}) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => _FoodOrderSheet(trainName: trainName),
  );
}

Future<void> showLoungeSheet(BuildContext context) {
  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (_) => const _LoungeSheet(),
  );
}

class _MenuItem {
  final String name;
  final int price;
  final IconData icon;
  const _MenuItem(this.name, this.price, this.icon);
}

const _menu = [
  _MenuItem('Veg Thali', 180, Icons.rice_bowl),
  _MenuItem('Chicken Biryani', 220, Icons.kebab_dining),
  _MenuItem('Masala Dosa', 120, Icons.flatware),
  _MenuItem('Veg Sandwich', 90, Icons.lunch_dining),
  _MenuItem('Tea / Coffee', 30, Icons.coffee),
  _MenuItem('Mineral Water', 20, Icons.water_drop),
];

class _SheetShell extends StatelessWidget {
  const _SheetShell({required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: SafeArea(
        child: Container(
          margin: const EdgeInsets.all(12),
          constraints: BoxConstraints(
            maxHeight: MediaQuery.of(context).size.height * 0.85,
          ),
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 20),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(24),
          ),
          child: child,
        ),
      ),
    );
  }
}

class _FoodOrderSheet extends ConsumerStatefulWidget {
  const _FoodOrderSheet({this.trainName});
  final String? trainName;
  @override
  ConsumerState<_FoodOrderSheet> createState() => _FoodOrderSheetState();
}

class _FoodOrderSheetState extends ConsumerState<_FoodOrderSheet> {
  final Map<String, int> _qty = {};

  int get _total {
    var t = 0;
    for (final item in _menu) {
      t += (_qty[item.name] ?? 0) * item.price;
    }
    return t;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _SheetShell(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.fastfood, color: theme.colorScheme.secondary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  'Order Food',
                  style: theme.textTheme.titleLarge
                      ?.copyWith(fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          Text(
            widget.trainName != null
                ? 'Delivered to your seat on ${widget.trainName}'
                : 'Delivered to your seat at the next halt',
            style: TextStyle(color: theme.colorScheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          Expanded(
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: _menu.length,
              separatorBuilder: (_, _) => const Divider(height: 1),
              itemBuilder: (_, i) {
                final item = _menu[i];
                final qty = _qty[item.name] ?? 0;
                return Row(
                  children: [
                    Icon(item.icon,
                        color: theme.colorScheme.secondary, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(item.name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                  fontWeight: FontWeight.w600)),
                          Text('₹${item.price}',
                              style: TextStyle(
                                  color: theme.colorScheme.onSurfaceVariant,
                                  fontSize: 12)),
                        ],
                      ),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      onPressed: qty == 0
                          ? null
                          : () => setState(() => _qty[item.name] = qty - 1),
                      icon: const Icon(Icons.remove_circle_outline),
                    ),
                    SizedBox(
                      width: 24,
                      child: Text('$qty',
                          textAlign: TextAlign.center,
                          style: const TextStyle(fontWeight: FontWeight.bold)),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      onPressed: () => setState(() => _qty[item.name] = qty + 1),
                      icon: const Icon(Icons.add_circle),
                      color: theme.colorScheme.secondary,
                    ),
                  ],
                );
              },
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Flexible(
                child: Text('Total: ₹$_total',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.bold)),
              ),
              const SizedBox(width: 8),
              ElevatedButton.icon(
                onPressed: _total == 0
                    ? null
                    : () async {
                        await ref
                            .read(localStorageServiceProvider)
                            .addServiceOrder({
                          'type': 'food',
                          'total': _total,
                          'items': _qty.entries
                              .where((e) => e.value > 0)
                              .map((e) => '${e.value}× ${e.key}')
                              .toList(),
                          'train': widget.trainName,
                          'placedAt': DateTime.now().toIso8601String(),
                        });
                        if (context.mounted) {
                          Navigator.of(context).pop();
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                              content: Text(
                                  'Order placed • ₹$_total. Food will be delivered to your seat.')));
                        }
                      },
                icon: const Icon(Icons.check),
                label: const Text('Place Order'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: theme.colorScheme.secondary,
                  foregroundColor: const Color(0xFF042424),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _LoungeSheet extends ConsumerStatefulWidget {
  const _LoungeSheet();
  @override
  ConsumerState<_LoungeSheet> createState() => _LoungeSheetState();
}

class _LoungeSheetState extends ConsumerState<_LoungeSheet> {
  String _station = 'Mumbai CSMT';
  String _slot = '08:00 – 10:00';
  int _guests = 1;

  static const _stations = ['Mumbai CSMT', 'Dadar', 'Thane', 'Kalyan Jn'];
  static const _slots = [
    '06:00 – 08:00',
    '08:00 – 10:00',
    '10:00 – 12:00',
    '16:00 – 18:00',
  ];

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final price = _guests * 250;
    return _SheetShell(
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.hotel, color: theme.colorScheme.secondary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Executive Lounge',
                    style: theme.textTheme.titleLarge
                        ?.copyWith(fontWeight: FontWeight.bold),
                  ),
                ),
              ],
            ),
            Text('Pre-book premium lounge access',
                style: TextStyle(color: theme.colorScheme.onSurfaceVariant)),
            const SizedBox(height: 16),
            _dropdown('Station', _station, _stations,
                (v) => setState(() => _station = v)),
            const SizedBox(height: 12),
            _dropdown(
                'Time slot', _slot, _slots, (v) => setState(() => _slot = v)),
            const SizedBox(height: 12),
            Row(
              children: [
                const Text('Guests',
                    style: TextStyle(fontWeight: FontWeight.w600)),
                const Spacer(),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed:
                      _guests <= 1 ? null : () => setState(() => _guests--),
                  icon: const Icon(Icons.remove_circle_outline),
                ),
                SizedBox(
                  width: 24,
                  child: Text('$_guests',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontWeight: FontWeight.bold)),
                ),
                IconButton(
                  visualDensity: VisualDensity.compact,
                  onPressed:
                      _guests >= 6 ? null : () => setState(() => _guests++),
                  icon: Icon(Icons.add_circle,
                      color: theme.colorScheme.secondary),
                ),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () async {
                  await ref.read(localStorageServiceProvider).addServiceOrder({
                    'type': 'lounge',
                    'station': _station,
                    'slot': _slot,
                    'guests': _guests,
                    'total': price,
                    'placedAt': DateTime.now().toIso8601String(),
                  });
                  if (context.mounted) {
                    Navigator.of(context).pop();
                    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                        content: Text(
                            'Lounge booked at $_station, $_slot • ₹$price')));
                  }
                },
                icon: const Icon(Icons.check),
                label: Text('Book Lounge • ₹$price'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: theme.colorScheme.secondary,
                  foregroundColor: const Color(0xFF042424),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _dropdown(String label, String value, List<String> items,
      ValueChanged<String> onChanged) {
    final theme = Theme.of(context);
    return InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        border:
            OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: value,
          isExpanded: true,
          items: items
              .map((s) => DropdownMenuItem(value: s, child: Text(s)))
              .toList(),
          onChanged: (v) => onChanged(v ?? value),
          style: TextStyle(color: theme.colorScheme.onSurface),
        ),
      ),
    );
  }
}
