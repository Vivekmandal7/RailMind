"use client";
import { useEffect, useState } from "react";

const STORAGE_KEY = "railmind-onboarded-v1";

export default function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      /* ignore */
    }
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-base/80 backdrop-blur-sm animate-fadeIn">
      <div className="panel max-w-md mx-4 p-6 border-cyan/30 shadow-glow">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-2 h-2 rounded-full bg-cyan shadow-glow" />
          <h2 className="font-mono text-lg text-cyan tracking-wide">RAILMIND</h2>
        </div>
        <p className="text-sm text-text/90 leading-relaxed mb-4">
          AI-powered rail operations control room — live network twin, 8-model intelligence
          pipeline, and what-if simulation for Indian Railways scale.
        </p>
        <ol className="space-y-2.5 mb-5">
          {[
            { n: "1", t: "Live map", d: "Track any train, click to follow, see conflicts pulse in real time." },
            { n: "2", t: "AI Engine", d: "Delay ML → cascade → OR-Tools → multi-LLM verify — watch modules fire." },
            { n: "3", t: "What-if", d: "Inject blocks, breakdowns, or fog — or try natural language commands." }
          ].map((step) => (
            <li key={step.n} className="flex gap-3">
              <span className="w-6 h-6 rounded-lg bg-cyan/15 text-cyan font-mono text-xs flex items-center justify-center shrink-0 border border-cyan/30">
                {step.n}
              </span>
              <div>
                <div className="text-xs font-semibold text-text">{step.t}</div>
                <div className="text-[11px] text-muted leading-snug">{step.d}</div>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex gap-2">
          <button
            onClick={dismiss}
            className="flex-1 py-2 rounded-lg bg-cyan text-base font-semibold text-sm hover:brightness-110 transition-all"
          >
            Enter control room
          </button>
          <button
            onClick={dismiss}
            className="px-3 py-2 rounded-lg border border-border text-muted text-xs hover:text-text transition-colors"
          >
            Skip
          </button>
        </div>
        <p className="text-[10px] text-muted/60 mt-3 text-center">
          Tip: press <span className="font-mono text-cyan">▶ Demo</span> for a guided walkthrough
        </p>
      </div>
    </div>
  );
}
