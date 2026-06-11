import * as THREE from 'three';

// Gates approach from the right (+x) and sweep past the bird at x = 0,
// so the side-on camera reads their heights as they come.
const SPACING = 16;
const COUNT = 8;
const FIRST_X = 55;
const RECYCLE_X = -34;
const FLOOR_BASE = -9.5;
const CEIL_BASE = 19;
const COL_RADIUS = 1.35;

export class Obstacles {
  constructor(scene, config) {
    this.config = config;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.rockMat = new THREE.MeshStandardMaterial({
      color: 0x3a4663, roughness: 0.92, flatShading: true,
      emissive: 0x2a3450, emissiveIntensity: 0.5,
    });
    this.crystalMat = new THREE.MeshStandardMaterial({
      color: 0x9ff3e8, emissive: 0x46e0c8, emissiveIntensity: 1.5,
      roughness: 0.25, flatShading: true,
    });
    this.crystalDim = new THREE.MeshStandardMaterial({
      color: 0x6fb8d8, emissive: 0x2e90b8, emissiveIntensity: 0.6,
      roughness: 0.4, flatShading: true,
    });

    this.pairs = [];
    for (let i = 0; i < COUNT; i++) this.pairs.push(this.makePair());
    this.lastScored = null;
    this.reset();
  }

  makeColumn(up) {
    const col = new THREE.Group();
    const prism = new THREE.Mesh(
      new THREE.CylinderGeometry(COL_RADIUS, COL_RADIUS * 1.35, 1, 6), this.rockMat
    );
    const tip = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.7, 6), this.crystalMat);
    if (!up) tip.rotation.x = Math.PI;
    col.add(prism, tip);

    const shards = new THREE.Group();
    for (let s = 0; s < 3; s++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9 + Math.random() * 0.7, 5), this.crystalDim);
      const a = (s / 3) * Math.PI * 2 + Math.random();
      shard.position.set(Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25);
      shard.rotation.z = (Math.random() - 0.5) * 0.5;
      if (!up) shard.rotation.x = Math.PI;
      shards.add(shard);
    }
    col.add(shards);
    col.userData = { prism, tip, shards, up };
    return col;
  }

  makePair() {
    const group = new THREE.Group();
    const bottom = this.makeColumn(true);
    const top = this.makeColumn(false);
    bottom.rotation.y = Math.random() * Math.PI;
    top.rotation.y = Math.random() * Math.PI;
    group.add(bottom, top);
    this.group.add(group);
    return {
      group, bottom, top,
      gapY: 2, gapHalf: 3.5, bob: 0,
      bobPhase: Math.random() * Math.PI * 2,
      scored: false,
    };
  }

  setColumn(col, gapEdgeY) {
    const { prism, tip, shards, up } = col.userData;
    // tip apex sits exactly at the gap edge — what you see is the hitbox
    tip.position.y = gapEdgeY + (up ? -0.85 : 0.85);
    const prismTop = gapEdgeY + (up ? -1.5 : 1.5);
    const base = up ? FLOOR_BASE : CEIL_BASE;
    const h = Math.abs(prismTop - base);
    prism.scale.y = h;
    prism.position.y = (prismTop + base) / 2;
    shards.position.y = gapEdgeY + (up ? -2.1 : 2.1);
  }

  configure(pair, score) {
    const { gapStart, gapMin, gapShrink } = this.config;
    const gap = Math.max(gapMin, gapStart - score * gapShrink);
    pair.gapHalf = gap / 2;
    pair.gapY = THREE.MathUtils.lerp(-2.2, 6.8, Math.random());
    pair.scored = false;
    this.setColumn(pair.bottom, pair.gapY - pair.gapHalf);
    this.setColumn(pair.top, pair.gapY + pair.gapHalf);
  }

  reset() {
    this.pairs.forEach((pair, i) => {
      pair.group.position.x = FIRST_X + i * SPACING;
      pair.group.position.y = 0;
      this.configure(pair, 0);
    });
  }

  // Advance the gates by dist; returns how many were passed this frame.
  update(dist, dt, score, elapsed) {
    let passed = 0;
    for (const pair of this.pairs) {
      pair.group.position.x -= dist;
      // gates drift gently on the aether — collision includes the bob
      pair.bob = Math.sin(elapsed * 0.85 + pair.bobPhase) * 0.3;
      pair.group.position.y = pair.bob;
      pair.bottom.rotation.y += dt * 0.1;
      pair.top.rotation.y -= dt * 0.1;

      if (!pair.scored && pair.group.position.x < -2.5) {
        pair.scored = true;
        passed++;
        this.lastScored = pair;
      }
      if (pair.group.position.x < RECYCLE_X) {
        let maxX = -Infinity;
        for (const p of this.pairs) maxX = Math.max(maxX, p.group.position.x);
        pair.group.position.x = maxX + SPACING;
        this.configure(pair, score);
      }
    }
    return passed;
  }

  // Forgiving collision: the bird's effective radius is shrunk a touch.
  hits(y, radius) {
    const r = radius * 0.78;
    for (const pair of this.pairs) {
      if (Math.abs(pair.group.position.x) < COL_RADIUS + r) {
        const gapY = pair.gapY + pair.bob;
        if (y - r < gapY - pair.gapHalf || y + r > gapY + pair.gapHalf) {
          return true;
        }
      }
    }
    return false;
  }

  setVisible(v) {
    this.group.visible = v;
  }
}
