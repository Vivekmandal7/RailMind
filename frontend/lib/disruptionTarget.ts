import type { NetworkData, TrainState } from "./types";

export function canonicalSectionId(id: string): string {
  const [a, b] = id.split("-");
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Trains currently occupying a section (either direction). */
export function trainsOnSection(states: TrainState[], sectionId: string): TrainState[] {
  const key = canonicalSectionId(sectionId);
  return states.filter(
    (t) => t.active && t.currentSection && canonicalSectionId(t.currentSection) === key
  );
}

/** Sections ranked by passenger load of trains currently on them. */
export function occupiedSections(
  states: TrainState[]
): { sectionId: string; passengers: number; trainCount: number }[] {
  const load = new Map<string, { passengers: number; trainCount: number }>();
  for (const t of states) {
    if (!t.active || !t.currentSection) continue;
    const key = canonicalSectionId(t.currentSection);
    const cur = load.get(key) ?? { passengers: 0, trainCount: 0 };
    cur.passengers += t.estPassengers;
    cur.trainCount += 1;
    load.set(key, cur);
  }
  return Array.from(load.entries())
    .map(([sectionId, v]) => ({ sectionId, ...v }))
    .sort((a, b) => b.passengers - a.passengers);
}

export interface BlockPickResult {
  sectionId: string;
  /** Human-readable note when we fall back or the section was empty. */
  notice?: string;
}

/**
 * Pick a block target guaranteed to affect live traffic on the loaded network.
 * Prefers ghat / single-line sections with trains on them, then busiest occupancy.
 */
export function pickBlockSection(
  net: NetworkData,
  states: TrainState[],
  requested?: string
): BlockPickResult | null {
  if (net.sections.length === 0) return null;

  const resolve = (sectionId: string): BlockPickResult => {
    const on = trainsOnSection(states, sectionId);
    if (on.length > 0) return { sectionId };
    return {
      sectionId,
      notice: `No trains on ${labelSection(net, sectionId)} — rerouted to busiest section`
    };
  };

  if (requested && net.sectionMap[requested]) {
    const on = trainsOnSection(states, requested);
    if (on.length > 0) return { sectionId: requested };
    // fall through to smart pick but note the miss
    const smart = pickBlockSection(net, states);
    if (!smart) return { sectionId: requested, notice: `No trains on ${labelSection(net, requested)}` };
    return {
      ...smart,
      notice: `No trains on ${labelSection(net, requested)} — blocking ${labelSection(net, smart.sectionId)} instead`
    };
  }

  // Demo corridor: KSRA–IGP ghat (Mumbai config) or ERS–TVC (India-wide)
  for (const id of ["KSRA-IGP", "IGP-KSRA", "ERS-TVC", "TVC-ERS"]) {
    if (net.sectionMap[id] && trainsOnSection(states, id).length > 0) {
      return { sectionId: id };
    }
  }

  // Any ghat / single-line with traffic
  for (const sec of net.sections) {
    if ((sec.ghat || sec.line === "single") && trainsOnSection(states, sec.id).length > 0) {
      return { sectionId: sec.id };
    }
  }

  const busy = occupiedSections(states);
  if (busy.length > 0) {
    return { sectionId: busy[0].sectionId };
  }

  // Last resort — ghat or first section (may not conflict until trains arrive)
  const ghat = net.sections.find((s) => s.ghat) ?? net.sections.find((s) => s.line === "single");
  const fallback = ghat?.id ?? net.sections[0].id;
  return {
    sectionId: fallback,
    notice: `No trains on network sections — blocking ${labelSection(net, fallback)} (may take a moment)`
  };
}

export function labelSection(net: NetworkData, sectionId: string): string {
  const sec = net.sectionMap[sectionId];
  return sec ? `${sec.from}–${sec.to}` : sectionId;
}
