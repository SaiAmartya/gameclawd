// Entity manager: syncs server snapshots to meshes and drives animation.
// Mesh construction lives in models.js.

import {
  yawFromFacing, setBarFraction,
  makeHero, makeGrunt, makeBrute, makeWarlock, makeArcher, makeBoss,
  makePickup, makeBolt
} from './models.js'

const ENEMY_FACTORIES = {
  boss: makeBoss,
  brute: makeBrute,
  warlock: makeWarlock,
  archer: makeArcher,
  grunt: makeGrunt
}

export class Entities {
  constructor (scene) {
    this.scene = scene
    this.players = new Map() // id -> record
    this.enemies = new Map()
    this.pickups = new Map()
    this.bolts = new Map()   // id -> projectile group
    this.dying = []          // death animations in flight
    this.enemyDefs = new Map()
    this.time = 0
  }

  reset (enemyDefs) {
    for (const rec of this.players.values()) this.scene.remove(rec.group)
    for (const rec of this.enemies.values()) this.scene.remove(rec.group)
    for (const g of this.pickups.values()) this.scene.remove(g)
    for (const g of this.bolts.values()) this.scene.remove(g)
    for (const d of this.dying) this.scene.remove(d.group)
    this.players.clear()
    this.enemies.clear()
    this.pickups.clear()
    this.bolts.clear()
    this.dying = []
    this.enemyDefs = new Map(enemyDefs.map(d => [d.id, d]))
  }

  // states: [{id, c, x, y, f, hp, maxHp, d(ead), ds(ash), moving}]
  syncPlayers (states, selfId) {
    const present = new Set()
    for (const s of states) {
      present.add(s.id)
      let rec = this.players.get(s.id)
      if (!rec) {
        rec = makeHero(s.c, s.id === selfId)
        rec.flashT = 0
        rec.swingT = -1
        this.scene.add(rec.group)
        this.players.set(s.id, rec)
      }
      rec.group.position.set(s.x, 0, s.y)
      rec.rig.rotation.y = yawFromFacing(s.f)
      setBarFraction(rec.bar, Math.max(0, s.hp) / (s.maxHp || 100))

      // dead heroes fall over and fade
      const targetTilt = s.d ? Math.PI / 2 : 0
      rec.rig.rotation.x += (targetTilt - rec.rig.rotation.x) * 0.2
      rec.group.visible = true

      // walk cycle: bob, scissoring legs, swaying cape; dash stretch
      const stride = s.moving && !s.d ? Math.sin(this.time * 11 + s.c * 2) : 0
      rec.rig.position.y = Math.abs(stride) * 0.05
      rec.parts.legL.rotation.x = stride * 0.7
      rec.parts.legR.rotation.x = -stride * 0.7
      rec.parts.cape.rotation.x = 0.32 + Math.abs(stride) * 0.22 + Math.sin(this.time * 2.2 + s.c) * 0.04
      const stretch = s.ds ? 1.18 : 1
      rec.rig.scale.set(2 - stretch, 1, stretch)
    }
    for (const [id, rec] of this.players) {
      if (!present.has(id)) {
        this.scene.remove(rec.group)
        this.players.delete(id)
      }
    }
  }

  syncEnemies (states) {
    const present = new Set()
    for (const s of states) {
      present.add(s.id)
      let rec = this.enemies.get(s.id)
      if (!rec) {
        const def = this.enemyDefs.get(s.id) || { type: 'grunt', maxHp: 50 }
        rec = (ENEMY_FACTORIES[def.type] || makeGrunt)()
        rec.type = def.type
        rec.maxHp = def.maxHp
        rec.flashT = 0
        rec.walk = 0
        rec.phase = (parseInt(s.id.slice(1), 10) || 0) * 1.7
        this.scene.add(rec.group)
        this.enemies.set(s.id, rec)
      }
      // movement blend (from snapshot deltas) drives the walk cycle
      const moved = rec.lastX !== undefined && Math.hypot(s.x - rec.lastX, s.y - rec.lastY) > 0.004
      rec.lastX = s.x
      rec.lastY = s.y
      rec.walk += ((moved ? 1 : 0) - rec.walk) * 0.15

      rec.group.position.set(s.x, 0, s.y)
      rec.rig.rotation.y = yawFromFacing(s.f)
      setBarFraction(rec.bar, Math.max(0, s.hp) / rec.maxHp)

      const stride = Math.sin(this.time * 9 + rec.phase) * rec.walk
      if (rec.parts.legL) {
        rec.parts.legL.rotation.x = stride * 0.6
        rec.parts.legR.rotation.x = -stride * 0.6
      }
      if (rec.parts.armL) {
        rec.parts.armL.rotation.x = rec.parts.armL.userData.base - stride * 0.35
        rec.parts.armR.rotation.x = rec.parts.armR.userData.base + stride * 0.35
      }

      const idleBob = Math.sin(this.time * 6 + s.x * 3) * 0.04
      rec.rig.position.y = idleBob + Math.abs(stride) * 0.04
      if (rec.type === 'boss') {
        const pulse = 1 + Math.sin(this.time * 3) * 0.04
        rec.rig.scale.setScalar(s.ds ? 1.12 : pulse)
      } else {
        rec.rig.scale.setScalar(1)
      }
    }
    for (const [id, rec] of this.enemies) {
      if (!present.has(id)) {
        // no death event handled it (e.g. world reset) — remove quietly
        this.scene.remove(rec.group)
        this.enemies.delete(id)
      }
    }
  }

