// Authoritative game simulation. One Game instance per lobby.

import { generateDungeon, roomAt } from './dungeon.js'
import {
  PLAYER, ENEMY_TYPES, PICKUPS,
  moveCircle, dist, angleDiff, isSolid, circleHitsWall, circleHitsObstacle
} from '../../shared/sim.js'

const MAX_PLAYERS = 2

export class Game {
  constructor (code, { solo = false } = {}) {
    this.code = code
    this.solo = solo
    this.maxPlayers = solo ? 1 : MAX_PLAYERS
    this.players = new Map() // socketId -> player state
    this.events = []         // drained into each snapshot
    this.nextEnemyId = 0
    this.nextPickupId = 0
    this.nextBoltId = 0
    this.generateWorld()
  }

  generateWorld () {
    this.dungeon = generateDungeon()
    this.over = false
    this.victory = false
    this.startedAt = Date.now()
    this.victoryMs = null      // server-measured solo clear time (leaderboard)
    this.scoreSubmitted = false

    this.bolts = [] // live projectiles: {id, x, y, vx, vy, dmg, c, life}

    this.enemies = this.dungeon.enemySpawns.map((spawn, i) => {
      const def = ENEMY_TYPES[spawn.type]
      return {
        id: 'e' + (this.nextEnemyId++),
        type: spawn.type,
        x: spawn.x,
        y: spawn.y,
        facing: Math.PI / 2,
        r: def.radius,
        hp: def.hp,
        maxHp: def.hp,
        aggro: false,
        attackCd: 0,
        windup: 0,
        windupTarget: null,
        windupKind: null,
        strafeDir: i % 2 ? 1 : -1,
        volleyCd: 2.5,
        enraged: false,
        dashLeft: 0,
        dashTimer: def.dashInterval || 0,
        dead: false
      }
    })

    this.pickups = this.dungeon.pickupSpawns.map(spawn => ({
      id: 'k' + (this.nextPickupId++),
      type: spawn.type,
      x: spawn.x,
      y: spawn.y
    }))
  }

  // ---- lobby ----

  addPlayer (id) {
    const idx = this.players.size
    const player = {
      id,
      color: idx,
      x: this.dungeon.spawnX + (idx === 0 ? -0.6 : 0.6),
      y: this.dungeon.spawnY,
      facing: -Math.PI / 2,
      mx: 0,
      my: 0,
      hp: PLAYER.MAX_HP,
      maxHp: PLAYER.MAX_HP,
      coins: 0,
      kills: 0,
      attackCd: 0,
      dashCd: 0,
      dashLeft: 0,
      dead: false,
      respawnT: 0,
      windupLockT: 0 // global incoming-attack pacing (anti-swarm-melt)
    }
    this.players.set(id, player)
    this.events.push({ k: 'join', id })
    return player
  }

  removePlayer (id) {
    if (!this.players.delete(id)) return
    this.events.push({ k: 'leave', id })
    // if everyone left behind is dead, the run is over (prevents a dead
    // player waiting forever on a respawn that requires a living partner)
    const remaining = [...this.players.values()]
    if (remaining.length && !remaining.some(p => !p.dead) && !this.over) {
      this.over = true
      this.events.push({ k: 'gameover' })
    }
  }

  reset () {
    this.nextEnemyId = 0
    this.nextPickupId = 0
    this.events = []
    this.generateWorld()
    let idx = 0
    for (const p of this.players.values()) {
      p.x = this.dungeon.spawnX + (idx === 0 ? -0.6 : 0.6)
      p.y = this.dungeon.spawnY
      p.hp = PLAYER.MAX_HP
      p.coins = 0
      p.kills = 0
      p.dead = false
      p.respawnT = 0
      p.attackCd = 0
      p.dashCd = 0
      p.dashLeft = 0
      idx++
    }
  }

  // ---- input ----

  handleInput (id, { mx, my }) {
    const p = this.players.get(id)
    if (!p || p.dead) return
    mx = Number(mx) || 0
    my = Number(my) || 0
    const len = Math.hypot(mx, my)
    if (len > 1) { mx /= len; my /= len }
    p.mx = mx
    p.my = my
    if (len > 0.05) p.facing = Math.atan2(my, mx)
  }

