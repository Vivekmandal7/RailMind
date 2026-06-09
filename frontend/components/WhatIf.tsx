"use client";
import { useEffect, useState, useMemo } from "react";
import { useStore } from "@/store/useStore";
import { pickBlockSection, labelSection } from "@/lib/disruptionTarget";
import type { NetworkData, TrainState } from "@/lib/types";

function defaultBlockSection(net: NetworkData, states: TrainState[]): string {
  const pick = pickBlockSection(net, states);
  if (pick) return pick.sectionId;
  const ghat = net.sections.find((s) => s.ghat);
  if (ghat) return ghat.id;
  const single = net.sections.find((s) => s.line === "single");
  if (single) return single.id;
  return net.sections[0]?.id ?? "KSRA-IGP";
}

function InjectBtn({
  label,
  desc,
  tone,
  onClick
}: {
  label: string;
  desc: string;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-start px-2.5 py-2 rounded-lg border bg-base/50 hover:bg-white/5 transition-colors ${tone}`}
    >
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-[10px] text-muted text-left leading-tight">{desc}</span>
    </button>
  );
}

export default function WhatIf() {
  const net = useStore((s) => s.net);
  const states = useStore((s) => s.states);
  const injectBreakdown = useStore((s) => s.injectBreakdown);
  const injectBlock = useStore((s) => s.injectBlock);
  const injectFog = useStore((s) => s.injectFog);
  const clearDisruptions = useStore((s) => s.clearDisruptions);
  const injectNotice = useStore((s) => s.injectNotice);
  const runNL = useStore((s) => s.runNL);
  const nlLog = useStore((s) => s.nlLog);
  const disruptions = useStore((s) => s.disruptions);
  const passengerLayer = useStore((s) => s.passengerLayer);
  const togglePassengerLayer = useStore((s) => s.togglePassengerLayer);

  const blockSection = useMemo(() => defaultBlockSection(net, states), [net, states]);
  const blockLabel = useMemo(() => labelSection(net, blockSection), [net, blockSection]);

  const [cmd, setCmd] = useState("");
  const [llm, setLlm] = useState<boolean | null>(null);
  const [llmDetail, setLlmDetail] = useState("");

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") || "http://127.0.0.1:8000"}/health`)
      .then((r) => r.json())
      .then((d) => {
        const providers = d.llm_providers as string[] | undefined;
        setLlm(Boolean(d.llm_enabled));
        setLlmDetail(
          providers && providers.length > 0
            ? providers.join(" + ")
            : d.delay_model === "ml"
            ? "ML only"
            : "rule-based"
        );
      })
      .catch(() => {
        fetch("/api/nl")
          .then((r) => r.json())
          .then((d) => {
            setLlm(Boolean(d.enabled));
            setLlmDetail("local");
          })
          .catch(() => setLlm(false));
      });
  }, []);

  const submit = () => {
    if (!cmd.trim()) return;
    runNL(cmd);
    setCmd("");
  };

  return (
    <div className="panel flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <span className="panel-header">What-if Injector</span>
        <button
          onClick={togglePassengerLayer}
          className={`tag transition-colors ${
            passengerLayer ? "text-amber border-amber/50 bg-amber/10" : "text-muted"
          }`}
        >
          PAX LAYER {passengerLayer ? "ON" : "OFF"}
        </button>
      </div>

      <div className="p-2.5 space-y-2.5">
        <div className="flex gap-1.5">
          <InjectBtn
            label="Breakdown"
            desc="Stall busiest train"
            tone="border-risk/40 text-risk"
            onClick={() => injectBreakdown()}
          />
          <InjectBtn
            label="Block"
            desc={`Close ${blockLabel} section`}
            tone="border-amber/40 text-amber"
            onClick={() => injectBlock()}
          />
          <InjectBtn
            label="Fog"
            desc="Network speed limit"
            tone="border-cyan/40 text-cyan"
            onClick={() => injectFog()}
          />
        </div>

        {injectNotice && (
          <p className="text-[10px] text-amber border border-amber/30 bg-amber/10 rounded-lg px-2 py-1.5 leading-snug">
            {injectNotice}
          </p>
        )}

        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="panel-header">Natural-language what-if</span>
            <span
              className={`tag text-[9px] ${
                llm ? "text-safe border-safe/50" : "text-muted"
              }`}
              title={llm ? `LLM: ${llmDetail}` : "No LLM key — backend uses rule engine"}
            >
              LLM {llm === null ? "…" : llm ? llmDetail || "LIVE" : "LOCAL"}
            </span>
          </div>
          <div className="flex gap-1.5">
            <input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              placeholder='e.g. "delay 12137 by 20 min" or "what if KYN–KSRA closes?"'
              className="flex-1 bg-base border border-border rounded-lg px-2.5 py-1.5 text-xs font-mono text-text placeholder:text-muted/60 focus:outline-none focus:border-cyan/60"
            />
            <button
              onClick={submit}
              className="px-3 rounded-lg bg-cyan/15 border border-cyan/50 text-cyan text-xs font-semibold hover:bg-cyan/25"
            >
              Run
            </button>
          </div>
        </div>

        {nlLog.length > 0 && (
          <div className="max-h-28 overflow-y-auto space-y-1.5">
            {nlLog.map((l) => (
              <div key={l.id} className="text-[11px] border-l-2 border-cyan/40 pl-2 py-0.5">
                <div className="font-mono text-cyan">&gt; {l.cmd}</div>
                <div className="text-text/80 leading-snug">{l.explanation}</div>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1 border-t border-border/60">
          <div className="flex gap-1 flex-wrap">
            {disruptions.length === 0 ? (
              <span className="text-[10px] text-muted">No disruptions injected</span>
            ) : (
              disruptions.map((d) => (
                <span key={d.id} className="tag text-risk border-risk/40 bg-risk/10">
                  {d.label}
                </span>
              ))
            )}
          </div>
          {disruptions.length > 0 && (
            <button
              onClick={clearDisruptions}
              className="text-[11px] text-muted hover:text-text underline"
            >
              Clear all
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
