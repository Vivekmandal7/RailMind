# RailMind Codebase Audit

**Date:** 2026-06-08  
**Scope:** Full read-only audit of backend (Python/FastAPI) + frontend (Next.js / Mapbox / deck.gl). No code was changed in this pass.

---

## PART 1 — What It Is

### Purpose (plain language)

RailMind is an **operator control room** for Indian Railways: a **live digital twin** of the network on a map, backed by an **AI brain** that watches trains move along real track geometry, scans a 45-minute look-ahead for conflicts, proposes OR-Tools resolution plans, verifies them with rule + multi-LLM checks, and logs every decision on an incident timeline. Operators can inject disruptions (breakdown, block, fog), run natural-language what-if commands, apply or auto-apply verified plans, and replay events by scrubbing sim time.

Honest scope (per README): positions are **schedule-modeled with disruption physics**, not live GPS. Default backend config is **India-wide** (`india_wide.yaml`); corridor-fidelity sim still exists for Mumbai CSMT→Igatpuri in older configs.

---

### Architecture map

#### Backend modules (`backend/railmind/`)

| Module | File(s) | Role |
|--------|---------|------|
| **Config / wiring** | `config.py` → `build_orchestrator()` | Loads YAML, GeoJSON + timetable → `NetworkGraph` → `DigitalTwin`, injects all intelligence modules |
| **Transport** | `app.py` | FastAPI: `sim_loop()` calls `orch.step()` at `tick_hz`, broadcasts `TwinSnapshot` on `/stream`; REST for commands |
| **Digital twin** | `twin.py` — `DigitalTwin.compute_states()` | Arc-length motion along polylines; delays, frozen (breakdown), fog `speed_factor` |
| **Data source** | `datasource.py`, `network.py` | Static corridor graph from GeoJSON + JSON timetable |
| **Orchestrator** | `orchestrator.py` — `Orchestrator.step()`, `_run_pipeline()`, `snapshot()` | Sim clock, disruptions, throttled intelligence pipeline, snapshot assembly |
| **Conflict detector** | `detectors.py` — `RuleBasedConflictDetector.detect()` | Headway, platform, congestion in 45-min window |
| **Delay forecaster** | `forecaster.py` — `GBMDelayForecaster.forecast()` | ML (`delay_forecaster.joblib`) or heuristic fallback |
| **Cascade / hybrid predictor** | `predictor.py`, `predictor_hybrid.py` — `HybridPredictor.predict()` | Downstream delay ripple + ML merge |
| **OR-Tools optimizer** | `optimizer_ortools.py` — `CpSatOptimizer.propose()` | CP-SAT holds; falls back to `optimizer.py` greedy |
| **Multi-LLM verifier** | `verifier_llm.py` — `MultiModelVerifier.verify_full()` | Rule gate + up to 2 LLM judges; rule-only without API keys |
| **NL agent** | `nl.py` (authoritative), `nl_agent.py` (LLM wrapper) | Parse what-if commands; `run_whatif()` in orchestrator |
| **Explainer** | `explainer.py` — `LLMExplainer.explain()` | Plan rationale (LLM or rule fallback) |
| **Passenger impact** | `passenger.py` — `HeuristicPassengerImpact.estimate()` | Runs in pipeline; **not exposed on wire contract** |
| **Anomaly sentinel** | `anomaly.py` — `BaselineAnomalySentinel.scan()` | Systemic delay / crawl / fog → `alerts` in snapshot |
| **Brain telemetry** | `brain.py` — `BrainTracker` | 8 module statuses → `engine_modules` in snapshot |
| **Incident timeline** | `timeline.py` — `TimelineLog` | Rolling deduped audit log (max 80 events) |
| **Wire contract** | `models.py` ⇄ `frontend/lib/contract.ts` | Pydantic DTOs mirrored in TypeScript |

#### WebSocket / REST contract

**REST** (`app.py`):

| Endpoint | Handler | Purpose |
|----------|---------|---------|
| `GET /health` | `health()` | Engine status, LLM providers, model kinds |
| `GET /network` | `network()` | Static `NetworkModel` |
| `GET /snapshot` | `snapshot()` | One `TwinSnapshot` frame |
| `GET /train/{number}` | `train()` | Single train (placeholder if unknown) |
| `POST /whatif` | `whatif()` | NL command → inject + pipeline + explanation |
| `POST /apply` | `apply()` | Apply plan for `conflict_id` |
| `POST /autonomous` | `autonomous()` | Toggle auto-apply |
| `POST /inject/{kind}` | `inject()` | `breakdown` / `block` / `fog` / `clear` |
| `POST /control` | `control()` | `playing`, `time_scale`, `seek_sec` |

