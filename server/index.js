// GameClawd — one machine, every game.
//
// A single Express + Socket.IO server hosts the hub and every game:
//   /                      the hub (claw machine)
//   /games/<id>/           each game's static client
//   /api/games             the game registry
//   /api/dungeon/*         Dungeon of Doom HTTP API (leaderboard reads)
//   /api/aetherwing/*      AETHERWING leaderboard API
//   /socket.io             Dungeon of Doom realtime traffic
//   /healthz               uptime checks / keep-alive pings

import express from 'express'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { Server } from 'socket.io'

import { GAMES } from './games.js'
import { attachDungeon, dungeonApi, activeGameCount } from './dungeon/net.js'
import { aetherwingApi } from './aetherwing/api.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_DIR = path.join(__dirname, '..', 'client')
const PORT = process.env.PORT || 8080

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.disable('x-powered-by')

// ---- static clients ----
// The hub lives at the root; each game is self-contained under /games/<id>/.
app.use(express.static(CLIENT_DIR))
// Dungeon's client and server share collision code via this mount.
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')))

// ---- platform API ----
app.get('/api/games', (req, res) => res.json({ games: GAMES }))

app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    platform: 'gameclawd',
    games: GAMES.length,
    dungeonLobbies: activeGameCount(),
    uptime: Math.round(process.uptime()),
  })
})

// ---- per-game APIs ----
app.use('/api/dungeon', dungeonApi)
app.use('/api/aetherwing', aetherwingApi)

// ---- realtime ----
attachDungeon(io)

server.listen(PORT, () => {
  console.log(`GameClawd running at http://localhost:${PORT}`)
})
