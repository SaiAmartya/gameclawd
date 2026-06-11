// Shared simulation code — used by the server (authoritative) and the
// client (prediction). Must stay dependency-free and deterministic.

export const TICK_RATE = 30

// All distances are in tile units (1 tile = 1 world unit = 1 meter in 3D).
export const PLAYER = {
  RADIUS: 0.32,
  SPEED: 5.2,
  MAX_HP: 100,
  ATTACK_DAMAGE: 26,
  ATTACK_RANGE: 2.0,
  ATTACK_ARC: 1.15, // radians off facing, each side
  ATTACK_COOLDOWN: 0.45,
  DASH_SPEED_MULT: 2.8,
  DASH_DURATION: 0.18,
  DASH_COOLDOWN: 1.6,
  RESPAWN_TIME: 6,
  RESPAWN_HP: 60
}

export const ENEMY_TYPES = {
  grunt: { radius: 0.38, speed: 2.9, hp: 52, damage: 8, attackRate: 0.55, aggro: 7.5 },
  brute: { radius: 0.55, speed: 2.2, hp: 120, damage: 15, attackRate: 0.8, aggro: 7.5 },
  // skirmisher: holds a casting band and lobs dodgeable hexbolts
  warlock: { radius: 0.34, speed: 2.7, hp: 44, damage: 11, attackRate: 1.4, aggro: 10,
             boltSpeed: 7.5, keepMin: 3.5, keepMax: 7.5 },
  // sniper: tracks a player with an aim-beam from across the room, then
  // fires a fast tracer bolt. Counterplay: break LOS behind cover or rush it.
  archer: { radius: 0.32, speed: 2.5, hp: 38, damage: 16, attackRate: 1.7, aggro: 14,
            boltSpeed: 16, range: 13, keepMin: 5.5, keepMax: 11, aimTime: 0.9 },
  boss:  { radius: 0.95, speed: 2.5, hp: 380, damage: 22, attackRate: 0.65, aggro: 10,
           dashSpeed: 9.5, dashDuration: 0.55, dashInterval: 6,
           slamRadius: 2.3, slamDamage: 24, boltSpeed: 8.5, boltDamage: 12 }
}

export const PICKUPS = {
  heart: { radius: 0.45, heal: 35 },
  coin:  { radius: 0.45 }
}

// grid: array of strings, '#' = solid, anything else = floor
export function isSolid (grid, tx, ty) {
  if (ty < 0 || ty >= grid.length || tx < 0 || tx >= grid[0].length) return true
  return grid[ty][tx] === '#'
}

// Circle-vs-tilemap overlap test
export function circleHitsWall (grid, x, y, r) {
  const minTx = Math.floor(x - r)
  const maxTx = Math.floor(x + r)
  const minTy = Math.floor(y - r)
  const maxTy = Math.floor(y + r)
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!isSolid(grid, tx, ty)) continue
      // closest point on tile AABB to circle centre
      const cx = Math.max(tx, Math.min(x, tx + 1))
      const cy = Math.max(ty, Math.min(y, ty + 1))
      const dx = x - cx
      const dy = y - cy
      if (dx * dx + dy * dy < r * r) return true
    }
  }
  return false
}

// Circle-vs-prop-obstacle overlap test. Obstacles are solid set dressing
// (pillars, crates, barrels): {x, y, r, tall}. tallOnly skips low props —
// projectiles fly over a crate but shatter against a pillar.
export function circleHitsObstacle (obstacles, x, y, r, tallOnly = false) {
  if (!obstacles) return false
  for (const o of obstacles) {
    if (tallOnly && !o.tall) continue
    const dx = x - o.x
    const dy = y - o.y
    const rr = r + o.r
    if (dx * dx + dy * dy < rr * rr) return true
  }
  return false
}

function blockedAt (grid, x, y, r, obstacles) {
  return circleHitsWall(grid, x, y, r) || circleHitsObstacle(obstacles, x, y, r)
}

// Move a circle through the tilemap (and prop obstacles), resolving each axis
// independently so the mover slides along walls instead of sticking to them.
export function moveCircle (grid, x, y, r, dx, dy, obstacles) {
  // large deltas always sub-step: a thin obstacle (pillar) fits between the
  // start and end points, so an endpoint-only check would tunnel through it
  if (dx !== 0) {
    let nx = x + dx
    if (Math.abs(dx) > 0.25 || blockedAt(grid, nx, y, r, obstacles)) {
      const step = Math.sign(dx) * 0.05
      nx = x
      while (Math.abs(nx + step - x) <= Math.abs(dx) && !blockedAt(grid, nx + step, y, r, obstacles)) {
        nx += step
      }
    }
    x = nx
  }
  if (dy !== 0) {
    let ny = y + dy
    if (Math.abs(dy) > 0.25 || blockedAt(grid, x, ny, r, obstacles)) {
      const step = Math.sign(dy) * 0.05
      ny = y
      while (Math.abs(ny + step - y) <= Math.abs(dy) && !blockedAt(grid, x, ny + step, r, obstacles)) {
        ny += step
      }
    }
    y = ny
  }
  return { x, y }
}

export function dist (ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  return Math.sqrt(dx * dx + dy * dy)
}

// Smallest absolute difference between two angles
export function angleDiff (a, b) {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return Math.abs(d)
}
