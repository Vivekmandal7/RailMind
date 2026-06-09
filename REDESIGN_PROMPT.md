# RailMind → "RailMind Live" — Master Redesign Prompt

> Paste this whole file into your coding agent (Claude Code / Cursor) as the build brief.
> It converts RailMind from a schedule-modeled simulation into a **live-data-fed digital twin**:
> real track geometry, real stations, real schedules, real live running status, smooth
> interpolation between pings, and an honest provenance label on every moving train.

---

## 0. ROLE & MISSION

You are a senior full-stack + data engineer. The existing repo `RailMind` is a Next.js 14 control
room + FastAPI digital-twin engine with a working AI brain (OR-Tools CP-SAT optimizer, trained delay
forecaster, multi-LLM verifier, NL agent, incident timeline, deck.gl/MapLibre map). **Do not throw the
brain away.** Your job is to **replace the data spine** so the twin is driven by REAL data and **feels
like a live national operations platform** when you zoom in.

The single design principle: **No invented positions presented as truth.** Every train on the map
carries a provenance tag — `LIVE`, `INTERPOLATED`, `PREDICTED`, or `SIM` — and the UI shows it.

---

## 1. THE DATA REALITY (design around this, don't fight it)

- **No free continuous GPS feed** exists for all Indian trains. The real signal is **NTES**: per-train
  *last-reported station, delay (min), next station, ETA*, refreshed every few minutes.
- Therefore the twin must **interpolate** each train's lat/long along **real track geometry** between
  its last station and next station, using schedule + live delay. This is legitimate digital-twin
  reconciliation, not faking.
- Be explicit in code and UI about what is measured vs inferred.

---

## 2. TARGET EXPERIENCE ("what 'real' must feel like")

When a judge opens the platform:
1. A **real basemap** (Google Maps satellite/road) with **real railway tracks overlaid** (OpenRailwayMap).
2. **Hundreds of real trains** moving smoothly along the actual rails, each pulled from live status.
3. **Zoom into a station** → see platform-level detail: how many trains are **approaching**, **dwelling
   at platforms**, or **held outside** waiting for a clear block; each with train no., name, delay, next stop.
4. Click a train → live card: speed (derived), delay, last station + timestamp, next station + ETA,
   provenance tag, and the route line highlighted on real track.
5. A **"go live" clock**: top bar shows data freshness ("NTES updated 2 min ago") and a sim/live toggle.
6. The **AI brain still runs on top** of this real data: conflict look-ahead, OR-Tools resolution,
   VERIFIED ✓ badge, NL what-if — now operating on real trains.

---

## 3. DATA SOURCES & CREDENTIALS (wire these exactly)

| Layer | Source | How | Notes |
|------|--------|-----|------|
| **Basemap** | Google Maps Platform (Maps JS / Map Tiles API) | use existing key `GOOGLE_MAPS_API_KEY` | satellite + road; restrict key by domain/referrer |
| **Real track geometry** | OpenRailwayMap raster tiles `https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png` AND OSM vector rail (`railway=rail`) via **Overpass API** or a **Geofabrik India extract** | overlay tiles for visuals; load vector geometry for interpolation snapping | free for non-commercial; for production self-host tiles |
| **Stations** | datameet/railways (already bundled) + OSM `railway=station` | merge, dedupe by code | get real lat/long for every station on a corridor |
| **Schedules** | data.gov.in train timetable datasets + scrape/erail fallback | seed DB | gives planned arr/dep per station = interpolation backbone |
| **LIVE running status** | an NTES-backed API — pick ONE and abstract it: `indianrailapi.com`, a RapidAPI "Indian Railways / IRCTC live status" provider, or RailRadar-style endpoint | poll per active train; respect rate limits | returns last station, delay, next station, ETA |
| **Weather (optional)** | Open-Meteo | per-corridor | feeds delay ML features |

