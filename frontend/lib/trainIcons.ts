/** Shared train icon for deck.gl IconLayer (mask = tint via getColor). */
export const TRAIN_ICON = {
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="84" viewBox="0 0 40 84">
      <path d="M20 2 C30 2 35 11 35 24 L35 66 C35 78 29 82 20 82 C11 82 5 78 5 66 L5 24 C5 11 10 2 20 2 Z" fill="white"/>
      <rect x="11" y="9" width="18" height="7" rx="3" fill="white" opacity="0.55"/>
    </svg>`
  )}`,
  width: 40,
  height: 84,
  anchorX: 20,
  anchorY: 42,
  mask: true
} as const;

export const SIM_SPEED_PRESETS = [1, 15, 60, 120] as const;
export type SimSpeedPreset = (typeof SIM_SPEED_PRESETS)[number];

export const SIM_MIN_SEC = 5 * 3600;
export const SIM_MAX_SEC = 24 * 3600;
