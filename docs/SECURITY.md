# Security

RailMind follows a **secrets-out-of-repo** policy. Real API keys (OpenAI, Anthropic, RapidAPI, Mapbox, Firebase) live **only** in local environment files on your machine — never in source code, never in git history, never in GitHub.

## What goes where

| Secret | File (local only, gitignored) | Committed placeholder |
|--------|-------------------------------|------------------------|
| OpenAI / Anthropic keys | `backend/.env` | `backend/.env.example` (empty) |
| RapidAPI NTES key | `backend/.env` | `backend/.env.example` (empty) |
| Mapbox token | `frontend/.env.local` | `frontend/.env.example` (empty) |
| Firebase web config | `frontend/.env.local` | `frontend/.env.example` (empty) |

**Do not** put Mapbox tokens in `backend/.env` or LLM keys in frontend env files.

## Audit summary (2026-06-14)

| Check | Result |
|-------|--------|
| `backend/.env` tracked in git | **No** — covered by `.gitignore` |
| `frontend/.env.local` tracked in git | **No** — covered by `.env*.local` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in git history | **None found** (`git log -S` scan) |
| `RAILMIND_RAPIDAPI_KEY` in git history | **None found** |
| Hard-coded API key patterns in backend/frontend source | **None found** |
| Firebase web config in main repo source | **Env-only** via `NEXT_PUBLIC_*` in `.env.local` |

> **Note:** The Flutter passenger app (`RailMind-main/`) ships Firebase client config files — these are public-by-design web/mobile keys. Restrict them in the Firebase console (authorized domains, app check). They are separate from your OpenAI / RapidAPI / Mapbox server-side secrets.

## What must never be committed

- `backend/.env` — LLM provider keys, RapidAPI key, corridor overrides
- `frontend/.env.local` — Mapbox token, Firebase config, backend URL overrides
- Any file containing `sk-ant-`, `sk-proj-`, `sk-`, or private service account JSON
- Docker override files with real keys (`.env` at repo root for compose is gitignored)

Use the checked-in examples instead:

- [`backend/.env.example`](../backend/.env.example)
- [`frontend/.env.example`](../frontend/.env.example)

## If a secret was ever committed

1. **Rotate immediately** — revoke the key in Anthropic / OpenAI / RapidAPI / Mapbox / Firebase console and issue a new one.
2. Remove the file from git history (e.g. `git filter-repo` or BFG) — do not rely on `.gitignore` alone for past commits.
3. Update local `.env` / `.env.local` with the new key.
4. Re-run this checklist before pushing.

## Local development

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
# Fill in your keys locally — the app runs without LLM/RapidAPI keys (honest fallbacks)
```

The control room **requires** a Mapbox token in `frontend/.env.local` for the basemap. Everything else is optional:

- No LLM keys → rule verifier + heuristic explainer
- No RapidAPI key → schedule replay, trains tagged **SIM**
- No Firebase → analytics disabled

## Reporting

For security concerns related to this repository, contact the team via [yuum.ai](https://yuum.ai).
