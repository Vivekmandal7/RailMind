# RailMind — Operator Control Room + Digital-Twin Engine

A live **digital twin** of a railway corridor: an air-traffic-control-style web
app where every train moves in real time along its **real route**, while a
modular AI engine predicts conflicts and proposes (or auto-applies) resolutions.

Seeded with one real corridor — **Mumbai CSMT → Igatpuri** (Central Railway,
including the single-line Kasara–Igatpuri ghat) — so it runs offline out of the box.

```
RailMind/
├── backend/     Python 3.11+ · FastAPI · the digital-twin engine (modular, typed, tested)
├── frontend/    Next.js · React · TypeScript · Tailwind · deck.gl control room
├── docs/        EXTENDING.md — how every future module plugs in
├── dev.sh       one command: engine + UI, connected
└── docker-compose.yml
```

## Run it (one command)

**Option A — dev script** (auto-creates the venv + installs deps):

```bash
./dev.sh
# Engine  : http://127.0.0.1:8000
# Control : http://localhost:3000
```

**Option B — Docker:**

```bash
docker compose up --build
# open http://localhost:3000
```

**Option C — manual (two terminals):**

```bash
# 1) engine
cd backend && python3.11 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
uvicorn railmind.app:app --reload --port 8000

# 2) control room
cd frontend && npm install && npm run dev
```

> The frontend **auto-detects** the engine. If the backend isn't running it
> falls back to an equivalent in-browser simulation, so `npm run dev` alone in
> `frontend/` still works. The KPI bar shows **LIVE · WS** vs **LOCAL**.

No API keys required. An optional `OPENAI_API_KEY` (set on the backend) enriches
the natural-language what-if explanations; without it a deterministic local
explainer is used.

## Architecture

```
DataSource ─► NetworkGraph ─► DigitalTwin ─► Orchestrator ─► FastAPI WS/REST ─► Next.js
 (GeoJSON)    (NetworkX +      (arc-length    (tick→detect→predict     (typed Pydantic
              arc-length)      kinematics)     →optimize→verify→         contract ⇄
                                               apply→broadcast)          contract.ts)
```

The engine is built from **swappable modules behind interfaces** (ABCs) with
dependency injection and config-driven feature flags. Each is independently
unit-tested. See **[docs/EXTENDING.md](docs/EXTENDING.md)** for exact interface
signatures and how to: add a live DataSource, swap in OR-Tools CP-SAT, plug a
trained ML Predictor, or add an LLM-consensus Verifier.

- **DataSource** — `GeoJSONDataSource` (datameet/railways-style GeoJSON +
  data.gov.in-style timetable). Future: live API.
- **NetworkGraph** — stations=nodes, sections=edges on NetworkX; route polylines
  with **precomputed arc-length** + alternate-path routing.
- **DigitalTwin** — accelerated sim clock; computes each train's state per tick.
- **ConflictDetector / Predictor / Optimizer / Verifier** — rule-based / cascade /
  greedy / rule-based baselines, all replaceable.
- **Orchestrator** — wires the loop and owns disruption + plan state.
- **Transport** — FastAPI WebSocket streams `TwinSnapshot` at a steady tick;
  REST for queries, what-if, apply, control.

## Why the motion looks real

- **Arc-length parameterization:** position is addressed by *distance travelled*
  along the real polyline, so visual speed is correct regardless of vertex
  spacing — trains follow the actual track curve.
- **Kinematics:** between scheduled stops, distance follows a *smootherstep*
  easing of time → zero velocity at each stop, peak mid-segment. Trains
  **accelerate out of stations and brake into them**; pass-through stations are
  crossed at speed. No instant velocity changes.
- **Decoupled render:** the backend streams authoritative `dist_km + speed` at
  ~5 Hz; the **frontend interpolates every animation frame** (~60 fps),
  dead-reckoning between ticks and easing toward each new snapshot. Motion stays
  buttery even at a low tick rate. (Sim rate ≠ render rate.)
- **Rendering:** trains are elongated markers **oriented to the track heading**
  (deck.gl `IconLayer`, angle from the path tangent), with a motion glow, a comet
  trail, and smooth colour transitions on status change.

## Features

Live map · KPI bar · alerts feed · AI recommendations (with **VERIFIED** badge,
Apply/Simulate, **Autonomous** auto-apply) · what-if injectors (breakdown / block /
fog) · **natural-language what-if** · universal tracker · passenger-impact layer ·
cascade/ripple view · time scrubber · live roster.

## Tests

```bash
cd backend && . .venv/bin/activate && pytest      # 24 engine + smoke tests
```

Covers geo/arc-length, network loading, twin kinematics (continuity, accel/brake,
arrival), conflict detection (single-line head-on), optimizer + verifier,
predictor cascade, and a full orchestrator smoke run with WS-payload round-trip.

## Data sources

- Station locations & section topology: Indian Railways open geodata
  (datameet/railways style); coordinates approximated to real positions for the
  CSMT–Igatpuri corridor.
- Timetable: a representative data.gov.in-style subset (Punjab Mail, Panchavati,
  Nagpur Duronto, Pushpak, Pawan + Kasara/Titwala suburban locals).

Everything is bundled under `backend/data/` (and mirrored in `frontend/data/` for
the offline fallback) so the app is fully reproducible.

## Load a different corridor

Drop new `stations.geojson` / `sections.geojson` / `timetable.json` into
`backend/data/`, copy `backend/config/mumbai_csmt_igatpuri.yaml` to a new config,
point its paths + sim params at your data, and launch with
`RAILMIND_CONFIG=backend/config/your_corridor.yaml`.
