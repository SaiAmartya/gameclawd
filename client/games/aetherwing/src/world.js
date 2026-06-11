import * as THREE from 'three';

// Four moods the sky cycles through as your score climbs.
const PALETTES = [
  { // golden hour
    zenith: 0x3b2d5e, horizon: 0xff8e5e, sun: 0xffd9a0, fog: 0xf08a60,
    hemiSky: 0xffb98a, hemiGround: 0x2a3a5e, dir: 0xffd9a0, ocean: 0x14445c,
    cloud: 0xffe8d4, night: 0.0,
  },
  { // dusk
    zenith: 0x1a1038, horizon: 0xb84a7e, sun: 0xff9ecb, fog: 0x8e4470,
    hemiSky: 0xc06090, hemiGround: 0x181838, dir: 0xffb0d8, ocean: 0x0e2a4a,
    cloud: 0xe8c0e0, night: 0.35,
  },
  { // starlight
    zenith: 0x050514, horizon: 0x1b2a5a, sun: 0xcfe6ff, fog: 0x141e44,
    hemiSky: 0x32488e, hemiGround: 0x0a0a20, dir: 0xbcd8ff, ocean: 0x06182e,
    cloud: 0x44507e, night: 1.0,
  },
  { // dawn
    zenith: 0x274a7a, horizon: 0xffc46e, sun: 0xfff1c4, fog: 0xe8a878,
    hemiSky: 0xffd0a0, hemiGround: 0x24405e, dir: 0xfff1c4, ocean: 0x1e4a6a,
    cloud: 0xfff0dc, night: 0.1,
  },
];

const SKY_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vWorld;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  void main() {
    vec3 d = normalize(vWorld);
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.62));
    float sunAmt = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * pow(sunAmt, 700.0) * 1.6;  // disc
    col += uSunColor * pow(sunAmt, 16.0) * 0.32;  // halo
    gl_FragColor = vec4(col, 1.0);
  }
