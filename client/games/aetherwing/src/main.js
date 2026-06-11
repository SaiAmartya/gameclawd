import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { Bird } from './bird.js';
import { Obstacles } from './obstacles.js';
import { Effects } from './effects.js';
import { SFX, Music } from './audio.js';
import { Leaderboard } from './leaderboard.js';

const CONFIG = {
  gravity: -30,
  flap: 10.4,
  maxFall: -22,
  speedStart: 13,
  speedMax: 22,
  speedRamp: 0.12,
  gapStart: 7.4,
  gapMin: 5.0,
  gapShrink: 0.05,
  ceiling: 15.5,
  floor: -7.4,
  birdRadius: 0.55,
};

const BEST_KEY = 'aetherwing-best';

// ── scene plumbing ─────────────────────────────────────────────
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 900);

// side-on view: the bird crosses the frame left-of-centre, gates
// sweep in from the right so their heights read as they approach
function frameCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? 72 : 55;
  camera.userData.z = aspect < 1 ? 16.5 + (1 - aspect) * 12 : 16.5;
  camera.updateProjectionMatrix();
}
frameCamera();
camera.position.set(2.2, 4, camera.userData.z);

const scene = new THREE.Scene();
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.7, 0.8
));
composer.addPass(new OutputPass());

const world = new World(scene);
const bird = new Bird(scene);
const obstacles = new Obstacles(scene, CONFIG);
const effects = new Effects(scene);
const sfx = new SFX();
const music = new Music(sfx);
const lb = new Leaderboard();

// ── HUD ────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const hud = {
  score: $('score'), menu: $('menu'), over: $('gameover'),
  finalScore: $('final-score'), finalBest: $('final-best'),
  menuBest: $('menu-best'), flash: $('flash'), newbest: $('newbest'),
  menuLbList: $('menu-lb-list'), overLbList: $('over-lb-list'),
  submitRow: $('submit-row'), pilotName: $('pilot-name'),
  submitBtn: $('submit-btn'), submitStatus: $('submit-status'),
  muteBtn: $('mute-btn'),
};

// ── state ──────────────────────────────────────────────────────
let state = 'menu'; // menu | playing | dead
let score = 0;
let best = Number(localStorage.getItem(BEST_KEY) || 0);
let vy = 0;
let speed = CONFIG.speedStart;
let timeScale = 1;
let deathT = 0;
let overShown = false;
let elapsed = 0;
let submitted = false;

hud.menuBest.textContent = best;
obstacles.setVisible(false);

async function refreshBoard(el, highlight = null) {
  const scores = await lb.fetchTop();
  lb.render(el, scores, highlight);
}
refreshBoard(hud.menuLbList);

function startGame() {
  state = 'playing';
  score = 0;
  vy = CONFIG.flap * 0.6;
  speed = CONFIG.speedStart;
  submitted = false;
  bird.reset();
  effects.clearTrail();
  obstacles.reset();
  obstacles.setVisible(true);
  hud.menu.classList.add('hidden');
  hud.over.classList.add('hidden');
  hud.score.classList.remove('hidden');
  hud.score.textContent = '0';
  sfx.start();
  music.setMood('playing');
  lb.beginSession(); // mint the flight token at takeoff
}

function flap() {
  vy = CONFIG.flap;
  bird.flap();
  sfx.flap();
  const p = bird.group.position;
  effects.puff(new THREE.Vector3(p.x - 0.5, p.y - 0.4, p.z));
}

function die() {
  state = 'dead';
  deathT = 0;
  overShown = false;
  sfx.crash();
  music.setMood('dead');
  effects.feathers(bird.group.position.clone());
  hud.flash.classList.remove('boom');
  void hud.flash.offsetWidth;
  hud.flash.classList.add('boom');
  if (score > best) {
    best = score;
    localStorage.setItem(BEST_KEY, String(best));
    hud.newbest.classList.remove('hidden');
  } else {
    hud.newbest.classList.add('hidden');
  }
}

function showOver() {
  overShown = true;
  music.setMood('menu');
  hud.finalScore.textContent = score;
  hud.finalBest.textContent = best;
  hud.score.classList.add('hidden');
  hud.over.classList.remove('hidden');
  hud.submitStatus.textContent = '';
  const canSubmit = score >= 1 && lb.token && !submitted;
  hud.submitRow.classList.toggle('hidden', !canSubmit);
  if (canSubmit) {
    hud.pilotName.value = lb.savedName;
    hud.submitBtn.disabled = false;
  }
  refreshBoard(hud.overLbList);
}

function restart() {
  hud.menuBest.textContent = best;
  startGame();
}

function onScore(passed) {
  score += passed;
  hud.score.textContent = score;
  hud.score.classList.remove('pop');
  void hud.score.offsetWidth;
  hud.score.classList.add('pop');
  sfx.score(score);
}

