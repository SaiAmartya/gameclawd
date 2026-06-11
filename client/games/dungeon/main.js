// Dungeon of Doom — client entry point.
// Owns the menu flow, socket traffic, self-prediction, interpolation
// of remote entities, and the render loop.

import { World } from './game3d/scene.js'
import { Entities } from './game3d/entities.js'
import { Effects } from './game3d/effects.js'
import { Input } from './input.js'
import { Hud } from './hud.js'
import { audio } from './audio.js'
import { PLAYER, moveCircle } from '/shared/sim.js'
import { boltColor } from './game3d/models.js'

const $ = (id) => document.getElementById(id)
const socket = io()

const world = new World($('game-root'))
const entities = new Entities(world.scene)
const effects = new Effects(world.scene)
const hud = new Hud()

const state = {
  phase: 'menu',
  selfId: null,
  code: null,
  solo: false,
  dungeon: null,
  snaps: [],     // { rt: receive time, s: snapshot }
  latest: null,
  over: false,
  bossId: null,
  bossMaxHp: 1,
  aims: [],      // live sniper telegraphs: { eid, pid, until }
  self: { x: 0, y: 0, facing: -Math.PI / 2, dashLeft: 0, dashCd: 0, attackCd: 0, dead: false }
}

const INTERP_DELAY = 110

// ---- input ----

const input = new Input({
  onAttack: () => {
    if (state.phase !== 'playing' || state.over || state.self.dead) return
    if (state.self.attackCd > 0) return
    state.self.attackCd = PLAYER.ATTACK_COOLDOWN
    socket.emit('attack')
    entities.playSwing(state.selfId)
    effects.swingArc(state.self.x, state.self.y, state.self.facing)
    audio.swing()
  },
  onDash: () => {
    if (state.phase !== 'playing' || state.over || state.self.dead) return
    if (state.self.dashCd > 0) return
    state.self.dashCd = PLAYER.DASH_COOLDOWN
    state.self.dashLeft = PLAYER.DASH_DURATION
    socket.emit('dash')
    audio.dash()
  },
  onMute: () => hud.toast(audio.toggleMute() ? 'Sound muted' : 'Sound on'),
  onMusic: () => hud.toast(toggleMusic() ? 'Music on' : 'Music off')
})

// ---- background music toggle (persisted) ----

const musicWanted = () => localStorage.getItem('dod-music') !== 'off'

function updateMusicLabel () {
  $('btn-music').innerHTML = '&#9835; Music: ' + (musicWanted() ? 'On' : 'Off')
}

// Toggles the *preference*, then makes reality match. (Autoplay rules mean
// music may not actually start until a click/keypress like this one.)
function toggleMusic () {
  const want = !musicWanted()
  localStorage.setItem('dod-music', want ? 'on' : 'off')
  want ? audio.startMusic() : audio.stopMusic()
  updateMusicLabel()
  return want
}

$('btn-music').addEventListener('click', toggleMusic)
updateMusicLabel()

// ---- menu wiring ----

function setMenuError (msg) {
  $('menu-error').textContent = msg || ''
}

$('btn-solo').addEventListener('click', () => {
  socket.emit('createGame', { solo: true }, handleEnterGame)
})
$('btn-host').addEventListener('click', () => {
  socket.emit('createGame', { solo: false }, (resp) => {
    handleEnterGame(resp)
    if (resp.ok) hud.toast(`Share code ${resp.init.code} with a friend!`)
  })
})
$('btn-join').addEventListener('click', joinGame)
$('join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinGame()
})

function joinGame () {
  const code = $('join-code').value.trim().toUpperCase()
  if (code.length !== 4) return setMenuError('Codes are 4 characters.')
  socket.emit('joinGame', { code }, handleEnterGame)
}

function handleEnterGame (resp) {
  if (!resp || !resp.ok) return setMenuError(resp?.error || 'Could not reach the dungeon.')
  setMenuError('')
  state.selfId = resp.selfId
  audio.ensure() // user gesture: unlock audio
  if (musicWanted()) audio.startMusic() // no-op if already playing
  setupWorld(resp.init)
}