**WebSocket** `GET /stream` (`app.py` — `stream()`, `_handle_ws_command()`):

- **Server → client:** JSON `TwinSnapshot` every tick (~5 Hz) when clients connected; immediate snapshot on connect.
- **Client → server:** `{ action: "control" | "apply" | "autonomous" | "inject" | "whatif", ... }`. Invalid JSON silently ignored. **No ack envelope**; `whatif` over WS runs pipeline but **sends no explanation back**.

`TwinSnapshot` fields (`models.py`): `sim_sec`, `tick_hz`, `time_scale`, `autonomous`, `trains`, `conflicts`, `recommendations`, `predictions`, `alerts`, `disruptions`, `engine_modules`, `timeline`.

#### Frontend architecture

| Layer | Path | Role |
|-------|------|------|
| **Page shell** | `app/page.tsx` | `h-screen` column: `MapKpiBar` + `ControlRoomLayout` + `ControlRoomRoster`; `useLiveTwinConnection()` |
| **Layout** | `components/ControlRoomLayout.tsx` | 3-column grid: left panels / `IndiaMap` / right panels |
| **Active map** | `components/IndiaMap.tsx` | Mapbox GL + `@deck.gl/mapbox` `MapboxOverlay` (`interleaved: true`) |
| **Legacy map** | `components/NetworkMap.tsx`, `MapBasemap.tsx` | DeckGL + MapLibre — **not mounted** on main page |
| **Store** | `store/useStore.ts` | Zustand: sim, conflicts, alerts, focus/track, timeline, live/local mode |
| **Live bridge** | `lib/liveClient.ts`, `hooks/useLiveTwinConnection.ts` | WS ingest; health → live vs local fallback |
| **Motion smoothing** | `lib/twinBridge.ts` — `TwinInterpolator` | Lerp 5 Hz snapshots → 60 fps along polylines |
| **Local motion** | `lib/indiaTrains.ts`, `lib/trainMotion.ts` | Schedule-based snapshots for local India map |
| **Deck layers** | `lib/mapLayers.ts` — `buildRailLayers()`, `buildDynamicMapLayers()`, `buildConflictLayers()` | Rails, trains, conflict pulse, plan overlay |
| **Unused loop** | `components/useSimLoop.ts` | Drives `store.tick()` — **not wired** in `page.tsx` |

#### End-to-end data flow

```
YAML config + GeoJSON/timetable
    → GeoJSONDataSource → NetworkGraph → DigitalTwin
    → Orchestrator (sim clock)

app.sim_loop() [5 Hz]
    → Orchestrator.step(real_dt)
        → sim_sec += real_dt × time_scale (if playing)
        → _run_pipeline() [throttled ~60 sim-sec intervals]
            1. twin.compute_states(ctx)
            2. detector.detect() → conflicts
            3. forecaster.forecast() → delay ML
            4. predictor.predict() → cascade + ML
            5. passenger.estimate() → brain stats only
            6. anomaly.scan() → alerts
            7. per conflict: optimizer.propose() → verifier.verify_full() → explainer.explain()
            8. if autonomous: auto-apply first verified critical plan
    → orch.snapshot() → TwinSnapshot JSON

Frontend:
    LiveClient WS → ingestSnapshot() → useStore
    IndiaMap RAF (60 fps):
        live: TwinInterpolator.step() → buildDynamicMapLayers() → MapboxOverlay
        local: computeVisibleSnapshots() + syncLocalSim() → store recompute
    Panels read store; commands → LiveClient.send() or local recompute
```

---

### Feature inventory — current status

