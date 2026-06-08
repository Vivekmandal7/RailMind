# RailMind — Operator Control Room

A live **digital twin** of a railway corridor: a mission-control web app where an
operator watches every train move in real time along its **real route**, while an
AI predicts conflicts/delays and proposes (or auto-applies) re-optimizations to
prevent them. Think air-traffic control, for trains.

Seeded with one **real corridor** — Mumbai CSMT → Igatpuri (Central Railway,
including the constrained single-line Kasara–Igatpuri ghat) — so it runs fully
offline out of the box.

![stack](https://img.shields.io/badge/Next.js-App_Router-black) ![ts](https://img.shields.io/badge/TypeScript-strict-blue) ![map](https://img.shields.io/badge/deck.gl-9-green)

## Run it

```bash
npm install
npm run dev
# open http://localhost:3000
```

No API keys required. An optional `OPENAI_API_KEY` enhances the natural-language
what-if explanations; without it, a deterministic local rule engine is used.

## What you're looking at

- **Top KPI bar** — sim clock (60× accelerated), on-time %, trains live, active
  risks, safety score — all updating live.
- **Left — Live alerts** — collision risk, delay cascade, platform clash, with
  severity and countdowns. Click to track the train.
- **Center — Live map** (the star) — real stations + track geometry on a dark
  canvas. Trains are glowing markers moving live with number labels, coloured by
  status (green = on time, amber = delayed, red = held/conflict). Conflicts pulse
  red; the cascade/reroute path glows cyan.
- **Right — AI recommendations** — per active risk: the proposed plan, impact
  stats (delay saved, conflicts resolved, connections + passengers protected), a
  **VERIFIED** badge, **Apply** and **Simulate** buttons, and an **AUTO**
  (autonomous) toggle that auto-applies critical plans.
- **Right — What-if injector** — Breakdown / Block / Fog buttons + a
  **natural-language** command box.
- **Bottom — Live roster** — every service with status, delay, speed, next stop.
- **Time scrubber** — scrub forward to forecast the network ahead, or replay the
  window; pick playback speed (1×–300×).

## The four signature features

1. **Universal Tracker** (top-left of map) — type any train number/name, or pick
   any origin → destination; the map focuses and tracks it live with predicted
   ETA, current delay, and next stop. *Track anything on the network.*
2. **Passenger-impact layer** — every disruption surfaces the human cost
   (passengers affected, connections at risk); the AI plan shows *X passengers
   protected*. Toggle **PAX LAYER** to shade the network by passenger load.
3. **Cascade / ripple view** — click a delayed train (map or roster) to highlight
   and animate every downstream section/train its delay will hit.
4. **Natural-language what-if** — e.g. `delay 12137 by 30 min`,
   `what if KYN–KSRA closes?`, `breakdown 11061`, `fog`. The engine simulates it
   live and the AI explains the impact + recommended response in plain language.

## Architecture

```
data/                      Real corridor (seed)
  stations.geojson         21 Central-Railway stations w/ real coordinates
  sections.geojson         track sections w/ line type (single/double) + capacity
  timetable.json           public-timetable subset (8 services, both directions)
lib/
  types.ts                 typed domain model
  dataLoader.ts            parses GeoJSON + timetable -> network (route geometry,
                           cumulative distances per train)
  geo.ts                   haversine, polyline interpolation, bearings, clock fmt
  simulationEngine.ts      THE HEART — time-stepped engine:
                             • interpolates each train's position along its real
                               route geometry from schedule + current delay
                             • conflict detection over a 45-min look-ahead
                               (single-line headway, platform double-book,
                               congestion)
                             • fog/breakdown/block/delay handling
  optimizer.ts             greedy re-optimization (hold / reorder / reroute) with
                           impact accounting + a verify step
  nlCommand.ts             natural-language parser + deterministic explainer
store/useStore.ts          Zustand store; recomputes states/conflicts/plans/alerts
                           each tick; delay propagation; autonomous mode
components/                deck.gl map + all mission-control panels
app/api/nl/route.ts        optional LLM enhancement (graceful no-key fallback)
```

### Simulation engine (the heart, and it's real)

Each animation frame the store advances accelerated sim time and asks the engine
to recompute the whole network:

- A train's **schedule** (sparse stops) is mapped onto **cumulative distance**
  along its real route polyline (built from the section GeoJSON geometry). Given
  the current sim time minus its delay, the engine finds the distance travelled,
  then interpolates the exact `[lng,lat]` position and bearing along the geometry
  — never a hardcoded animation.
- **Conflict detection** steps forward over a 45-minute horizon, computing section
  and platform occupancy at each step and flagging capacity breaches (the
  single-line Kasara–Igatpuri ghat is where opposing expresses converge).
- **Delay propagation** is emergent: holding a train shifts its schedule, which
  the next recompute reflects across dependent services and connections.
- **Re-optimization** (`optimizer.ts`) returns a plan + quantified impact and a
  `verified` flag behind a stable interface.

## Swapping to a live backend / real solver / real LLM

The simulation is deliberately isolated behind small interfaces:

- **Live data feed:** replace the `tick()` driver in `store/useStore.ts` with a
  WebSocket subscription that pushes authoritative `TrainState[]`. The engine's
  pure functions (`computeAllStates`, `detectConflicts`) and all UI stay the same.
- **Real optimizer:** `proposeResolution(net, conflict, states)` in
  `lib/optimizer.ts` is the only entry point the UI uses — swap the greedy
  heuristic for OR-Tools CP-SAT and keep the `ResolutionPlan` contract.
- **Real LLM verify/explain:** `app/api/nl/route.ts` already calls OpenAI when
  `OPENAI_API_KEY` is set, and the `verified`/`verifyNote` fields on a plan are
  the hook for an LLM cross-check.

## Data sources

- Station locations & line/section topology: Indian Railways open geodata
  (datameet/railways style). Coordinates are approximated to real positions for
  the CSMT–Igatpuri corridor.
- Timetable: a representative subset in the spirit of data.gov.in Indian Railways
  timetable datasets (Punjab Mail, Panchavati Exp, Nagpur Duronto, Pushpak Exp,
  Pawan Exp, plus Kasara/Titwala suburban locals).

These are bundled under `data/` so the app is fully offline and reproducible.

## Tech

Next.js (App Router) · React 18 · TypeScript (strict) · TailwindCSS · Zustand ·
deck.gl 9 (`PathLayer` tracks, `ScatterplotLayer`/`TextLayer` trains).