  syncPickups (list) {
    const present = new Set()
    for (const k of list) {
      present.add(k.id)
      let g = this.pickups.get(k.id)
      if (!g) {
        g = makePickup(k.type)
        g.position.set(k.x, 0, k.y)
        this.scene.add(g)
        this.pickups.set(k.id, g)
      }
    }
    for (const [id, g] of this.pickups) {
      if (!present.has(id)) {
        this.scene.remove(g)
        this.pickups.delete(id)
      }
    }
  }

  // live projectiles: [{id, x, y, a(ngle), c(olor kind)}]
  syncBolts (list) {
    const present = new Set()
    for (const b of list) {
      present.add(b.id)
      let g = this.bolts.get(b.id)
      if (!g) {
        g = makeBolt(b.c)
        this.scene.add(g)
        this.bolts.set(b.id, g)
      }
      g.position.set(b.x, 0, b.y)
      g.userData.spin.rotation.y = yawFromFacing(b.a)
      // hexbolts wobble in flight; tracers fly dead straight
      if (b.c !== 'a') g.userData.spin.position.x = Math.sin(this.time * 18 + b.x) * 0.04
    }
    for (const [id, g] of this.bolts) {
      if (!present.has(id)) {
        this.scene.remove(g)
        this.bolts.delete(id)
      }
    }
  }

  playSwing (id) {
    const rec = this.players.get(id)
    if (rec) rec.swingT = 0
  }

  // unique emissive materials of a record, with their true originals captured
  // once before any tint. (Materials are shared across meshes in a rig, so a
  // per-mesh capture would store an already-tinted colour as the "original".)
  emissiveMats (rec) {
    if (!rec.emats) {
      const set = new Set()
      rec.rig.traverse(obj => {
        if (obj.material && obj.material.emissive) set.add(obj.material)
      })
      rec.emats = [...set]
      for (const m of rec.emats) m.userData.origEmissive = m.emissive.clone()
    }
    return rec.emats
  }

  flash (id, color = 0xff2010, duration = 0.18) {
    const rec = this.players.get(id) || this.enemies.get(id)
    if (!rec) return
    rec.flashT = duration
    for (const m of this.emissiveMats(rec)) m.emissive.setHex(color)
  }

  // play a sink-and-shrink death, then dispose
  killEnemy (id) {
    const rec = this.enemies.get(id)
    if (!rec) return
    this.enemies.delete(id)
    rec.deathT = 0.6
    rec.bar.visible = false
    this.dying.push(rec)
  }

  update (dt) {
    this.time += dt

    for (const rec of [...this.players.values(), ...this.enemies.values()]) {
      if (rec.flashT > 0) {
        rec.flashT -= dt
        if (rec.flashT <= 0) {
          for (const m of this.emissiveMats(rec)) m.emissive.copy(m.userData.origEmissive)
        }
      }
    }

    // sword swings
    for (const rec of this.players.values()) {
      if (rec.swingT < 0) continue
      rec.swingT += dt
      const t = rec.swingT / 0.24
      if (t >= 1) {
        rec.swingT = -1
        rec.parts.swordPivot.rotation.set(0.55, 0, 0)
      } else {
        const ease = 1 - Math.pow(1 - t, 3)
        rec.parts.swordPivot.rotation.y = 1.4 - ease * 2.8
        rec.parts.swordPivot.rotation.x = 0.2 + Math.sin(t * Math.PI) * 0.4
      }
    }

    // pickups idle animation
    for (const g of this.pickups.values()) {
      const spin = g.userData.spin
      spin.rotation.y += dt * 2.4
      spin.position.y = 0.45 + Math.sin(this.time * 3 + g.position.x) * 0.08
    }

    // death animations
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const rec = this.dying[i]
      rec.deathT -= dt
      const t = Math.max(0, rec.deathT / 0.6)
      rec.rig.scale.set(1 + (1 - t) * 0.3, t * t, 1 + (1 - t) * 0.3)
      rec.rig.rotation.y += dt * 6
      if (rec.deathT <= 0) {
        this.scene.remove(rec.group)
        this.dying.splice(i, 1)
      }
    }
  }
}