async function submitScore() {
  const name = hud.pilotName.value.trim();
  if (name.length < 2) {
    hud.submitStatus.textContent = 'call sign needs 2+ characters';
    return;
  }
  hud.submitBtn.disabled = true;
  hud.submitStatus.textContent = 'transmitting…';
  const res = await lb.submit(name, score);
  if (res.error) {
    hud.submitStatus.textContent = `rejected: ${res.error.replaceAll('_', ' ')}`;
    hud.submitBtn.disabled = false;
    return;
  }
  submitted = true;
  lb.savedName = name;
  hud.submitRow.classList.add('hidden');
  hud.submitStatus.textContent = res.rank
    ? `★ ranked #${res.rank} worldwide ★`
    : 'score recorded';
  lb.render(hud.overLbList, res.scores, name);
}

// ── audio boot & mute ──────────────────────────────────────────
const MUTE_KEY = 'aetherwing-muted';
let muted = localStorage.getItem(MUTE_KEY) === '1';
sfx.setMuted(muted);
hud.muteBtn.textContent = muted ? '🔇' : '🔊';

hud.muteBtn.addEventListener('click', () => {
  muted = !muted;
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  sfx.setMuted(muted);
  hud.muteBtn.textContent = muted ? '🔇' : '🔊';
  hud.muteBtn.blur(); // Space should flap, not re-toggle the button
});

// browsers gate audio behind a gesture — the soundtrack fades in on the
// first interaction of any kind (registered before the flap handlers so
// the menu music is already swelling when the first flight starts)
const bootAudio = () => music.start();
window.addEventListener('pointerdown', bootAudio, { once: true });
window.addEventListener('keydown', bootAudio, { once: true });

// ── input ──────────────────────────────────────────────────────
function action() {
  if (state === 'menu') startGame();
  else if (state === 'playing') flap();
  else if (state === 'dead' && overShown) restart();
}

window.addEventListener('pointerdown', (e) => {
  if (e.target instanceof Element && e.target.closest('input, button, .lb, a')) {
    return; // HUD interactions (and the GameClawd hub link) shouldn't flap
  }
  action();
});
window.addEventListener('keydown', (e) => {
  if (document.activeElement === hud.pilotName) {
    if (e.code === 'Enter') submitScore();
    return; // typing a call sign, not flying
  }
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!e.repeat) action();
  }
});
hud.submitBtn.addEventListener('click', submitScore);

window.addEventListener('resize', () => {
  frameCamera();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ── game loop ──────────────────────────────────────────────────
const clock = new THREE.Clock();

function tick() {
  requestAnimationFrame(tick);
  const rawDt = Math.min(clock.getDelta(), 1 / 30);

  if (state === 'dead') {
    deathT += rawDt;
    timeScale += (0.14 - timeScale) * Math.min(1, rawDt * 8);
    if (deathT > 0.9 && !overShown) showOver();
  } else {
    timeScale += (1 - timeScale) * Math.min(1, rawDt * 4);
  }
  const dt = rawDt * timeScale;
  elapsed += dt;

  let scroll = 2.2 * dt; // ambient drift on menu / death

  if (state === 'playing') {
    vy = Math.max(vy + CONFIG.gravity * dt, CONFIG.maxFall);
    bird.group.position.y += vy * dt;

    if (bird.group.position.y > CONFIG.ceiling) {
      bird.group.position.y = CONFIG.ceiling;
      vy = Math.min(vy, 0);
    }

    speed = Math.min(CONFIG.speedMax, speed + CONFIG.speedRamp * dt);
    scroll = speed * dt;
    const passed = obstacles.update(scroll, dt, score, elapsed);
    if (passed) onScore(passed);

    effects.emitTrail(bird.tailPosition(), dt);

    if (bird.group.position.y < CONFIG.floor + CONFIG.birdRadius ||
        obstacles.hits(bird.group.position.y, CONFIG.birdRadius)) {
      die();
    }
  } else if (state === 'menu') {
    bird.group.position.y = 1.5 + Math.sin(elapsed * 2.1) * 0.45;
  } else if (state === 'dead') {
    vy = Math.max(vy + CONFIG.gravity * dt, CONFIG.maxFall);
    const y = bird.group.position.y + vy * dt;
    bird.group.position.y = Math.max(y, CONFIG.floor + 0.3);
    bird.tumble(dt);
  }

  // the sky shifts moods every 8 gates; idles gently on the menu
  const paletteT = state === 'menu' ? elapsed * 0.012 : score / 8;

  bird.update(dt, vy, state);
  world.update(dt, elapsed, paletteT, scroll);
  effects.update(dt, rawDt);

  // side camera: subtle sway, vertical follow, shake on impact
  const by = bird.group.position.y;
  const shakeX = (Math.random() - 0.5) * effects.shake * 0.7;
  const shakeY = (Math.random() - 0.5) * effects.shake * 0.7;
  const camX = 2.2 + Math.sin(elapsed * 0.18) * 0.4 + shakeX;
  const camY = 3.8 + by * 0.32 + shakeY;
  camera.position.x += (camX - camera.position.x) * Math.min(1, rawDt * 6);
  camera.position.y += (camY - camera.position.y) * Math.min(1, rawDt * 5);
  camera.position.z = camera.userData.z;
  camera.lookAt(3.2, 1.6 + by * 0.42, 0);

  composer.render();
}

tick();

// debug/E2E handle — lets tests verify audio + game state without UI scraping
window.__aetherwing = { sfx, music, get state() { return state; } };