| Feature | Status | Notes |
|---------|--------|-------|
| **India-wide map (Mapbox + deck.gl)** | **Working** | `IndiaMap.tsx`; requires `NEXT_PUBLIC_MAPBOX_TOKEN` |
| **Legacy corridor map (NetworkMap)** | **Orphaned** | Fully implemented but not mounted; CSS in `globals.css` targets `.network-map` only |
| **Live twin WebSocket stream** | **Working** | When backend reachable; auto-reconnect in `liveClient.ts` |
| **Local fallback sim** | **Partial** | `initLive()` falls back to `loadIndiaNetwork()`; **dual clock** (see bugs) |
| **Train motion (arc-length)** | **Working** | Backend `twin.py`; frontend `indiaTrains.ts` / `TwinInterpolator` |
| **Conflict detection** | **Working** | Backend `detectors.py`; frontend `simulationEngine.ts` for local |
| **Conflict map pulse** | **Working** | `mapLayers.ts` `buildConflictLayers()` — red/amber animated paths |
| **AI recommendations panel** | **Working** | `AiPanel.tsx`; plans from backend or `lib/optimizer.ts` locally |
| **Apply plan** | **Partial** | Only `hold_sec` delays applied (`orchestrator._apply()`, `applyPlanInternal`) |
| **Autonomous auto-apply** | **Partial** | Backend works; **local + IndiaMap: `store.tick()` never runs** → AUTO likely inert locally |
| **OR-Tools CP-SAT** | **Partial** | Real solver when `ortools` installed; `delay_saved_min` copied from greedy, not solver objective |
| **Delay ML forecaster** | **Partial** | ML if `delay_forecaster.joblib` present; else heuristic |
| **Multi-LLM verifier** | **Partial** | Rule-only without keys; UI shows VERIFIED badge when votes present |
| **NL what-if (REST)** | **Working** | `POST /whatif` + local `nlCommand.ts` |
| **NL what-if (WebSocket)** | **Broken** | Fire-and-forget; no explanation returned to client |
| **What-if inject buttons** | **Working** | Breakdown / block / fog / clear → store or WS |
| **AI Engine panel (8 modules)** | **Partial** | Live data from `engine_modules`; local shows `LOCAL_MODULES` stubs |
| **Incident Timeline** | **Working** | Backend `timeline.py`; local `timelineLocal.ts`; scroll layout issues |
| **Live Alerts feed** | **Working** | `buildAlerts()`; click side-effects problematic |
| **Demo Mode** | **Working** | `DemoMode.tsx` scripted scenario; uses `focusConflict` heavily |
| **Train search** | **Working** | `TrainSearch.tsx` → `selectTrain()` → fly-to |
| **Click train on map** | **Working** | `IndiaMap` `onClick` → `selectTrainRef` |
| **Train detail panel** | **Working** | `TrainDetailPanel.tsx`; overlaps map controls when open |
| **Sim clock (play/pause/speed/scrub)** | **Partial** | `SimClockBar.tsx`; local scrub from store **does not sync** `IndiaMap` RAF clock |
| **Reset view** | **Working** | `requestMapReset()` → `resetView()` → `fitBounds(INDIA_BOUNDS)` |
| **3D toggle** | **Broken / cosmetic** | Pitch-only at country zoom; no terrain/buildings |
| **Zoom (+/− and scroll)** | **Broken / partial** | See Part 2; `focusConflictId` loop is primary regression |
| **Live ↔ Local switch** | **Partial** | Automatic via `initLive()` health only; **no manual toggle**; badge in `MapKpiBar` |
| **Passenger (PAX) layer toggle** | **Broken** | `WhatIf.tsx` toggles `passengerLayer`; only `NetworkMap.tsx` reads it — **not IndiaMap** |
| **Cascade visualization** | **Broken** | `Roster.tsx` calls `showCascade()`; only `NetworkMap.tsx` renders cascade rings |
| **Passenger impact in API** | **Broken** | Computed in pipeline, not in `TwinSnapshot` |
| **Section block physics** | **Partial** | `blocked` affects detector only; twin does not stop trains on blocked sections |
| **Onboarding overlay** | **Working** | First-visit modal; blocks all input until dismissed |
| **Firebase analytics** | **Unknown** | `FirebaseAnalytics.tsx` exists; optional env config |
| **Backend tests** | **Present** | `backend/tests/` (twin, orchestrator, intelligence, timeline); not executed in this audit (no pytest in env) |

---

## PART 2 — Diagnosis of Reported Bugs

### 1. 3D toggle does nothing

**Files:** `frontend/components/IndiaMap.tsx` (`toggle3D`, `is3D` effect L360–364), `frontend/lib/indiaViewport.ts`

**What the code does:**

```360:364:frontend/components/IndiaMap.tsx
  const toggle3D = useCallback(() => setIs3D((v) => !v), []);

  useEffect(() => {
    mapRef.current?.easeTo({ pitch: is3D ? 45 : 0, duration: 800, essential: true });
  }, [is3D]);
```

Map init hard-codes `pitch: 0`, `zoom: 3`, style `mapbox://styles/mapbox/dark-v11` with **no terrain, no 3D buildings, no bearing change**.

**Root cause:**

