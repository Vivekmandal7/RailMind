"use client";
import { useCallback, useRef, useState, useEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@/store/useStore";
import { pickBlockSection } from "@/lib/disruptionTarget";
import type { EngineModule } from "@/lib/types";

export type DemoScenario = "block_ghat" | "breakdown_flagship" | "fog_network";

const SCENARIOS: { id: DemoScenario; label: string; desc: string }[] = [
  { id: "block_ghat", label: "Block ghat", desc: "Single-line section closure" },
  { id: "breakdown_flagship", label: "Breakdown flagship", desc: "High-pax train stalls" },
  { id: "fog_network", label: "Fog network", desc: "Network-wide speed cap" }
];

const ENGINE_KEYS = [
  "delay_ml",
  "cascade",
  "conflict_detector",
  "optimizer",
  "verifier",
  "passenger",
  "anomaly",
  "explainer"
];

const ENGINE_NAMES: Record<string, string> = {
  delay_ml: "Delay ML",
  cascade: "Cascade",
  conflict_detector: "Conflict scan",
  optimizer: "OR-Tools",
  verifier: "Verifier",
  passenger: "Passenger",
  anomaly: "Anomaly",
  explainer: "Explainer"
};

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function waitFor(
  pred: () => boolean,
  timeoutMs = 18000,
  intervalMs = 120
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (pred()) {
        resolve(true);
        return;
      }
      if (Date.now() - start >= timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

async function pulseEngine(
  setDemoState: ReturnType<typeof useStore.getState>["setDemoState"],
  keys: string[],
  caption: string
) {
  setDemoState({ demoCaption: caption });
  for (const key of keys) {
    const modules: EngineModule[] = ENGINE_KEYS.map((k) => ({
      key: k,
      name: ENGINE_NAMES[k] ?? k,
      status: k === key ? "running" : keys.indexOf(k) < keys.indexOf(key) ? "ok" : "idle",
      lastAction: k === key ? "Processing…" : "",
      latencyMs: k === key ? 0 : 42,
      detail: ""
    }));
    setDemoState({ demoEngineOverride: modules });
    await sleep(650);
  }
  setDemoState({ demoEngineOverride: null });
}

function DemoScenarioMenu({
  open,
  anchorRef,
  onPick,
  onClose
}: {
  open: boolean;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onPick: (id: DemoScenario) => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !anchorRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = anchorRef.current!.getBoundingClientRect();
      const menuW = 224;
      const left = Math.min(Math.max(8, r.left), window.innerWidth - menuW - 8);
      setPos({ top: r.bottom + 6, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !pos || typeof document === "undefined") return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[280]" onClick={onClose} aria-hidden />
      <div
        className="fixed z-[300] w-56 panel bg-panel2 border border-border rounded-xl shadow-2xl overflow-hidden animate-fadeIn"
        style={{ top: pos.top, left: pos.left }}
        role="menu"
      >
        <div className="px-3 py-2 border-b border-border panel-header">Scenario</div>
        {SCENARIOS.map((sc) => (
          <button
            key={sc.id}
            role="menuitem"
            onClick={() => onPick(sc.id)}
            className="w-full text-left px-3 py-2.5 hover:bg-white/5 transition-colors border-b border-border/40 last:border-0"
          >
            <div className="text-xs font-semibold text-text">{sc.label}</div>
            <div className="text-[10px] text-muted mt-0.5">{sc.desc}</div>
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}

export default function DemoMode() {
  const [open, setOpen] = useState(false);
  const runningRef = useRef(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const demoActive = useStore((s) => s.demoActive);
  const setDemoState = useStore((s) => s.setDemoState);
  const clearDisruptions = useStore((s) => s.clearDisruptions);
  const setPlaying = useStore((s) => s.setPlaying);
  const focusCorridor = useStore((s) => s.focusCorridor);
  const focusBlockCorridor = useStore((s) => s.focusBlockCorridor);
  const setTrack = useStore((s) => s.setTrack);
  const injectBlock = useStore((s) => s.injectBlock);
  const injectBreakdown = useStore((s) => s.injectBreakdown);
  const injectFog = useStore((s) => s.injectFog);
  const applyPlan = useStore((s) => s.applyPlan);
  const focusConflict = useStore((s) => s.focusConflict);
  const requestMapReset = useStore((s) => s.requestMapReset);
  const mode = useStore((s) => s.mode);
  const connected = useStore((s) => s.connected);

  const pickFlagship = useCallback(() => {
    const s = useStore.getState();
    const active = s.states.filter((t) => t.active && t.speedKmh > 0);
    return active.sort((a, b) => b.estPassengers - a.estPassengers)[0]?.number;
  }, []);

  const runDemo = useCallback(
    async (scenario: DemoScenario) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setOpen(false);
      const isLive = mode === "live" && connected;
      setDemoState({ demoActive: true, demoCaption: "Resetting view for demo…" });
      if (!isLive) setPlaying(false);
      clearDisruptions();
      setTrack(null);
      focusConflict(null);
      requestMapReset();
      await sleep(1400);

      setDemoState({ demoCaption: "Live map — Indian rail network at operational scale" });
      focusCorridor();
      await sleep(2400);

      const flagship = pickFlagship();
      if (flagship) {
        setDemoState({ demoCaption: `Tracking flagship ${flagship} — click any train to follow` });
        setTrack(flagship);
        await sleep(2400);
      }

      if (scenario === "block_ghat") {
        setDemoState({ demoCaption: "Flying into busy single-line corridor…" });
        focusBlockCorridor();
        await sleep(2200);
        const s = useStore.getState();
        const pick = pickBlockSection(s.net, s.states);
        const label = pick?.sectionId ?? "ghat section";
        setDemoState({
          demoCaption: `Injecting block on ${label}…`
        });
        injectBlock(pick?.sectionId);
      } else if (scenario === "breakdown_flagship") {
        setDemoState({ demoCaption: `Breakdown on flagship ${flagship ?? "train"}…` });
        injectBreakdown(flagship);
      } else {
        setDemoState({ demoCaption: "Fog restriction — network speed capped at 60%" });
        injectFog();
      }
      await sleep(1200);

      setDemoState({ demoCaption: "Scanning 45-min look-ahead — conflicts emerging…" });
      await waitFor(() => useStore.getState().conflicts.length > 0, 12000);
      const firstConflict = useStore.getState().conflicts[0];
      if (firstConflict) focusConflict(firstConflict.id);
      await sleep(1000);

      if (!isLive) {
        await pulseEngine(setDemoState, ["delay_ml", "cascade", "conflict_detector"], "AI Engine: delay ML → cascade → conflict scan");
      } else {
        setDemoState({ demoCaption: "AI Engine: delay ML → cascade → conflict detection" });
        await waitFor(
          () =>
            useStore.getState().engineModules.some((m) => m.status === "running" || m.status === "ok") &&
            useStore.getState().timeline.some((e) => e.kind === "conflict"),
          15000
        );
        await sleep(1200);
      }

      setDemoState({ demoCaption: "OR-Tools optimizing + multi-model verification…" });
      if (!isLive) {
        await pulseEngine(setDemoState, ["optimizer", "verifier"], "CP-SAT solver + LLM verifier");
      }
      await waitFor(() => useStore.getState().plans.length > 0, 12000);
      await sleep(600);

      const st = useStore.getState();
      const plan =
        st.plans.find((p) => p.verified && !p.flaggedForHuman) ??
        st.plans.find((p) => !p.flaggedForHuman) ??
        st.plans[0];

      if (plan) {
        focusConflict(plan.conflictId);
        const badge =
          plan.verifierTotal && plan.verifierTotal > 0
            ? `Verified ✓ ${plan.verifierAgree}/${plan.verifierTotal}`
            : "Verified ✓";
        setDemoState({ demoCaption: `Plan ${badge} — auto-applying resolution…` });
        applyPlan(plan);
        await sleep(1800);
      }

      setDemoState({ demoCaption: "Conflicts clearing — KPIs recovering" });
      await waitFor(
        () =>
          useStore.getState().conflicts.filter((c) => c.severity === "critical").length === 0 ||
          useStore.getState().timeline.some((e) => e.kind === "apply" || e.kind === "outcome"),
        10000
      );
      await sleep(1200);

      setDemoState({ demoCaption: "Returning to India-wide overview…" });
      requestMapReset();
      await sleep(1600);

      setDemoState({ demoActive: false, demoCaption: null, demoEngineOverride: null });
      focusConflict(null);
      setPlaying(true);
      runningRef.current = false;
    },
    [
      applyPlan,
      clearDisruptions,
      connected,
      focusBlockCorridor,
      focusConflict,
      focusCorridor,
      injectBlock,
      injectBreakdown,
      injectFog,
      mode,
      pickFlagship,
      requestMapReset,
      setDemoState,
      setPlaying,
      setTrack
    ]
  );

  return (
    <div className="relative flex items-center gap-1.5">
      <button
        ref={btnRef}
        disabled={demoActive}
        onClick={() => setOpen((o) => !o)}
        className={`tag font-semibold px-2.5 py-1 transition-all duration-200 ${
          demoActive
            ? "text-cyan border-cyan/60 bg-cyan/15 animate-pulse"
            : "text-amber border-amber/50 bg-amber/10 hover:bg-amber/20 hover:shadow-glowAmber"
        }`}
      >
        {demoActive ? "DEMO…" : "▶ Demo"}
      </button>

      <DemoScenarioMenu
        open={open && !demoActive}
        anchorRef={btnRef}
        onPick={runDemo}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}

export function DemoCaption() {
  const caption = useStore((s) => s.demoCaption);
  if (!caption) return null;
  return (
    <div className="absolute bottom-[4.5rem] left-1/2 -translate-x-1/2 z-30 pointer-events-none animate-captionIn">
      <div className="panel bg-panel/95 backdrop-blur px-5 py-2.5 border-cyan/40 shadow-glow max-w-lg text-center">
        <p className="text-sm text-text/95 font-medium">{caption}</p>
      </div>
    </div>
  );
}
