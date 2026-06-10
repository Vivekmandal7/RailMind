/** 
 * Realistic train icon for deck.gl (top-down view, intrinsic colors for "real train" look).
 * Navy body + saffron accents (nod to Indian Railways livery) + dark windows.
 * Status is conveyed via the colored glow + animated marker lights (see mapLayers).
 * Mask=false so the SVG colors are used directly (looks like an actual train, not a tinted blob).
 */
export const TRAIN_ICON = {
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="72" viewBox="0 0 36 72">
      <!-- Main body (dark navy for realistic train) -->
      <rect x="4" y="10" width="28" height="52" rx="3" fill="#0f2942"/>
      <!-- Loco front slope / cab (slightly lighter for 3D feel) -->
      <polygon points="4,10 18,3 32,10" fill="#1a3a52"/>
      <!-- Saffron/yellow stripe (IR-like accent) -->
      <rect x="4" y="18" width="28" height="3" fill="#f4a261" opacity="0.9"/>
      <!-- Windows (dark, segmented to suggest coaches) -->
      <rect x="6" y="24" width="24" height="3" rx="1" fill="#0a1624"/>
      <rect x="6" y="30" width="24" height="3" rx="1" fill="#0a1624"/>
      <rect x="6" y="36" width="24" height="3" rx="1" fill="#0a1624"/>
      <rect x="6" y="42" width="24" height="3" rx="1" fill="#0a1624"/>
      <!-- Rear buffer / tail -->
      <rect x="4" y="62" width="28" height="5" rx="2" fill="#0f2942"/>
      <!-- Small direction "nose" highlight at front -->
      <polygon points="18,3 14,9 22,9" fill="#f4a261" opacity="0.7"/>
    </svg>`
  )}`,
  width: 36,
  height: 72,
  anchorX: 18,
  anchorY: 36,
  mask: false
} as const;

export const SIM_SPEED_PRESETS = [1, 15, 60, 120] as const;
export type SimSpeedPreset = (typeof SIM_SPEED_PRESETS)[number];

export const SIM_MIN_SEC = 5 * 3600;
export const SIM_MAX_SEC = 24 * 3600;