  handleAttack (id) {
    const p = this.players.get(id)
    if (!p || p.dead || this.over) return
    if (p.attackCd > 0) return
    p.attackCd = PLAYER.ATTACK_COOLDOWN
    this.events.push({ k: 'swing', id, f: p.facing })

    for (const e of this.enemies) {
      if (e.dead) continue
      const d = dist(p.x, p.y, e.x, e.y) - e.r
      if (d > PLAYER.ATTACK_RANGE) continue
      const ang = Math.atan2(e.y - p.y, e.x - p.x)
      if (angleDiff(ang, p.facing) > PLAYER.ATTACK_ARC) continue
      this.damageEnemy(e, PLAYER.ATTACK_DAMAGE, p)
      // minor knockback (bosses stand their ground) — small enough that an
      // enemy stays in striking reach, so attack-spam can't keep it away
      if (e.type !== 'boss' && !e.dead) {
        const kb = 0.3
        const moved = moveCircle(this.dungeon.grid, e.x, e.y, e.r,
          Math.cos(ang) * kb, Math.sin(ang) * kb, this.dungeon.obstacles)
        e.x = moved.x
        e.y = moved.y
      }
    }
  }

  handleDash (id) {
    const p = this.players.get(id)
    if (!p || p.dead || this.over) return
    if (p.dashCd > 0) return
    p.dashCd = PLAYER.DASH_COOLDOWN
    p.dashLeft = PLAYER.DASH_DURATION
    this.events.push({ k: 'dash', id })
  }

  // ---- simulation ----

  damageEnemy (enemy, amount, source) {
    enemy.hp -= amount
    enemy.aggro = true
    // no hit-stun: enemies keep winding up and attacking through damage,
    // so standing still and trading blows is a real cost, not an exploit
    this.events.push({ k: 'ehit', id: enemy.id, dmg: amount, x: enemy.x, y: enemy.y })
    if (enemy.hp > 0) return

    enemy.dead = true
    if (source) source.kills++
    this.events.push({ k: 'edeath', id: enemy.id, x: enemy.x, y: enemy.y, type: enemy.type })

    // loot
    const drops = enemy.type === 'boss' ? 5 : 1
    for (let i = 0; i < drops; i++) {
      this.pickups.push({
        id: 'k' + (this.nextPickupId++),
        type: 'coin',
        x: enemy.x + (Math.random() - 0.5) * 1.2,
        y: enemy.y + (Math.random() - 0.5) * 1.2
      })
    }
    if (enemy.type !== 'boss' && Math.random() < 0.3) {
      this.pickups.push({ id: 'k' + (this.nextPickupId++), type: 'heart', x: enemy.x, y: enemy.y })
    }

    if (enemy.type === 'boss' && !this.victory) {
      this.victory = true
      this.over = true
      this.victoryMs = Date.now() - this.startedAt
      this.events.push({ k: 'victory', time: this.victoryMs })
    }
  }

  damagePlayer (p, amount) {
    if (p.dead || p.dashLeft > 0) return // dash grants i-frames
    p.hp = Math.max(0, p.hp - amount)
    this.events.push({ k: 'phit', id: p.id, dmg: amount })
    if (p.hp > 0) return

    p.dead = true
    p.mx = 0
    p.my = 0
    p.respawnT = PLAYER.RESPAWN_TIME
    this.events.push({ k: 'pdeath', id: p.id })

    const anyAlive = [...this.players.values()].some(pl => !pl.dead)
    if (!anyAlive && !this.over) {
      this.over = true
      this.events.push({ k: 'gameover' })
    }
  }

  // straight-line visibility through the tilemap (sampled)
  hasLOS (x1, y1, x2, y2) {
    const d = dist(x1, y1, x2, y2)
    const steps = Math.ceil(d / 0.3)
    for (let i = 1; i < steps; i++) {
      const t = i / steps
      if (isSolid(this.dungeon.grid, Math.floor(x1 + (x2 - x1) * t), Math.floor(y1 + (y2 - y1) * t))) {
        return false
      }
    }
    return true
  }

  spawnBolt (e, angle, speed, dmg, c) {
    this.bolts.push({
      id: 'b' + (this.nextBoltId++),
      x: e.x + Math.cos(angle) * (e.r + 0.25),
      y: e.y + Math.sin(angle) * (e.r + 0.25),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      dmg,
      c,
      life: 3
    })
  }

