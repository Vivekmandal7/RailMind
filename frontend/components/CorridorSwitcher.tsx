"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/store/useStore";

const BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000";

const SHORT: Record<string, string> = {
  delhi: "Delhi",
  mumbai: "Mumbai",
  india: "India"
};

interface Corridor {
  key: string;
  name: string;
}

/** Corridor / view pills shown in the top bar (the "Delhi · Mumbai · India" in the corner).
 *  - When backend is connected: real corridor switching (POST + reload, engine swaps dataset).
 *  - When running frontend-only (local sim): always show the three pills as quick view/focus controls.
 *    India = full view reset. Delhi/Mumbai = focus a representative corridor area using the India-wide data.
 */
export default function CorridorSwitcher() {
  const [list, setList] = useState<Corridor[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const requestMapReset = useStore((s) => s.requestMapReset);
  const focusCorridor = useStore((s) => s.focusCorridor);
  const setFitRoute = useStore((s) => s.setFitRoute);
  const net = useStore((s) => s.net);

  useEffect(() => {
    fetch(`${BACKEND}/corridors`)
      .then((r) => r.json())
      .then((d) => {
        setList(d.corridors ?? []);
        setCurrent(d.current ?? "");
      })
      .catch(() => {
        // No backend → we will render local fallback pills below (Delhi / Mumbai / India)
      });
  }, []);

  const switchTo = async (key: string) => {
    if (key === current || busyKey) return;
    setBusyKey(key);
    try {
      const r = await fetch(`${BACKEND}/corridor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key })
      });
      const d = await r.json();
      if (d.ok) {
        setTimeout(() => window.location.reload(), 500);
      } else {
        setBusyKey(null);
      }
    } catch {
      setBusyKey(null);
    }
  };

  const handleLocalAction = (key: string) => {
    if (key === "india") {
      requestMapReset();
      return;
    }
    // Delhi / Mumbai in local mode: focus a sensible route in the India-wide dataset
    // so the map "goes to that part of the country" with real track geometry visible.
    if (key === "delhi") {
      // Prefer a northern/Delhi flagship if present, else generic focus
      const delhiTrain = net.trains.find((t: any) =>
        t.route.some((c: string) => ["NDLS", "NZM", "DLI", "AGC", "BPL"].includes(c))
      );
      if (delhiTrain) {
        setFitRoute(delhiTrain.route);
      } else {
        focusCorridor();
      }
      return;
    }
    if (key === "mumbai") {
      const mumbaiTrain = net.trains.find((t: any) =>
        t.route.some((c: string) => ["CSMT", "BCT", "LTT", "KYN", "IGP", "SUR"].includes(c))
      );
      if (mumbaiTrain) {
        setFitRoute(mumbaiTrain.route);
      } else {
        focusCorridor();
      }
      return;
    }
  };

  // Always render the pills so "Delhi · Mumbai · India" are visible in the corner
  // even in pure local/frontend-only runs (no backend).
  const effectiveList: Corridor[] =
    list.length > 0
      ? list
      : [
          { key: "india", name: "India-wide Rail Network" },
          { key: "delhi", name: "Delhi area" },
          { key: "mumbai", name: "Mumbai area" }
        ];

  const isLiveMode = list.length > 0;

  return (
    <div className="flex items-center gap-1" title={isLiveMode ? "Switch corridor (live engine)" : "Quick view / focus (local simulation)"}>
      {effectiveList.map((c) => {
        const active = isLiveMode ? c.key === current : c.key === "india";
        const busy = isLiveMode && busyKey === c.key;
        const label = SHORT[c.key] ?? c.name;

        return (
          <button
            key={c.key}
            type="button"
            onClick={() => {
              if (isLiveMode) {
                switchTo(c.key);
              } else {
                handleLocalAction(c.key);
              }
            }}
            disabled={busy}
            title={c.name}
            className={`text-[10px] font-semibold px-1.5 py-[3px] rounded transition-colors disabled:opacity-50 ${
              active
                ? "text-cyan border border-cyan/50 bg-cyan/10"
                : "text-muted border border-border/60 hover:text-text hover:border-cyan/40"
            }`}
          >
            {busy ? "…" : label}
          </button>
        );
      })}
    </div>
  );
}