function setupWorld (init) {
  state.dungeon = init.dungeon
  state.code = init.code
  state.solo = init.solo
  state.snaps = []
  state.latest = null
  state.over = false
  state.aims = []
  $('score-submit').classList.add('hidden')

  const me = init.players.find(p => p.id === state.selfId) || init.players[0]
  state.self.x = me ? me.x : init.dungeon.spawnX
  state.self.y = me ? me.y : init.dungeon.spawnY
  state.self.facing = -Math.PI / 2
  state.self.dead = false
  state.self.dashLeft = 0
  state.self.dashCd = 0
  state.self.attackCd = 0

  const bossDef = init.enemies.find(e => e.type === 'boss')
  state.bossId = bossDef ? bossDef.id : null
  state.bossMaxHp = bossDef ? bossDef.maxHp : 1

  world.build(init.dungeon)
  entities.reset(init.enemies)
  hud.reset(init.dungeon, init.code, init.solo)
  hud.hideOverlay()

  $('menu').classList.add('hidden')
  input.setEnabled(true)
  state.phase = 'playing'
}

function backToMenu () {
  socket.emit('leaveGame')
  state.phase = 'menu'
  input.setEnabled(false)
  hud.hide()
  $('menu').classList.remove('hidden')
  refreshLeaderboard()
}

$('btn-restart').addEventListener('click', () => socket.emit('restart'))
$('btn-menu').addEventListener('click', backToMenu)

// ---- global leaderboard (fastest solo clears) ----

