"use client";

import { useEffect } from "react";

/** Mapbox GL throws a benign "AbortError: signal is aborted without reason" when
 *  it cancels outdated tile requests. It is thrown SYNCHRONOUSLY inside its
 *  render loop (a requestAnimationFrame callback), so a window 'error' listener
 *  can't beat Next.js's dev-overlay handler. We catch it at the source by
 *  wrapping rAF (and keep window listeners as a backup). Only these benign
 *  aborts are swallowed — every other error propagates normally. */
function isBenignAbort(value: unknown, message?: string): boolean {
  const m = message ?? "";
  if (/signal is aborted|aborted without reason/i.test(m)) return true;
  const v = value as { name?: string; message?: string } | null | undefined;
  if (!v) return false;
  if (v.name === "AbortError") return true;
  return /signal is aborted|aborted without reason/i.test(String(v.message ?? ""));
}

// Patch rAF as soon as this module loads (before the map first renders).
if (typeof window !== "undefined") {
  const w = window as unknown as { __railmindRafPatched?: boolean };
  if (!w.__railmindRafPatched) {
    w.__railmindRafPatched = true;
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
      orig((t) => {
        try {
          cb(t);
        } catch (err) {
          if (!isBenignAbort(err, (err as Error)?.message)) throw err;
        }
      });
  }
}

export default function AbortErrorSuppressor() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isBenignAbort(e.error, e.message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as { message?: string } | undefined;
      if (isBenignAbort(e.reason, reason?.message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
    };
  }, []);

  return null;
}
