// Mesh factories: heroes, monsters, the boss and pickups.
// Everything is built from primitives — no external assets.

import * as THREE from 'three'

const HERO_COLORS = [0x41b6ff, 0xff9d3e, 0x7dff8a, 0xff6bd5]
const CAMERA_PITCH = Math.atan2(7.6, 5.9) // must match scene camera offset

export const yawFromFacing = (f) => Math.atan2(Math.cos(f), Math.sin(f))

function circleShadow (radius) {
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 18),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, depthWrite: false })
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.02
  return mesh
}

function healthBar (width) {
  const group = new THREE.Group()
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.09),
    new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.85, depthWrite: false })
  )
  const fg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.07),
    new THREE.MeshBasicMaterial({ color: 0xd8453f, transparent: true, depthWrite: false })
  )
  // both are transparent so they sort by renderOrder: fill always over back
  bg.renderOrder = 10
  fg.renderOrder = 11
  fg.position.z = 0.01
  group.add(bg, fg)
  group.rotation.x = -CAMERA_PITCH
  group.userData = { fg, width }
  group.visible = false
  return group
}

export function setBarFraction (bar, frac) {
  const { fg, width } = bar.userData
  fg.scale.x = Math.max(0.001, frac)
  fg.position.x = -width * (1 - frac) / 2
  bar.visible = frac < 0.999
}

// a hanging arm on a shoulder pivot; rotation.x = userData.base + swing
function armPivot (x, y, z, base) {
  const pivot = new THREE.Group()
  pivot.position.set(x, y, z)
  pivot.rotation.x = base
  pivot.userData.base = base
  return pivot
}

// ---- heroes ----

// a proper low-poly knight: animated legs, cuirass, pauldrons, cape,
// visored helm with a plume, a round shield and a real sword
export function makeHero (colorIdx, isSelf) {
  const color = HERO_COLORS[colorIdx % HERO_COLORS.length]
  const group = new THREE.Group()
  const rig = new THREE.Group()
  group.add(rig)

  const armorMat = new THREE.MeshStandardMaterial({ color: 0xaeb8c6, roughness: 0.34, metalness: 0.75 })
  const mailMat = new THREE.MeshStandardMaterial({ color: 0x49505c, roughness: 0.55, metalness: 0.55 })
  const clothMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 })
  const capeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.72), roughness: 0.85, side: THREE.DoubleSide
  })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xc9a04e, roughness: 0.35, metalness: 0.7 })
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x4a3826, roughness: 0.85 })

  // legs swing from hip pivots while running
  const mkLeg = (side) => {
    const hip = new THREE.Group()
    hip.position.set(side * 0.14, 0.46, 0)
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.44, 0.17), mailMat)
    thigh.position.y = -0.22
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.26), leatherMat)
    boot.position.set(0, -0.42, 0.04)
    hip.add(thigh, boot)
    rig.add(hip)
    return hip
  }
  const legL = mkLeg(-1)
  const legR = mkLeg(1)

  // tunic skirt, cuirass, gold collar, belt with buckle, chest emblem
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.33, 0.26, 8), clothMat)
  skirt.position.y = 0.56
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.29, 0.48, 8), armorMat)
  torso.position.y = 0.88
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.1, 8), trimMat)
  collar.position.y = 1.13
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 8), leatherMat)
  belt.position.y = 0.67
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), trimMat)
  buckle.position.set(0, 0.67, 0.29)
  const emblem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), trimMat)
  emblem.position.set(0, 0.95, 0.26)
  emblem.scale.z = 0.4
  rig.add(skirt, torso, collar, belt, buckle, emblem)

  // pauldrons
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 10, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), armorMat)
    pad.position.set(side * 0.29, 1.06, 0)
    pad.rotation.z = -side * 0.35
    rig.add(pad)
  }

  // cape (sways with the walk cycle) — angled out so the steep camera sees
  // it foreshortened behind the shoulders instead of covering the back
  const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.62), capeMat)
  cape.position.set(0, 0.88, -0.24)
  cape.rotation.x = 0.32
  rig.add(cape)

  // helm: dome, brim, visor slit, coloured plume
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), armorMat)
  helm.position.y = 1.34
  helm.scale.y = 1.15
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.23, 0.06, 12), mailMat)
  brim.position.y = 1.26
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.055, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x101216, roughness: 0.4 })
  )
  visor.position.set(0, 1.34, 0.17)
  const plume = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.34, 6), clothMat)
  plume.position.y = 1.62
  plume.rotation.x = -0.12
  rig.add(helm, brim, visor, plume)

  // round shield on the left arm
  const shield = new THREE.Group()
  shield.position.set(-0.36, 0.9, 0.1)
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 14), clothMat)
  face.rotation.x = Math.PI / 2
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.028, 8, 18), trimMat)
  const bossKnob = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), trimMat)
  bossKnob.position.z = 0.05
  shield.add(face, rim, bossKnob)
  shield.rotation.y = -0.45
  rig.add(shield)

  // sword arm on a shoulder pivot, blade pointing forward (+z)
  const swordPivot = new THREE.Group()
  swordPivot.position.set(0.34, 0.98, 0.05)
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.3), mailMat)
  arm.position.z = 0.12
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6), leatherMat)
  grip.rotation.x = Math.PI / 2
  grip.position.z = 0.3
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), trimMat)
  pommel.position.z = 0.21
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 0.05), trimMat)
  guard.position.z = 0.4
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xdde4ee, roughness: 0.22, metalness: 0.85, emissive: 0x232a36 })
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.035, 0.62), bladeMat)
  blade.position.z = 0.73
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.12, 4), bladeMat)
  tip.rotation.x = Math.PI / 2
  tip.position.z = 1.1
  swordPivot.add(arm, grip, pommel, guard, blade, tip)
  swordPivot.rotation.x = 0.55
  rig.add(swordPivot)

  group.add(circleShadow(0.4))
  if (isSelf) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42, 0.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xe8b54d, transparent: true, opacity: 0.55, depthWrite: false })
    )
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.03
    group.add(ring)
  }
  const bar = healthBar(0.9)
  bar.position.y = 1.95
  group.add(bar)

  return { group, rig, parts: { swordPivot, legL, legR, cape }, bar }
}