> Put every key in `backend/.env` (gitignored). Add `.env.example` entries. Never commit keys.
> Build a **provider abstraction** `backend/railmind/live/providers/` so the live-status source is swappable
> (one `LiveStatusProvider` interface, concrete classes per API). If the chosen API dies, you swap one class.

---

## 4. ARCHITECTURE CHANGES

Add a new **ingestion + reconciliation layer** in front of the existing twin:

```
[ Live Status Provider ] --poll--> [ Ingestion Worker ] --> [ Twin State Store ]
[ Real Track Geometry  ] --load--> [ Geometry Index (snap/route) ] ^
[ Schedule DB          ] --seed--> [ Reconciler + Interpolator ] --+
                                          |
                                   typed TwinSnapshot (Pydantic)
                                          |
                              WebSocket /stream  -->  Next.js control room
                                          |
                              existing AI brain (detectors, OR-Tools, verifier, NL)
```

Concrete tasks:
1. **Ingestion worker** (async, FastAPI background task / APScheduler): for each active train on the
   loaded corridor, poll live status every N seconds (stagger to respect rate limits), cache results,
   and write to the twin state store with `last_report_ts`.
2. **Geometry index**: load OSM rail polylines for the corridor; build an index that can (a) snap a
   station to the nearest point on the track, and (b) return the **path along the rails** between two
   stations (use `OpenRailRouting`/GraphHopper-on-rails or a precomputed corridor polyline). Cache it.
3. **Reconciler + Interpolator** (the core — see §5).
4. **Provenance**: every train object gets `source: LIVE|INTERPOLATED|PREDICTED|SIM` and `confidence`.
5. **Caching & resilience**: Redis or in-memory TTL cache; if the live API is down or rate-limited,
   **fall back to pure schedule** and tag those trains `SIM` (degrade honestly, never blank the map).
6. Keep the **local fallback sim** for offline dev, but clearly labeled.

---

## 5. THE POSITION INTERPOLATION ALGORITHM (most important piece)

For each train, between live pings:

```
INPUT per train (from live status):
  last_station, last_station_ts, delay_min, next_station, eta_next
  schedule: ordered [ (station, planned_arr, planned_dep) ... ]
  track path: polyline of REAL rail coordinates between consecutive stations

COMPUTE current position at wall-clock T:
  1. segment = (last_station -> next_station)
  2. seg_path = real_track_polyline(last_station, next_station)   # actual rails
  3. planned_run = planned_arr(next) - planned_dep(last)
     effective_run = planned_run  (optionally widen by delay model)
  4. elapsed = T - last_station_dep_actual   # dep_actual = max(planned_dep, last_report_ts)
  5. frac = clamp(elapsed / effective_run, 0, 1)
  6. position = point_at_fraction(seg_path, frac)   # arc-length along real polyline
  7. heading = tangent(seg_path, frac)
  8. speed_kmph = segment_length_km / (effective_run_hours)   # derived, label as derived
  9. source = LIVE if (T - last_report_ts) < FRESH_WINDOW else INTERPOLATED
 10. if frac >= 1 and no new ping: hold at next_station, mark "DWELL/HELD"
```

Rules:
- **Snap to real rails** — never draw a straight line between stations; follow `seg_path`.
- **Smoothing**: when a new ping arrives that disagrees with the interpolated point, **ease** the train
  to the corrected position over ~2–3s (lerp) instead of teleporting.
- **Dwell / waiting detection**: if a train's `frac` is pinned near a station longer than its planned
  dwell, classify it `WAITING` and surface it in the station's "trains waiting" count.
- **Speed is derived, not measured** — label it so.

This is what makes the map *move like real trains on real tracks* while staying honest.

---

## 6. MAP / UI REDESIGN

- **Basemap**: Google Maps (satellite toggle) as the ground truth ground; **OpenRailwayMap raster as a
  rail overlay** so real tracks/switches/yards are visible; trains rendered as a deck.gl layer on top.