1. **“3D” is pitch-only** at **country scale** (zoom ~3–6). On a flat vector basemap, 45° pitch is nearly indistinguishable from top-down — no extruded geometry to reveal oblique view.
2. **No Mapbox terrain/DEM** — `map.setTerrain()` and `mapbox-dem` source never added after `load`.
3. **Possible race** — `easeTo` on `is3D` change does not guard `map.isStyleLoaded()`; early toggle may no-op.
4. **Secondary:** repeated `flyTo` from `focusConflictId` effect (bug #5) can mask pitch changes.

**Proposed fix:**

- On 3D enable (after `map.on('load')`): add `mapbox-dem`, `map.setTerrain({ exaggeration: 1.5 })`, enable 3D buildings layer from style.
- Bump zoom when entering 3D: `zoom: Math.max(map.getZoom(), 10)` and optional `bearing: 25`.
- Guard `easeTo` with style-loaded check.
- Update `MapLegend` to describe 3D mode.

---

### 2. Red blinking light — unclear meaning, persists

**What it is (multiple sources — none labeled “conflict pulse” in UI):**

| Source | File | Appearance | Meaning |
|--------|------|--------------|---------|
| **Conflict pulse (primary)** | `lib/mapLayers.ts` `buildConflictLayers()` L315–359 | **Red/amber pulsing path** along track section | Active conflict geometry; `pulse = sin(frameTick × 0.12)` drives width/alpha |
| **Alert countdown blink** | `AlertsFeed.tsx` L59–61 | **Red/amber text** `animate-pulseRisk` | T-min countdown when `countdownSec < 240` (4 min) |
| **KPI status dot** | `MapKpiBar.tsx` L73–79 | **Cyan** ping (live) or **amber** (reconnecting) | Connection status — not conflicts |
| **Roster status dot** | `Roster.tsx` L48 | Static red dot | Train `held` / `conflict` status — no animation |
| **Demo button** | `DemoMode.tsx` L315 | Cyan `animate-pulse` | Demo running |

Onboarding (`OnboardingOverlay.tsx` L41) says *“conflicts pulse in real time”* but **`MapLegend.tsx` does not document conflict pulses** — only train status dots and ghat line color.

**Why it persists:**

1. **Conflicts remain in store** until resolved/cleared — pulse renders whenever `conflicts.length > 0`.
2. **`focusConflictId` is never auto-cleared** after alert/plan/demo focus (`useStore.ts` `focusConflict` L779–789 sets id; only `DemoMode` and explicit `focusConflict(null)` clear it). Highlight ring in `AlertsFeed` stays on; map `flyTo` effect keeps re-firing (bug #5).
3. Delay-cascade alerts (`id: delay:${train}` from `buildAlerts` L349–362) can accumulate for every train ≥10 min late — countdown blink on many rows.

**Proposed fix:**

- Add legend entries: “Conflict pulse (red)” / “Verified plan overlay (cyan)”.
- Clear `focusConflictId` after `flyTo` `moveend`, or debounce effect to `[focusConflictId]` only.
- Distinguish map pulse vs alert countdown in `AlertsFeed` header tooltip.
- Optionally fade pulse when plan applied / conflict in `resolvedConflictIds`.

---

### 3. Incident Timeline panel — content cut off

**Files:** `IncidentTimeline.tsx`, `ControlRoomLayout.tsx` L39–48, `globals.css` `.scroll-panel`

**Structure (mostly correct):**

```67:72:frontend/components/IncidentTimeline.tsx
    <div className="panel flex flex-col h-full overflow-hidden">
      <div className="... shrink-0">...</div>
      <div ref={listRef} className="flex-1 scroll-panel min-h-0">
```

**Root causes:**

1. **Grid height budget:** Left sidebar splits `5fr : 4fr : 3fr` — timeline gets ~33% of ~900px column minus KPI/roster ≈ **250–300px**. Many events require scroll; users may perceive “cut off” if scroll affordance is weak.
2. **`line-clamp-2` on `ev.detail`** (`EventRow` L48) — intentional truncation; long explanations never fully visible without clicking.
3. **`AlertsFeed` sibling missing `min-h-0`** (see #8) can steal flex space in edge cases.
4. **Auto-scroll to top** on new events (`useEffect` L60–64) — jumping scroll position feels like broken layout.

**Proposed fix:**

- Rebalance grid e.g. `4fr 5fr 3fr` if timeline is primary.
- Replace `line-clamp-2` with expandable rows or tooltip on hover.
- Ensure all three left panels use `shrink-0` headers + `flex-1 min-h-0 overflow-y-auto` on body.
- Soften auto-scroll (only if user already at top).

---

### 4. AI Engine panel — modules cut off

**Files:** `AiEnginePanel.tsx` L61–106, `ControlRoomLayout.tsx` L39 (row `3fr`)

**Root causes:**

1. **Smallest grid row (`3fr` of 12)** — ~180–220px after header + chip row; 8 `ModuleRow`s cannot fit without scroll.
2. **Header row (L63) missing `shrink-0`** — can compress under vertical pressure before list scrolls.
3. **Aggressive `truncate`** on `m.name`, `m.lastAction`, `m.detail` (L31–38) — clips content even when scroll space exists.
4. **Chip summary row** `max-h-[68px] scroll-panel` (L76) consumes fixed space above module list.

**Proposed fix:**

- Add `shrink-0` to both header blocks.
- Increase AI Engine row fraction or collapse chip row behind toggle.
- Use `line-clamp-2` + title attribute instead of single-line `truncate`.
- Mirror `AiPanel.tsx` pattern: `flex-1 scroll-panel min-h-0` (already on list; fix header + grid weights).

---

### 5. Live Alert click — full-screen takeover instead of map focus

**Files:** `AlertsFeed.tsx` L44–48, `useStore.ts` `focusConflict` L779–789, `IndiaMap.tsx` L371–379, L381–395, `TrainDetailPanel.tsx`

**There is no Next.js route navigation.** The “takeover” is a **bundle of global side effects**:

```779:789:frontend/store/useStore.ts
  focusConflict: (id) => {
    ...
    set({ focusConflictId: id });
    get().scrub(Math.max(s.windowStart, c.atSec - 90));  // pauses sim + jumps clock
    if (c.trains[0]) get().setTrack(c.trains[0]);        // opens TrainDetailPanel + flyTo train
  },
```

```381:395:frontend/components/IndiaMap.tsx
  useEffect(() => {
    if (!focusConflictId) return;
    const c = mapConflicts.find((x) => x.id === focusConflictId);
    ...
    mapRef.current?.flyTo({ center: mid, zoom: ..., pitch: ... });
  }, [focusConflictId, mapConflicts, sectionMap]);
```

**Root causes:**

1. **`scrub()`** pauses sim and jumps `simSec` — `SimClockBar` moves; feels like mode change.
2. **`setTrack()`** sets `selectedTrain` → `TrainDetailPanel` mounts (288px overlay).
3. **`focusConflictId` effect depends on `mapConflicts` array** — recomputed every ~4 RAF frames in local mode via `syncLocalSim` → **`flyTo` fires continuously**, fighting user pan/zoom (also causes bug #7).
4. **Local mode:** `scrub()` updates store `simSec` but **`IndiaMap` keeps its own `simSecRef`** — store and map clocks diverge (`IndiaMap` only syncs `storeSimSec` when `isLive`).
5. **`AiPanel` “Simulate” button** calls same `focusConflict` — same behavior.

**Proposed fix:**

- Split `focusConflictOnMap(id)` (set `focusConflictId`, single `flyTo`, optional highlight) from `investigateConflict(id)` (scrub + track).
- Change effect deps to `[focusConflictId]`; read latest conflict via `useStore.getState()`.
- Clear `focusConflictId` on `moveend` or second click.
- Alert click: map focus only; defer `TrainDetailPanel` to explicit train click.
- Wire `scrub` ↔ `IndiaMap` `simSecRef` in local mode (or single clock owner).

---

### 6. Live Train Roster — manual scrolling awkward

**Files:** `Roster.tsx` L31–32, `ControlRoomLayout.tsx` `ControlRoomRoster` L67–72, `globals.css` `.scroll-x-panel`

**Root causes:**

1. **Horizontal-only scroll** — `scroll-x-panel` enables `overflow-x: auto`; vertical wheel does not scroll roster (needs Shift+wheel).
2. **Fixed `h-[118px]`** — tight for cards + scrollbar; `overflow-hidden` on shell may clip scrollbar.
3. **`min-w-[168px]` cards × many trains** — wide strip; no scroll hint/arrows.
4. **`showCascade()` on delayed train click** (`Roster.tsx` L38) — sets cascade state but **IndiaMap does not render cascade** (only legacy `NetworkMap.tsx`).

**Proposed fix:**

- Map vertical wheel to horizontal: `onWheel` → `scrollLeft += deltaY`.
- Increase roster height to ~140px or make collapsible.
- Add fade edge / scroll buttons when `scrollWidth > clientWidth`.
- Remove or wire `showCascade` into `mapLayers.ts` for IndiaMap.

---

### 7. Zoom in/out (+/− buttons and scroll-zoom) not working

**Files:** `IndiaMap.tsx` (map init L513–525, `NavigationControl` L525), `TrainDetailPanel.tsx` L18, `globals.css` L135–151

**Root causes (ranked):**

| Priority | Cause | Evidence |
|----------|-------|----------|
| **A** | **`focusConflictId` → `flyTo` loop** | Effect deps include `mapConflicts` (new array every recompute) — user zoom/pan immediately overridden while focus active |
| **B** | **`TrainDetailPanel` overlap** | `absolute top-4 right-16 z-10 w-72` covers top-right; Mapbox `NavigationControl` at `"top-right"` — clicks/wheel over panel miss map |
| **C** | **Missing Mapbox token** | `IndiaMap` L607–615 renders placeholder — no map, no zoom |
| **D** | **`@deck.gl` version skew** | `package.json`: `@deck.gl/core` ^9.0.27 vs `@deck.gl/mapbox` ^9.3.3 |
| **E** | **Legacy CSS mismatch** | `.network-map` pointer-event rules in `globals.css`; active map uses `.india-map` — less relevant with `interleaved: true` but indicates incomplete migration |
| **F** | **Country zoom** | At zoom 3, scroll-zoom deltas are tiny — can feel “broken” even when working |

Map init does **not** disable `scrollZoom` (Mapbox default `true`). No explicit `dragPan: false`.

**Proposed fix:**

- Fix `focusConflictId` effect (bug #5) — restores zoom immediately after alert interaction.
- Move `NavigationControl` to `bottom-right` (above `SimClockBar`) or custom +/- with `z-30`.
- Reposition `TrainDetailPanel` to bottom-left or reduce width.
- Align all `@deck.gl/*` to same minor version.
- Explicitly set `scrollZoom: true, dragPan: true, touchZoomRotate: true` on `Map` constructor.

---

### 8. Full UX + layout audit (additional issues)

| Area | Issue | File(s) | Severity |
|------|-------|---------|----------|
| **AlertsFeed scroll** | Body `flex-1 scroll-panel` **missing `min-h-0`**; header missing `shrink-0` | `AlertsFeed.tsx` L30–35 | Layout — content clipped without scroll |
| **Sidebars vs viewport** | `w-[min(280px,24vw)]` + `w-[min(320px,26vw)]` ≈ 600px — map narrow on <1280px | `ControlRoomLayout.tsx` | UX |
| **No collapsible panels** | Cannot reclaim map space | `ControlRoomLayout.tsx` | UX |
| **Dual local sim clocks** | `IndiaMap` RAF owns `simSecRef`; store owns `simSec`; `useSimLoop` unwired | `IndiaMap.tsx`, `useStore.ts`, `page.tsx` | **Broken** — scrub/focus desync |
| **Local AUTO mode** | `store.tick()` handles autonomous; never called without `useSimLoop` | `useSimLoop.ts`, `useStore.ts` `tick` | **Broken** locally |
| **PAX layer toggle** | UI toggles; IndiaMap ignores `passengerLayer` | `WhatIf.tsx`, `NetworkMap.tsx` | **Broken** on active map |
| **Cascade from roster** | State set; no IndiaMap visualization | `Roster.tsx`, `NetworkMap.tsx` | **Broken** |
| **Live/local manual switch** | Only automatic; no user control | `useStore.ts` `initLive` | Partial |
| **AiPanel PlanCard stats** | 4-column stats in 320px sidebar — cramped | `AiPanel.tsx` L80–85 | Layout |
| **WhatIf NL log** | `max-h-28` nested scroll inside panel scroll | `WhatIf.tsx` L163 | Minor |
| **MapLegend** | `pointer-events-none`; missing conflict pulse / connection dot legend | `MapLegend.tsx` | UX |
| **Tracker component** | `Tracker.tsx` exists; not in layout | `app/page.tsx` | Orphaned |
| **KpiBar vs MapKpiBar** | `KpiBar.tsx` legacy; page uses `MapKpiBar` | — | Dead code |
| **README vs code** | README cites MapLibre; India map uses Mapbox | `README.md` | Docs drift |
| **Onboarding** | `z-[100]` blocks entire UI until dismissed | `OnboardingOverlay.tsx` | By design |
| **Demo caption** | `bottom-[4.5rem]` may overlap legend on short viewports | `DemoMode.tsx` `DemoCaption` | Minor |
| **Inter-panel z-index** | Sidebars `z-10` over map; correct for clicks but reduces map width | `ControlRoomLayout.tsx` | By design |
| **Backend block physics** | Trains traverse blocked sections | `twin.py`, `detectors.py` | Sim accuracy |
| **Plan apply** | Reorder/speed/reroute actions cosmetic | `orchestrator._apply` | Partial feature |
| **WS what-if** | No client response | `app.py` `_handle_ws_command` | Broken path |

**Interactive element checklist:**

| Control | Works? | Caveat |
|---------|--------|--------|
| Train search | Yes | `TrainSearch.tsx` |
| Click train on map | Yes | Opens detail panel + flyTo |
| What-if inject buttons | Yes | Live → WS; local → recompute |
| NL what-if | Yes (REST/local); partial live | Live explanation via REST poll in `runNL` |
| Demo Mode | Yes | Heavy `focusConflict` side effects |
| Sim clock play/pause | Partial | Local: IndiaMap `playingRef` not synced from store `scrub` |
| Sim clock speed | Yes | |
| Sim clock scrub | Partial | Local: doesn't update IndiaMap `simSecRef` |
| Reset view | Yes | `requestMapReset` |
| Live/local | Auto only | Badge in `MapKpiBar`; no toggle |
| 3D toggle | No visible effect | Bug #1 |
| Zoom +/- / scroll | Broken when focus active | Bug #7 |
| Apply plan | Yes | Hold delays only |
| AUTO toggle | Partial | Local likely inert |
| Timeline event click | Partial | Same scrub+track side effects as alerts |
| Passenger layer | No on IndiaMap | Bug above |

---

## PART 3 — Prioritized Fix Plan

### (A) Broken / blocking

| # | Issue | File(s) | Root cause | One-line fix |
|---|-------|---------|------------|--------------|
| A1 | Zoom/pan overridden after alert click | `IndiaMap.tsx` L381–395 | `useEffect` deps include `mapConflicts` | Depend only on `focusConflictId`; read conflicts from `getState()`; clear focus after `moveend` |
| A2 | Alert click “takeover” | `useStore.ts` `focusConflict`, `AlertsFeed.tsx` | `scrub` + `setTrack` bundled with map focus | Add `focusConflictOnMap` without scrub/track; use for alert clicks |
| A3 | Dual local sim clocks | `IndiaMap.tsx`, `useStore.ts`, `page.tsx` | RAF `simSecRef` vs store `simSec`; `useSimLoop` unwired | Single clock owner: wire `useSimLoop` OR sync `scrub`/playing both directions |
| A4 | Local AUTO inert | `page.tsx`, `useSimLoop.ts` | `store.tick()` never called | Mount `useSimLoop` or call `tick` from IndiaMap RAF |
| A5 | 3D toggle invisible | `IndiaMap.tsx`, `indiaViewport.ts` | Pitch-only at zoom 3, no terrain | Add terrain + buildings + zoom-in on 3D enable |
| A6 | PAX layer dead on active map | `IndiaMap.tsx`, `mapLayers.ts` | `passengerLayer` only in `NetworkMap` | Port passenger shading into `buildRailLayers` or remove toggle |
| A7 | Cascade dead on active map | `Roster.tsx`, `mapLayers.ts` | Cascade layers only in `NetworkMap` | Render cascade in `buildDynamicMapLayers` or remove `showCascade` call |
| A8 | Missing Mapbox token | `IndiaMap.tsx` L607 | No `.env.local` | Document / validate token at dev start |

### (B) UX / layout

| # | Issue | File(s) | Root cause | One-line fix |
|---|-------|---------|------------|--------------|
| B1 | AlertsFeed clipped | `AlertsFeed.tsx` L35 | `flex-1 scroll-panel` without `min-h-0` | Add `min-h-0` to scroll body, `shrink-0` to header |
| B2 | AI Engine clipped | `AiEnginePanel.tsx` L63 | Small `3fr` row + header not `shrink-0` | `shrink-0` headers; rebalance grid to `4fr/4fr/4fr` or `4/5/3` |
| B3 | Timeline cramped | `ControlRoomLayout.tsx`, `IncidentTimeline.tsx` | `4fr` row + `line-clamp-2` | Increase timeline `fr`; expandable event details |
| B4 | Roster scroll awkward | `Roster.tsx`, `ControlRoomRoster` | Horizontal-only, 118px height | Wheel→horizontal scroll; taller strip |
| B5 | TrainDetailPanel blocks zoom UI | `TrainDetailPanel.tsx` L18 | Overlaps top-right controls | Move panel or nav control |
| B6 | Red pulse unexplained | `MapLegend.tsx`, `mapLayers.ts` | No legend entry for conflict pulse | Add “Conflict pulse” + severity colors to legend |
| B6b | `focusConflictId` stuck highlight | `useStore.ts`, `AlertsFeed.tsx` | Never cleared | Clear on second click / after flyTo / Esc |
| B7 | Sidebars eat map on laptop | `ControlRoomLayout.tsx` | Fixed 280+320px | Collapsible drawers below `xl` breakpoint |
| B8 | No live/local toggle | `MapKpiBar.tsx`, `useStore.ts` | Auto fallback only | Add manual “Reconnect” / “Use local” control |
| B9 | AiPanel stats cramped | `AiPanel.tsx` L80 | 4 cols in 320px | 2×2 grid on narrow sidebars |

### (C) Polish

| # | Issue | File(s) | Root cause | One-line fix |
|---|-------|---------|------------|--------------|
| C1 | `@deck.gl` version skew | `frontend/package.json` | core 9.0.27 vs mapbox 9.3.3 | Align package versions |
| C2 | Legacy NetworkMap/CSS | `globals.css`, `NetworkMap.tsx` | India migration incomplete | Delete or gate legacy; unify pointer-events CSS |
| C3 | README MapLibre vs Mapbox | `README.md` | Docs drift | Update tech stack section |
| C4 | WS what-if no response | `backend/railmind/app.py` | Fire-and-forget handler | Return explanation event or document REST-only |
| C5 | Passenger impact not in snapshot | `orchestrator.py`, `models.py` | Not wired to DTO | Add field to `TwinSnapshot` or drop brain module UI claim |
| C6 | Block sections don’t stop trains | `twin.py` | `blocked` only in detector | Check `ctx.blocked` in `compute_train_state` |
| C7 | Plan apply hold-only | `orchestrator._apply` | Reorder/speed not implemented | Implement or label actions “advisory only” |
| C8 | Demo caption overlap | `DemoMode.tsx` `DemoCaption` | Fixed bottom offset | Responsive `bottom` based on `SimClockBar` height |
| C9 | Orphan components | `Tracker.tsx`, `KpiBar.tsx` | Not mounted | Remove or integrate |

---

### Regression flags (India-wide switch + Phase 7 polish)

| Change | Symptoms likely introduced | Evidence |
|--------|---------------------------|----------|
| **India-wide default** (`india_wide.yaml`, `loadIndiaNetwork`, `IndiaMap`) | 3D useless at country zoom; conflict pulses easy to miss; dual data paths (`indiaRailNetwork` vs store `net.sectionMap`) | `config.py` / `app.py` default path; `IndiaMap` `sectionMap` branch L168 |
| **Phase 7 layout** (`ControlRoomLayout` grid, `scroll-panel`, roster strip) | Panel clipping; horizontal-only roster; lost `useSimLoop` wiring | `page.tsx` uses `ControlRoomLayout` not old layout; `useSimLoop` not imported |
| **Map stack swap** (NetworkMap → IndiaMap Mapbox) | Zoom CSS mismatch; PAX/cascade features left on NetworkMap; README still says MapLibre | `globals.css` `.network-map` vs `.india-map`; `NetworkMap` orphan |
| **`focusConflict` enhancement** (scrub + track for timeline/alerts) | Alert “takeover”; zoom fight; stuck highlight | `focusConflict` + `jumpToTimelineEvent` share scrub+track pattern |

---

## Shared root cause (single most likely)

**The `focusConflict` / `focusConflictId` pipeline is the highest-leverage defect.** It was extended (India-wide / Phase 7) to couple **map camera**, **sim scrub**, and **train tracking** in `useStore.focusConflict`, while `IndiaMap` registers a `useEffect` on `[focusConflictId, mapConflicts, sectionMap]` that **re-issues `flyTo` on every conflict recompute**. That one design choice explains **bug #5 (alert takeover feel)**, **bug #7 (zoom/scroll appears broken)**, and **bug #2 (persistent red pulse + highlight)** — not because the pulse is wrong, but because focus never clears and the camera keeps fighting the operator. Secondary shared factor: **flex panel layout** (`min-h-0` omitted in `AlertsFeed`, tight `3fr` AI row) explains **bugs #3, #4, and parts of #8** as a separate CSS/grid cluster.

**Recommended first PR:** decouple map focus from scrub/track, fix the `focusConflictId` effect dependency array, and add `min-h-0`/`shrink-0` to all panel scroll regions — before investing in terrain/3D or backend sim gaps.

---

*End of audit. No source files were modified.*