// ---- monsters ----

// goblin raider: hunched, big ears, yellow eyes, a crude cleaver
export function makeGrunt () {
  const group = new THREE.Group()
  const rig = new THREE.Group()
  group.add(rig)

  const skinMat = new THREE.MeshStandardMaterial({ color: 0x973028, roughness: 0.75 })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x5e1c17, roughness: 0.85 })
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x44331f, roughness: 0.9 })
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x767c85, roughness: 0.45, metalness: 0.6 })
  const hornMat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.7 })
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xe7ddc4, roughness: 0.6 })

  // stubby legs on hip pivots
  const mkLeg = (side) => {
    const hip = new THREE.Group()
    hip.position.set(side * 0.13, 0.34, 0)
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.26, 0.13), darkMat)
    leg.position.y = -0.13
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.08, 0.19), leatherMat)
    foot.position.set(0, -0.25, 0.03)
    hip.add(leg, foot)
    rig.add(hip)
    return hip
  }
  const legL = mkLeg(-1)
  const legR = mkLeg(1)

  // hunched body with a ragged loincloth and a chest strap
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), skinMat)
  body.position.set(0, 0.56, 0.02)
  body.scale.set(1, 0.95, 0.85)
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.16, 8), leatherMat)
  cloth.position.y = 0.38
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.45, 0.04), leatherMat)
  strap.position.set(-0.08, 0.6, 0.26)
  strap.rotation.z = 0.55
  rig.add(body, cloth, strap)

  // head: long ears, stub horns, glowing eyes, underbite teeth
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8), skinMat)
  head.position.set(0, 0.92, 0.08)
  head.scale.y = 0.9
  rig.add(head)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd23e })
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), skinMat)
    ear.position.set(side * 0.21, 0.99, 0.04)
    ear.rotation.z = -side * 1.25
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 5), hornMat)
    horn.position.set(side * 0.09, 1.07, 0.05)
    horn.rotation.z = -side * 0.35
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeMat)
    eye.position.set(side * 0.08, 0.94, 0.24)
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 4), boneMat)
    tooth.position.set(side * 0.06, 0.82, 0.23)
    rig.add(ear, horn, eye, tooth)
  }

  // arms: left claw reaching, right holds a crude cleaver
  const armL = armPivot(-0.27, 0.62, 0.05, 0.5)
  const clawL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.3), skinMat)
  clawL.position.z = 0.14
  armL.add(clawL)
  const armR = armPivot(0.27, 0.62, 0.05, 0.2)
  const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.26), skinMat)
  armMesh.position.z = 0.12
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.18, 5), leatherMat)
  handle.position.set(0, 0.02, 0.28)
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.24, 0.17), ironMat)
  blade.position.set(0, 0.2, 0.3)
  blade.rotation.x = -0.1
  armR.add(armMesh, handle, blade)
  rig.add(armL, armR)

  group.add(circleShadow(0.42))
  const bar = healthBar(0.8)
  bar.position.y = 1.35
  group.add(bar)
  return { group, rig, parts: { legL, legR, armL, armR }, bar }
}

