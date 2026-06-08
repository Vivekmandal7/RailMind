# Extending RailMind

Every stage of the engine is an interface (ABC) injected by the
`Orchestrator`. No module reaches into another's internals — they communicate
only through the dataclasses in `backend/railmind/interfaces.py` and the wire
contract in `backend/railmind/models.py`. To add or swap a capability you
implement one interface and register it in `backend/railmind/config.py`; nothing
else changes.

```
DataSource ─┐
            ├─► NetworkGraph ─► DigitalTwin ─► Orchestrator ─► FastAPI (WS/REST) ─► Next.js UI
ConflictDetector / Predictor / Optimizer / Verifier ──┘   (typed Pydantic contract)
```

## Feature flags / config

`backend/config/*.yaml` selects the implementation for each stage by string key
and toggles half-built modules without code changes:

```yaml
modules:
  conflict_detector: rule_based   # -> DETECTORS registry
  predictor: cascade              # -> PREDICTORS registry
  optimizer: greedy               # -> OPTIMIZERS registry
  verifier: rule_based            # -> VERIFIERS registry
  autonomous: false
```

The registries live in `config.py`:

```python
DETECTORS  = {"rule_based": RuleBasedConflictDetector}
PREDICTORS = {"cascade": DelayCascadePredictor}
OPTIMIZERS = {"greedy": GreedyOptimizer}
VERIFIERS  = {"rule_based": RuleBasedVerifier}
```

Add your class to the dict, point the YAML at its key, restart. Done.

---

## 1. Add a DataSource (e.g. a live API feed)

Implement `railmind.interfaces.DataSource`:

```python
class DataSource(ABC):
    def load_stations(self) -> list[Station]: ...
    def load_sections(self) -> list[Section]: ...
    def load_trains(self, stations: dict[str, Station],
                    sections: dict[str, Section]) -> list[Train]: ...
```

```python
# railmind/datasource_live.py
class LiveApiDataSource(DataSource):
    def __init__(self, base_url: str, **_):
        self.base_url = base_url
    def load_stations(self): ...   # GET /stations -> [Station(...)]
    def load_sections(self): ...   # GET /sections -> [Section(... cum_km precomputed)]
    def load_trains(self, stations, sections): ...
```

Register + select:

```python
# config.py
DATA_SOURCES["live_api"] = LiveApiDataSource
```
```yaml
data_source:
  kind: live_api
  base_url: https://feed.example/api
```

> Sections must carry a polyline `geometry` and **precomputed `cum_km`**
> (`railmind.geo.cumulative_arc_length`) — arc-length is what makes motion
> smooth on the frontend.

---

## 2. Swap in OR-Tools (CP-SAT) for the Optimizer

Implement `railmind.interfaces.Optimizer`:

```python
class Optimizer(ABC):
    def propose(self, twin: DigitalTwinProto, conflict: Conflict,
                states: list[TrainState]) -> ResolutionPlan: ...
```

```python
# railmind/optimizer_ortools.py
from ortools.sat.python import cp_model

class CpSatOptimizer(Optimizer):
    def propose(self, twin, conflict, states) -> ResolutionPlan:
        model = cp_model.CpModel()
        # decision vars: hold seconds per train, ordering booleans, platform assignment
        # constraints: single-line mutual exclusion, headway >= H, capacity per section
        # objective: minimise weighted (delay_min * passengers)
        ...
        return ResolutionPlan(id=..., conflict_id=conflict.id, summary=...,
                              actions=[ResolutionAction(kind="hold", train=..., hold_sec=...)],
                              delay_saved_min=..., conflicts_resolved=...,
                              connections_protected=..., passengers_protected=...,
                              verified=False, verify_note="")  # Verifier fills verified
```

```python
OPTIMIZERS["cp_sat"] = CpSatOptimizer   # config.py
```
```yaml
modules: { optimizer: cp_sat }
```

The UI keeps working because it only ever consumes `RecommendationModel`.

---

## 3. Plug in an ML Predictor

Implement `railmind.interfaces.Predictor`:

```python
class Predictor(ABC):
    def predict(self, twin, states: list[TrainState],
                ctx: SimContext) -> list[Prediction]: ...
```

```python
# railmind/predictor_ml.py
class MLPredictor(Predictor):
    def __init__(self, model_path: str, **_):
        self.model = load_model(model_path)
    def predict(self, twin, states, ctx) -> list[Prediction]:
        X = featurise(states, twin)         # delays, speeds, headways, section load
        yhat = self.model.predict(X)        # projected delay per train
        return [Prediction(train=s.number, predicted_delay_min=int(yhat[i]),
                           cause="ml") for i, s in enumerate(states)]
```

```python
PREDICTORS["ml"] = MLPredictor
```

Train offline on historical running data; the engine and stream are untouched.

---

## 4. Add an LLM-consensus Verifier

Implement `railmind.interfaces.Verifier`:

```python
class Verifier(ABC):
    def verify(self, twin, plan: ResolutionPlan,
               conflict: Conflict) -> tuple[bool, str]: ...
```

```python
# railmind/verifier_llm.py
class MultiModelVerifier(Verifier):
    def __init__(self, models: list[str], **_):
        self.models = models
    def verify(self, twin, plan, conflict) -> tuple[bool, str]:
        votes = [ask_model(m, plan, conflict) for m in self.models]   # safe? y/n + reason
        ok = sum(v.safe for v in votes) > len(votes) // 2
        return ok, consensus_note(votes)
```

```python
VERIFIERS["llm_consensus"] = MultiModelVerifier
```

The orchestrator already calls `verify()` for every plan and streams the result
as `RecommendationModel.verified` + `verify_note`, which the AI panel renders as
the **VERIFIED** badge — so a richer verifier lights up the UI automatically.

---

## 5. Add a ConflictDetector (e.g. ML)

```python
class ConflictDetector(ABC):
    def detect(self, twin: DigitalTwinProto, ctx: SimContext) -> list[Conflict]: ...
```

The rule-based detector steps the twin over a look-ahead window via the public
`twin.compute_states(ctx)` surface only — your ML detector can do the same (or
consume raw features) and must return the same `Conflict` dataclass.

---

## The contract (don't break these)

- **Runtime contract:** dataclasses in `interfaces.py` (`Station`, `Section`,
  `Train`, `TrainState`, `Conflict`, `ResolutionPlan`, `Prediction`, `SimContext`).
- **Wire contract:** Pydantic models in `models.py`, mirrored 1:1 by
  `frontend/lib/contract.ts`. If you add a field, add it in both places.
- **Transport is dumb:** `app.py` only advances the orchestrator and broadcasts
  `TwinSnapshot`. Put logic in modules, never in the transport.

## Tests

Each module is independently testable; see `backend/tests/`. Add a test next to
your implementation and run `pytest` from `backend/`.
