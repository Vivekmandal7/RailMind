"use client";
import { useEffect, useRef } from "react";
import { useStore } from "@/store/useStore";

/** Drives the SimulationEngine via a fixed real-time interval. */
export function useSimLoop() {
  const tick = useStore((s) => s.tick);
  const last = useRef<number>(performance.now());

  useEffect(() => {
    let raf = 0;
    let mounted = true;
    const loop = () => {
      if (!mounted) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - last.current) / 1000);
      last.current = now;
      tick(dt);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      mounted = false;
      cancelAnimationFrame(raf);
    };
  }, [tick]);
}
