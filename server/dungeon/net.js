// Dungeon of Doom networking — lobby management, socket handlers, and the
// authoritative 30 Hz tick loop. Migrated intact from the standalone server;
// the hub passes in its Socket.IO instance.

import express from 'express'

import { Game } from './game.js'
import { topTimes, submitTime } from './leaderboard.js'
import { TICK_RATE } from '../../shared/sim.js'

const games = new Map() // code -> Game
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function makeCode () {
  let code = ''
  do {
    code = ''
    for (let i = 0; i < 4; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
  } while (games.has(code))
  return code
}

function leaveCurrentGame (socket) {
  const code = socket.data.gameCode
  if (!code) return
  const game = games.get(code)
  socket.leave(code)
  socket.data.gameCode = null
  if (!game) return
  game.removePlayer(socket.id)
  if (game.players.size === 0) games.delete(code)
}

export function activeGameCount () {
  return games.size
}

// read-only top solo clear times; submissions go through the socket so the
// server can tie them to an authoritative victory
export const dungeonApi = express.Router()
dungeonApi.get('/leaderboard', (req, res) => {
  res.json({ ok: true, top: topTimes() })
})

export function attachDungeon (io) {
  io.on('connection', (socket) => {
    socket.data.gameCode = null

    const currentGame = () => games.get(socket.data.gameCode)

    socket.on('createGame', (opts, ack) => {
      if (typeof ack !== 'function') return
      leaveCurrentGame(socket)
      const code = makeCode()
      const game = new Game(code, { solo: !!opts?.solo })
      games.set(code, game)
      socket.join(code)
      socket.data.gameCode = code
      game.addPlayer(socket.id)
      ack({ ok: true, selfId: socket.id, init: game.initPayload() })
    })

    socket.on('joinGame', (opts, ack) => {
      if (typeof ack !== 'function') return
      const code = String(opts?.code || '').trim().toUpperCase()
      const game = games.get(code)
      if (!game) return ack({ ok: false, error: 'No game found with that code.' })
      if (game.solo) return ack({ ok: false, error: 'That game is single-player.' })
      if (game.players.size >= game.maxPlayers) return ack({ ok: false, error: 'That game is full.' })
      leaveCurrentGame(socket)
      socket.join(code)
      socket.data.gameCode = code
      game.addPlayer(socket.id)
      ack({ ok: true, selfId: socket.id, init: game.initPayload() })
      socket.to(code).emit('rosterUpdate', game.roster())
    })

    socket.on('input', (data) => currentGame()?.handleInput(socket.id, data || {}))
    socket.on('attack', () => currentGame()?.handleAttack(socket.id))
    socket.on('dash', () => currentGame()?.handleDash(socket.id))

    // Leaderboard submission. The client only supplies a display name; the
    // time comes from the server's own clock on the player's current victory.
    socket.on('submitScore', (opts, ack) => {
      if (typeof ack !== 'function') return
      const game = currentGame()
      if (!game || !game.solo || !game.victory || !Number.isFinite(game.victoryMs)) {
        return ack({ ok: false, error: 'No solo victory to submit.' })
      }
      if (game.scoreSubmitted) {
        return ack({ ok: false, error: 'This run is already on the board.' })
      }
      game.scoreSubmitted = true
      const result = submitTime(opts?.name, game.victoryMs)
      ack({ ...result, top: topTimes() })
    })

    socket.on('restart', () => {
      const game = currentGame()
      if (!game) return
      game.reset()
      io.to(game.code).emit('worldReset', game.initPayload())
    })

    socket.on('leaveGame', () => leaveCurrentGame(socket))
    socket.on('disconnect', () => leaveCurrentGame(socket))
  })

  // ---- main loop ----
  const dt = 1 / TICK_RATE
  setInterval(() => {
    for (const game of games.values()) {
      if (game.players.size === 0) continue
      game.tick(dt)
      io.to(game.code).emit('snap', game.snapshot())
    }
  }, 1000 / TICK_RATE)
}
