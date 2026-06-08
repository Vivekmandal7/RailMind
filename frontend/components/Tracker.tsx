"use client";
import { useMemo, useState } from "react";
import { useStore } from "@/store/useStore";
import { fmtClock } from "@/lib/geo";

export default function Tracker() {
  const net = useStore((s) => s.net);
  const states = useStore((s) => s.states);
  const trackTrain = useStore((s) => s.trackTrain);
  const setTrack = useStore((s) => s.setTrack);
  const showCascade = useStore((s) => s.showCascade);
  const clearCascade = useStore((s) => s.clearCascade);

  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState("");
  const [dest, setDest] = useState("");

  const suggestions = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return net.trains
      .filter(
        (t) =>
          t.number.includes(s) || t.name.toLowerCase().includes(s)
      )
      .slice(0, 5);
  }, [q, net.trains]);

  const odMatches = useMemo(() => {
    if (!origin || !dest || origin === dest) return [];
    return net.trains.filter((t) => {
      const i = t.route.indexOf(origin);
      const j = t.route.indexOf(dest);
      return i >= 0 && j >= 0 && i < j;
    });
  }, [origin, dest, net.trains]);

  const tracked = states.find((t) => t.number === trackTrain);
  const trackedTrain = net.trains.find((t) => t.number === trackTrain);
  const setFitRoute = useStore((s) => s.setFitRoute);

  return (
    <div className="absolute top-3 left-3 z-10 w-[330px]">
      <div className="panel bg-panel/95 backdrop-blur p-2.5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="panel-header">Universal Tracker</span>
          <span className="text-[10px] text-muted">Track anything on the network</span>
        </div>

        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search train number or name…"
            className="w-full bg-base border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-text placeholder:text-muted/60 focus:outline-none focus:border-cyan/60"
          />
          {suggestions.length > 0 && (
            <div className="absolute mt-1 w-full bg-panel2 border border-border rounded-lg overflow-hidden z-20">
              {suggestions.map((t) => (
                <button
                  key={t.number}
                  onClick={() => {
                    setTrack(t.number);
                    setQ("");
                  }}
                  className="w-full text-left px-2.5 py-1.5 hover:bg-white/5 flex items-center justify-between"
                >
                  <span className="text-xs text-text">
                    <span className="font-mono text-cyan">{t.number}</span> {t.name}
                  </span>
                  <span className="tag text-muted">{t.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-2">
          <select
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="flex-1 bg-base border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-cyan/60"
          >
            <option value="">Origin</option>
            {net.stations.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
          <span className="text-muted text-xs">→</span>
          <select
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            className="flex-1 bg-base border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-text focus:outline-none focus:border-cyan/60"
          >
            <option value="">Destination</option>
            {net.stations.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </div>
        {odMatches.length > 0 && (
          <div className="mt-1.5 flex gap-1 flex-wrap">
            {odMatches.map((t) => (
              <button
                key={t.number}
                onClick={() => setTrack(t.number)}
                className="tag text-cyan border-cyan/40 bg-cyan/10 hover:bg-cyan/20"
              >
                {t.number}
              </button>
            ))}
          </div>
        )}
      </div>

      {tracked && trackedTrain && (
        <div className="panel bg-panel/95 backdrop-blur p-2.5 mt-2 border-cyan/30">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-mono text-cyan text-sm">{tracked.number}</span>{" "}
              <span className="text-xs text-text">{tracked.name}</span>
            </div>
            <button
              onClick={() => {
                setTrack(null);
                clearCascade();
              }}
              className="text-muted hover:text-text text-xs"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5 mt-2">
            <Mini label="Status" value={tracked.active ? tracked.status : "scheduled"} tone={statusTone(tracked.status)} />
            <Mini label="Delay" value={`+${tracked.delayMinutes}m`} tone={tracked.delayMinutes >= 5 ? "text-amber" : "text-safe"} />
            <Mini label="Speed" value={`${Math.round(tracked.speedKmh)}`} tone="text-text" />
            <Mini label="Next stop" value={tracked.nextStation ?? "—"} tone="text-cyan" />
            <Mini
              label="ETA next"
              value={tracked.etaNextSec ? fmtClock(tracked.etaNextSec) : "—"}
              tone="text-text"
            />
            <Mini label="ETA final" value={fmtClock(tracked.etaFinalSec)} tone="text-text" />
          </div>

          <div className="mt-2 text-[10px] text-muted font-mono">
            {trackedTrain.route[0]} → {trackedTrain.route[trackedTrain.route.length - 1]} ·{" "}
            {tracked.estPassengers.toLocaleString()} pax onboard
          </div>

          {trackedTrain && (
            <button
              onClick={() => setFitRoute(trackedTrain.route)}
              className="mt-2 w-full text-xs font-semibold py-1.5 rounded-lg border border-cyan/50 text-cyan hover:bg-cyan/10"
            >
              Zoom to route
            </button>
          )}
          {tracked.active && tracked.delayMinutes > 0 && (
            <button
              onClick={() => showCascade(tracked.number)}
              className="mt-1.5 w-full text-xs font-semibold py-1.5 rounded-lg border border-cyan/50 text-cyan hover:bg-cyan/10"
            >
              Show cascade / ripple
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex flex-col rounded-lg bg-base/60 border border-border px-2 py-1">
      <span className="panel-header text-[9px]">{label}</span>
      <span className={`font-mono text-xs ${tone} capitalize`}>{value}</span>
    </div>
  );
}

function statusTone(s: string): string {
  return s === "running"
    ? "text-safe"
    : s === "delayed"
    ? "text-amber"
    : s === "held" || s === "conflict"
    ? "text-risk"
    : "text-muted";
}