  // a windup has finished — deliver whatever attack was telegraphed
  resolveWindup (e) {
    const def = ENEMY_TYPES[e.type]
    const kind = e.windupKind || 'melee'
    e.windupKind = null
    const victim = this.players.get(e.windupTarget)

    if (kind === 'melee') {
      const reach = e.r + PLAYER.RADIUS + 0.45
      this.events.push({ k: 'eswing', id: e.id })
      if (victim && !victim.dead && dist(e.x, e.y, victim.x, victim.y) < reach) {
        this.damagePlayer(victim, def.damage)
      }
    } else if (kind === 'cast') {
      this.events.push({ k: 'ecast', id: e.id, x: e.x, y: e.y })
      if (victim && !victim.dead) {
        const a = Math.atan2(victim.y - e.y, victim.x - e.x)
        this.spawnBolt(e, a, def.boltSpeed, def.damage, 'w')
      }
    } else if (kind === 'snipe') {
      this.events.push({ k: 'eshoot', id: e.id, x: e.x, y: e.y })
      if (victim && !victim.dead) {
        const a = Math.atan2(victim.y - e.y, victim.x - e.x)
        this.spawnBolt(e, a, def.boltSpeed, def.damage, 'a')
      }
    } else if (kind === 'slam') {
      this.events.push({ k: 'bossslam', x: e.x, y: e.y, r: def.slamRadius })
      for (const p of this.players.values()) {
        if (p.dead) continue
        if (dist(e.x, e.y, p.x, p.y) < def.slamRadius + PLAYER.RADIUS) {
          this.damagePlayer(p, def.slamDamage)
        }
      }
    } else if (kind === 'volley') {
      this.events.push({ k: 'bossvolley', id: e.id })
      if (victim && !victim.dead) {
        const n = e.enraged ? 5 : 3
        const base = Math.atan2(victim.y - e.y, victim.x - e.x)
        for (let i = 0; i < n; i++) {
          this.spawnBolt(e, base + (i - (n - 1) / 2) * 0.28, def.boltSpeed, def.boltDamage, 'b')
        }
      }
    }
  }