- **Zoom tiers** (level-of-detail):
  - National: clustered train counts per region, hot corridors highlighted.
  - Corridor: individual trains moving on real rails.
  - **Station (deep zoom)**: a **station panel** showing platforms with occupancy, a queue of
    **approaching**, **dwelling**, and **held-outside** trains — each a row with no./name/delay/next/ETA
    and a "waiting Xm" timer. This is the "how many trains are waiting" experience you described.
- **Train card** on click: live status, provenance tag, route highlighted on real track, speed (derived),
  passenger-impact estimate from the brain.
- **Top status bar**: data freshness ("NTES • updated 2m ago"), LIVE vs SIM toggle, train count by source.
- **Provenance legend**: LIVE (solid), INTERPOLATED (slightly dimmed), PREDICTED (dashed), SIM (outlined).
- Keep existing **AI Engine panel**, **Incident Timeline**, **Demo Mode** — now driven by real trains.

---

## 7. KEEP & UPGRADE THE AI BRAIN (feed it real data)

- **Conflict detector**: now scans real interpolated positions for headway/platform/block conflicts on
  the real corridor — far more credible than before.
- **OR-Tools optimizer**: resolves real conflicts; show "delay saved / passengers protected."
- **Multi-LLM verifier**: keep VERIFIED ✓ N/N before any auto-apply (this is your agentic + safety moat).
- **NL agent**: "delay 12137 by 30 min", "what if Kasara–Igatpuri blocks now" — apply to the real twin.
- **Honesty**: any AI action on real data is a **recommendation in a sandbox overlay**, never a command
  sent to actual railway systems. Say so on screen.

---

## 8. PHASED BUILD PLAN (ship in this order)

- **P0 — Live ingestion (proof of life):** one corridor (Mumbai CSMT → Igatpuri). Poll live status for
  its trains, print last-station/delay to logs. Provider abstraction in place.
- **P1 — Real map:** Google basemap + OpenRailwayMap overlay + real station coords + real corridor track
  polyline loaded.
- **P2 — Interpolation engine:** trains move smoothly along real rails between pings; provenance tags live.
- **P3 — Station deep-zoom + waiting queues:** platform panel, "trains waiting" counts, train cards.
- **P4 — Brain on real data:** conflicts/optimizer/verifier/NL operating on the live twin; timeline logs.
- **P5 — Demo polish:** freshness bar, legend, Demo Mode scripted scenarios, recording.

Each phase must run end-to-end before the next. Write/extend pytest for ingestion, geometry, interpolation.

---

## 9. GUARDRAILS / DEFINITION OF DONE

- [ ] No straight-line train motion — all motion follows real OSM rail geometry.
- [ ] Every train shows a provenance tag; no inferred position is labeled "GPS".
- [ ] Live API rate limits respected; staggered polling; TTL cache; graceful fallback to `SIM`.
- [ ] Keys only in `.env`; `.env.example` updated; nothing secret committed.
- [ ] If the live API is unavailable, the map degrades to schedule-driven `SIM` and says so — never blank.
- [ ] AI actions are clearly sandbox recommendations, never sent to real rail control.
- [ ] One corridor at full fidelity + national map for scale; architecture ready to add corridors via config.
- [ ] Tests: ingestion parse, geometry snap/route, interpolation fraction math, fallback path.

---

## 10. JUDGE-PROOF PITCH FRAMING (put in README + say out loud)

> "RailMind Live is a digital twin of Indian Railways fed by **real NTES running-status data** rendered on
> **real OpenStreetMap rail geometry**. We don't claim a magic GPS feed nobody has — we do what real
> control centers do: reconcile live station reports against the physical network and interpolate between
> them, labeling every train LIVE, INTERPOLATED, or PREDICTED. On top of that real twin, our AI brain
> forecasts conflicts, resolves them with an OR-Tools constraint solver, and verifies every autonomous
> decision with multi-model consensus before it acts. It's not a slide — it's the operating picture, and
> it's honest about what's measured versus inferred."

That honesty is the thing other teams won't have. Most will fake GPS and crumble under one question.
You'll have a real, defensible, deep system — and a clear path to real feeds (RTIS/partner) on the roadmap.
