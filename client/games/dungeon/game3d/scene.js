// Three.js world: renderer, camera, dungeon geometry, lighting, atmosphere.
// World mapping: tile (x, y) -> 3D (x, height, z=y). 1 tile = 1 unit.

import * as THREE from 'three'

import { makeWallTexture, makeFloorTexture, makeBannerTexture } from './textures.js'

const WALL_HEIGHT = 2.4
const TORCH_LIGHT_POOL = 6

// deterministic per-tile pseudo-random for colour variation
function tileNoise (x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return n - Math.floor(n)
}

export class World {
  constructor (container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x05060a)
    this.scene.fog = new THREE.FogExp2(0x06070c, 0.055)

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 120)
    this.cameraOffset = new THREE.Vector3(0, 8.4, 5.9)
    this.cameraTarget = new THREE.Vector3()
    this.shake = 0

    // base lighting
    this.scene.add(new THREE.HemisphereLight(0x37415e, 0x0a0a10, 0.55))
    const moon = new THREE.DirectionalLight(0x9aa7cc, 0.18)
    moon.position.set(20, 40, 10)
    this.scene.add(moon)

    // the player's lantern follows the hero
    this.lantern = new THREE.PointLight(0xffd9a0, 28, 12, 1.7)
    this.lantern.position.set(0, 2.2, 0)
    this.scene.add(this.lantern)

    // pooled torch lights, re-assigned to the nearest torches each frame
    this.torchLights = []
    for (let i = 0; i < TORCH_LIGHT_POOL; i++) {
      const light = new THREE.PointLight(0xff8c3a, 0, 7.5, 1.9)
      this.scene.add(light)
      this.torchLights.push(light)
    }

    this.dungeonGroup = null
    this.torchFlames = []
    this.torchPositions = []
    this.dust = null
    this.time = 0
    this.heroPosUniform = { value: new THREE.Vector3() }

    // procedural textures, drawn once and reused across rebuilds
    this.tex = {
      wall: makeWallTexture(),
      floor: makeFloorTexture(),
      banner: makeBannerTexture()
    }

    window.addEventListener('resize', () => this.onResize())
  }

  onResize () {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  // ---- dungeon construction ----

  build (dungeon) {
    if (this.dungeonGroup) {
      this.scene.remove(this.dungeonGroup)
      this.dungeonGroup.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose()
        if (obj.material && !Array.isArray(obj.material)) obj.material.dispose()
      })
    }
    this.dungeonGroup = new THREE.Group()
    this.torchFlames = []
    this.torchPositions = []

    const grid = dungeon.grid
    const size = dungeon.size
    const roomTint = new Map()
    for (const r of dungeon.rooms) {
      roomTint.set(r.i, r.boss ? [0.5, 0.16, 0.14] : r.spawn ? [0.24, 0.3, 0.26] : null)
    }
    const roomOf = (x, y) => {
      for (const r of dungeon.rooms) {
        if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return r.i
      }
      return -1
    }

    // floor: merged quads, flagstone texture multiplied by per-tile tints
    // (tints are brighter than the final look — the texture darkens them)
    const positions = []
    const colors = []
    const uvs = []
    const indices = []
    let vi = 0
    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        const ch = grid[ty][tx]
        if (ch === '#') continue
        const n = tileNoise(tx, ty)
        let r = 0.52 + n * 0.14
        let g = 0.53 + n * 0.14
        let b = 0.6 + n * 0.15
        if (ch === ',') { r *= 0.78; g *= 0.78; b *= 0.8 } // corridors darker
        const tint = roomTint.get(roomOf(tx, ty))
        if (tint) { r = r * 0.7 + tint[0] * 0.42; g = g * 0.7 + tint[1] * 0.42; b = b * 0.7 + tint[2] * 0.42 }
        positions.push(
          tx, 0, ty, tx + 1, 0, ty, tx + 1, 0, ty + 1, tx, 0, ty + 1
        )
        // texture spans 2x2 tiles per repeat
        uvs.push(tx * 0.5, ty * 0.5, tx * 0.5 + 0.5, ty * 0.5, tx * 0.5 + 0.5, ty * 0.5 + 0.5, tx * 0.5, ty * 0.5 + 0.5)
        for (let k = 0; k < 4; k++) colors.push(r, g, b)
        indices.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2)
        vi += 4
      }
    }
    const floorGeo = new THREE.BufferGeometry()
    floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    floorGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    floorGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    floorGeo.setIndex(indices)
    floorGeo.computeVertexNormals()
    const floorMat = new THREE.MeshStandardMaterial({
      map: this.tex.floor, vertexColors: true, roughness: 0.95, metalness: 0.05
    })
    this.dungeonGroup.add(new THREE.Mesh(floorGeo, floorMat))

    // walls: instanced boxes on solid tiles that touch a floor tile
    const wallTiles = []
    const isFloor = (x, y) => x >= 0 && y >= 0 && x < size && y < size && grid[y][x] !== '#'
    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        if (grid[ty][tx] !== '#') continue
        let touches = false
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1 && !touches; dx++) {
            if (isFloor(tx + dx, ty + dy)) touches = true
          }
        }
        if (touches) wallTiles.push([tx, ty])
      }
    }
    const wallGeo = new THREE.BoxGeometry(1, WALL_HEIGHT, 1)
    const wallMat = new THREE.MeshStandardMaterial({
      map: this.tex.wall, roughness: 0.9, metalness: 0.08, transparent: true
    })
    // X-ray fade: wall fragments sitting on the camera->hero sightline go
    // mostly transparent so the hero is never hidden behind a foreground wall
    wallMat.onBeforeCompile = (shader) => {
      shader.uniforms.uHeroPos = this.heroPosUniform
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDodWorldPos;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 dodWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            dodWp = instanceMatrix * dodWp;
          #endif
          vDodWorldPos = (modelMatrix * dodWp).xyz;`)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vDodWorldPos;\nuniform vec3 uHeroPos;')
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 segA = cameraPosition;
            vec3 segAB = uHeroPos - segA;
            float segT = clamp(dot(vDodWorldPos - segA, segAB) / max(dot(segAB, segAB), 0.0001), 0.0, 1.0);
            float segD = length(vDodWorldPos - (segA + segAB * segT));
            float occl = 1.0 - smoothstep(1.0, 2.2, segD);     // 1 on the sightline
            float nearCam = 1.0 - smoothstep(0.78, 0.96, segT); // ignore walls at/behind the hero
            diffuseColor.a *= 1.0 - occl * nearCam * 0.85;
          }`)
    }
    const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallTiles.length)
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    wallTiles.forEach(([tx, ty], i) => {
      m.makeTranslation(tx + 0.5, WALL_HEIGHT / 2, ty + 0.5)
      walls.setMatrixAt(i, m)
      // near-white tints — the brick texture carries the tone, this varies it
      const n = tileNoise(tx * 3, ty * 7)
      c.setRGB(0.78 + n * 0.24, 0.76 + n * 0.22, 0.8 + n * 0.24)
      walls.setColorAt(i, c)
    })
    walls.instanceMatrix.needsUpdate = true
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true
    this.dungeonGroup.add(walls)

    // torches: post + emissive flame
    const postGeo = new THREE.CylinderGeometry(0.05, 0.07, 1.1, 6)
    const postMat = new THREE.MeshStandardMaterial({ color: 0x3d2a18, roughness: 0.9 })
    const flameGeo = new THREE.IcosahedronGeometry(0.13, 0)
    for (const t of dungeon.torches) {
      const post = new THREE.Mesh(postGeo, postMat)
      post.position.set(t.x, 0.55, t.y)
      this.dungeonGroup.add(post)
      const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040 })
      const flame = new THREE.Mesh(flameGeo, flameMat)
      flame.position.set(t.x, 1.25, t.y)
      this.dungeonGroup.add(flame)
      this.torchFlames.push(flame)
      this.torchPositions.push(new THREE.Vector3(t.x, 1.4, t.y))
    }

    this.buildDecor(dungeon)

    // drifting dust motes for atmosphere
    if (this.dust) this.scene.remove(this.dust)
    const dustCount = 240
    const dustPos = new Float32Array(dustCount * 3)
    for (let i = 0; i < dustCount; i++) {
      dustPos[i * 3] = Math.random() * size
      dustPos[i * 3 + 1] = 0.3 + Math.random() * 2
      dustPos[i * 3 + 2] = Math.random() * size
    }
    const dustGeo = new THREE.BufferGeometry()
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3))
    this.dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
      color: 0xaa9a70, size: 0.035, transparent: true, opacity: 0.45, depthWrite: false
    }))
    this.dungeonGroup.add(this.dust)

    this.scene.add(this.dungeonGroup)
  }

  // Set dressing. Solid props (pillars, crates, barrels) come from the
  // server's obstacle list so what you see is exactly what you collide with;
  // banners, bones and rubble stay cosmetic and derive from tileNoise, so
  // every co-op client decorates the dungeon identically.
  buildDecor (dungeon) {
    const g = this.dungeonGroup
    const grid = dungeon.grid
    const size = dungeon.size
    const isWall = (x, y) => x < 0 || y < 0 || x >= size || y >= size || grid[y][x] === '#'

    // authoritative solid props
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0x6e6a78, roughness: 0.9 })
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a4226, roughness: 0.9 })
    const bandMat = new THREE.MeshStandardMaterial({ color: 0x2e2a26, roughness: 0.6, metalness: 0.5 })
    for (const o of dungeon.obstacles || []) {
      const twist = tileNoise(o.x * 11, o.y * 17) * 1.4
      if (o.kind === 'pillar') {
        const col = new THREE.Mesh(
          new THREE.CylinderGeometry(o.r * 0.72, o.r * 0.92, WALL_HEIGHT, 8), stoneMat)
        col.position.set(o.x, WALL_HEIGHT / 2, o.y)
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(o.r * 2, 0.2, o.r * 2), stoneMat)
        plinth.position.set(o.x, 0.1, o.y)
        const cap = plinth.clone()
        cap.position.y = WALL_HEIGHT - 0.1
        g.add(col, plinth, cap)
      } else if (o.kind === 'barrel') {
        const barrel = new THREE.Mesh(
          new THREE.CylinderGeometry(o.r * 0.88, o.r, 0.66, 10), woodMat)
        barrel.position.set(o.x, 0.33, o.y)
        const band = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.92, 0.02, 6, 14), bandMat)
        band.rotation.x = Math.PI / 2
        band.position.set(o.x, 0.33, o.y)
        g.add(barrel, band)
      } else { // crate / crateSmall
        const s = o.r * 1.7
        const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), woodMat)
        crate.position.set(o.x, s / 2, o.y)
        crate.rotation.y = twist
        const brace = new THREE.Mesh(new THREE.BoxGeometry(s * 1.04, s * 0.16, s * 1.04), bandMat)
        brace.position.set(o.x, s / 2, o.y)
        brace.rotation.y = twist
        g.add(crate, brace)
      }
    }

    // heraldic banners on the far wall of rooms; the boss room gets a row
    const bannerGeo = new THREE.PlaneGeometry(0.74, 1.5)
    const bannerMat = new THREE.MeshStandardMaterial({
      map: this.tex.banner, transparent: true, alphaTest: 0.4, roughness: 0.9, side: THREE.DoubleSide
    })
    for (const r of dungeon.rooms) {
      const slots = r.boss ? [-2.2, 0, 2.2] : tileNoise(r.x * 5, r.y * 3) > 0.4 ? [0] : []
      for (const off of slots) {
        const bx = r.x + r.w / 2 + off
        if (!isWall(Math.floor(bx), r.y - 1) || isWall(Math.floor(bx), r.y)) continue
        const banner = new THREE.Mesh(bannerGeo, bannerMat)
        banner.position.set(bx, 1.55, r.y + 0.03)
        g.add(banner)
      }
    }

    // scattered rubble & old bones along the walls (instanced)
    const rocks = []
    const bones = []
    for (let ty = 0; ty < size; ty++) {
      for (let tx = 0; tx < size; tx++) {
        if (grid[ty][tx] === '#') continue
        if (!(isWall(tx + 1, ty) || isWall(tx - 1, ty) || isWall(tx, ty + 1) || isWall(tx, ty - 1))) continue
        const n = tileNoise(tx * 13.3 + 7, ty * 7.7 + 3)
        if (n < 0.05) rocks.push([tx + 0.5, ty + 0.5, n])
        else if (n < 0.085) bones.push([tx + 0.5, ty + 0.5, n])
      }
    }
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()
    const euler = new THREE.Euler()

    const rockMat = new THREE.MeshStandardMaterial({ color: 0x4c4954, roughness: 0.95, flatShading: true })
    const rockInst = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.11, 0), rockMat, rocks.length * 3)
    rocks.forEach(([x, y, n], i) => {
      for (let k = 0; k < 3; k++) {
        const a = n * 80 + k * 2.1
        const s = 0.45 + tileNoise(x * 9 + k, y * 4 + k) * 0.75
        pos.set(x + Math.cos(a) * 0.2, 0.08 * s, y + Math.sin(a) * 0.2)
        quat.setFromEuler(euler.set(n * 9, a, k))
        scl.setScalar(s)
        m.compose(pos, quat, scl)
        rockInst.setMatrixAt(i * 3 + k, m)
      }
    })
    g.add(rockInst)

    const boneMat = new THREE.MeshStandardMaterial({ color: 0xcfc5ab, roughness: 0.8 })
    const skullInst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), boneMat, bones.length)
    const boneInst = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.025, 0.22, 2, 5), boneMat, bones.length * 2)
    bones.forEach(([x, y, n], i) => {
      pos.set(x, 0.07, y)
      quat.setFromEuler(euler.set(0, n * 30, 0))
      scl.set(1, 0.85, 1.05)
      m.compose(pos, quat, scl)
      skullInst.setMatrixAt(i, m)
      for (let k = 0; k < 2; k++) {
        pos.set(x + (k ? 0.16 : -0.13), 0.035, y + (k ? -0.08 : 0.12))
        quat.setFromEuler(euler.set(Math.PI / 2, 0, n * 20 + k * 1.9))
        scl.setScalar(1)
        m.compose(pos, quat, scl)
        boneInst.setMatrixAt(i * 2 + k, m)
      }
    })
    g.add(skullInst, boneInst)
  }

  // ---- per-frame ----

  addShake (amount) {
    this.shake = Math.min(0.6, this.shake + amount)
  }

  update (dt, focus) {
    this.time += dt

    // smooth follow camera with a little movement look-ahead
    this.cameraTarget.lerp(new THREE.Vector3(focus.x, 0.8, focus.y), 1 - Math.exp(-dt * 6))
    const desired = this.cameraTarget.clone().add(this.cameraOffset)
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 7))
    if (this.shake > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6
      this.shake *= Math.exp(-dt * 9)
    }
    this.camera.lookAt(this.cameraTarget)

    // lantern follows the hero; wall-fade shader tracks the hero too
    this.heroPosUniform.value.set(focus.x, 0.9, focus.y)
    this.lantern.position.set(focus.x, 2.1, focus.y)
    this.lantern.intensity = 26 + Math.sin(this.time * 9.3) * 2.5

    // assign pooled lights to the nearest torches
    if (this.torchPositions.length) {
      const sorted = this.torchPositions
        .map((p, i) => ({ i, d: (p.x - focus.x) ** 2 + (p.z - focus.y) ** 2 }))
        .sort((a, b) => a.d - b.d)
      for (let i = 0; i < this.torchLights.length; i++) {
        const light = this.torchLights[i]
        if (i < sorted.length && sorted[i].d < 500) {
          const p = this.torchPositions[sorted[i].i]
          light.position.copy(p)
          light.intensity = 9 + Math.sin(this.time * 11 + sorted[i].i * 5.7) * 2.4
        } else {
          light.intensity = 0
        }
      }
    }

    // flame flicker
    for (let i = 0; i < this.torchFlames.length; i++) {
      const f = this.torchFlames[i]
      const s = 1 + Math.sin(this.time * 12 + i * 3.1) * 0.22
      f.scale.set(s, s * (1 + Math.sin(this.time * 17 + i) * 0.15), s)
    }

    // dust drift
    if (this.dust) {
      this.dust.position.y = Math.sin(this.time * 0.4) * 0.15
      this.dust.rotation.y += dt * 0.01
    }
  }

  render () {
    this.renderer.render(this.scene, this.camera)
  }
}
