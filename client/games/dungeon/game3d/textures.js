// Procedural canvas textures: cut-stone walls, flagstone floors and heraldic
// banners, all drawn at startup — the dungeon looks hand-textured without
// shipping a single asset file. Seeded PRNG keeps every client identical.

import * as THREE from 'three'

function mulberry32 (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function speckle (ctx, rand, x, y, w, h, count, alpha) {
  for (let i = 0; i < count; i++) {
    const light = rand() > 0.5
    ctx.fillStyle = light ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha * 1.5})`
    ctx.fillRect(x + rand() * w, y + rand() * h, 1 + rand() * 2, 1 + rand() * 2)
  }
}

function crack (ctx, rand, x, y, len, step) {
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, y)
  for (let s = 0; s < 4; s++) {
    x += (rand() - 0.5) * step
    y += len / 4
    ctx.lineTo(x, y)
  }
  ctx.stroke()
}

// cut-stone brickwork for the wall faces (drawn tall: walls are 1 x 2.4)
export function makeWallTexture () {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 512
  const ctx = c.getContext('2d')
  const rand = mulberry32(0xD00D)

  ctx.fillStyle = '#1b191f' // mortar
  ctx.fillRect(0, 0, c.width, c.height)

  const rows = 11
  const bh = c.height / rows
  const cols = 3
  const bw = c.width / cols
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * bw * 0.5
    for (let col = -1; col < cols; col++) {
      const x = col * bw + off
      const y = row * bh
      const v = 96 + rand() * 46
      ctx.fillStyle = `rgb(${(v * 0.95) | 0},${(v * 0.93) | 0},${(v * 1.06) | 0})`
      ctx.fillRect(x + 2, y + 2, bw - 4, bh - 4)
      // bevel: lit top edge, shadowed bottom edge
      ctx.fillStyle = 'rgba(255,255,255,0.10)'
      ctx.fillRect(x + 2, y + 2, bw - 4, 3)
      ctx.fillStyle = 'rgba(0,0,0,0.24)'
      ctx.fillRect(x + 2, y + bh - 6, bw - 4, 4)
      speckle(ctx, rand, x + 2, y + 2, bw - 4, bh - 4, 24, 0.07)
      if (rand() < 0.3) crack(ctx, rand, x + 8 + rand() * (bw - 20), y + 4, bh - 10, 16)
    }
  }
  // grime creeping up from the floor line
  const grad = ctx.createLinearGradient(0, c.height * 0.55, 0, c.height)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(8,12,6,0.5)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, c.width, c.height)

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// worn flagstones; tiles with RepeatWrapping, one canvas per 2x2 floor tiles
export function makeFloorTexture () {
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')
  const rand = mulberry32(0xF100)

  ctx.fillStyle = '#141318' // grout
  ctx.fillRect(0, 0, c.width, c.height)

  const n = 4
  const s = c.width / n
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const v = 150 + rand() * 52
      ctx.fillStyle = `rgb(${(v * 0.96) | 0},${(v * 0.95) | 0},${(v * 1.05) | 0})`
      const inset = 2 + rand() * 3
      ctx.fillRect(gx * s + inset, gy * s + inset, s - inset * 2, s - inset * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(gx * s + inset, gy * s + inset, s - inset * 2, 2)
      ctx.fillStyle = 'rgba(0,0,0,0.16)'
      ctx.fillRect(gx * s + inset, gy * s + s - inset - 3, s - inset * 2, 3)
      speckle(ctx, rand, gx * s + inset, gy * s + inset, s - inset * 2, s - inset * 2, 30, 0.05)
      if (rand() < 0.35) crack(ctx, rand, gx * s + 10 + rand() * (s - 24), gy * s + 6, s - 14, 18)
    }
  }

  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

// swallow-tailed crimson banner with a gold border and emblem
export function makeBannerTexture () {
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const ctx = c.getContext('2d')
  const rand = mulberry32(0xBA77)

  ctx.beginPath()
  ctx.moveTo(5, 0)
  ctx.lineTo(123, 0)
  ctx.lineTo(123, 196)
  ctx.lineTo(96, 232)
  ctx.lineTo(64, 202)
  ctx.lineTo(32, 232)
  ctx.lineTo(5, 196)
  ctx.closePath()
  ctx.fillStyle = '#6e1716'
  ctx.fill()

  ctx.save()
  ctx.clip()
  // cloth weave shading
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.05})`
    ctx.fillRect(rand() * 128, rand() * 256, 2 + rand() * 5, 8 + rand() * 22)
  }
  // gold border (strokes the banner outline), hanging rod, emblem
  ctx.strokeStyle = '#c9a04e'
  ctx.lineWidth = 7
  ctx.stroke()
  ctx.fillStyle = '#3a2c18'
  ctx.fillRect(0, 0, 128, 10)
  ctx.translate(64, 102)
  ctx.fillStyle = '#c9a04e'
  ctx.beginPath()
  ctx.moveTo(0, -46); ctx.lineTo(31, 0); ctx.lineTo(0, 46); ctx.lineTo(-31, 0)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = '#2a0e0d'
  ctx.beginPath()
  ctx.moveTo(0, -31); ctx.lineTo(20, 0); ctx.lineTo(0, 31); ctx.lineTo(-20, 0)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