function formatMs (ms) {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

async function refreshLeaderboard () {
  try {
    const resp = await fetch('/api/dungeon/leaderboard')
    const data = await resp.json()
    renderLeaderboard(data.top || [])
  } catch { /* dungeon unreachable — keep whatever is shown */ }
}

function renderLeaderboard (top) {
  const list = $('lb-list')
  list.innerHTML = ''
  if (!top.length) {
    const li = document.createElement('li')
    li.className = 'lb-empty'
    li.textContent = 'No clears yet — be the first!'
    list.appendChild(li)
    return
  }
  for (const entry of top) {
    const li = document.createElement('li')
    const name = document.createElement('span')
    name.className = 'lb-name'
    name.textContent = entry.name // textContent — names are also sanitized server-side
    const time = document.createElement('span')
    time.className = 'lb-time'
    time.textContent = formatMs(entry.ms)
    li.append(name, time)
    list.appendChild(li)
  }
}

$('score-name').addEventListener('keydown', (e) => {
  e.stopPropagation() // typing a name must not trigger game hotkeys
  if (e.key === 'Enter') $('btn-submit-score').click()
})

$('btn-submit-score').addEventListener('click', () => {
  const name = $('score-name').value.trim()
  if (!name) return hud.toast('Etch a name first, hero.')
  localStorage.setItem('dod-name', name)
  socket.emit('submitScore', { name }, (resp) => {
    if (!resp || !resp.ok) return hud.toast(resp?.error || 'The board rejects you.')
    $('score-submit').classList.add('hidden')
    hud.toast(resp.rank
      ? `Etched into legend — rank #${resp.rank}!`
      : 'A worthy clear, but not among the ten fastest.')
    if (resp.top) renderLeaderboard(resp.top)
  })
})

refreshLeaderboard()

// ---- socket events ----

socket.on('snap', (s) => {
  if (state.phase !== 'playing') return
  state.snaps.push({ rt: performance.now(), s })
  if (state.snaps.length > 40) state.snaps.shift()
  state.latest = s
  for (const ev of s.ev) handleEvent(ev, s)
})

socket.on('worldReset', (init) => {
  if (state.phase !== 'playing') return
  setupWorld(init)
  hud.toast('A new dungeon rises from the depths...')
})

socket.on('rosterUpdate', () => {})

socket.on('disconnect', () => {
  if (state.phase !== 'playing') return
  hud.toast('Lost connection to the dungeon...')
})

function findSnapPlayer (s, id) {
  return s.p.find(p => p.id === id)
}

function handleEvent (ev, s) {
  switch (ev.k) {
    case 'swing': {
      if (ev.id === state.selfId) break // already played locally
      entities.playSwing(ev.id)
      const p = findSnapPlayer(s, ev.id)
      if (p) effects.swingArc(p.x, p.y, ev.f)
      audio.swing()
      break
    }
    case 'dash':
      if (ev.id !== state.selfId) audio.dash()
      break
    case 'ehit':
      entities.flash(ev.id)
      effects.damageNumber(ev.x, ev.y, ev.dmg)
      audio.hit()
      break
    case 'ewindup':
      // telegraph: the enemy glows before striking — your cue to dash away
      if (ev.w === 'aim') {
        // deadeye draws a bead: crimson glow + a tracking laser-sight beam
        entities.flash(ev.id, 0xff4040, 0.9)
        state.aims = state.aims.filter(a => a.eid !== ev.id)
        state.aims.push({ eid: ev.id, pid: ev.t, until: performance.now() + 950 })
        if (ev.t === state.selfId) audio.aim()
      } else if (ev.w === 'cast') {
        entities.flash(ev.id, 0x9b4dff, 0.5)
      } else {
        entities.flash(ev.id, 0xffc83e, 0.35)
      }
      break
    case 'eswing':
      audio.swing()
      break
    case 'ecast':
      // hexbolt leaves the staff
      state.aims = state.aims.filter(a => a.eid !== ev.id)
      effects.muzzle(ev.x, ev.y, 0xb44dff)
      audio.cast()
      break
    case 'eshoot':
      // deadeye looses its tracer
      state.aims = state.aims.filter(a => a.eid !== ev.id)
      effects.muzzle(ev.x, ev.y, 0xffe9a0)
      audio.arrow()
      break
    case 'boltbreak':
      effects.sparks(ev.x, ev.y, boltColor(ev.c))
      audio.shatter()
      break
    case 'bossvolley':
      audio.cast()
      world.addShake(0.18)
      break
    case 'phit': {
      entities.flash(ev.id)
      if (ev.id === state.selfId) {
        hud.damageFlash()
        world.addShake(0.22)
        audio.hurt()
      }
      break
    }
    case 'edeath': {
      state.aims = state.aims.filter(a => a.eid !== ev.id)
      entities.killEnemy(ev.id)
      effects.ring(ev.x, ev.y, 0xff7040, ev.type === 'boss' ? 3 : 1.2)
      audio.enemyDeath()
      if (ev.type === 'boss') world.addShake(0.55)
      break
    }
    case 'pdeath':
      audio.playerDeath()
      if (ev.id !== state.selfId) hud.toast('Your ally has fallen!')
      break
    case 'respawn':
      if (ev.id === state.selfId) hud.setRespawn(null)
      else hud.toast('Your ally rises again!')
      audio.heal()
      break
    case 'pickup': {
      effects.ring(ev.x, ev.y, ev.type === 'heart' ? 0x52e07a : 0xe8b54d, 0.8)
      if (ev.id === state.selfId) ev.type === 'heart' ? audio.heal() : audio.coin()
      break
    }
    case 'bossdash':
      audio.bossRoar()
      world.addShake(0.3)
      break
    case 'victory': {
      state.over = true
      audio.victory()
      const me = state.latest ? findSnapPlayer(state.latest, state.selfId) : null
      const secs = Math.round((ev.time || 0) / 1000)
      hud.showOverlay('victory',
        `The Dungeon Overlord is slain.<br>` +
        `Time: ${Math.floor(secs / 60)}m ${secs % 60}s &nbsp;&middot;&nbsp; ` +
        `Gold: ${me ? me.co : 0} &nbsp;&middot;&nbsp; Kills: ${me ? me.ki : 0}`)
      // solo clears can be etched onto the global leaderboard
      if (state.solo) {
        $('score-name').value = localStorage.getItem('dod-name') || ''
        $('score-submit').classList.remove('hidden')
      }
      break
    }
    case 'gameover': {
      state.over = true
      audio.gameover()
      const me = state.latest ? findSnapPlayer(state.latest, state.selfId) : null
      hud.showOverlay('death',
        `The dungeon claims another soul.<br>` +
        `Gold: ${me ? me.co : 0} &nbsp;&middot;&nbsp; Kills: ${me ? me.ki : 0}`)
      break
    }
    case 'join':
      if (ev.id !== state.selfId) { hud.toast('A hero has entered the dungeon!'); audio.join() }
      break
    case 'leave':
      hud.toast('Your ally has left the dungeon.')
      break
  }
}

// ---- interpolation ----

const lerp = (a, b, t) => a + (b - a) * t
function lerpAngle (a, b, t) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

function interpolate (renderT) {
  const snaps = state.snaps
  if (!snaps.length) return null
  let i1 = snaps.length - 1
  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].rt >= renderT) { i1 = i; break }
  }
  const s1 = snaps[i1]
  const s0 = snaps[Math.max(0, i1 - 1)]
  const span = s1.rt - s0.rt
  const t = span > 0 ? Math.min(1, Math.max(0, (renderT - s0.rt) / span)) : 1

  const players = s1.s.p.map(p1 => {
    const p0 = findSnapPlayer(s0.s, p1.id) || p1
    return {
      ...p1,
      x: lerp(p0.x, p1.x, t),
      y: lerp(p0.y, p1.y, t),
      f: lerpAngle(p0.f, p1.f, t),
      moving: Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.015
    }
  })
  const enemies = s1.s.e.map(e1 => {
    const e0 = s0.s.e.find(e => e.id === e1.id) || e1
    return {
      ...e1,
      x: lerp(e0.x, e1.x, t),
      y: lerp(e0.y, e1.y, t),
      f: lerpAngle(e0.f, e1.f, t)
    }
  })
  const bolts = (s1.s.b || []).map(b1 => {
    const b0 = (s0.s.b || []).find(b => b.id === b1.id) || b1
    return { ...b1, x: lerp(b0.x, b1.x, t), y: lerp(b0.y, b1.y, t) }
  })
  return { players, enemies, bolts, pickups: s1.s.k }
}