// hooded cultist: layered robes, glowing violet eyes under the cowl, and a
// gnarled staff crowned with a floating hex-orb
export function makeWarlock () {
  const group = new THREE.Group()
  const rig = new THREE.Group()
  group.add(rig)

  const robeMat = new THREE.MeshStandardMaterial({ color: 0x2c1b3e, roughness: 0.85, flatShading: true })
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x4d2f6b, roughness: 0.7 })
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x8a7340, roughness: 0.9 })
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x33241a, roughness: 0.9 })
  const orbMat = new THREE.MeshStandardMaterial({
    color: 0xb44dff, emissive: 0x7a1fd6, emissiveIntensity: 1.4, roughness: 0.2
  })

  // flowing robe (no legs — the hem sways instead)
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.5, 9), robeMat)
  hem.position.y = 0.25
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.31, 0.62, 9), robeMat)
  body.position.y = 0.78
  const rope = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.025, 6, 12), ropeMat)
  rope.rotation.x = Math.PI / 2
  rope.position.y = 0.62
  const mantle = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.31, 0.18, 9), trimMat)
  mantle.position.y = 1.08
  rig.add(hem, body, rope, mantle)

  // cowl with a shadowed face and burning eyes
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), robeMat)
  hood.position.set(0, 1.26, 0)
  hood.scale.set(1, 1.15, 1.05)
  const peak = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.3, 8), robeMat)
  peak.position.set(0, 1.5, -0.04)
  peak.rotation.x = 0.25
  const face = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x0a0612, roughness: 1 })
  )
  face.position.set(0, 1.25, 0.08)
  rig.add(hood, peak, face)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc46bff })
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), eyeMat)
    eye.position.set(side * 0.06, 1.27, 0.2)
    rig.add(eye)
  }

  // left claw reaches forward; right arm raises the staff
  const armL = armPivot(-0.24, 0.98, 0.04, 0.55)
  const sleeveL = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 7), robeMat)
  sleeveL.rotation.x = Math.PI / 2
  sleeveL.position.z = 0.18
  armL.add(sleeveL)
  const armR = armPivot(0.26, 0.98, 0.04, 0.25)
  const sleeveR = sleeveL.clone()
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.035, 1.25, 6), woodMat)
  staff.position.set(0.04, 0.1, 0.34)
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), orbMat)
  orb.position.set(0.04, 0.78, 0.34)
  const orbGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 8, 8),
    new THREE.MeshBasicMaterial({
      color: 0xb44dff, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  )
  orbGlow.position.copy(orb.position)
  armR.add(sleeveR, staff, orb, orbGlow)
  rig.add(armL, armR)

  group.add(circleShadow(0.4))
  const bar = healthBar(0.8)
  bar.position.y = 1.85
  group.add(bar)
  return { group, rig, parts: { armL, armR }, bar }
}

