/** Benign network failures from Mapbox telemetry / ad-blocker fetch hooks. */
export function isBenignMapNetworkError(reason: unknown): boolean {
  if (!reason) return false;

  if (typeof reason === "string") {
    return /failed to fetch|network error|load failed|aborted/i.test(reason);
  }

  if (typeof reason === "object") {
    const e = reason as { name?: string; message?: string; stack?: string };
    if (e.name === "AbortError") return true;

    const msg = e.message ?? "";
    if (!/failed to fetch|network error|load failed|aborted/i.test(msg)) return false;

    const stack = e.stack ?? "";
    return (
      /mapbox-gl|events\.mapbox\.com|mapbox\.com/i.test(stack) ||
      /frame_ant|chrome-extension:\/\//i.test(stack) ||
      stack.length === 0
    );
  }

  return false;
}
