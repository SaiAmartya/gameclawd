// Smoke tests for the server simulation. Run with: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { generateDungeon } from '../server/dungeon/dungeon.js'
import { Game } from '../server/dungeon/game.js'
import { circleHitsWall, circleHitsObstacle, moveCircle, PLAYER, ENEMY_TYPES } from '../shared/sim.js'

test('dungeon is fully connected and has exactly one boss + one spawn room', () => {
  for (let run = 0; run < 20; run++) {
    const d = generateDungeon()
    assert.equal(d.rooms.filter(r => r.boss).length, 1)
    assert.equal(d.rooms.filter(r => r.spawn).length, 1)
    assert.ok(d.rooms.length >= 4, 'enough rooms generated')

    // flood fill from spawn must reach every room centre
    const size = d.size
    const seen = new Set()
    const queue = [[Math.floor(d.spawnX), Math.floor(d.spawnY)]]
    while (queue.length) {
      const [x, y] = queue.pop()
      const k = x + ',' + y
      if (seen.has(k)) continue
      if (x < 0 || y < 0 || x >= size || y >= size) continue
      if (d.grid[y][x] === '#') continue
      seen.add(k)
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
    for (const r of d.rooms) {
      const cx = Math.floor(r.x + r.w / 2)
      const cy = Math.floor(r.y + r.h / 2)
      assert.ok(seen.has(cx + ',' + cy), `room ${r.i} reachable from spawn`)
    }
  }
})

test('movement collides with walls and never tunnels through them', () => {
  const grid = ['#####', '#...#', '#...#', '#...#', '#####']
  // starting in the open, slam into the right wall at high speed
  const res = moveCircle(grid, 2.5, 2.5, 0.32, 50, 0)
  assert.ok(res.x < 4 - 0.32 + 0.01, 'stopped at the wall')
  assert.ok(!circleHitsWall(grid, res.x, res.y, 0.32), 'resting position is valid')
})

test('player attack damages and kills enemies, boss kill triggers victory', () => {
  const game = new Game('TEST', { solo: true })
  const p = game.addPlayer('p1')

  const enemy = game.enemies.find(e => e.type !== 'boss')
  p.x = enemy.x - 1
  p.y = enemy.y
  p.facing = 0 // facing +x, toward the enemy

  while (!enemy.dead) {
    p.attackCd = 0
    game.handleAttack('p1')
  }
  assert.ok(enemy.dead)
  assert.ok(game.pickups.some(k => k.type === 'coin'), 'enemy dropped a coin')
  assert.ok(game.events.some(e => e.k === 'edeath'))

  const boss = game.enemies.find(e => e.type === 'boss')
  p.x = boss.x - 1
  p.y = boss.y
  while (!boss.dead) {
    p.attackCd = 0
    game.handleAttack('p1')
  }
  assert.ok(game.victory, 'killing the boss wins the run')
  assert.ok(game.events.some(e => e.k === 'victory'))
})

test('enemies chase and damage players; player death ends a solo run', () => {
  const game = new Game('TEST', { solo: true })
  const p = game.addPlayer('p1')
  const enemy = game.enemies.find(e => e.type === 'grunt')

  // drop the player on top of the enemy and let the sim run
  p.x = enemy.x + 0.5
  p.y = enemy.y
  for (let i = 0; i < 30 * 60 && !p.dead; i++) {
    p.x = enemy.x + 0.5 // pin the player in contact
    p.y = enemy.y
    game.tick(1 / 30)
  }
  assert.ok(p.dead, 'player eventually dies in contact with an enemy')
  assert.ok(game.over, 'solo run is over when the only player dies')
})

test('enemy attacks are telegraphed and cannot be paused by attack-spam', () => {
  const game = new Game('TEST', { solo: true })
  const p = game.addPlayer('p1')
  const enemy = game.enemies.find(e => e.type === 'grunt')
  enemy.aggro = true
  p.x = enemy.x + 0.5
  p.y = enemy.y

  // first tick starts a windup, not instant damage
  game.tick(1 / 30)
  assert.equal(p.hp, p.maxHp, 'no instant damage — attack telegraphed')
  assert.ok(enemy.windup > 0, 'enemy is winding up')

  // a player hit no longer interrupts the windup — no hit-stun pause
  p.facing = Math.atan2(enemy.y - p.y, enemy.x - p.x)
  game.handleAttack('p1')
  assert.ok(enemy.windup > 0, 'windup survives being hit')

  // face-tanking while spamming attacks is a trade: the strike still lands
  for (let i = 0; i < 60 && p.hp === p.maxHp; i++) {
    game.handleAttack('p1') // no-ops while on cooldown
    p.x = enemy.x + 0.5     // stay pinned in contact despite knockback
    p.y = enemy.y
    game.tick(1 / 30)
  }
  assert.ok(p.hp < p.maxHp, 'spamming attacks does not prevent the enemy striking')
})

test('incoming attacks on one player are rate-limited, even when swarmed', () => {
  const game = new Game('TEST', { solo: true })
  const p = game.addPlayer('p1')
  // surround the player with four aggroed grunts in contact
  const grunts = game.enemies.filter(e => e.type === 'grunt').slice(0, 4)
  grunts.forEach((e, i) => {
    e.aggro = true
    const ang = (i / 4) * Math.PI * 2
    e.x = p.x + Math.cos(ang) * 0.8
    e.y = p.y + Math.sin(ang) * 0.8
  })
  game.tick(1 / 30)
  const windingUp = game.enemies.filter(e => e.windup > 0).length
  assert.equal(windingUp, 1, 'only one enemy may wind up while the lock is active')
  assert.ok(p.windupLockT > 0, 'player attack-pacing lock engaged')

  // over a full second of being surrounded, damage stays within the pacing
  // budget (~1 strike per 0.8s) instead of all four striking at once
  for (let i = 0; i < 30; i++) game.tick(1 / 30)
  assert.ok(p.maxHp - p.hp <= 16, `took ${p.maxHp - p.hp} dmg in 1s — should be paced`)
})

test('dash grants i-frames', () => {
  const game = new Game('TEST', { solo: true })
  const p = game.addPlayer('p1')
  p.dashLeft = PLAYER.DASH_DURATION
  game.damagePlayer(p, 50)
  assert.equal(p.hp, p.maxHp, 'no damage taken while dashing')
})

test('players collide with prop obstacles (pillars, crates)', () => {
  const grid = ['#######', '#.....#', '#.....#', '#.....#', '#######']
  const obstacles = [{ x: 3.5, y: 2.5, r: 0.3, tall: true, kind: 'pillar' }]
  // walk straight at the pillar — must stop short, never phase through
  const res = moveCircle(grid, 1.5, 2.5, 0.32, 4, 0, obstacles)
  assert.ok(res.x < 3.5 - 0.3, `stopped before the pillar (x=${res.x})`)
  assert.ok(!circleHitsObstacle(obstacles, res.x, res.y, 0.32), 'resting position is clear')
  // low props block movement but not projectiles; tall props block both
  const crate = [{ x: 3.5, y: 2.5, r: 0.36, tall: false, kind: 'crate' }]
  assert.ok(circleHitsObstacle(crate, 3.5, 2.5, 0.12), 'crate blocks movers')
  assert.ok(!circleHitsObstacle(crate, 3.5, 2.5, 0.12, true), 'bolts fly over a crate')
})

test('generated obstacles never overlap enemy or pickup spawns', () => {
  for (let run = 0; run < 10; run++) {
    const d = generateDungeon()
    assert.ok(d.obstacles.length > 0, 'dungeon has solid props')
    for (const s of [...d.enemySpawns, ...d.pickupSpawns]) {
      if (s.type === 'boss') continue // boss spawns at room centre, kept clear
      assert.ok(!circleHitsObstacle(d.obstacles, s.x, s.y, 0.6),
        `spawn at ${s.x},${s.y} clear of props`)
    }
    assert.ok(!circleHitsObstacle(d.obstacles, d.spawnX, d.spawnY, 0.8),
      'player spawn point clear of props')
  }
})

test('archer telegraphs an aim, then fires a fast tracer bolt that hits', () => {
  const game = new Game('TEST', { solo: true })
  const p = game.addPlayer('p1')

  // stage a deadeye duel across the spawn room: archer left, player right
  const room = game.dungeon.rooms.find(r => r.spawn)
  const cy = room.y + room.h / 2 + 0.5
  const archer = game.enemies[0]
  archer.type = 'archer'
  archer.r = ENEMY_TYPES.archer.radius
  archer.hp = archer.maxHp = ENEMY_TYPES.archer.hp
  archer.x = room.x + 1.5
  archer.y = cy
  archer.aggro = true
  archer.attackCd = 0
  p.x = room.x + 7.5
  p.y = cy
  // park every other enemy far away and inert
  for (const e of game.enemies.slice(1)) { e.dead = true }

  game.tick(1 / 30)
  const aim = game.events.find(ev => ev.k === 'ewindup' && ev.w === 'aim')
  assert.ok(aim, 'aim telegraph event emitted')
  assert.equal(aim.t, 'p1', 'telegraph names the marked player')
  assert.ok(archer.windup > 0, 'archer is drawing a bead, not striking instantly')

  // hold still through the aim and the bolt flight — the shot must land
  for (let i = 0; i < 90 && p.hp === p.maxHp; i++) game.tick(1 / 30)
  assert.ok(game.events.some(ev => ev.k === 'eshoot'), 'shot fired')
  assert.equal(p.maxHp - p.hp, ENEMY_TYPES.archer.damage, 'tracer bolt damage landed')
})

test('snapshots carry live projectiles for the client to render', () => {
  const game = new Game('TEST', { solo: true })
  game.addPlayer('p1')
  game.spawnBolt(game.enemies[0], 0, 8, 10, 'w')
  const snap = game.snapshot()
  assert.equal(snap.b.length, 1)
  const b = snap.b[0]
  assert.ok(typeof b.x === 'number' && typeof b.y === 'number')
  assert.equal(b.c, 'w')
})

test('leaderboard sanitizes names and rejects bogus times', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dod-lb-'))
  const lb = await import('../server/dungeon/leaderboard.js')

  assert.equal(lb.sanitizeName('<script>alert(1)</script>'), 'scriptalert1scri') // stripped + capped at 16
  assert.equal(lb.sanitizeName('   '), 'NAMELESS HERO')
  assert.equal(lb.sanitizeName('x'.repeat(99)).length, 16)

  assert.equal(lb.submitTime('cheater', 500).ok, false, 'sub-10s times rejected')
  assert.equal(lb.submitTime('cheater', NaN).ok, false)
  assert.equal(lb.submitTime('cheater', '120000').ok, false, 'non-numeric rejected')

  const a = lb.submitTime('slow', 300_000)
  const b = lb.submitTime('fast', 60_000)
  assert.equal(a.ok, true)
  assert.equal(b.rank, 1, 'faster time ranks first')
  const top = lb.topTimes()
  assert.equal(top[0].name, 'fast')
  assert.equal(top[1].name, 'slow')
})

test('snapshot serializes and events drain', () => {
  const game = new Game('TEST', {})
  game.addPlayer('p1')
  game.tick(1 / 30)
  const snap = game.snapshot()
  assert.equal(snap.p.length, 1)
  assert.ok(Array.isArray(snap.e))
  assert.ok(snap.e.length > 0)
  assert.ok(JSON.stringify(snap).length < 20000, 'snapshot stays reasonably small')
  const snap2 = game.snapshot()
  assert.equal(snap2.ev.length, 0, 'events drained after snapshot')
})
