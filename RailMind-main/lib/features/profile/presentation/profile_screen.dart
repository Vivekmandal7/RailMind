import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_providers.dart';
import '../../bookings/providers/bookings_provider.dart';
import 'profile_sheets.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final primaryColor = theme.colorScheme.primary;
    final secondaryColor = theme.colorScheme.secondary;
    final userAsync = ref.watch(currentUserProvider);
    final tripCount = ref.watch(bookingsProvider).length;
    final tier = tripCount >= 5
        ? '👑 Platinum Voyager'
        : tripCount >= 2
            ? '🌟 Premium Voyager'
            : '🎫 Voyager';

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'User Profile',
          style: theme.textTheme.headlineMedium?.copyWith(
            fontWeight: FontWeight.bold,
            color: primaryColor,
          ),
        ),
      ),
      body: userAsync.when(
        data: (user) {
          if (user == null) {
            return const Center(child: Text('User not found. Please log in again.'));
          }

          final initials = user.name.trim().isNotEmpty
              ? user.name.trim().split(' ').map((e) => e[0]).take(2).join().toUpperCase()
              : 'U';

          return SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                const SizedBox(height: 20),
                // Avatar Circle
                Container(
                  width: 96,
                  height: 96,
                  decoration: BoxDecoration(
                    color: secondaryColor.withValues(alpha: 0.1),
                    shape: BoxShape.circle,
                    border: Border.all(color: secondaryColor, width: 2),
                  ),
                  child: Center(
                    child: Text(
                      initials,
                      style: TextStyle(
                        color: secondaryColor,
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                // Name & Email
                Text(
                  user.name,
                  style: theme.textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: primaryColor,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  user.email,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 8),
                // Member Tier Badge
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.secondaryContainer.withValues(alpha: 0.15),
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    tier,
                    style: TextStyle(
                      color: secondaryColor,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(height: 32),
                // Options Menu List
                _buildMenuItem(
                  context: context,
                  icon: Icons.favorite_border,
                  title: 'Saved Favorites',
                  subtitle: 'Trains & Stations',
                  onTap: () => showFavoritesSheet(context),
                ),
                const SizedBox(height: 12),
                _buildMenuItem(
                  context: context,
                  icon: Icons.settings_suggest_outlined,
                  title: 'Travel Preferences',
                  subtitle: 'Default class & choices',
                  onTap: () => showPreferencesSheet(context),
                ),
                const SizedBox(height: 12),
                _buildMenuItem(
                  context: context,
                  icon: Icons.notifications_active_outlined,
                  title: 'Notification Settings',
                  subtitle: 'Journey alerts & updates',
                  onTap: () => showNotificationSettingsSheet(context),
                ),
                const SizedBox(height: 12),
                _buildMenuItem(
                  context: context,
                  icon: Icons.help_outline,
                  title: 'Help & Support',
                  subtitle: 'FAQs & contact',
                  onTap: () => showHelpSheet(context),
                ),
                const SizedBox(height: 32),
                // Logout Button
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: theme.colorScheme.error,
                    foregroundColor: Colors.white,
                    minimumSize: const Size.fromHeight(56),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onPressed: () => ref.read(authControllerProvider.notifier).signOut(),
                  icon: const Icon(Icons.logout),
                  label: const Text('Log Out'),
                ),
                const SizedBox(height: 20),
              ],
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(child: Text('Error: $err')),
      ),
    );
  }

  Widget _buildMenuItem({
    required BuildContext context,
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    final theme = Theme.of(context);
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        leading: Icon(icon, color: theme.colorScheme.secondary),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
        subtitle: Text(subtitle, style: const TextStyle(fontSize: 11)),
        trailing: const Icon(Icons.chevron_right, size: 20, color: Colors.grey),
        onTap: onTap,
      ),
    );
  }
}
