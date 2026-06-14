import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../models/user_model.dart';
import '../../../services/auth_service.dart';
import '../../../services/firestore_service.dart';
import '../../../services/local_storage_service.dart';

// Services Providers
final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService();
});

final firestoreServiceProvider = Provider<FirestoreService>((ref) {
  return FirestoreService();
});

// Auth State Provider
final authStateChangesProvider = StreamProvider<User?>((ref) {
  return ref.watch(authServiceProvider).authStateChanges;
});

// User Profile Provider
final currentUserProvider = FutureProvider<UserModel?>((ref) async {
  final user = ref.watch(authStateChangesProvider).value;
  if (user == null) return null;
  final storage = ref.watch(localStorageServiceProvider);
  final firestore = ref.watch(firestoreServiceProvider);

  final localUser = storage.getUserProfile(user.uid);
  if (localUser != null) return localUser;

  // No local cache — try Firestore (cross-device), else create a fresh profile.
  UserModel? remote;
  try {
    remote = await firestore.getUser(user.uid);
  } catch (_) {
    remote = null;
  }
  final resolved = remote ??
      UserModel(
        uid: user.uid,
        name: user.displayName ?? 'RailMind Passenger',
        email: user.email ?? '',
        photoUrl: user.photoURL,
        createdAt: DateTime.now(),
      );
  await storage.saveUserProfile(resolved);
  if (remote == null) {
    try {
      await firestore.createUser(resolved);
    } catch (_) {/* offline / rules — local cache is the source of truth */}
  }
  return resolved;
});

// Auth UI Controller Provider using unified AsyncNotifier and autoDispose modifier
final authControllerProvider = AsyncNotifierProvider.autoDispose<AuthController, void>(() {
  return AuthController();
});

class AuthController extends AsyncNotifier<void> {
  @override
  FutureOr<void> build() {
    // Return void
  }

  Future<bool> signInWithEmail(String email, String password) async {
    final authService = ref.read(authServiceProvider);
    state = const AsyncValue.loading();
    final result = await AsyncValue.guard(() async {
      await authService.signInWithEmail(email, password);
    });
    state = result;
    return !result.hasError;
  }

  Future<bool> signUpWithEmail({
    required String email,
    required String password,
    required String name,
  }) async {
    final authService = ref.read(authServiceProvider);
    final storageService = ref.read(localStorageServiceProvider);
    state = const AsyncValue.loading();
    final result = await AsyncValue.guard(() async {
      final credential = await authService.signUpWithEmail(email, password);
      final user = credential.user;
      if (user != null) {
        final userModel = UserModel(
          uid: user.uid,
          name: name,
          email: email,
          photoUrl: user.photoURL, // Note: photoURL in uppercase
          createdAt: DateTime.now(),
        );
        await storageService.saveUserProfile(userModel);
        try {
          await ref.read(firestoreServiceProvider).createUser(userModel);
        } catch (_) {/* best-effort remote sync */}
      }
    });
    state = result;
    return !result.hasError;
  }

  Future<bool> signInWithGoogle() async {
    final authService = ref.read(authServiceProvider);
    final storageService = ref.read(localStorageServiceProvider);
    state = const AsyncValue.loading();
    final result = await AsyncValue.guard(() async {
      final credential = await authService.signInWithGoogle();
      if (credential != null) {
        final user = credential.user;
        if (user != null) {
          final existingUser = storageService.getUserProfile(user.uid);
          if (existingUser == null) {
            final userModel = UserModel(
              uid: user.uid,
              name: user.displayName ?? 'Google User',
              email: user.email ?? '',
              photoUrl: user.photoURL, // Note: photoURL in uppercase
              createdAt: DateTime.now(),
            );
            await storageService.saveUserProfile(userModel);
            try {
              await ref.read(firestoreServiceProvider).createUser(userModel);
            } catch (_) {/* best-effort remote sync */}
          }
        }
      }
    });
    state = result;
    return !result.hasError;
  }

  Future<void> signOut() async {
    final authService = ref.read(authServiceProvider);
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(() async {
      await authService.signOut();
    });
  }
}
