// Global leaderboard for fastest solo clears.
//
// Security model: clear times are measured server-side (Game.victoryMs) and
// never accepted from the client; a run can submit exactly once, only after
// an authoritative solo victory; names are sanitized and length-capped before
// they are stored or served.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data')
const FILE = path.join(DATA_DIR, 'leaderboard.json')
const MAX_ENTRIES = 10
const MIN_MS = 10_000           // sanity floor — no sub-10s "clears"
const MAX_MS = 6 * 3600_000     // and nothing longer than 6 hours

let board = []
try {
  const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  if (Array.isArray(raw)) {
    board = raw
      .filter(e => typeof e?.name === 'string' && Number.isFinite(e?.ms))
      .map(e => ({ name: sanitizeName(e.name), ms: Math.round(e.ms), at: Number(e.at) || 0 }))
      .sort((a, b) => a.ms - b.ms)
      .slice(0, MAX_ENTRIES)
  }
} catch { /* no board yet */ }

export function sanitizeName (raw) {
  // printable basics only: letters, digits, underscore, space and -'.!
  const cleaned = String(raw ?? '').replace(/[^\w \-'.!]/g, '').trim().slice(0, 16)
  return cleaned || 'NAMELESS HERO'
}

function save () {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(FILE, JSON.stringify(board))
  } catch (err) {
    console.error('leaderboard: save failed —', err.message)
  }
}

export function topTimes () {
  return board.map((e, i) => ({ rank: i + 1, name: e.name, ms: e.ms }))
}

// Returns { ok, rank } — rank is null when the time didn't make the board.
export function submitTime (name, ms) {
  if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) return { ok: false }
  const entry = { name: sanitizeName(name), ms: Math.round(ms), at: Date.now() }
  board.push(entry)
  board.sort((a, b) => a.ms - b.ms)
  board = board.slice(0, MAX_ENTRIES)
  const idx = board.indexOf(entry)
  save()
  return { ok: true, rank: idx >= 0 ? idx + 1 : null }
}
