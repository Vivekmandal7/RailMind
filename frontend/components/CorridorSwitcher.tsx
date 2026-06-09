"use client";

import { useEffect, useState } from "react";

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

/** Flip the live engine between corridors (Delhi · Mumbai · India) in one click.
 *  Inline pills — the backend rebuilds on the chosen corridor; we reload to
 *  re-frame the map cleanly. */
export default function CorridorSwitcher() {
  const [list, setList] = useState<Corridor[]>([]);
  const [current, setCurrent] = useState<string>("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BACKEND}/corridors`)
      .then((r) => r.json())
      .then((d) => {
        setList(d.corridors ?? []);
        setCurrent(d.current ?? "");
      })
      .catch(() => {});
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

  if (list.length === 0) return null;

  return (
    <div className="flex items-center gap-1" title="Switch corridor">
      {list.map((c) => {
        const active = c.key === current;
        const busy = busyKey === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => switchTo(c.key)}
            disabled={busyKey !== null}
            title={c.name}
            className={`text-[10px] font-semibold px-1.5 py-[3px] rounded transition-colors disabled:opacity-50 ${
              active
                ? "text-cyan border border-cyan/50 bg-cyan/10"
                : "text-muted border border-border/60 hover:text-text hover:border-cyan/40"
            }`}
          >
            {busy ? "…" : (SHORT[c.key] ?? c.name)}
          </button>
        );
      })}
    </div>
  );
}
