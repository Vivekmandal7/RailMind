# Backend

Python digital-twin engine — FastAPI, WebSocket stream, live NTES data spine, modular AI pipeline.

**Full documentation:** [root README](../README.md) · [EXTENDING.md](../docs/EXTENDING.md) · [SECURITY.md](../docs/SECURITY.md)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # add keys locally — never commit .env
PYTHONPATH=. python -m railmind.train_delay
RAILMIND_CONFIG=config/mumbai_csmt_igatpuri.yaml \
  PYTHONPATH=. uvicorn railmind.app:app --reload --port 8000
```

Corridors: `config/delhi_ndls_agra.yaml` · `config/mumbai_csmt_igatpuri.yaml` · `config/india_wide.yaml`.

Optional `RAILMIND_RAPIDAPI_KEY` in `.env` enables live NTES running status; without it the engine honestly falls back to schedule replay.
