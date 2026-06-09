# Backend

Python digital-twin engine — FastAPI, WebSocket stream, modular AI pipeline.

**Full documentation:** [root README](../README.md) · [EXTENDING.md](../docs/EXTENDING.md) · [SECURITY.md](../docs/SECURITY.md)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
PYTHONPATH=. python -m railmind.train_delay
RAILMIND_CONFIG=config/mumbai_csmt_igatpuri.yaml \
  PYTHONPATH=. uvicorn railmind.app:app --reload --port 8000
```
