"use client";

import { useEffect } from "react";

/** Mapbox GL throws a benign "AbortError: signal is aborted without reason" when
 *  it cancels outdated tile requests. It is thrown SYNCHRONOUSLY inside its
 *  render loop (a requestAnimationFrame callback), so a window 'error' listener
 *  can't beat Next.js's dev-overlay handler. We catch it inside the rAF callback
 *  and swallow ONLY abort errors; everything else re-throws untouched. */
function isAbort(err: unknown): boolean {
  if (err == null) return false;
  const e = err as { name?: string; message?: string; stack?: string };
  let s = "";
  try {
    // include the stack — Mapbox's render-abort stack contains "abortTile",
    // so this matches even if name/message are odd on some error objects.
    s = `${e.name ?? ""} ${e.message ?? ""} ${e.stack ?? ""} ${String(err)}`;
  } catch {
    s = "";
  }
  return /abort/i.test(s);
}

// Wrap rAF as soon as this module loads (before the map first renders). Re-wrap
// from the STORED original on every (re)load so HMR picks up this logic without
// double-wrapping.
if (typeof window !== "undefined") {
  const w = window as unknown as {
    __railmindOrigRAF?: typeof window.requestAnimationFrame;
  };
  if (!w.__railmindOrigRAF) {
    w.__railmindOrigRAF = window.requestAnimationFrame.bind(window);
  }
  const orig = w.__railmindOrigRAF;
  window.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    orig((t) => {
      try {
        cb(t);
      } catch (err) {
        if (!isAbort(err)) throw err;
      }
    });

  // Mapbox also logs the abort via console.error (e.g. when switching styles /
  // satellite), which Next.js's dev overlay surfaces as an error toast. Drop
  // only benign abort logs; pass everything else through untouched.
  const cw = window as unknown as { __railmindConsolePatched?: boolean };
  if (!cw.__railmindConsolePatched) {
    cw.__railmindConsolePatched = true;
    const origError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      for (const a of args) {
        if (isAbort(a) || /abort|signal is aborted/i.test(String((a as { message?: string })?.message ?? a))) {
          return;
        }
      }
      origError(...args);
    };
  }
}

export default function AbortErrorSuppressor() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isAbort(e.error) || /abort/i.test(e.message ?? "")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isAbort(e.reason)) {
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