// skeletal deadeye: a bone sniper in a tattered cloak with a single burning
// crimson eye and a heavy arbalest held at the shoulder
export function makeArcher () {
  const group = new THREE.Group()
  const rig = new THREE.Group()
  group.add(rig)

  const boneMat = new THREE.MeshStandardMaterial({ color: 0xd9d2bd, roughness: 0.65 })
  const darkBoneMat = new THREE.MeshStandardMaterial({ color: 0xa89f88, roughness: 0.75 })
  const clothMat = new THREE.MeshStandardMaterial({
    color: 0x2a3038, roughness: 0.95, side: THREE.DoubleSide
  })
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x3e2c1c, roughness: 0.85 })
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x6d737d, roughness: 0.4, metalness: 0.65 })

  // bone legs on hip pivots
  const mkLeg = (side) => {
    const hip = new THREE.Group()
    hip.position.set(side * 0.11, 0.42, 0)
    const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.34, 6), boneMat)
    femur.position.y = -0.17
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), boneMat)
    knee.position.y = -0.34
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.16), darkBoneMat)
    foot.position.set(0, -0.4, 0.03)
    hip.add(femur, knee, foot)
    rig.add(hip)
    return hip
  }
  const legL = mkLeg(-1)
  const legR = mkLeg(1)

  // pelvis, spine and ribcage
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.14), boneMat)
  pelvis.position.y = 0.46
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 6), darkBoneMat)
  spine.position.y = 0.68
  rig.add(pelvis, spine)
  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(0.13 - i * 0.015, 0.02, 6, 10), boneMat)
    rib.rotation.x = Math.PI / 2
    rib.position.y = 0.82 - i * 0.09
    rib.scale.z = 1.25
    rig.add(rib)
  }

  // tattered cloak hanging from the shoulders
  const cloak = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.62, 1, 3), clothMat)
  cloak.position.set(0, 0.68, -0.14)
  cloak.rotation.x = 0.18
  rig.add(cloak)

  // skull: cranium, jaw, one burning crimson eye
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), boneMat)
  skull.position.set(0, 1.06, 0.02)
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.1), darkBoneMat)
  jaw.position.set(0, 0.97, 0.06)
  const socket = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 1 })
  )
  socket.position.set(-0.05, 1.08, 0.13)
  const deadeye = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff4040 })
  )
  deadeye.position.set(0.055, 1.08, 0.12)
  const hoodBack = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8, 0, Math.PI * 2, 0, Math.PI / 1.6), clothMat)
  hoodBack.position.set(0, 1.08, -0.03)
  hoodBack.rotation.x = -0.4
  rig.add(skull, jaw, socket, deadeye, hoodBack)

  // quiver of bolts on the back
  const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.34, 7), woodMat)
  quiver.position.set(-0.16, 0.78, -0.16)
  quiver.rotation.z = 0.4
  rig.add(quiver)
  for (let i = 0; i < 3; i++) {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 4), boneMat)
    shaft.position.set(-0.21 + i * 0.045, 0.98 + (i % 2) * 0.03, -0.16)
    shaft.rotation.z = 0.4
    rig.add(shaft)
  }

  // arms shoulder the arbalest: stock, bow limbs, string and a loaded bolt
  const armL = armPivot(-0.2, 0.88, 0.05, 0.85)
  const boneArmL = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.3, 5), boneMat)
  boneArmL.rotation.x = Math.PI / 2
  boneArmL.position.z = 0.14
  armL.add(boneArmL)
  const armR = armPivot(0.2, 0.88, 0.05, 0.6)
  const boneArmR = boneArmL.clone()
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.62), woodMat)
  stock.position.set(-0.1, 0.02, 0.4)
  const limbs = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.035, 0.05), ironMat)
  limbs.position.set(-0.1, 0.05, 0.62)
  for (const side of [-1, 1]) {
    const string = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.34, 3), boneMat)
    string.position.set(-0.1 + side * 0.14, 0.05, 0.48)
    string.rotation.x = Math.PI / 2
    string.rotation.z = side * 0.45
    armR.add(string)
  }
  const loaded = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.4, 4), ironMat)
  loaded.rotation.x = Math.PI / 2
  loaded.position.set(-0.1, 0.08, 0.5)
  armR.add(boneArmR, stock, limbs, loaded)
  rig.add(armL, armR)

  group.add(circleShadow(0.36))
  const bar = healthBar(0.8)
  bar.position.y = 1.55
  group.add(bar)
  return { group, rig, parts: { legL, legR, armL, armR }, bar }
}