// ---- input sending & self-prediction ----

let lastSent = { mx: 0, my: 0 }
let lastSentAt = 0

function predictSelf (dt, now) {
  const self = state.self
  const me = state.latest ? findSnapPlayer(state.latest, state.selfId) : null
  self.dead = me ? !!me.d : false
  self.attackCd = Math.max(0, self.attackCd - dt)
  self.dashCd = Math.max(0, self.dashCd - dt)
  self.dashLeft = Math.max(0, self.dashLeft - dt)

  if (self.dead || state.over) {
    if (me) { self.x = me.x; self.y = me.y }
    if (lastSent.mx !== 0 || lastSent.my !== 0) {
      lastSent = { mx: 0, my: 0 }
      socket.emit('input', lastSent)
    }
    return
  }

  const { mx, my } = input.getMove()
  if (Math.abs(mx - lastSent.mx) > 0.01 || Math.abs(my - lastSent.my) > 0.01 ||
      ((mx !== 0 || my !== 0) && now - lastSentAt > 120)) {
    lastSent = { mx, my }
    lastSentAt = now
    socket.emit('input', lastSent)
  }

  const speed = PLAYER.SPEED * (self.dashLeft > 0 ? PLAYER.DASH_SPEED_MULT : 1)
  if (mx !== 0 || my !== 0) {
    self.facing = Math.atan2(my, mx)
    const moved = moveCircle(state.dungeon.grid, self.x, self.y, PLAYER.RADIUS,
      mx * speed * dt, my * speed * dt, state.dungeon.obstacles)
    self.x = moved.x
    self.y = moved.y
  }

  // soft reconciliation toward the authoritative position
  if (me) {
    const ex = me.x - self.x
    const ey = me.y - self.y
    const err = Math.hypot(ex, ey)
    if (err > 2.5) {
      self.x = me.x
      self.y = me.y
    } else if (err > 0.01) {
      const k = Math.min(1, (mx !== 0 || my !== 0 ? 1.5 : 6) * dt)
      self.x += ex * k
      self.y += ey * k
    }
  }
}

