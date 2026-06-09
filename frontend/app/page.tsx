"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { isBenignMapNetworkError } from "@/lib/mapNetworkErrors";
import ErrorBoundary from "@/components/ErrorBoundary";
import MapKpiBar from "@/components/MapKpiBar";
import OnboardingOverlay from "@/components/OnboardingOverlay";
import ControlRoomLayout, { ControlRoomRoster } from "@/components/ControlRoomLayout";
import { useLiveTwinConnection } from "@/hooks/useLiveTwinConnection";

function isAbortError(reason: unknown): boolean {
  if (!reason || typeof reason !== "object") return false;
  const e = reason as { name?: string; message?: string };
  return e.name === "AbortError" || /aborted/i.test(e.message ?? "");
}

function suppressBenignMapError(reason: unknown): boolean {
  return isAbortError(reason) || isBenignMapNetworkError(reason);
}

export default function Page() {
  const [mapKey, setMapKey] = useState(0);
  useLiveTwinConnection();

  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      if (suppressBenignMapError(e.reason)) e.preventDefault();
    };
    const onError = (e: ErrorEvent) => {
      if (suppressBenignMapError(e.error ?? e.message)) e.preventDefault();
    };
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return (
    <div className="relative flex flex-col h-screen w-screen bg-base overflow-hidden grid-bg">
      <OnboardingOverlay />
      <MapKpiBar />
      <ErrorBoundary onReset={() => setMapKey((k) => k + 1)}>
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <ControlRoomLayout mapKey={mapKey} />
          <ControlRoomRoster />
        </div>
      </ErrorBoundary>
    </div>
  );
}