// ogre bruiser: massive tapered torso, shoulder plates, tusked underbite
export function makeBrute () {
  const group = new THREE.Group()
  const rig = new THREE.Group()
  group.add(rig)

  const skinMat = new THREE.MeshStandardMaterial({ color: 0x5a523d, roughness: 0.9, flatShading: true })
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x3a352c, roughness: 0.9 })
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x4b4742, roughness: 0.6, metalness: 0.35 })
  const leatherMat = new THREE.MeshStandardMaterial({ color: 0x40301d, roughness: 0.9 })
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xd9cfb4, roughness: 0.6 })
  const hornMat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.7 })

  // stubby legs
  const mkLeg = (side) => {
    const hip = new THREE.Group()
    hip.position.set(side * 0.22, 0.44, 0)
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.22), darkMat)
    leg.position.y = -0.17
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.3), leatherMat)
    foot.position.set(0, -0.34, 0.04)
    hip.add(leg, foot)
    rig.add(hip)
    return hip
  }
  const legL = mkLeg(-1)
  const legR = mkLeg(1)

  // belt with a skull buckle, huge tapered torso, back spikes
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.24, 0.38), leatherMat)
  pelvis.position.y = 0.56
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), boneMat)
  skull.position.set(0, 0.56, 0.21)
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.3, 0.75, 8), skinMat)
  torso.position.y = 1.02
  rig.add(pelvis, skull, torso)
  for (let i = 0; i < 3; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 5), hornMat)
    spike.position.set((i - 1) * 0.16, 1.32 - Math.abs(i - 1) * 0.1, -0.32)
    spike.rotation.x = -0.7
    rig.add(spike)
  }

  // shoulder plates with spikes
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(
      new THREE.SphereGeometry(0.21, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.8), plateMat)
    pad.position.set(side * 0.44, 1.34, 0)
    pad.rotation.z = -side * 0.4
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 5), hornMat)
    spike.position.set(side * 0.52, 1.48, 0)
    spike.rotation.z = -side * 0.7
    rig.add(pad, spike)
  }

  // low-set head with an underbite jaw, tusks and violet eyes
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.28), skinMat)
  head.position.set(0, 1.5, 0.12)
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.22), darkMat)
  jaw.position.set(0, 1.38, 0.18)
  rig.add(head, jaw)
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xb76bff })
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), eyeMat)
    eye.position.set(side * 0.08, 1.53, 0.27)
    const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), boneMat)
    tusk.position.set(side * 0.11, 1.45, 0.27)
    rig.add(eye, tusk)
  }

  // heavy arms ending in wrapped fists
  const mkArm = (side) => {
    const arm = armPivot(side * 0.52, 1.22, 0, 0)
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.42, 0.19), skinMat)
    upper.position.y = -0.22
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), skinMat)
    fist.position.y = -0.5
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 8), leatherMat)
    wrap.position.y = -0.38
    arm.add(upper, fist, wrap)
    rig.add(arm)
    return arm
  }
  const armL = mkArm(-1)
  const armR = mkArm(1)

  group.add(circleShadow(0.58))
  const bar = healthBar(1.0)
  bar.position.y = 1.95
  group.add(bar)
  return { group, rig, parts: { legL, legR, armL, armR }, bar }
}

