// Procedural dungeon generation.
//
// The dungeon lives on a square tile grid. Rooms are placed on a coarse
// cell grid via a random walk (guaranteeing connectivity), then carved
// into the tile grid and joined with L-shaped corridors. The room with
// the greatest graph distance from spawn becomes the boss room.

const CELLS = 4        // coarse cell grid is CELLS x CELLS
const CELL_T = 16      // tiles per cell
const GRID = CELLS * CELL_T

const randInt = (n) => Math.floor(Math.random() * n)

export function generateDungeon (roomCount = 8) {
  // --- 1. place rooms on the cell grid with a random walk ---
  const placed = new Map() // "cx,cy" -> room index
  const rooms = []         // { cx, cy, x, y, w, h, d, boss, spawn }
  const edges = []         // pairs of room indices

  const key = (cx, cy) => cx + ',' + cy
  const addRoom = (cx, cy) => {
    placed.set(key(cx, cy), rooms.length)
    rooms.push({ cx, cy, x: 0, y: 0, w: 0, h: 0, d: 0, boss: false, spawn: false })
    return rooms.length - 1
  }

  addRoom(randInt(CELLS), CELLS - 1) // spawn on the bottom row
  let guard = 0
  while (rooms.length < roomCount && guard++ < 1000) {
    const from = rooms[randInt(rooms.length)]
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => Math.random() - 0.5)
    for (const [dx, dy] of dirs) {
      const cx = from.cx + dx
      const cy = from.cy + dy
      if (cx < 0 || cy < 0 || cx >= CELLS || cy >= CELLS) continue
      if (placed.has(key(cx, cy))) continue
      const idx = addRoom(cx, cy)
      edges.push([placed.get(key(from.cx, from.cy)), idx])
      break
    }
  }

  // --- 2. BFS graph distance from spawn; farthest room is the boss room ---
  const adj = rooms.map(() => [])
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a) }
  const distQ = [0]
  const seen = new Set([0])
  rooms[0].d = 0
  while (distQ.length) {
    const cur = distQ.shift()
    for (const nb of adj[cur]) {
      if (seen.has(nb)) continue
      seen.add(nb)
      rooms[nb].d = rooms[cur].d + 1
      distQ.push(nb)
    }
  }
  let bossIdx = 0
  for (let i = 1; i < rooms.length; i++) {
    if (rooms[i].d > rooms[bossIdx].d) bossIdx = i
  }
  rooms[0].spawn = true
  rooms[bossIdx].boss = true

  // --- 3. size each room and carve into the tile grid ---
  const grid = Array.from({ length: GRID }, () => new Array(GRID).fill('#'))

  for (const room of rooms) {
    const w = room.boss ? 13 : 9 + randInt(5)   // 9-13 tiles wide
    const h = room.boss ? 11 : 7 + randInt(4)   // 7-10 tiles tall
    room.w = w
    room.h = h
    room.x = room.cx * CELL_T + 1 + randInt(CELL_T - w - 2)
    room.y = room.cy * CELL_T + 1 + randInt(CELL_T - h - 2)
    for (let ty = room.y; ty < room.y + h; ty++) {
      for (let tx = room.x; tx < room.x + w; tx++) {
        grid[ty][tx] = '.'
      }
    }
  }

  const carve = (tx, ty) => {
    if (tx < 1 || ty < 1 || tx >= GRID - 1 || ty >= GRID - 1) return
    if (grid[ty][tx] === '#') grid[ty][tx] = ','
  }

  // --- 4. carve 2-wide L corridors between connected rooms ---
  for (const [a, b] of edges) {
    const ra = rooms[a]
    const rb = rooms[b]
    const ax = Math.floor(ra.x + ra.w / 2)
    const ay = Math.floor(ra.y + ra.h / 2)
    const bx = Math.floor(rb.x + rb.w / 2)
    const by = Math.floor(rb.y + rb.h / 2)
    for (let tx = Math.min(ax, bx); tx <= Math.max(ax, bx); tx++) {
      carve(tx, ay); carve(tx, ay + 1)
    }
    for (let ty = Math.min(ay, by); ty <= Math.max(ay, by); ty++) {
      carve(bx, ty); carve(bx + 1, ty)
    }
  }

  // --- 5. torches along room walls ---
  const torches = []
  for (const room of rooms) {
    const inset = [
      [room.x + 1, room.y + 1],
      [room.x + room.w - 2, room.y + 1],
      [room.x + 1, room.y + room.h - 2],
      [room.x + room.w - 2, room.y + room.h - 2]
    ]
    for (const [tx, ty] of inset) torches.push({ x: tx + 0.5, y: ty + 0.5 })
  }

  // --- 6. solid prop obstacles (authoritative — players collide with these) ---
  // {x, y, r, tall, kind}. tall props also block projectiles; low crates and
  // barrels are chest-height cover you can shoot a sniper bolt over.
  const obstacles = []

  // stone pillars in the corners of every large room
  for (const room of rooms) {
    if (room.w < 7 || room.h < 7) continue
    const corners = [
      [room.x + 1.6, room.y + 1.6], [room.x + room.w - 1.6, room.y + 1.6],
      [room.x + 1.6, room.y + room.h - 1.6], [room.x + room.w - 1.6, room.y + room.h - 1.6]
    ]
    for (const [px, py] of corners) {
      obstacles.push({ x: px, y: py, r: 0.3, tall: true, kind: 'pillar' })
    }
  }

  // supply cluster in the spawn room (kept off the corner pillars)
  const spawnR = rooms[0]
  const sx = spawnR.x + spawnR.w / 2 - 2
  const sy = spawnR.y + 1.3
  obstacles.push(
    { x: sx, y: sy, r: 0.38, tall: false, kind: 'crate' },
    { x: sx + 0.75, y: sy + 0.2, r: 0.28, tall: false, kind: 'crateSmall' },
    { x: sx + 0.25, y: sy + 0.85, r: 0.3, tall: false, kind: 'barrel' }
  )

  // scattered cover crates in combat rooms — duck behind these when a
  // Deadeye draws a bead on you
  for (const room of rooms) {
    if (room.spawn || room.boss || Math.random() > 0.55) continue
    const n = 1 + randInt(2)
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 10; tries++) {
        const x = room.x + 1.8 + Math.random() * (room.w - 3.6)
        const y = room.y + 1.8 + Math.random() * (room.h - 3.6)
        const cx = room.x + room.w / 2
        const cy = room.y + room.h / 2
        if ((x - cx) ** 2 + (y - cy) ** 2 < 2.2 ** 2) continue
        if (obstacles.some(o => (x - o.x) ** 2 + (y - o.y) ** 2 < (o.r + 1.1) ** 2)) continue
        obstacles.push({
          x, y, r: 0.36, tall: false, kind: Math.random() < 0.6 ? 'crate' : 'barrel'
        })
        break
      }
    }
  }

  // --- 7. spawn points for enemies and pickups (clear of obstacles) ---
  const enemySpawns = []
  const pickupSpawns = []
  const clearOf = (x, y, r) =>
    obstacles.every(o => (x - o.x) ** 2 + (y - o.y) ** 2 > (o.r + r) ** 2)
  const floorTileIn = (room) => {
    for (let tries = 0; tries < 14; tries++) {
      const x = room.x + 1 + randInt(room.w - 2) + 0.5
      const y = room.y + 1 + randInt(room.h - 2) + 0.5
      if (clearOf(x, y, 0.8)) return { x, y }
    }
    return { x: room.x + room.w / 2, y: room.y + room.h / 2 }
  }

  for (const room of rooms) {
    if (room.spawn) continue
    if (room.boss) {
      enemySpawns.push({ type: 'boss', x: room.x + room.w / 2, y: room.y + room.h / 2, room })
      enemySpawns.push({ type: 'grunt', ...floorTileIn(room) })
      enemySpawns.push({ type: 'warlock', ...floorTileIn(room) })
      enemySpawns.push({ type: 'archer', ...floorTileIn(room) })
      continue
    }
    const count = Math.min(2 + room.d, 4)
    for (let i = 0; i < count; i++) {
      const roll = Math.random()
      let type = 'grunt'
      if (room.d >= 2 && roll < 0.25) type = 'brute'
      else if (room.d >= 2 && roll < 0.45) type = 'archer'
      else if (room.d >= 1 && roll < 0.7) type = 'warlock'
      enemySpawns.push({ type, ...floorTileIn(room) })
    }
    if (Math.random() < 0.55) pickupSpawns.push({ type: 'heart', ...floorTileIn(room) })
    if (Math.random() < 0.6) pickupSpawns.push({ type: 'coin', ...floorTileIn(room) })
  }

  const spawnRoom = rooms[0]
  return {
    size: GRID,
    grid: grid.map(row => row.join('')),
    rooms: rooms.map((r, i) => ({
      i, x: r.x, y: r.y, w: r.w, h: r.h, d: r.d, boss: r.boss, spawn: r.spawn
    })),
    edges,
    torches,
    obstacles,
    spawnX: spawnRoom.x + spawnRoom.w / 2,
    spawnY: spawnRoom.y + spawnRoom.h / 2,
    enemySpawns,
    pickupSpawns
  }
}

// Which room (index) contains this position, or -1
export function roomAt (rooms, x, y) {
  for (const r of rooms) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.i
  }
  return -1
}
