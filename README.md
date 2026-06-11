# 🦞 GameClawd

**The arcade claw machine of games built by Claude.** One neon cabinet, every
prize playable — solo or with a friend. Pick a capsule, the claw grabs it,
and the game launches.

## The prizes

| Game | What it is | Players |
|------|-----------|---------|
| ⚔️ **Dungeon of Doom** | 3D co-op roguelite dungeon crawler — telegraphed combat, procedural dungeons, online co-op via 4-letter room codes | 1–2 |
| 🕊️ **AETHERWING** | 3D flappy odyssey — origami bird, living sky, procedural audio, cheat-resistant global leaderboard | 1 |

Both games were designed, coded, play-tested, and security-tested by Claude.

## Architecture

One Node process hosts everything. Dungeon of Doom needs a persistent
WebSocket server (server-authoritative sim at 30 Hz), which is why the whole
platform runs as a single long-lived web service rather than serverless:

```
server/
  index.js            hub server — static hosting, registry, health, Socket.IO
  games.js            the game registry (single source of truth)
  dungeon/            authoritative dungeon sim + lobby networking + leaderboard
  aetherwing/api.js   HMAC flight tokens + replay-proof score submission
shared/sim.js         movement & collision shared by dungeon server and client
client/
  index.html|css|js   the hub (claw machine)
  games/dungeon/      Three.js dungeon client (ES modules, no build step)
  games/aetherwing/   Three.js aetherwing client (ES modules, no build step)
tests/
  *.test.js           unit tests (node:test) — sim, leaderboards, score API
  e2e/*.spec.js       Playwright E2E — hub, both games, 2-browser co-op
```

Routing: hub at `/`, games at `/games/<id>/`, per-game APIs at `/api/<id>/*`,
Socket.IO on its default path, health at `/healthz`.

**Adding a game:** drop its client under `client/games/<id>/`, add an entry
to `server/games.js`, mount any server module it needs under `/api/<id>`.
The hub renders its capsule automatically.

## Run locally

```bash
npm install
npm start            # http://localhost:8080
```

## Tests

```bash
npm test             # unit: dungeon sim + leaderboards + aetherwing API
npm run test:e2e     # Playwright: boots the server, drives real browsers
                     # (first time: npx playwright install chromium)
```

The E2E suite covers the hub (capsule rendering, claw grab-and-launch,
reduced-motion fallback), a solo dungeon run, **two browser contexts
completing the co-op room-code handshake**, and AETHERWING's takeoff +
leaderboard token flow.

## Deploy (Render)

The repo ships a [Blueprint](render.yaml):

1. Push this repo to GitHub.
2. Render dashboard → **New + → Blueprint** → select the repo. Render reads
   `render.yaml`, creates the `gameclawd` web service on the free plan, and
   generates `SCORE_SECRET` automatically.
3. *(Optional, recommended)* Set `BLOB_READ_WRITE_TOKEN` to a Vercel Blob
   token so the AETHERWING leaderboard survives restarts — the free Render
   disk is ephemeral. Without it, scores fall back to local file storage.
4. The GitHub Actions [keepalive workflow](.github/workflows/keepalive.yml)
   pings `/healthz` every 10 minutes so the free instance stays awake;
   update its URL if your service name differs.

Environment variables:

| Var | Required | Purpose |
|-----|----------|---------|
| `PORT` | set by Render | listen port (defaults to 8080 locally) |
| `SCORE_SECRET` | production | HMAC secret for AETHERWING flight tokens |
| `BLOB_READ_WRITE_TOKEN` | optional | durable AETHERWING leaderboard via Vercel Blob |
| `DATA_DIR` / `AETHERWING_DATA_DIR` | optional | where file-backed leaderboards live |

---

*Machine operated by CLAWD 🦞 — every game designed, coded & play-tested by Claude.*
