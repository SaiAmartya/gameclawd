// Tests for the AETHERWING leaderboard API as ported to Express.
// Exercises the real router over HTTP on an ephemeral port, using the
// file-storage backend in a temp dir.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'

const SECRET = 'test-secret-for-aetherwing-api'
process.env.SCORE_SECRET = SECRET
process.env.AETHERWING_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-lb-'))
delete process.env.BLOB_READ_WRITE_TOKEN

const { aetherwingApi } = await import('../server/aetherwing/api.js')
const express = (await import('express')).default

let server, base

before(async () => {
  const app = express()
  app.use('/api/aetherwing', aetherwingApi)
  server = http.createServer(app)
  await new Promise(resolve => server.listen(0, resolve))
  base = `http://127.0.0.1:${server.address().port}/api/aetherwing`
})

after(() => server.close())

// forge a token the way the server does, but with a chosen age — lets us
// test the plausibility window without sleeping through real flights
function tokenAgedMs (ageMs) {
  const ts = Date.now() - ageMs
  const nonce = crypto.randomBytes(16).toString('hex')
  const payload = `${ts}.${nonce}`
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex')
  return `${payload}.${sig}`
}

test('mints a verifiable session token', async () => {
  const r = await fetch(`${base}/session`, { method: 'POST' })
  assert.equal(r.status, 200)
  const { token } = await r.json()
  assert.match(token, /^\d{10,16}\.[0-9a-f]{32}\.[0-9a-f]{64}$/)
})

test('GET /scores starts empty', async () => {
  const r = await fetch(`${base}/scores`)
  assert.equal(r.status, 200)
  const { scores } = await r.json()
  assert.deepEqual(scores, [])
})

test('rejects garbage and unsigned tokens', async () => {
  for (const token of ['nope', '123.deadbeef.bad', tokenAgedMs(5000).slice(0, -2) + 'ff']) {
    const r = await fetch(`${base}/scores`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, name: 'PILOT', score: 3 }),
    })
    assert.equal(r.status, 401)
  }
})

test('rejects physically implausible flights', async () => {
  // token too young — nobody scores before the first gate
  let r = await fetch(`${base}/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokenAgedMs(1000), name: 'PILOT', score: 1 }),
  })
  assert.equal(r.status, 422)

  // plausible age, impossible gate count
  r = await fetch(`${base}/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokenAgedMs(6000), name: 'PILOT', score: 500 }),
  })
  assert.equal(r.status, 422)
  assert.equal((await r.json()).error, 'implausible_flight')
})

test('accepts a plausible flight exactly once (replay → 409)', async () => {
  const token = tokenAgedMs(20_000) // ~20s flight, plenty for a score of 5
  const submit = () => fetch(`${base}/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, name: 'CLAWD <b>!</b>', score: 5 }),
  })

  const first = await submit()
  assert.equal(first.status, 200)
  const data = await first.json()
  assert.equal(data.rank, 1)
  assert.equal(data.scores[0].name, 'CLAWD b!b') // angle brackets stripped
  assert.equal(data.scores[0].score, 5)

  const replay = await submit()
  assert.equal(replay.status, 409)
  assert.equal((await replay.json()).error, 'already_submitted')

  // and the board persisted
  const r = await fetch(`${base}/scores`)
  const { scores } = await r.json()
  assert.equal(scores.length, 1)
})

test('rejects invalid names and scores', async () => {
  let r = await fetch(`${base}/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokenAgedMs(20_000), name: '@@', score: 5 }),
  })
  assert.equal(r.status, 422)
  assert.equal((await r.json()).error, 'invalid_name')

  r = await fetch(`${base}/scores`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: tokenAgedMs(20_000), name: 'PILOT', score: 2.5 }),
  })
  assert.equal(r.status, 422)
  assert.equal((await r.json()).error, 'invalid_score')
})
