# Frontend

The RailMind operator control room (Next.js 14 · React · TypeScript · Mapbox GL · deck.gl).

**Full documentation, judge demo script, and architecture:** [root README](../README.md)

```bash
npm install
cp .env.example .env.local   # add NEXT_PUBLIC_MAPBOX_TOKEN (required) + optional Firebase
npm run dev                  # http://localhost:3000
```

Requires `NEXT_PUBLIC_MAPBOX_TOKEN` in `.env.local` for the basemap. The UI connects to the Python engine at `NEXT_PUBLIC_BACKEND_URL`; without it, a local in-browser simulation fallback keeps every panel working.

For judge presentations use `./demo.sh` from the repo root (production build, no dev overlay).
