"use client";
import { useStore } from "@/store/useStore";
import type { EngineModule } from "@/lib/types";

const STATUS_STYLE: Record<string, string> = {
  ok: "text-safe border-safe/40 bg-safe/10",
  running: "text-cyan border-cyan/40 bg-cyan/10 animate-pulse",
  idle: "text-muted border-border bg-base/40",
  flag: "text-amber border-amber/40 bg-amber/10",
  error: "text-risk border-risk/40 bg-risk/10",
  off: "text-muted border-border bg-base/30"
};

const STATUS_ICON: Record<string, string> = {
  ok: "✓",
  running: "◌",
  idle: "·",
  flag: "!",
  error: "✗",
  off: "—"
};

function ModuleRow({ m }: { m: EngineModule }) {
  const tone = STATUS_STYLE[m.status] ?? STATUS_STYLE.idle;
  const icon = STATUS_ICON[m.status] ?? "·";
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
      <span className={`tag shrink-0 w-5 text-center ${tone}`}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-text truncate">{m.name}</span>
          {m.latencyMs > 0 && (
            <span className="text-[9px] font-mono text-muted shrink-0">{m.latencyMs}ms</span>
          )}
        </div>
        <div className="text-[10px] text-muted truncate">{m.lastAction}</div>
        {m.detail && (
          <div className="text-[9px] text-muted/70 truncate font-mono">{m.detail}</div>
        )}
      </div>
    </div>
  );
}

export default function AiEnginePanel() {
  const mode = useStore((s) => s.mode);
  const connected = useStore((s) => s.connected);
  const engineModules = useStore((s) => s.engineModules);
  const demoEngineOverride = useStore((s) => s.demoEngineOverride);
  const predictions = useStore((s) => s.predictions);
  const plans = useStore((s) => s.plans);

  const modules =
    demoEngineOverride ??
    (engineModules.length > 0 ? engineModules : LOCAL_MODULES);

  const opt = modules.find((m) => m.key === "optimizer");
  const ver = modules.find((m) => m.key === "verifier");
  const ml = modules.find((m) => m.key === "delay_ml");

  return (
    <div className="panel flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="panel-header">AI Engine</span>
        <span
          className={`tag text-[9px] ${
            mode === "live" && connected
              ? "text-cyan border-cyan/50 bg-cyan/10"
              : "text-muted"
          }`}
        >
          {mode === "live" && connected ? "LIVE BRAIN" : "LOCAL FALLBACK"}
        </span>
      </div>

      <div className="shrink-0 px-3 py-1.5 border-b border-border/60 bg-base/30 max-h-[68px] scroll-panel">
        <div className="flex flex-wrap gap-1 text-[10px] font-mono">
          {ml && (
            <span className="tag text-cyan border-cyan/30">
              Delay ML {ml.lastAction.includes("ML") ? "✓" : "H"} · {predictions.length} forecasts
            </span>
          )}
          {opt && opt.status === "ok" && (
            <span className="tag text-amber border-amber/30">
              Optimizer ✓ {opt.lastAction.split("·")[0]?.trim()}
            </span>
          )}
          {ver && (
            <span className={`tag ${ver.status === "ok" ? "text-safe border-safe/30" : "text-amber border-amber/30"}`}>
              Verifier {ver.lastAction}
            </span>
          )}
          {plans[0]?.verifierAgree != null && plans[0]?.verifierTotal != null && (
            <span className="tag text-safe border-safe/30">
              Verifier ✓ {plans[0].verifierAgree}/{plans[0].verifierTotal} agree
            </span>
          )}
        </div>
      </div>

      <div className="px-3 py-1">
        {modules.map((m) => (
          <ModuleRow key={m.key} m={m} />
        ))}
      </div>
    </div>
  );
}

const LOCAL_MODULES: EngineModule[] = [
  { key: "delay_ml", name: "Delay ML", status: "off", lastAction: "Connect backend for ML", latencyMs: 0, detail: "local heuristic" },
  { key: "cascade", name: "Cascade Predictor", status: "idle", lastAction: "Local cascade model", latencyMs: 0, detail: "" },
  { key: "conflict_detector", name: "Conflict Detector", status: "idle", lastAction: "Local rule engine", latencyMs: 0, detail: "" },
  { key: "optimizer", name: "OR-Tools Optimizer", status: "off", lastAction: "Connect backend for CP-SAT", latencyMs: 0, detail: "" },
  { key: "verifier", name: "Multi-LLM Verifier", status: "off", lastAction: "Connect backend for LLM consensus", latencyMs: 0, detail: "" },
  { key: "nl_agent", name: "NL Agent", status: "idle", lastAction: "Local rule parser", latencyMs: 0, detail: "" },
  { key: "passenger", name: "Passenger Impact", status: "idle", lastAction: "Local heuristic", latencyMs: 0, detail: "" },
  { key: "anomaly", name: "Anomaly Sentinel", status: "idle", lastAction: "Local baseline", latencyMs: 0, detail: "" }
];
