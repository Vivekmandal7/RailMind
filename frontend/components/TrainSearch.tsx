"use client";

import { useEffect, useRef, useState } from "react";
import type { TrainDefinition } from "@/lib/indiaTrains";

interface Props {
  trains: TrainDefinition[];
  onSelect: (train: TrainDefinition) => void;
}

export default function TrainSearch({ trains, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<TrainDefinition[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? trains
          .filter((t) => t.number.includes(q) || t.name.toLowerCase().includes(q))
          .slice(0, 6)
      : [];
    setResults(matches);
    setOpen(q.length > 0 && matches.length > 0);
  }, [query, trains]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (train: TrainDefinition) => {
    setQuery(train.number);
    setOpen(false);
    onSelect(train);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (results[0]) pick(results[0]);
  };

  return (
    <div ref={wrapRef} className="absolute top-4 left-32 z-10 w-64">
      <form onSubmit={onSubmit}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim() && results.length > 0 && setOpen(true)}
          placeholder="Search train # or name…"
          className="w-full panel bg-panel/95 backdrop-blur border border-white/15 px-3 py-1.5 text-xs text-white placeholder:text-muted focus:border-cyan/50 focus:outline-none"
          aria-label="Search trains"
        />
      </form>
      {open && (
        <ul className="mt-1 panel bg-panel/98 border border-white/10 max-h-48 overflow-y-auto shadow-lg">
          {results.map((t) => (
            <li key={t.number}>
              <button
                type="button"
                onClick={() => pick(t)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-cyan/10 border-b border-white/5 last:border-0"
              >
                <span className="font-mono font-bold text-cyan">{t.number}</span>
                <span className="text-muted ml-2">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
