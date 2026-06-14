import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class AppTheme {
  AppTheme._();

  // ---- Brand / neon palette -------------------------------------------- //
  /// Electric cyan — the primary neon accent.
  static const Color neon = Color(0xFF22E0D6);
  static const Color neonAlt = Color(0xFF3DA5FF);
  static const Color neonPurple = Color(0xFF8B7BFF);
  static const Color neonPink = Color(0xFFFF5C8A);

  // ---- Dark surfaces (default experience) ------------------------------ //
  static const Color bgDark = Color(0xFF060A12);
  static const Color bgDarkElevated = Color(0xFF0C121E);
  static const Color surfaceDark = Color(0xFF111927);
  static const Color surfaceDarkAlt = Color(0xFF18222F);
  static const Color strokeDark = Color(0xFF243044);
  static const Color textDark = Color(0xFFE9F1FF);
  static const Color textDarkMuted = Color(0xFF8A98AE);

  // ---- Legacy transit colors (kept for back-compat) -------------------- //
  static const Color primaryNavy = Color(0xFF041627);
  static const Color secondaryBlue = Color(0xFF0058BC);
  static const Color accentBlue = Color(0xFF0070EB);
  static const Color softBackground = Color(0xFFF6F8FC);
  static const Color textOnSurface = Color(0xFF101521);
  static const Color textMuted = Color(0xFF5A6679);

  // ---- Status colors ---------------------------------------------------- //
  static const Color successGreen = Color(0xFF1FD18E);
  static const Color successGreenLight = Color(0xFF53E16F);
  static const Color warning = Color(0xFFFFB23E);
  static const Color danger = Color(0xFFFF5C6C);

  // ---- Signature gradients --------------------------------------------- //
  static const LinearGradient neonGradient = LinearGradient(
    colors: [neon, neonAlt],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient heroGradient = LinearGradient(
    colors: [Color(0xFF0E2A3D), Color(0xFF0A1626), Color(0xFF0B1C2C)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient violetGradient = LinearGradient(
    colors: [neonPurple, neonAlt],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static List<BoxShadow> neonGlow(Color color, {double blur = 24, double opacity = 0.45}) => [
        BoxShadow(
          color: color.withValues(alpha: opacity),
          blurRadius: blur,
          spreadRadius: -4,
          offset: const Offset(0, 8),
        ),
      ];

  // Light Theme
  static ThemeData get lightTheme {
    final baseTheme = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: const ColorScheme.light(
        primary: primaryNavy,
        secondary: secondaryBlue,
        secondaryContainer: accentBlue,
        background: softBackground,
        surface: Colors.white,
        surfaceVariant: Color(0xFFECEEF1),
        onPrimary: Colors.white,
        onSecondary: Colors.white,
        onBackground: textOnSurface,
        onSurface: textOnSurface,
        onSurfaceVariant: textMuted,
        outlineVariant: Color(0xFFC4C6CD),
        error: Color(0xFFBA1A1A),
      ),
      scaffoldBackgroundColor: softBackground,
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: primaryNavy),
        titleTextStyle: TextStyle(
          color: primaryNavy,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: Colors.white,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: Colors.grey.shade200, width: 1),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: secondaryBlue,
          foregroundColor: Colors.white,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: secondaryBlue,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFFF2F4F7),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade200, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: secondaryBlue, width: 1.5),
        ),
        labelStyle: const TextStyle(color: textMuted),
        hintStyle: TextStyle(color: Colors.grey.shade400),
      ),
    );

    return baseTheme.copyWith(
      textTheme: GoogleFonts.outfitTextTheme(baseTheme.textTheme).copyWith(
        bodyLarge: GoogleFonts.inter(textStyle: baseTheme.textTheme.bodyLarge),
        bodyMedium: GoogleFonts.inter(textStyle: baseTheme.textTheme.bodyMedium),
        labelLarge: GoogleFonts.inter(textStyle: baseTheme.textTheme.labelLarge),
      ),
    );
  }

  // Dark Theme
  static ThemeData get darkTheme {
    final baseTheme = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: const ColorScheme.dark(
        primary: textDark,
        onPrimary: bgDark,
        secondary: neon,
        onSecondary: Color(0xFF042424),
        secondaryContainer: neonAlt,
        tertiary: neonPurple,
        surface: surfaceDark,
        onSurface: textDark,
        surfaceContainerHighest: surfaceDarkAlt,
        onSurfaceVariant: textDarkMuted,
        outlineVariant: strokeDark,
        outline: strokeDark,
        error: danger,
      ),
      scaffoldBackgroundColor: bgDark,
      appBarTheme: const AppBarTheme(
        backgroundColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        iconTheme: IconThemeData(color: textDark),
        titleTextStyle: TextStyle(
          color: textDark,
          fontSize: 20,
          fontWeight: FontWeight.w700,
        ),
      ),
      cardTheme: CardThemeData(
        color: surfaceDark,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(22),
          side: const BorderSide(color: strokeDark, width: 1),
        ),
      ),
      dividerTheme: const DividerThemeData(color: strokeDark, thickness: 1),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: bgDarkElevated,
        indicatorColor: neon.withValues(alpha: 0.16),
        elevation: 0,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: states.contains(WidgetState.selected) ? neon : textDarkMuted,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected) ? neon : textDarkMuted,
          ),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: neon,
          foregroundColor: const Color(0xFF042424),
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(14),
          ),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: neon,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surfaceDarkAlt,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: strokeDark, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: neon, width: 1.5),
        ),
        labelStyle: const TextStyle(color: textDarkMuted),
        hintStyle: const TextStyle(color: Color(0xFF5C6A80)),
        prefixIconColor: textDarkMuted,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: surfaceDarkAlt,
        side: const BorderSide(color: strokeDark),
        labelStyle: const TextStyle(color: textDark),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(100)),
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: surfaceDark,
        surfaceTintColor: Colors.transparent,
      ),
      snackBarTheme: const SnackBarThemeData(
        backgroundColor: surfaceDarkAlt,
        contentTextStyle: TextStyle(color: textDark),
        behavior: SnackBarBehavior.floating,
      ),
    );

    return baseTheme.copyWith(
      textTheme: GoogleFonts.outfitTextTheme(baseTheme.textTheme)
          .apply(bodyColor: textDark, displayColor: textDark)
          .copyWith(
            bodyLarge: GoogleFonts.inter(textStyle: baseTheme.textTheme.bodyLarge?.copyWith(color: textDark)),
            bodyMedium: GoogleFonts.inter(textStyle: baseTheme.textTheme.bodyMedium?.copyWith(color: textDark)),
            bodySmall: GoogleFonts.inter(textStyle: baseTheme.textTheme.bodySmall?.copyWith(color: textDarkMuted)),
            labelLarge: GoogleFonts.inter(textStyle: baseTheme.textTheme.labelLarge?.copyWith(color: textDark)),
          ),
    );
  }
}