// the Dungeon Overlord: robed bulk, iron pauldrons, horn crown, ember cleaver
export function makeBoss () {
  const group = new THREE.Group()
  const rig = new THREE.Group()
  group.add(rig)

  const robeMat = new THREE.MeshStandardMaterial({
    color: 0x521114, roughness: 0.8, flatShading: true, emissive: 0x190303
  })
  const skinMat = new THREE.MeshStandardMaterial({ color: 0x6b1212, roughness: 0.6, emissive: 0x1c0303 })
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2b2724, roughness: 0.5, metalness: 0.6 })
  const hornMat = new THREE.MeshStandardMaterial({ color: 0x1f1a16, roughness: 0.6 })

  // robed bulk with an iron girdle and massed shoulders
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.98, 1.6, 9), robeMat)
  body.position.y = 0.85
  const girdle = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.18, 9), ironMat)
  girdle.position.y = 1.12
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), robeMat)
  chest.position.y = 1.72
  chest.scale.set(1.15, 0.78, 0.9)
  rig.add(body, girdle, chest)

  // spiked iron pauldrons
  for (const side of [-1, 1]) {
    const pad = new THREE.Mesh(
      new THREE.SphereGeometry(0.27, 9, 7, 0, Math.PI * 2, 0, Math.PI / 1.8), ironMat)
    pad.position.set(side * 0.62, 1.92, 0)
    pad.rotation.z = -side * 0.45
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 5), hornMat)
    spike.position.set(side * 0.74, 2.1, 0)
    spike.rotation.z = -side * 0.8
    rig.add(pad, spike)
  }

  // horned head: crown of spikes, two great horns, burning eyes and mouth
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), skinMat)
  head.position.set(0, 2.2, 0.08)
  rig.add(head)
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 + 0.3
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 5), hornMat)
    spike.position.set(Math.cos(ang) * 0.2, 2.44, 0.08 + Math.sin(ang) * 0.2)
    spike.rotation.set(Math.sin(ang) * 0.4, 0, -Math.cos(ang) * 0.4)
    rig.add(spike)
  }
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.55, 6), hornMat)
    horn.position.set(side * 0.25, 2.5, 0.02)
    horn.rotation.z = -side * 0.55
    rig.add(horn)
  }
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff7a20 })
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 10), emberMat)
    eye.position.set(side * 0.12, 2.25, 0.31)
    rig.add(eye)
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.03), emberMat)
  mouth.position.set(0, 2.1, 0.32)
  rig.add(mouth)

  // arms: a clawed fist and a huge ember-edged cleaver
  const armL = armPivot(-0.78, 1.78, 0.05, 0)
  const upperL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.22), robeMat)
  upperL.position.y = -0.28
  const fist = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), skinMat)
  fist.position.y = -0.6
  armL.add(upperL, fist)
  const armR = armPivot(0.78, 1.78, 0.05, 0)
  const upperR = upperL.clone()
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6), hornMat)
  haft.position.y = -0.85
  const cleaver = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.6, 0.38), ironMat)
  cleaver.position.set(0, -1.0, 0.22)
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.6, 0.045), emberMat)
  edge.position.set(0, -1.0, 0.42)
  armR.add(upperR, haft, cleaver, edge)
  rig.add(armL, armR)

  const glow = new THREE.PointLight(0xff3a20, 9, 7, 1.8)
  glow.position.y = 1.8
  group.add(glow)

  group.add(circleShadow(1.0))
  const bar = healthBar(1.8)
  bar.position.y = 3.15
  group.add(bar)
  return { group, rig, parts: { armL, armR }, bar }
}

// ---- projectiles ----

const BOLT_STYLES = {
  w: { color: 0xb44dff, glow: 0x8a2be2, len: 1.0, size: 0.09, y: 0.8 },  // warlock hexbolt
  b: { color: 0xff6a2a, glow: 0xd63a10, len: 1.0, size: 0.1, y: 0.9 },   // boss volley
  a: { color: 0xffe9a0, glow: 0xd6a832, len: 2.6, size: 0.05, y: 0.9 }   // deadeye tracer
}

export const boltColor = (c) => (BOLT_STYLES[c] || BOLT_STYLES.w).color

// glowing core stretched along +z plus an additive halo and trailing streak
export function makeBolt (c) {
  const style = BOLT_STYLES[c] || BOLT_STYLES.w
  const group = new THREE.Group()
  const spin = new THREE.Group()
  spin.position.y = style.y
  group.add(spin)

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(style.size, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  )
  core.scale.z = style.len
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(style.size * 2.1, 8, 8),
    new THREE.MeshBasicMaterial({
      color: style.color, transparent: true, opacity: 0.45,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  )
  halo.scale.z = style.len * 1.15
  const trail = new THREE.Mesh(
    new THREE.ConeGeometry(style.size * 1.4, style.size * 14, 6),
    new THREE.MeshBasicMaterial({
      color: style.glow, transparent: true, opacity: 0.35,
      blending: THREE.AdditiveBlending, depthWrite: false
    })
  )
  trail.rotation.x = -Math.PI / 2
  trail.position.z = -style.size * 7.5
  spin.add(core, halo, trail)
  group.userData.spin = spin
  return group
}

// ---- pickups ----

export function makePickup (type) {
  const group = new THREE.Group()
  let mesh
  if (type === 'heart') {
    mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({ color: 0xe8332e, emissive: 0x701210, roughness: 0.3 })
    )
  } else {
    mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14),
      new THREE.MeshStandardMaterial({ color: 0xe8b54d, emissive: 0x6e4d12, metalness: 0.85, roughness: 0.25 })
    )
    mesh.rotation.z = Math.PI / 2
  }
  mesh.position.y = 0.45
  group.add(mesh)
  group.add(circleShadow(0.16))
  group.userData.spin = mesh
  return group
}