  tick (dt) {
    const grid = this.dungeon.grid
    const obs = this.dungeon.obstacles
    const alivePlayers = [...this.players.values()].filter(p => !p.dead)

    // players
    for (const p of this.players.values()) {
      p.attackCd = Math.max(0, p.attackCd - dt)
      p.dashCd = Math.max(0, p.dashCd - dt)
      p.dashLeft = Math.max(0, p.dashLeft - dt)
      p.windupLockT = Math.max(0, p.windupLockT - dt)

      if (p.dead) {
        // respawn only while the run is still live (co-op carry)
        if (!this.over && this.players.size > 1) {
          p.respawnT -= dt
          if (p.respawnT <= 0) {
            p.dead = false
            p.hp = PLAYER.RESPAWN_HP
            p.x = this.dungeon.spawnX
            p.y = this.dungeon.spawnY
            this.events.push({ k: 'respawn', id: p.id })
          }
        }
        continue
      }

      const speed = PLAYER.SPEED * (p.dashLeft > 0 ? PLAYER.DASH_SPEED_MULT : 1)
      if (p.mx !== 0 || p.my !== 0) {
        const moved = moveCircle(grid, p.x, p.y, PLAYER.RADIUS, p.mx * speed * dt, p.my * speed * dt, obs)
        p.x = moved.x
        p.y = moved.y
      }
    }

    // enemies
    for (const e of this.enemies) {
      if (e.dead || this.over) continue
      const def = ENEMY_TYPES[e.type]
      e.attackCd = Math.max(0, e.attackCd - dt)

      // find nearest living player
      let target = null
      let best = Infinity
      for (const p of alivePlayers) {
        const d = dist(e.x, e.y, p.x, p.y)
        if (d < best) { best = d; target = p }
      }
      if (!target) continue
      if (best < def.aggro) e.aggro = true
      if (!e.aggro) continue

      // mid-windup: hold position, then deliver the telegraphed attack
      if (e.windup > 0) {
        e.windup -= dt
        if (e.windup <= 0) this.resolveWindup(e)
        continue
      }

      const ang = Math.atan2(target.y - e.y, target.x - e.x)
      e.facing = ang
      const contact = e.r + PLAYER.RADIUS + 0.1

      if (e.type === 'warlock' || e.type === 'archer') {
        // skirmishers hold a preferred band — retreat if pressed, advance if
        // out of range or sight, otherwise strafe around the target. The
        // archer backpedals hard when rushed: its weakness is melee range.
        const los = this.hasLOS(e.x, e.y, target.x, target.y)
        let mx = 0
        let my = 0
        let mult = 1
        if (!los || best > def.keepMax) { mx = Math.cos(ang); my = Math.sin(ang) }
        else if (best < def.keepMin) {
          mx = -Math.cos(ang)
          my = -Math.sin(ang)
          if (e.type === 'archer') mult = 1.35
        } else { mx = -Math.sin(ang) * 0.6 * e.strafeDir; my = Math.cos(ang) * 0.6 * e.strafeDir }
        const step = def.speed * mult * dt
        const moved = moveCircle(grid, e.x, e.y, e.r, mx * step, my * step, obs)
        if (Math.abs(moved.x - e.x) + Math.abs(moved.y - e.y) < step * 0.2) e.strafeDir *= -1
        e.x = moved.x
        e.y = moved.y
      } else {
        // boss dash ability
        let speed = def.speed
        if (e.type === 'boss') {
          e.dashTimer -= dt
          if (e.dashLeft > 0) {
            e.dashLeft -= dt
            speed = def.dashSpeed
          } else if (e.dashTimer <= 0 && best > 2.5) {
            e.dashLeft = def.dashDuration
            e.dashTimer = def.dashInterval
            this.events.push({ k: 'bossdash', id: e.id })
          }
        }
        // chase
        if (best > contact) {
          const step = Math.min(speed * dt, best - contact)
          const moved = moveCircle(grid, e.x, e.y, e.r, Math.cos(ang) * step, Math.sin(ang) * step, obs)
          e.x = moved.x
          e.y = moved.y
        }
      }

      // separation from other enemies
      for (const other of this.enemies) {
        if (other === e || other.dead) continue
        const d = dist(e.x, e.y, other.x, other.y)
        const min = e.r + other.r
        if (d > 0.001 && d < min) {
          const push = (min - d) * 0.5
          const px = (e.x - other.x) / d * push
          const py = (e.y - other.y) / d * push
          const moved = moveCircle(grid, e.x, e.y, e.r, px, py, obs)
          e.x = moved.x
          e.y = moved.y
        }
      }

      // ---- attack initiation ----
      const dNow = dist(e.x, e.y, target.x, target.y)

      if (e.type === 'warlock') {
        // ranged casts bypass the melee pacing lock — bolts are dodgeable
        if (e.attackCd <= 0 && dNow < def.keepMax + 1 &&
            this.hasLOS(e.x, e.y, target.x, target.y)) {
          e.attackCd = def.attackRate
          e.windup = 0.5
          e.windupKind = 'cast'
          e.windupTarget = target.id
          this.events.push({ k: 'ewindup', id: e.id, w: 'cast' })
        }
      } else if (e.type === 'archer') {
        // long-range snipe: a tracked aim-beam telegraph, then a fast tracer
        // bolt. Won't fire with a player breathing down its neck — rush it.
        if (e.attackCd <= 0 && dNow > 1.6 && dNow < def.range &&
            this.hasLOS(e.x, e.y, target.x, target.y)) {
          e.attackCd = def.attackRate
          e.windup = def.aimTime
          e.windupKind = 'snipe'
          e.windupTarget = target.id
          this.events.push({ k: 'ewindup', id: e.id, w: 'aim', t: target.id })
        }
      } else if (e.type === 'boss') {
        // enrage at half health: faster attacks, denser volleys
        if (!e.enraged && e.hp <= e.maxHp / 2) {
          e.enraged = true
          this.events.push({ k: 'bossphase' })
        }
        e.volleyCd = Math.max(0, e.volleyCd - dt)
        if (e.attackCd <= 0 && dNow < contact + 0.4) {
          // ground slam: AoE around the boss — walk out or dash through it
          if (target.windupLockT > 0) {
            e.attackCd = 0.2
          } else {
            target.windupLockT = 0.35
            e.attackCd = e.enraged ? def.attackRate * 0.7 : def.attackRate
            e.windup = 0.45
            e.windupKind = 'slam'
            e.windupTarget = target.id
            this.events.push({ k: 'ewindup', id: e.id, w: 'slam' })
          }
        } else if (e.volleyCd <= 0 && dNow > 2 && dNow < 11 &&
                   this.hasLOS(e.x, e.y, target.x, target.y)) {
          e.volleyCd = e.enraged ? 2.2 : 3.5
          e.windup = 0.5
          e.windupKind = 'volley'
          e.windupTarget = target.id
          this.events.push({ k: 'ewindup', id: e.id, w: 'volley' })
        }
      } else {
        // melee on contact. Incoming attacks on one player are rate-limited
        // (windupLockT), so a surrounding pack lands a readable rhythm of
        // strikes instead of bursting the player down.
        if (e.attackCd <= 0 && dNow < contact + 0.25) {
          if (target.windupLockT > 0) {
            e.attackCd = 0.2 // circle and wait for an opening
          } else {
            target.windupLockT = 0.5
            e.attackCd = def.attackRate
            e.windup = 0.3
            e.windupKind = 'melee'
            e.windupTarget = target.id
            this.events.push({ k: 'ewindup', id: e.id })
          }
        }
      }
    }

    // projectiles: fly until they hit a wall, a player, or expire.
    // Dashing players phase straight through (i-frames).
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]
      b.life -= dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      let gone = b.life <= 0
      if (!gone && (circleHitsWall(grid, b.x, b.y, 0.12) ||
                    circleHitsObstacle(obs, b.x, b.y, 0.12, true))) {
        gone = true
        this.events.push({ k: 'boltbreak', x: b.x, y: b.y, c: b.c })
      }
      if (!gone) {
        for (const p of alivePlayers) {
          if (p.dead || p.dashLeft > 0) continue
          if (dist(b.x, b.y, p.x, p.y) < PLAYER.RADIUS + 0.16) {
            this.damagePlayer(p, b.dmg)
            gone = true
            break
          }
        }
      }
      if (gone) this.bolts.splice(i, 1)
    }

    // pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i]
      for (const p of alivePlayers) {
        if (dist(k.x, k.y, p.x, p.y) > PICKUPS[k.type].radius + PLAYER.RADIUS) continue
        if (k.type === 'heart') {
          if (p.hp >= p.maxHp) continue // leave it for later
          p.hp = Math.min(p.maxHp, p.hp + PICKUPS.heart.heal)
        } else if (k.type === 'coin') {
          p.coins++
        }
        this.events.push({ k: 'pickup', id: p.id, type: k.type, x: k.x, y: k.y })
        this.pickups.splice(i, 1)
        break
      }
    }
  }

  // ---- serialization ----

  initPayload () {
    return {
      code: this.code,
      solo: this.solo,
      maxPlayers: this.maxPlayers,
      dungeon: {
        size: this.dungeon.size,
        grid: this.dungeon.grid,
        rooms: this.dungeon.rooms,
        edges: this.dungeon.edges,
        torches: this.dungeon.torches,
        obstacles: this.dungeon.obstacles,
        spawnX: this.dungeon.spawnX,
        spawnY: this.dungeon.spawnY
      },
      enemies: this.enemies.map(e => ({
        id: e.id, type: e.type, x: e.x, y: e.y, maxHp: e.maxHp
      })),
      players: this.roster()
    }
  }

  roster () {
    return [...this.players.values()].map(p => ({
      id: p.id, color: p.color, x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp
    }))
  }

  snapshot () {
    const snap = {
      t: Date.now(),
      p: [...this.players.values()].map(p => ({
        id: p.id,
        c: p.color,
        x: Math.round(p.x * 100) / 100,
        y: Math.round(p.y * 100) / 100,
        f: Math.round(p.facing * 100) / 100,
        hp: p.hp,
        co: p.coins,
        ki: p.kills,
        d: p.dead ? 1 : 0,
        ds: p.dashLeft > 0 ? 1 : 0,
        rt: p.dead ? Math.ceil(p.respawnT) : 0
      })),
      e: this.enemies.filter(e => !e.dead).map(e => ({
        id: e.id,
        x: Math.round(e.x * 100) / 100,
        y: Math.round(e.y * 100) / 100,
        f: Math.round(e.facing * 100) / 100,
        hp: e.hp,
        ds: e.dashLeft > 0 ? 1 : 0
      })),
      b: this.bolts.map(b => ({
        id: b.id,
        x: Math.round(b.x * 100) / 100,
        y: Math.round(b.y * 100) / 100,
        a: Math.round(Math.atan2(b.vy, b.vx) * 100) / 100,
        c: b.c
      })),
      k: this.pickups,
      ev: this.events
    }
    this.events = []
    return snap
  }
}

export { roomAt }
