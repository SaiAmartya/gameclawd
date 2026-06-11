// AETHERWING leaderboard API — ported from the original Vercel serverless
// functions to an Express router.
//
// Storage backends:
//   - Vercel Blob when BLOB_READ_WRITE_TOKEN is set (durable, survives
//     redeploys — same store the standalone game used)
//   - local JSON files under data/aetherwing/ otherwise (local dev & E2E)
//
// Security model (unchanged from the original):
//   1. HMAC-signed flight tokens minted at takeoff (POST /session)
//   2. physics plausibility — token age bounds the max passable gates
//   3. replay protection — one submission per token nonce
//   4. name sanitization server-side

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const LB_PATH = 'leaderboard/top.json'
const MAX_KEEP = 100
const TOP_N = 10
// Forward speed caps at 22 u/s with gates every 16 u — nobody can
// pass gates faster than that, no matter how well they fly.
const MAX_GATES_PER_SECOND = 22 / 16
const MIN_FLIGHT_MS = 4000 // first gate is ~4.4s out
const MAX_TOKEN_AGE_MS = 6 * 3600 * 1000
const NAME_STRIP = /[^\w \-.!']/g

const secret =
  process.env.SCORE_SECRET ||
  (() => {
    const s = crypto.randomBytes(32).toString('hex')
    console.warn(
      'aetherwing: SCORE_SECRET not set — using an ephemeral secret. ' +
        'Tokens will not survive a restart. Set SCORE_SECRET in production.'
    )
    return s
  })()

// ---- storage backends ----

const useBlob = !!process.env.BLOB_READ_WRITE_TOKEN

const DATA_DIR =
  process.env.AETHERWING_DATA_DIR ||
  path.join(__dirname, '..', '..', 'data', 'aetherwing')
const BOARD_FILE = path.join(DATA_DIR, 'top.json')
const NONCE_FILE = path.join(DATA_DIR, 'nonces.json')

let fileNonces = new Set()
try {
  const raw = JSON.parse(fs.readFileSync(NONCE_FILE, 'utf8'))
  if (Array.isArray(raw)) fileNonces = new Set(raw)
} catch { /* no nonces yet */ }

function fileSave (file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

async function readBoard () {
  if (useBlob) {
    try {
      const { list } = await import('@vercel/blob')
      const { blobs } = await list({ prefix: LB_PATH, limit: 1 })
      if (!blobs.length) return []
      // cache-busting query param skips the CDN so we always read fresh
      const r = await fetch(`${blobs[0].url}?v=${Date.now()}`, { cache: 'no-store' })
      if (!r.ok) return []
      const data = await r.json()
      return Array.isArray(data) ? data : []
    } catch {
      return []
    }
  }
  try {
    const data = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'))
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function writeBoard (board) {
  if (useBlob) {
    const { put } = await import('@vercel/blob')
    await put(LB_PATH, JSON.stringify(board), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 0,
      contentType: 'application/json',
    })
    return
  }
  fileSave(BOARD_FILE, board)
}

// Returns true if the nonce was fresh (and is now burned), false on replay.
async function burnNonce (nonce) {
  if (useBlob) {
    try {
      const { put } = await import('@vercel/blob')
      // put() without allowOverwrite throws if the nonce blob already exists
      await put(`nonces/${nonce}`, '1', { access: 'public', addRandomSuffix: false })
      return true
    } catch {
      return false
    }
  }
  if (fileNonces.has(nonce)) return false
  fileNonces.add(nonce)
  fileSave(NONCE_FILE, [...fileNonces])
  return true
}

// ---- token signing ----

function signToken () {
  const ts = Date.now()
  const nonce = crypto.randomBytes(16).toString('hex')
  const payload = `${ts}.${nonce}`
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

function verifyToken (token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [tsStr, nonce, sig] = parts
  if (!/^[0-9]{10,16}$/.test(tsStr) || !/^[0-9a-f]{32}$/.test(nonce)) return null
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${tsStr}.${nonce}`)
    .digest('hex')
  if (sig.length !== expected.length) return null
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  return { ts: Number(tsStr), nonce }
}

// ---- router ----

export const aetherwingApi = express.Router()
aetherwingApi.use(express.json({ limit: '4kb' }))

aetherwingApi.post('/session', (req, res) => {
  res.setHeader('cache-control', 'no-store')
  res.json({ token: signToken() })
})

aetherwingApi.get('/scores', async (req, res) => {
  const board = await readBoard()
  res.setHeader('cache-control', 'no-store')
  res.json({ scores: board.slice(0, TOP_N) })
})

aetherwingApi.post('/scores', async (req, res) => {
  const body = req.body
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'bad_request' })
  }

  const auth = verifyToken(body.token)
  if (!auth) return res.status(401).json({ error: 'invalid_token' })

  const ageMs = Date.now() - auth.ts
  if (ageMs > MAX_TOKEN_AGE_MS || ageMs < 0) {
    return res.status(401).json({ error: 'expired_token' })
  }
  if (ageMs < MIN_FLIGHT_MS) {
    return res.status(422).json({ error: 'implausible_flight' })
  }

  const score = body.score
  if (!Number.isInteger(score) || score < 1 || score > 5000) {
    return res.status(422).json({ error: 'invalid_score' })
  }
  const maxPossible = Math.floor((ageMs / 1000) * MAX_GATES_PER_SECOND) + 2
  if (score > maxPossible) {
    return res.status(422).json({ error: 'implausible_flight' })
  }

  const name = String(body.name ?? '').replace(NAME_STRIP, '').trim().slice(0, 16)
  if (name.length < 2) return res.status(422).json({ error: 'invalid_name' })

  if (!(await burnNonce(auth.nonce))) {
    return res.status(409).json({ error: 'already_submitted' })
  }

  const board = await readBoard()
  const entry = { name, score, ts: Date.now() }
  board.push(entry)
  board.sort((a, b) => b.score - a.score || a.ts - b.ts)
  const trimmed = board.slice(0, MAX_KEEP)
  await writeBoard(trimmed)

  const rank = trimmed.indexOf(entry) + 1
  res.json({ ok: true, rank: rank || null, scores: trimmed.slice(0, TOP_N) })
})
