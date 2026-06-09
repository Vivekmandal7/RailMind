"use client";

import { useEffect } from "react";
import { useStore } from "@/store/useStore";

/** Connect to the Python twin on mount; disconnect on unmount. */
export function useLiveTwinConnection() {
  const initLive = useStore((s) => s.initLive);
  const cleanupLive = useStore((s) => s.cleanupLive);

  useEffect(() => {
    initLive();
    return () => cleanupLive();
  }, [initLive, cleanupLive]);
}
