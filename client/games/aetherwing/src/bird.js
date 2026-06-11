import * as THREE from 'three';

// The bird flies along +x, yawed a few degrees toward the camera so
// the player reads it in three-quarter profile.
const HEADING = -Math.PI / 2 - 0.24;

// A little origami bird, folded out of flat-shaded triangles.
export class Bird {
  constructor(scene) {
    this.group = new THREE.Group(); // world position + heading
    this.pose = new THREE.Group();  // pitch & roll, inside the heading frame
    this.group.add(this.pose);
    this.group.rotation.y = HEADING;
    this.flapVel = 0;
    this.flapPhase = 0;

    const paper = new THREE.MeshStandardMaterial({
      color: 0xfff6ec, roughness: 0.65, flatShading: true,
      emissive: 0xfff6ec, emissiveIntensity: 0.22,
    });
    const coral = new THREE.MeshStandardMaterial({
      color: 0xff8e5e, roughness: 0.6, flatShading: true,
      emissive: 0xff5e2e, emissiveIntensity: 0.25,
    });
    const ink = new THREE.MeshStandardMaterial({ color: 0x1a1028, roughness: 0.4 });

    // body — a folded dart pointing forward (local -z)
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.7, 4), paper);
    body.geometry.rotateX(-Math.PI / 2);
    body.geometry.rotateZ(Math.PI / 4);
    this.pose.add(body);

    // head + beak + crest
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), paper);
    head.position.set(0, 0.18, -0.85);
    this.pose.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 4), coral);
    beak.geometry.rotateX(-Math.PI / 2);
    beak.position.set(0, 0.16, -1.22);
    this.pose.add(beak);

    const crest = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 4), coral);
    crest.position.set(0, 0.52, -0.78);
    crest.rotation.x = 0.5;
    this.pose.add(crest);

    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), ink);
      eye.position.set(side * 0.22, 0.3, -0.92);
      this.pose.add(eye);
    }

    // wings — paper triangles hinged at the body
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
      0, 0, -0.55,
      0, 0, 0.45,
      1.55, 0.12, 0.15,
    ]), 3));
    wingGeo.computeVertexNormals();
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xffe8d4, roughness: 0.7, flatShading: true, side: THREE.DoubleSide,
      emissive: 0xffe8d4, emissiveIntensity: 0.2,
    });

    this.wings = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.18, 0.12, 0);
      const wing = new THREE.Mesh(wingGeo, wingMat);
      wing.scale.x = side;
      pivot.add(wing);
      this.pose.add(pivot);
      this.wings.push(pivot);
    }

    // tail fan
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 3), coral);
    tail.geometry.rotateX(Math.PI / 2);
    tail.position.set(0, 0.05, 0.95);
    tail.scale.set(1.4, 0.5, 1);
    this.pose.add(tail);

    this.group.position.set(0, 1.5, 0);
    scene.add(this.group);

    // reusable world-space tail anchor for the flight trail
    this._tailLocal = new THREE.Vector3(0, 0.1, 1.1);
    this._tailWorld = new THREE.Vector3();
  }

  flap() {
    this.flapVel = 18;
  }

  tailPosition() {
    this._tailWorld.copy(this._tailLocal);
    this.pose.localToWorld(this._tailWorld);
    return this._tailWorld;
  }

  update(dt, vy, state) {
    this.flapPhase += dt * (4 + this.flapVel);
    this.flapVel = Math.max(0, this.flapVel - dt * 40);
    const ambient = Math.sin(this.flapPhase) * 0.22;
    const burst = Math.min(this.flapVel / 18, 1);
    const angle = ambient - burst * Math.sin(this.flapPhase * 2.4) * 0.9;
    this.wings[0].rotation.z = -angle - 0.12;
    this.wings[1].rotation.z = angle + 0.12;

    if (state === 'playing') {
      const targetPitch = THREE.MathUtils.clamp(vy * 0.055, -0.65, 0.5);
      this.pose.rotation.x += (targetPitch - this.pose.rotation.x) * Math.min(1, dt * 8);
      this.pose.rotation.z = Math.sin(this.flapPhase * 0.5) * 0.06;
    } else if (state === 'menu') {
      this.pose.rotation.x *= 0.95;
      this.pose.rotation.z = Math.sin(this.flapPhase * 0.5) * 0.1;
    }
  }

  tumble(dt) {
    this.pose.rotation.z += dt * 7;
    this.pose.rotation.x += dt * 3;
  }

  reset() {
    this.group.position.set(0, 1.5, 0);
    this.pose.rotation.set(0, 0, 0);
    this.flapVel = 0;
  }
}