// ---- main loop ----

let lastT = performance.now()

function frame (now) {
  const dt = Math.min(0.05, (now - lastT) / 1000)
  lastT = now

  if (state.phase === 'playing' && state.dungeon) {
    predictSelf(dt, now)

    const interp = interpolate(now - INTERP_DELAY)
    if (interp) {
      const moving = lastSent.mx !== 0 || lastSent.my !== 0
      const playerStates = interp.players.map(p => p.id === state.selfId
        ? { ...p, x: state.self.x, y: state.self.y, f: state.self.facing, maxHp: 100, moving }
        : { ...p, maxHp: 100 })
      entities.syncPlayers(playerStates, state.selfId)
      entities.syncEnemies(interp.enemies)
      entities.syncBolts(interp.bolts)
      entities.syncPickups(interp.pickups)

      // sniper laser-sights: track live from the shooter to its mark
      state.aims = state.aims.filter(a => {
        const shooter = entities.enemies.get(a.eid)
        const markPos = a.pid === state.selfId
          ? state.self
          : interp.players.find(p => p.id === a.pid)
        if (performance.now() > a.until || !shooter || !markPos) {
          effects.clearBeam(a.eid)
          return false
        }
        effects.setBeam(a.eid, shooter.group.position.x, shooter.group.position.z,
          markPos.x, markPos.y)
        return true
      })

      // HUD vitals from authoritative state
      const me = findSnapPlayer(state.latest, state.selfId)
      if (me) {
        hud.setVitals({
          hp: me.hp,
          maxHp: 100,
          coins: me.co,
          kills: me.ki || 0,
          dashFrac: 1 - state.self.dashCd / PLAYER.DASH_COOLDOWN
        })
        if (me.d && !state.over && !state.solo) hud.setRespawn(me.rt)
        else hud.setRespawn(null)
      }

      // boss bar + minimap
      const boss = state.latest.e.find(e => e.id === state.bossId)
      const bossRoom = state.dungeon.rooms.find(r => r.boss)
      const selfRoomIdx = hud.roomAt(state.self.x, state.self.y)
      hud.markVisited(state.self.x, state.self.y)
      const bossVisible = boss && bossRoom &&
        (selfRoomIdx === bossRoom.i || boss.hp < state.bossMaxHp)
      hud.setBoss(bossVisible ? boss.hp / state.bossMaxHp : null)
      hud.drawMinimap({
        self: state.self,
        allies: interp.players.filter(p => p.id !== state.selfId && !p.d),
        bossAlive: !!boss,
        bossPos: boss ? { x: boss.x, y: boss.y } : null
      })
    }

    entities.update(dt)
    effects.update(dt)
    world.update(dt, { x: state.self.x, y: state.self.y })
  } else {
    // idle menu backdrop: keep rendering with a slow camera drift
    world.update(dt, { x: world.cameraTarget.x, y: world.cameraTarget.z })
  }

  world.render()
}

function rafLoop (now) {
  frame(now)
  requestAnimationFrame(rafLoop)
}
requestAnimationFrame(rafLoop)

// Browsers pause requestAnimationFrame in hidden/occluded windows; keep the
// game logic ticking at a low rate so a backgrounded co-op partner stays in
// sync instead of lurching when they tab back in.
setInterval(() => {
  if (performance.now() - lastT > 250) frame(performance.now())
}, 100)

// debug handle for E2E tests & troubleshooting
window.DOD = { state, input, socket, world, entities, effects, audio }
