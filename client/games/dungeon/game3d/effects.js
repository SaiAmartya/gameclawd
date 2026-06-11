// Visual juice: damage numbers, swing arcs, hit rings.

import * as THREE from 'three'

const ARC = 1.15 // matches PLAYER.ATTACK_ARC

function makeNumberSprite () {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 64
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(1.25, 0.62, 1)
  sprite.visible = false
  sprite.userData = { canvas, texture, life: 0 }
  return sprite
}

export class Effects {
  constructor (scene) {
    this.scene = scene
    this.numbers = []
    for (let i = 0; i < 14; i++) {
      const s = makeNumberSprite()
      scene.add(s)
      this.numbers.push(s)
    }
    this.transients = [] // { mesh, life, maxLife, grow }
    this.beams = new Map() // key -> { mesh, mat, lastSeen }
    this.time = 0
  }

  // ---- aim beams (sniper telegraphs) ----
  // Call setBeam every frame while an enemy is drawing a bead; stale beams
  // are swept automatically so a dropped event can't leave one stuck on.
  setBeam (key, x1, z1, x2, z2, color = 0xff4040) {
    let beam = this.beams.get(key)
    if (!beam) {
      const mat = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 1), mat)
      this.scene.add(mesh)
      beam = { mesh, mat, lastSeen: this.time }
      this.beams.set(key, beam)
    }
    beam.lastSeen = this.time
    const from = new THREE.Vector3(x1, 0.95, z1)
    const to = new THREE.Vector3(x2, 0.8, z2)
    const len = from.distanceTo(to)
    beam.mesh.position.copy(from).add(to).multiplyScalar(0.5)
    beam.mesh.scale.z = Math.max(0.001, len)
    beam.mesh.lookAt(to)
    // pulse harder as the shot gets closer — pure menace
    beam.mat.opacity = 0.35 + Math.sin(this.time * 26) * 0.2
  }

  clearBeam (key) {
    const beam = this.beams.get(key)
    if (!beam) return
    this.scene.remove(beam.mesh)
    beam.mesh.geometry.dispose()
    beam.mat.dispose()
    this.beams.delete(key)
  }

  // quick additive pop at a cast/shot origin
  muzzle (x, z, color = 0xb44dff, y = 0.9) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 8, 8),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false
      })
    )
    mesh.position.set(x, y, z)
    mesh.userData.targetScale = 2.4
    mesh.userData.uniformGrow = true
    this.scene.add(mesh)
    this.transients.push({ mesh, life: 0.14, maxLife: 0.14, grow: 1 })
  }

  // shower of shards where a bolt broke against a wall or pillar
  sparks (x, z, color = 0xffc06a) {
    for (let i = 0; i < 5; i++) {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.05, 0.05),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0.9,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      )
      const a = Math.random() * Math.PI * 2
      mesh.position.set(x, 0.7 + Math.random() * 0.4, z)
      mesh.userData.vel = new THREE.Vector3(Math.cos(a) * 2.2, 1.5 + Math.random() * 2, Math.sin(a) * 2.2)
      this.scene.add(mesh)
      this.transients.push({ mesh, life: 0.3, maxLife: 0.3, grow: 0, fly: 1 })
    }
  }

  damageNumber (x, z, amount, color = '#ffe9a8') {
    const sprite = this.numbers.find(s => !s.visible) || this.numbers[0]
    const { canvas, texture } = sprite.userData
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '700 42px "IBM Plex Mono", monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.lineWidth = 7
    ctx.strokeStyle = 'rgba(0,0,0,0.85)'
    ctx.strokeText(String(amount), 64, 32)
    ctx.fillStyle = color
    ctx.fillText(String(amount), 64, 32)
    texture.needsUpdate = true
    sprite.position.set(x + (Math.random() - 0.5) * 0.3, 1.6, z)
    sprite.material.opacity = 1
    sprite.visible = true
    sprite.userData.life = 0.75
  }

  swingArc (x, z, facing, color = 0xffd9a0) {
    const geo = new THREE.RingGeometry(0.55, 1.95, 22, 1, -facing - ARC, ARC * 2)
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.85, z)
    this.scene.add(mesh)
    this.transients.push({ mesh, life: 0.18, maxLife: 0.18, grow: 0 })
  }

  ring (x, z, color = 0xffffff, size = 1) {
    const geo = new THREE.RingGeometry(0.25, 0.4, 20)
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
    })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0.12, z)
    mesh.userData.targetScale = 2.6 * size
    this.scene.add(mesh)
    this.transients.push({ mesh, life: 0.35, maxLife: 0.35, grow: 1 })
  }

  update (dt) {
    this.time += dt

    // sweep beams that stopped being refreshed (shot fired or aim broken)
    for (const [key, beam] of this.beams) {
      if (this.time - beam.lastSeen > 0.12) this.clearBeam(key)
    }

    for (const sprite of this.numbers) {
      if (!sprite.visible) continue
      sprite.userData.life -= dt
      sprite.position.y += dt * 1.1
      sprite.material.opacity = Math.min(1, sprite.userData.life / 0.3)
      if (sprite.userData.life <= 0) sprite.visible = false
    }

    for (let i = this.transients.length - 1; i >= 0; i--) {
      const t = this.transients[i]
      t.life -= dt
      const f = Math.max(0, t.life / t.maxLife)
      t.mesh.material.opacity = f * 0.8
      if (t.grow) {
        const s = 1 + (1 - f) * t.mesh.userData.targetScale
        t.mesh.scale.set(s, s, t.mesh.userData.uniformGrow ? s : 1)
      }
      if (t.fly) {
        const v = t.mesh.userData.vel
        v.y -= 9 * dt
        t.mesh.position.addScaledVector(v, dt)
      }
      if (t.life <= 0) {
        this.scene.remove(t.mesh)
        t.mesh.geometry.dispose()
        t.mesh.material.dispose()
        this.transients.splice(i, 1)
      }
    }
  }
}