`;

// The world scrolls along -x past the bird. Camera watches from +z.
export class World {
  constructor(scene) {
    this.scene = scene;
    // sun sits ahead of the bird and behind the gates, in frame
    this.sunDir = new THREE.Vector3(0.3, 0.18, -0.92).normalize();

    this.cols = {};
    for (const k of ['zenith', 'horizon', 'sun', 'fog', 'hemiSky', 'hemiGround', 'dir', 'ocean', 'cloud']) {
      this.cols[k] = new THREE.Color();
    }
    this._a = new THREE.Color();
    this._b = new THREE.Color();
    this.night = 0;

    scene.fog = new THREE.Fog(0xf08a60, 60, 230);

    this.buildSky();
    this.buildLights();
    this.buildOcean();
    this.buildClouds();
    this.buildMountains();
    this.buildIslands();
    this.buildFlock();
    this.buildStars();
    this.applyPalette(0);
  }

  buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uSunDir: { value: this.sunDir },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), this.skyMat);
    this.scene.add(sky);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x222244, 1.25);
    this.dir = new THREE.DirectionalLight(0xffffff, 2.2);
    this.dir.position.copy(this.sunDir).multiplyScalar(80);
    this.scene.add(this.hemi, this.dir);
  }

  buildOcean() {
    const geo = new THREE.PlaneGeometry(700, 380, 64, 34);
    geo.rotateX(-Math.PI / 2);
    this.oceanGeo = geo;
    this.oceanBase = geo.attributes.position.array.slice();
    this.oceanMat = new THREE.MeshStandardMaterial({
      color: 0x14445c, roughness: 0.42, metalness: 0.25, flatShading: true,
      emissive: 0x14445c, emissiveIntensity: 0.45,
    });
    const ocean = new THREE.Mesh(geo, this.oceanMat);
    ocean.position.set(0, -8.2, -70);
    this.scene.add(ocean);
  }

  buildClouds() {
    this.clouds = [];
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffe8d4, roughness: 1, flatShading: true,
      emissive: 0xffe8d4, emissiveIntensity: 0.4,
    });
    for (let i = 0; i < 16; i++) {
      const cluster = new THREE.Group();
      const puffs = 3 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), this.cloudMat);
        puff.position.set((p - puffs / 2) * 1.6 + Math.random(), Math.random() * 0.8, Math.random() * 1.4);
        const s = 1.1 + Math.random() * 1.6;
        puff.scale.set(s * 1.5, s * 0.55, s);
        puff.rotation.y = Math.random() * Math.PI;
        cluster.add(puff);
      }
      cluster.position.set(
        -170 + Math.random() * 340,
        7 + Math.random() * 15,
        -130 + Math.random() * 130
      );
      cluster.userData.par = 0.25 + Math.random() * 0.45; // parallax factor
      this.scene.add(cluster);
      this.clouds.push(cluster);
    }
  }

  buildMountains() {
    this.mountains = [];
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a3050, roughness: 1, flatShading: true });
    for (let i = 0; i < 11; i++) {
      const h = 18 + Math.random() * 30;
      const m = new THREE.Mesh(new THREE.ConeGeometry(12 + Math.random() * 16, h, 5), mat);
      m.position.set(-160 + Math.random() * 320, -8 + h / 2, -90 - Math.random() * 90);
      m.rotation.y = Math.random() * Math.PI;
      this.scene.add(m);
      this.mountains.push(m);
    }
  }

  buildIslands() {
    this.islands = [];
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x5e5276, roughness: 0.95, flatShading: true,
      emissive: 0x3a3050, emissiveIntensity: 0.45,
    });
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x7eb86a, roughness: 0.9, flatShading: true,
      emissive: 0x4a7a3e, emissiveIntensity: 0.35,
    });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a3a, roughness: 1, flatShading: true });
    const pineMat = new THREE.MeshStandardMaterial({
      color: 0x3e8a62, roughness: 0.9, flatShading: true,
      emissive: 0x1e5a3e, emissiveIntensity: 0.3,
    });

    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const r = 2.4 + Math.random() * 2;
      const depth = 3 + Math.random() * 3;

      const rock = new THREE.Mesh(new THREE.ConeGeometry(r, depth, 6), rockMat);
      rock.rotation.x = Math.PI; // point hangs downward
      rock.position.y = -depth / 2;
      g.add(rock);

      const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.55, 6), grassMat);
      cap.position.y = 0.27;
      g.add(cap);

      const trees = 1 + Math.floor(Math.random() * 3);
      for (let t = 0; t < trees; t++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * r * 0.5;
        const tx = Math.cos(a) * d;
        const tz = Math.sin(a) * d;
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.5, 5), trunkMat);
        trunk.position.set(tx, 0.8, tz);
        const pine = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 6), pineMat);
        pine.position.set(tx, 1.7, tz);
        g.add(trunk, pine);
      }

      const s = 0.8 + Math.random() * 0.7;
      g.scale.set(s, s, s);
      g.position.set(-150 + Math.random() * 300, 3.5 + Math.random() * 9, -35 - Math.random() * 55);
      g.userData = { baseY: g.position.y, phase: Math.random() * Math.PI * 2 };
      g.rotation.y = Math.random() * Math.PI;
      this.scene.add(g);
      this.islands.push(g);
    }
  }

  buildFlock() {
    this.flock = [];
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1430, side: THREE.DoubleSide });
    // a shallow V of two triangles, facing the camera
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      -1, 0.3, 0,  -0.5, 0, 0,  0, 0.14, 0,
       0, 0.14, 0,  0.5, 0, 0,  1, 0.3, 0,
    ]), 3));
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(geo, mat);
      const s = 0.5 + Math.random() * 0.5;
      b.scale.set(s, s, s);
      b.position.set(-120 + Math.random() * 240, 7 + Math.random() * 9, -45 - Math.random() * 25);
      b.userData = { phase: Math.random() * Math.PI * 2, baseScale: s };
      this.scene.add(b);
      this.flock.push(b);
    }
  }

  buildStars() {
    const count = 450;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 0.85);
      const r = 390;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) + 4;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({
      color: 0xeef4ff, size: 1.7, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false,
    });
    this.scene.add(new THREE.Points(geo, this.starMat));
  }

  applyPalette(t) {
    const n = PALETTES.length;
    const idx = Math.floor(t) % n;
    const next = (idx + 1) % n;
    const f = THREE.MathUtils.smoothstep(t - Math.floor(t), 0, 1);
    const A = PALETTES[idx];
    const B = PALETTES[next];
    for (const k in this.cols) {
      this._a.setHex(A[k]);
      this._b.setHex(B[k]);
      this.cols[k].lerpColors(this._a, this._b, f);
    }
    this.night = THREE.MathUtils.lerp(A.night, B.night, f);

    this.skyMat.uniforms.uZenith.value.copy(this.cols.zenith);
    this.skyMat.uniforms.uHorizon.value.copy(this.cols.horizon);
    this.skyMat.uniforms.uSunColor.value.copy(this.cols.sun);
    this.scene.fog.color.copy(this.cols.fog);
    this.hemi.color.copy(this.cols.hemiSky);
    this.hemi.groundColor.copy(this.cols.hemiGround);
    this.dir.color.copy(this.cols.dir);
    this.dir.intensity = THREE.MathUtils.lerp(2.2, 0.9, this.night);
    this.oceanMat.color.copy(this.cols.ocean);
    this.oceanMat.emissive.copy(this.cols.ocean);
    this.cloudMat.color.copy(this.cols.cloud);
    this.cloudMat.emissive.copy(this.cols.cloud);
    this.starMat.opacity = this.night * 0.95;
  }

  // scroll = world-units the foreground moved this frame (speed * dt)
  update(dt, elapsed, paletteT, scroll) {
    this.applyPalette(paletteT);

    // rolling low-poly waves
    const pos = this.oceanGeo.attributes.position;
    const base = this.oceanBase;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const z = base[i * 3 + 2];
      pos.array[i * 3 + 1] =
        Math.sin(x * 0.14 + elapsed * 1.3) * 0.55 +
        Math.sin(z * 0.11 + elapsed * 0.9) * 0.7 +
        Math.sin((x + z) * 0.06 + elapsed * 0.5) * 0.4;
    }
    pos.needsUpdate = true;
    this.oceanGeo.computeVertexNormals();

    // parallax layers, nearest moves fastest
    for (const c of this.clouds) {
      c.position.x -= scroll * c.userData.par + dt * 0.8;
      if (c.position.x < -190) {
        c.position.x = 190;
        c.position.y = 7 + Math.random() * 15;
        c.position.z = -130 + Math.random() * 130;
      }
    }
    for (const m of this.mountains) {
      m.position.x -= scroll * 0.08;
      if (m.position.x < -180) m.position.x = 180;
    }
    for (const isl of this.islands) {
      isl.position.x -= scroll * 0.28;
      isl.position.y = isl.userData.baseY + Math.sin(elapsed * 0.5 + isl.userData.phase) * 0.5;
      if (isl.position.x < -160) {
        isl.position.x = 160;
        isl.userData.baseY = 3.5 + Math.random() * 9;
        isl.position.z = -35 - Math.random() * 55;
      }
    }
    for (const b of this.flock) {
      b.position.x -= scroll * 0.45 + dt * 1.4;
      b.position.y += Math.sin(elapsed * 2 + b.userData.phase) * dt * 0.6;
      b.scale.y = b.userData.baseScale * (0.35 + Math.abs(Math.sin(elapsed * 6 + b.userData.phase)) * 0.85);
      if (b.position.x < -130) {
        b.position.x = 130;
        b.position.y = 7 + Math.random() * 9;
      }
    }
  }
}
