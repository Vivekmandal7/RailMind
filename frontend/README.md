# Frontend

The RailMind operator control room lives in this directory (Next.js 14 · React · TypeScript · deck.gl).

**Full documentation, quickstart, architecture, and demo instructions:** see the [root README](../README.md).

```bash
npm install
cp .env.example .env.local   # optional — backend URL + Firebase analytics
npm run dev                  # http://localhost:3000
```

The UI auto-detects the Python engine at `NEXT_PUBLIC_BACKEND_URL`. Without it, a local in-browser simulation fallback keeps every panel working.
