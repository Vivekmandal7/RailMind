# Security

RailMind follows a **secrets-out-of-repo** policy. This document records the audit performed for the public GitHub repository and what to do if credentials were ever exposed.

## Audit summary (2026-06-08)

| Check | Result |
|-------|--------|
| `backend/.env` tracked in git | **No** — covered by `.gitignore` |
| `frontend/.env.local` tracked in git | **No** — covered by `.env*.local` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in git history | **None found** (`git log -S` scan) |
| Hard-coded API key patterns in source | **None found** |
| Firebase web config in repo | **Env-only** via `NEXT_PUBLIC_*` in `.env.local` (client keys are public by design) |

## What must never be committed

- `backend/.env` — LLM provider keys
- `frontend/.env.local` — Firebase + backend URL overrides
- Any file containing `sk-ant-`, `sk-proj-`, or private service account JSON

Use the checked-in examples instead:

- [`backend/.env.example`](../backend/.env.example)
- [`frontend/.env.example`](../frontend/.env.example)

## If a secret was ever committed

1. **Rotate immediately** — revoke the key in the Anthropic / OpenAI / Firebase console and issue a new one.
2. Remove the file from git history (e.g. `git filter-repo` or BFG) — do not rely on `.gitignore` alone for past commits.
3. Update local `.env` / `.env.local` with the new key.
4. Re-run this checklist before pushing.

## Local development

```bash
cp backend/.env.example backend/.env      # add keys if you want live LLM verify
cp frontend/.env.example frontend/.env.local
```

The app runs fully without LLM keys: OR-Tools CP-SAT, heuristic verifier, and local NL parser are used automatically.

## Reporting

For security concerns related to this repository, contact the team via [yuum.ai](https://yuum.ai).
