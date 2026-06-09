"use client";

import { useEffect } from "react";

/** Mapbox GL throws a benign "AbortError: signal is aborted without reason" when
 *  it cancels outdated tile requests during pan/zoom/teardown. It leaks as an
 *  unhandled error/rejection, which makes Next.js dev throw a blocking overlay
 *  over the map. Swallow only these benign aborts — nothing else. */
function isBenignAbort(value: unknown, message?: string): boolean {
  const m = message ?? "";
  if (/signal is aborted|aborted without reason/i.test(m)) return true;
  const v = value as { name?: string; message?: string } | null | undefined;
  if (!v) return false;
  if (v.name === "AbortError") return true;
  return /signal is aborted|aborted without reason/i.test(String(v.message ?? ""));
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
    // capture phase so we run before Next.js's dev-overlay listeners
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection, true);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection, true);
    };
  }, []);

  return null;
}
