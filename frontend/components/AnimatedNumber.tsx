"use client";
import { useEffect, useRef, useState } from "react";

export default function AnimatedNumber({
  value,
  className = ""
}: {
  value: number | string;
  className?: string;
}) {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);

  useEffect(() => {
    const from = typeof prev.current === "number" ? prev.current : parseFloat(String(prev.current)) || 0;
    const to = typeof value === "number" ? value : parseFloat(String(value)) || 0;
    if (from === to || Number.isNaN(to)) {
      setDisplay(value);
      prev.current = value;
      return;
    }
    const start = performance.now();
    const dur = 420;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (t < 1) raf = requestAnimationFrame(step);
      else prev.current = value;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <span className={className}>{display}</span>;
}
