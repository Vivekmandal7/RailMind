import type { NetworkData } from "./types";

export type NLIntent =
  | { type: "delay"; train: string; addMin: number }
  | { type: "breakdown"; train: string }
  | { type: "block"; section: string; label: string }
  | { type: "fog" }
  | { type: "clear" }
  | { type: "unknown"; raw: string };

/**
 * Local rule-based parser for the natural-language what-if box.
 * If a server LLM key is configured, the UI calls /api/nl which can return a
 * richer parse; this local parser is the graceful-degradation fallback and is
 * always used to produce the deterministic explanation.
 */
export function parseCommand(raw: string, net: NetworkData): NLIntent {
  const q = raw.trim().toLowerCase();
  if (!q) return { type: "unknown", raw };

  if (/(clear|reset|remove).*(disrupt|all|everything)|^clear$|^reset$/.test(q))
    return { type: "clear" };

  if (/\bfog\b|low visibility|mist/.test(q)) return { type: "fog" };

  // delay <train> by <n> min
  const delayM = q.match(/delay\s+(\d{4,6}).*?(\d{1,3})\s*(min|m|minutes)?/);
  if (delayM) {
    return { type: "delay", train: delayM[1], addMin: parseInt(delayM[2], 10) };
  }

  // breakdown / breaks down <train>
  const brk = q.match(/(breakdown|breaks?\s*down|fail(?:s|ure)?|stall(?:s|ed)?)\D*(\d{4,6})/);
  if (brk) return { type: "breakdown", train: brk[2] };
  const brk2 = q.match(/(\d{4,6})\D*(breakdown|breaks?\s*down|fail|stall)/);
  if (brk2) return { type: "breakdown", train: brk2[1] };

  // block / closes section between two station codes
  const codes = (q.toUpperCase().match(/\b[A-Z]{2,4}\b/g) ?? []).filter(
    (c) => net.stationMap[c]
  );
  if (/(close|closed|block|blocked|shut|suspend)/.test(q) && codes.length >= 2) {
    const a = codes[0];
    const b = codes[1];
    const sec = findSection(net, a, b);
    if (sec)
      return {
        type: "block",
        section: sec.id,
        label: `${net.stationMap[sec.from].name} \u2192 ${net.stationMap[sec.to].name}`
      };
  }

  // also accept "12137 late 20" style
  const late = q.match(/(\d{4,6}).*?(late|delayed).*?(\d{1,3})/);
  if (late) return { type: "delay", train: late[1], addMin: parseInt(late[3], 10) };

  return { type: "unknown", raw };
}

function findSection(net: NetworkData, a: string, b: string) {
  return (
    net.sectionMap[`${a}-${b}`] ||
    net.sections.find(
      (s) => (s.from === a && s.to === b) || (s.from === b && s.to === a)
    ) ||
    null
  );
}

export function intentEcho(i: NLIntent, net: NetworkData): string {
  switch (i.type) {
    case "delay":
      return `Injecting +${i.addMin} min delay on ${i.train}.`;
    case "breakdown":
      return `Simulating breakdown of ${i.train} — train stalls on its current section.`;
    case "block":
      return `Closing section ${i.label}. Re-routing/holding affected services.`;
    case "fog":
      return `Applying fog: network-wide speed restriction in force.`;
    case "clear":
      return `Cleared all injected disruptions.`;
    default:
      return `Could not parse "${i.raw}". Try: "delay 12137 by 20 min", "what if KYN–KSRA closes?", "breakdown 11061", or "fog".`;
  }
}
