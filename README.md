# 🦞 GameClawd

> **An arcade claw machine full of games — every single one designed, coded,
> play-tested, security-hardened, and deployed by Claude.**

No game engines. No asset packs. No 3D models, no texture files, no audio
files. Every dungeon wall, every origami wing-fold, every chime and crash in
this machine was *written* — as code — by an AI. GameClawd is the cabinet
that holds the prizes: pick a capsule, watch the claw grab it, and play.
Solo, or with a friend anywhere on the internet.

**🕹️ The hub is the machine** — a neon midnight arcade with a swaying claw
that physically grabs the game you choose. Free play, forever. The coin slot
is decorative.

## 🎁 What's in the machine

| | Game | The pitch | Players |
|---|------|-----------|---------|
| ⚔️ | **Dungeon of Doom** | A full 3D co-op roguelite. Procedurally generated dungeons, telegraphed skill-based melee, a Dungeon Overlord at the bottom. Host a run, share a 4-letter code, and a friend drops in from any browser — backed by a server-authoritative simulation at 30 Hz with client-side prediction, so nobody can cheat physics. | 1–2, online co-op |
| 🕊️ | **AETHERWING** | A cinematic 3D reimagining of Flappy Bird. An origami bird folded from raw triangles, a GLSL sky that crossfades from golden hour to starlight as you score, a generative ambient soundtrack composed live in WebAudio — and a global leaderboard defended by HMAC-signed flight tokens, physics-plausibility checks, and replay protection. | 1, global leaderboard |

Everything procedural, everything in the browser, zero build steps.

## 🤖 Why this is interesting

Each game here was built end-to-end by Claude (Fable 5): game design, 3D
rendering, networking, procedural art and audio, anti-cheat design, the test
suites, and the deployment pipeline. The platform itself — the claw machine
you're looking at — too. The human contribution was taste, direction, and a
GitHub account.

That includes the unglamorous parts:

- **Fair multiplayer** — Dungeon of Doom runs a server-authoritative sim;
  clients predict against the same shared collision code and reconcile softly.
- **Cheat-resistant leaderboards** — AETHERWING scores require a signed
  token whose *age* must make the claimed score physically possible
  (claim 500 gates on a 6-second flight → `422 implausible_flight`).
- **Real tests** — 19 unit tests on the simulations and score APIs, plus 13
  Playwright E2E tests that drive real browsers — including two browser
  contexts completing the co-op room-code handshake against a live server.

## 🏗️ Architecture

One Node process hosts everything. The dungeon needs a persistent WebSocket
server (that 30 Hz authoritative sim), so the whole platform runs as a single
long-lived web service instead of serverless functions:

```
server/
  index.js            hub server — static hosting, registry, health, Socket.IO
  games.js            the game registry (single source of truth)
  dungeon/            authoritative dungeon sim + lobby networking + leaderboard
  aetherwing/api.js   HMAC flight tokens + replay-proof score submission
shared/sim.js         movement & collision shared by dungeon server and client
client/
  index.html|css|js   the hub (the claw machine itself)
  games/dungeon/      Three.js dungeon client (ES modules, no build step)
  games/aetherwing/   Three.js aetherwing client (ES modules, no build step)
tests/
  *.test.js           unit tests (node:test) — sim, leaderboards, score API
  e2e/*.spec.js       Playwright E2E — hub, both games, 2-browser co-op
```

Routing: hub at `/`, games at `/games/<id>/`, per-game APIs at `/api/<id>/*`,
Socket.IO on its default path, health at `/healthz`.

**Adding prize #3:** drop its client under `client/games/<id>/`, add one
entry to `server/games.js`, mount any server module under `/api/<id>`. The
hub grows a new capsule automatically.

## 🚀 Run it locally

```bash
npm install
npm start            # → http://localhost:8080
```

Open two browser windows to try co-op: **Host Co-op** in one, **Join** with
the room code in the other.

## ✅ Tests

```bash
npm test             # unit: dungeon sim + leaderboards + aetherwing API
npx playwright install chromium   # first time only
npm run test:e2e     # E2E: boots the server, drives real browsers
```

## ☁️ Deploy (Render)

The repo ships a [Blueprint](render.yaml):

1. Render dashboard → **New + → Blueprint** → select this repo. Render reads
   `render.yaml`, creates the `gameclawd` web service (free plan), and
   generates `SCORE_SECRET` automatically.
2. *(Optional, recommended)* Set `BLOB_READ_WRITE_TOKEN` to a Vercel Blob
   token so the AETHERWING leaderboard survives restarts — the free Render
   disk is ephemeral. Without it, scores fall back to local file storage.
3. The [keepalive workflow](.github/workflows/keepalive.yml) pings
   `/healthz` every 10 minutes so the free instance stays awake; update its
   URL if your service name differs.

| Env var | Required | Purpose |
|---------|----------|---------|
| `PORT` | set by Render | listen port (defaults to 8080 locally) |
| `SCORE_SECRET` | production | HMAC secret for AETHERWING flight tokens |
| `BLOB_READ_WRITE_TOKEN` | optional | durable AETHERWING leaderboard via Vercel Blob |
| `DATA_DIR` / `AETHERWING_DATA_DIR` | optional | where file-backed leaderboards live |

---

*Machine operated by **CLAWD** 🦞 — every game in this cabinet was designed,
coded & play-tested by Claude. More capsules incoming.*
