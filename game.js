import * as THREE from 'three';

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const canvas = $('scene'), menu = $('menu'), hud = $('hud'), touchUI = $('touchUI');
const playBtn = $('playBtn'), scoreEl = $('score'), timerEl = $('timer'), flagsEl = $('flags');
const toastEl = $('toast'), cpMsg = $('checkpointMsg'), winEl = $('win'), winStats = $('winStats');
const helpEl = $('help'), colorBar = $('colorBar'), bestLine = $('bestLine');

// ---------- State ----------
const S = {
  started: false, won: false, time: 0, studs: 0, totalStuds: 24,
  flags: 0, totalFlags: 3, spawn: new THREE.Vector3(0, 2.2, 20),
  buildColor: '#e11d48', skin: '#f5cd30', sound: true, high: true,
  yaw: 0.6, pitch: 0.42, dist: 8,
};
try {
  const b = localStorage.getItem('blockverse_best');
  if (b) bestLine.textContent = 'Best time: ' + fmtTime(parseFloat(b));
} catch {}

// ---------- Audio (procedural, no assets) ----------
let AC = null;
function ac() { if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)(); if (AC.state === 'suspended') AC.resume(); return AC; }
function tone(f, d = 0.12, type = 'square', v = 0.12, slide = 0, delay = 0) {
  if (!S.sound) return;
  try {
    const c = ac(), t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t + d);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(c.destination); o.start(t); o.stop(t + d + 0.02);
  } catch {}
}
const sfx = {
  jump: () => tone(300, 0.15, 'square', 0.08, 300),
  coin: () => { tone(880, 0.09, 'square', 0.1); tone(1320, 0.14, 'square', 0.1, 0, 0.08); },
  check: () => { tone(523, 0.12, 'triangle', 0.14); tone(659, 0.12, 'triangle', 0.14, 0, 0.1); tone(784, 0.2, 'triangle', 0.14, 0, 0.2); },
  bounce: () => tone(160, 0.25, 'sine', 0.16, 420),
  death: () => tone(400, 0.4, 'sawtooth', 0.1, -320),
  build: () => tone(520, 0.08, 'square', 0.1, 120),
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.22, 'triangle', 0.13, 0, i * 0.12)),
};

// ---------- Renderer / Scene ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch { $('nogl').classList.remove('hidden'); throw new Error('no webgl'); }
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 55, 140);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);

scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x3f7a3f, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 1.9);
sun.position.set(28, 46, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
sun.shadow.camera.far = 140;
scene.add(sun);

// sky gradient dome
{
  const c = document.createElement('canvas'); c.width = 4; c.height = 256;
  const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, '#3b82f6'); gr.addColorStop(0.55, '#87ceeb'); gr.addColorStop(1, '#e0f2fe');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(190, 24, 16),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
  scene.add(dome);
}

// ---------- Helpers ----------
const colliders = [];   // {mesh, box:Box3, mover?:object, bounce?:bool, kill?:bool}
const MAT = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0.02, ...o });
function addBox(x, y, z, w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), opts.material || MAT(color));
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false; m.receiveShadow = true;
  scene.add(m);
  const rec = { mesh: m, box: new THREE.Box3().setFromObject(m), ...opts };
  if (opts.collide !== false) colliders.push(rec);
  return rec;
}
function refreshBox(rec) { rec.box.setFromObject(rec.mesh); }

// ---------- World ----------
// baseplate (classic green with studs)
addBox(0, -1, -15, 150, 2, 170, 0x2fa84f, { cast: false });
{ // stud grid (visual only)
  const geo = new THREE.CylinderGeometry(0.32, 0.32, 0.18, 12);
  const mat = MAT(0x37bd5c);
  const list = [];
  for (let x = -64; x <= 64; x += 4.5) for (let z = -88; z <= 56; z += 4.5) {
    if (x > -16 && x < 16 && z > -42 && z < -16) continue; // lava zone gap
    list.push([x, 0.09, z]);
  }
  const inst = new THREE.InstancedMesh(geo, mat, list.length);
  const d = new THREE.Object3D();
  list.forEach((p, i) => { d.position.set(p[0], p[1], p[2]); d.updateMatrix(); inst.setMatrixAt(i, d.matrix); });
  inst.receiveShadow = true; scene.add(inst);
}
// lava pool (kill zone, sits on baseplate)
const lava = new THREE.Mesh(new THREE.BoxGeometry(30, 0.25, 26),
  new THREE.MeshStandardMaterial({ color: 0xef2b1d, emissive: 0xff4400, emissiveIntensity: 0.9, roughness: 0.4 }));
lava.position.set(0, 0.13, -29); scene.add(lava);
const lavaLight = new THREE.PointLight(0xff5500, 30, 30); lavaLight.position.set(0, 3, -29); scene.add(lavaLight);
const LAVA = { x0: -15, x1: 15, z0: -42, z1: -16 };

// course
addBox(0, 0, 20, 8, 1, 8, 0x9ca3af);                       // spawn pad
addBox(0, 0.25, 13, 3, 1.5, 3, 0xf97316);
addBox(3, 0.75, 8, 3, 1.5, 3, 0xfacc15);
addBox(0, 1.25, 3, 3, 1.5, 3, 0x22c55e);
addBox(-3, 1.75, -2, 3, 1.5, 3, 0x3b82f6);
addBox(0, 2, -8, 4, 0.6, 8, 0xb45309);                      // bridge
addBox(0, 2, -15, 5.5, 0.6, 5.5, 0xe5e7eb);                 // checkpoint 1 deck
addBox(-4, 2, -21, 2.6, 0.6, 2.6, 0xa855f7);
addBox(0, 2.2, -25, 2.6, 0.6, 2.6, 0xa855f7);
addBox(4, 2.4, -29, 2.6, 0.6, 2.6, 0xa855f7);
const mover = addBox(0, 2.4, -33, 3, 0.6, 3, 0x06b6d4);     // moving platform
mover.mover = { axis: 'x', base: 0, amp: 5.5, speed: 1.1, phase: 0 };
mover.mesh.material.emissive = new THREE.Color(0x0e7490);
addBox(0, 2.4, -38, 5.5, 0.6, 5.5, 0xe5e7eb);               // checkpoint 2 deck
const pad1 = addBox(0, 2.85, -38, 2.4, 0.3, 2.4, 0x22ff66, {}); // bounce pad
pad1.bounce = true; pad1.mesh.material.emissive = new THREE.Color(0x16a34a);
addBox(0, 6, -44, 5.5, 0.6, 5.5, 0xe5e7eb);                 // tower / checkpoint 3
addBox(0, 6, -50.5, 2.2, 0.5, 8, 0xb45309);                 // spinner beam
addBox(0, 6, -57.5, 7.5, 0.6, 7.5, 0xfbbf24);               // finish gold deck
// stairs to bridge (decor + climbable)
addBox(-5.5, 0.4, -6, 2, 0.8, 2, 0xfb923c);
addBox(-4.5, 1.1, -7, 2, 0.8, 2, 0xfb923c);
// sandbox pads (safe build area)
addBox(20, 0.1, 16, 16, 0.6, 16, 0x93c5fd);
addBox(-20, 0.1, 16, 12, 0.6, 12, 0xfbcfe8);

// spinner bar (knock hazard)
const spinner = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.5, 0.5), MAT(0xef4444));
spinner.position.set(0, 6.9, -50.5); spinner.castShadow = true; scene.add(spinner);
const spinPole = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 12), MAT(0x1f2937));
spinPole.position.set(0, 6.5, -50.5); scene.add(spinPole);

// trophy
const trophyG = new THREE.Group();
{
  const gold = MAT(0xffd700, { metalness: 0.65, roughness: 0.25 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 1.2), MAT(0x1f2937)); base.position.y = 0.2;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 0.9, 14), gold); stem.position.y = 0.85;
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.32, 0.8, 16), gold); cup.position.y = 1.5;
  [base, stem, cup].forEach(m => { m.castShadow = true; trophyG.add(m); });
}
trophyG.position.set(0, 6.3, -58.5); scene.add(trophyG);

// checkpoints (pole + flag)
const checkpoints = [];
function addCheckpoint(x, y, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 10), MAT(0xe5e7eb)); pole.position.y = 1.5; pole.castShadow = true;
  const flag = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.08), MAT(0xef4444, { emissive: 0x7f1d1d })); flag.position.set(0.6, 2.5, 0);
  g.add(pole, flag); g.position.set(x, y, z); scene.add(g);
  const cp = { pos: new THREE.Vector3(x, y, z), flag, hit: false };
  checkpoints.push(cp); return cp;
}
addCheckpoint(3, 2.3, -15); addCheckpoint(-3, 2.7, -38); addCheckpoint(3, 6.3, -44);

// studs (collectibles)
const studs = [];
{
  const geo = new THREE.CylinderGeometry(0.45, 0.45, 0.16, 18);
  const mat = MAT(0xffd700, { metalness: 0.5, roughness: 0.3, emissive: 0x6b4e00 });
  const spots = [
    [0, 2, 13], [3, 2.6, 8], [0, 3.1, 3], [-3, 3.6, -2], [0, 3.4, -8],
    [0, 3.6, -12], [0, 3.6, -15], [-4, 3.4, -21], [0, 3.6, -25], [4, 3.8, -29],
    [0, 3.8, -33], [0, 3.8, -36], [0, 4.2, -38], [-1.5, 5, -40], [0, 6, -41.5],
    [0, 7.4, -44], [2, 7.4, -44], [0, 7.2, -47], [0, 7.2, -50.5], [0, 7.2, -54],
    [0, 7.4, -57.5], [20, 1.6, 16], [-20, 1.5, 16], [8, 1.4, 22],
  ];
  S.totalStuds = spots.length;
  spots.forEach((p, i) => {
    const m = new THREE.Mesh(geo, mat.clone()); m.position.set(p[0], p[1], p[2]);
    m.castShadow = true; scene.add(m);
    studs.push({ mesh: m, taken: false, phase: i * 0.5 });
  });
}

// decor: blocky trees + houses + clouds
function tree(x, z, s = 1) {
  addBox(x, 0.9 * s, z, 0.7 * s, 1.8 * s, 0.7 * s, 0x92400e, { collide: false });
  addBox(x, 2.2 * s, z, 2.2 * s, 1.6 * s, 2.2 * s, 0x16a34a, { collide: false });
}
tree(-12, 24); tree(12, 26, 1.3); tree(-16, 2, 0.9); tree(14, -4, 1.1); tree(-13, -48, 1.2); tree(13, -52);
function house(x, z, c) {
  addBox(x, 1.2, z, 5, 2.4, 4.4, c);
  const roof = addBox(x, 2.9, z, 5.8, 0.5, 5.2, 0x7c2d12); refreshBox(roof);
  addBox(x, 1.0, z + 2.25, 1.2, 1.8, 0.15, 0x451a03, { collide: false });
}
house(-26, 28, 0x60a5fa); house(30, 30, 0xf472b6);
const clouds = [];
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(4 + Math.random() * 5, 1.2, 2.5),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
  m.position.set(-50 + Math.random() * 100, 22 + Math.random() * 10, -70 + Math.random() * 110);
  scene.add(m); clouds.push(m);
}

// confetti
const CONF_N = 160;
const confetti = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.22, 0.05),
  new THREE.MeshBasicMaterial({}), CONF_N);
confetti.count = 0; scene.add(confetti);
const confettiVel = [];
{
  const cols = [0xe11d48, 0xf59e0b, 0x22c55e, 0x3b82f6, 0xa855f7, 0xffffff];
  const d = new THREE.Object3D(), c = new THREE.Color();
  for (let i = 0; i < CONF_N; i++) { confetti.setColorAt(i, c.setHex(cols[i % cols.length])); }
  confetti.instanceColor.needsUpdate = true;
}

// ---------- Player (blocky Roblox avatar) ----------
function faceTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = S.skin; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111';
  g.beginPath(); g.arc(42, 52, 9, 0, 7); g.arc(86, 52, 9, 0, 7); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 6; g.beginPath(); g.arc(64, 82, 24, 0.3, Math.PI - 0.3); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const player = new THREE.Group();
let torsoM, headM, armL, armR, legL, legR;
function buildAvatar() {
  while (player.children.length) { const k = player.children.pop(); k.geometry?.dispose?.(); }
  const skin = MAT(S.skin), shirt = MAT(0x2563eb), pants = MAT(0x16a34a);
  torsoM = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.5), shirt);
  torsoM.position.y = 1.2;
  headM = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.55),
    new THREE.MeshStandardMaterial({ map: faceTexture(), roughness: 0.7 }));
  headM.position.y = 1.9;
  armL = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.8, 0.32), skin); armL.position.set(-0.62, 1.2, 0);
  armR = armL.clone(); armR.position.x = 0.62;
  legL = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.8, 0.42), pants); legL.position.set(-0.2, 0.4, 0);
  legR = legL.clone(); legR.position.x = 0.2;
  [torsoM, headM, armL, armR, legL, legR].forEach(m => { m.castShadow = true; player.add(m); });
}
buildAvatar();
scene.add(player);
const P = { pos: S.spawn.clone(), vel: new THREE.Vector3(), grounded: false, coyote: 0, buffer: 0, face: 0, walk: 0 };
const PSIZE = { w: 0.8, h: 2.0, d: 0.8 };

// ghost preview for building
const ghost = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2),
  new THREE.MeshStandardMaterial({ color: S.buildColor, transparent: true, opacity: 0.5 }));
ghost.visible = false; scene.add(ghost);
const built = [];

// ---------- Input ----------
const keys = {};
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') { P.buffer = 0.15; e.preventDefault(); }
  if (e.code === 'KeyR') respawn();
  if (e.code === 'KeyB') placeBlock();
  if (e.code === 'KeyX') deleteBlock();
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys[e.code] = false);

// joystick
const joy = { x: 0, y: 0, id: null };
const joyEl = $('joystick'), stickEl = $('stick');
function joySet(dx, dy) {
  const r = 40, l = Math.hypot(dx, dy) || 1, k = Math.min(1, l / r);
  joy.x = (dx / l) * k; joy.y = (dy / l) * k;
  stickEl.style.transform = `translate(calc(-50% + ${joy.x * 36}px), calc(-50% + ${joy.y * 36}px))`;
}
joyEl.addEventListener('pointerdown', (e) => { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); joyMove(e); });
joyEl.addEventListener('pointermove', (e) => { if (e.pointerId === joy.id) joyMove(e); });
const joyEnd = (e) => { if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; stickEl.style.transform = 'translate(-50%,-50%)'; } };
joyEl.addEventListener('pointerup', joyEnd); joyEl.addEventListener('pointercancel', joyEnd);
function joyMove(e) { const r = joyEl.getBoundingClientRect(); joySet(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2)); }

// look-drag on right half of canvas
let lookId = null, lx = 0, ly = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.clientX > innerWidth * 0.35 && lookId === null && e.pointerType !== 'mouse') { lookId = e.pointerId; lx = e.clientX; ly = e.clientY; }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === lookId) { S.yaw -= (e.clientX - lx) * 0.006; S.pitch += (e.clientY - ly) * 0.004; S.pitch = Math.max(-0.2, Math.min(1.25, S.pitch)); lx = e.clientX; ly = e.clientY; }
});
const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
canvas.addEventListener('pointerup', lookEnd); canvas.addEventListener('pointercancel', lookEnd);
// desktop mouse orbit
let mouseDown = false, mx = 0, my = 0;
canvas.addEventListener('mousedown', (e) => { mouseDown = true; mx = e.clientX; my = e.clientY; });
addEventListener('mousemove', (e) => {
  if (!mouseDown) return;
  S.yaw -= (e.clientX - mx) * 0.005; S.pitch += (e.clientY - my) * 0.004;
  S.pitch = Math.max(-0.2, Math.min(1.25, S.pitch)); mx = e.clientX; my = e.clientY;
});
addEventListener('mouseup', () => mouseDown = false);
canvas.addEventListener('wheel', (e) => { S.dist = Math.max(4.5, Math.min(14, S.dist + e.deltaY * 0.01)); }, { passive: true });
canvas.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

$('jumpBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); P.buffer = 0.18; });
$('buildBtn').addEventListener('click', placeBlock);
$('delBtn').addEventListener('click', deleteBlock);
$('respawnBtn').addEventListener('click', respawn);
$('soundBtn').addEventListener('click', (e) => { S.sound = !S.sound; e.target.textContent = S.sound ? '🔊' : '🔇'; });
$('qualityBtn').addEventListener('click', () => {
  S.high = !S.high;
  renderer.shadowMap.enabled = S.high;
  renderer.setPixelRatio(S.high ? Math.min(devicePixelRatio, 2) : 1);
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  toast(S.high ? '✨ High quality' : '⚡ Performance mode');
});
$('helpBtn').addEventListener('click', () => helpEl.classList.remove('hidden'));
$('closeHelp').addEventListener('click', () => helpEl.classList.add('hidden'));
document.querySelectorAll('#colorBar .sw').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#colorBar .sw').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel'); S.buildColor = b.dataset.c; ghost.material.color.set(S.buildColor);
}));
document.querySelectorAll('.avatar-pick .sw').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.avatar-pick .sw').forEach(x => x.classList.remove('sel'));
  b.classList.add('sel'); S.skin = b.dataset.a; buildAvatar();
}));

function toast(msg, ms = 1800) {
  toastEl.textContent = msg; toastEl.style.opacity = 1;
  clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.style.opacity = 0, ms);
}
function fmtTime(t) { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; }

// ---------- Build / delete ----------
function placeBlock() {
  if (!S.started || built.length >= 40) { if (built.length >= 40) toast('Block limit reached (40)'); return; }
  const fx = Math.sin(P.face), fz = Math.cos(P.face);
  const gx = Math.round((P.pos.x + fx * 2.6) / 1.2) * 1.2;
  const gz = Math.round((P.pos.z + fz * 2.6) / 1.2) * 1.2;
  const gy = Math.round((P.pos.y + 0.6) / 1.2) * 1.2;
  const rec = addBox(gx, gy, gz, 1.2, 1.2, 1.2, new THREE.Color(S.buildColor).getHex());
  built.push(rec); sfx.build(); toast('🧱 Block placed (' + built.length + '/40)');
}
function deleteBlock() {
  let best = -1, bd = 5;
  built.forEach((r, i) => { const d = r.mesh.position.distanceTo(P.pos); if (d < bd) { bd = d; best = i; } });
  if (best < 0) { toast('No block nearby to remove'); return; }
  const [r] = built.splice(best, 1);
  scene.remove(r.mesh); const ci = colliders.indexOf(r); if (ci >= 0) colliders.splice(ci, 1);
  sfx.build(); toast('⌫ Block removed');
}

// ---------- Respawn / win ----------
function respawn() {
  P.pos.copy(S.spawn); P.pos.y += 0.5; P.vel.set(0, 0, 0);
  sfx.death();
}
function winGame() {
  if (S.won) return; S.won = true; sfx.win();
  let best = null;
  try {
    const old = parseFloat(localStorage.getItem('blockverse_best') || '1e9');
    if (S.time < old) { localStorage.setItem('blockverse_best', String(S.time)); best = 'New best time! 🎉'; }
  } catch {}
  winStats.innerHTML = `Time <b>${fmtTime(S.time)}</b> • Studs <b>${S.studs}/${S.totalStuds}</b><br>${best || ''}`;
  winEl.classList.remove('hidden');
  confetti.count = CONF_N;
  const d = new THREE.Object3D();
  for (let i = 0; i < CONF_N; i++) {
    d.position.set(P.pos.x + (Math.random() - 0.5) * 8, P.pos.y + 3 + Math.random() * 5, P.pos.z + (Math.random() - 0.5) * 8);
    d.updateMatrix(); confetti.setMatrixAt(i, d.matrix);
    confettiVel[i] = new THREE.Vector3((Math.random() - 0.5) * 3, -1 - Math.random() * 2, (Math.random() - 0.5) * 3);
  }
  confetti.instanceMatrix.needsUpdate = true;
}
$('againBtn').addEventListener('click', () => {
  winEl.classList.add('hidden'); S.won = false; S.time = 0; S.studs = 0; S.flags = 0;
  studs.forEach(s => { s.taken = false; s.mesh.visible = true; });
  checkpoints.forEach(c => { c.hit = false; c.flag.material.color.set(0xef4444); });
  S.spawn.set(0, 2.2, 20); confetti.count = 0; respawn();
});
$('freeBtn').addEventListener('click', () => winEl.classList.add('hidden'));

// ---------- Start ----------
playBtn.addEventListener('click', () => {
  ac(); S.started = true; S.time = 0;
  menu.classList.add('hidden'); hud.classList.remove('hidden');
  touchUI.classList.remove('hidden'); colorBar.classList.remove('hidden');
  toast('Collect studs ⭐ — reach the 🏆!');
});

// ---------- Physics ----------
const tmpBox = new THREE.Box3(), pBox = new THREE.Box3();
function collidePlayer() {
  pBox.min.set(P.pos.x - PSIZE.w / 2, P.pos.y, P.pos.z - PSIZE.d / 2);
  pBox.max.set(P.pos.x + PSIZE.w / 2, P.pos.y + PSIZE.h, P.pos.z + PSIZE.d / 2);
  P.grounded = false;
  for (const c of colliders) {
    if (!pBox.intersectsBox(c.box)) continue;
    // penetration depths
    const dx1 = pBox.max.x - c.box.min.x, dx2 = c.box.max.x - pBox.min.x;
    const dy1 = pBox.max.y - c.box.min.y, dy2 = c.box.max.y - pBox.min.y;
    const dz1 = pBox.max.z - c.box.min.z, dz2 = c.box.max.z - pBox.min.z;
    const m = Math.min(dx1, dx2, dy1, dy2, dz1, dz2);
    if (m === dy2 && P.vel.y <= 0.01) {           // landed on top
      P.pos.y = c.box.max.y + 0.001; P.vel.y = 0; P.grounded = true;
      if (c.bounce) { P.vel.y = 13.5; P.grounded = false; sfx.bounce(); }
    } else if (m === dy1 && P.vel.y > 0) { P.pos.y = c.box.min.y - PSIZE.h - 0.001; P.vel.y = 0; }
    else if (m === dx1) P.pos.x = c.box.min.x - PSIZE.w / 2 - 0.001;
    else if (m === dx2) P.pos.x = c.box.max.x + PSIZE.w / 2 + 0.001;
    else if (m === dz1) P.pos.z = c.box.min.z - PSIZE.d / 2 - 0.001;
    else if (m === dz2) P.pos.z = c.box.max.z + PSIZE.d / 2 + 0.001;
    pBox.min.set(P.pos.x - PSIZE.w / 2, P.pos.y, P.pos.z - PSIZE.d / 2);
    pBox.max.set(P.pos.x + PSIZE.w / 2, P.pos.y + PSIZE.h, P.pos.z + PSIZE.d / 2);
  }
}

// ---------- Main loop ----------
const clock = new THREE.Clock();
let elapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  elapsed += dt;

  // movers / spinner / lava / clouds / trophy
  mover.mesh.position.x = mover.mover.base + Math.sin(elapsed * mover.mover.speed) * mover.mover.amp;
  refreshBox(mover);
  spinner.rotation.y = elapsed * 1.6;
  lava.material.emissiveIntensity = 0.75 + Math.sin(elapsed * 3) * 0.25;
  lavaLight.intensity = 26 + Math.sin(elapsed * 3) * 8;
  trophyG.rotation.y = elapsed * 0.8; trophyG.position.y = 6.3 + Math.sin(elapsed * 2) * 0.12;
  clouds.forEach((c, i) => { c.position.x += dt * (0.4 + i * 0.05); if (c.position.x > 70) c.position.x = -70; });
  studs.forEach(s => { if (!s.taken) { s.mesh.rotation.y = elapsed * 2 + s.phase; s.mesh.position.y += Math.sin(elapsed * 3 + s.phase) * 0.003; } });

  // moving platform carry
  if (S.started && !S.won) S.time += dt;

  // input direction (camera-relative)
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz -= 1;
  if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  ix += joy.x; iz += joy.y;
  const il = Math.hypot(ix, iz);
  if (il > 1) { ix /= il; iz /= il; }
  const hasInput = il > 0.08;
  const sin = Math.sin(S.yaw), cos = Math.cos(S.yaw);
  const wx = ix * cos - iz * sin, wz = -ix * sin - iz * cos;

  // physics
  const SPEED = 6.6;
  const acc = P.grounded ? 42 : 16;
  P.vel.x += (wx * SPEED - P.vel.x) * Math.min(1, (P.grounded ? 12 : 3.2) * dt);
  P.vel.z += (wz * SPEED - P.vel.z) * Math.min(1, (P.grounded ? 12 : 3.2) * dt);
  P.vel.y -= 24 * dt;
  if (P.vel.y < -30) P.vel.y = -30;
  if (P.buffer > 0) P.buffer -= dt;
  if (P.coyote > 0) P.coyote -= dt;
  if (P.grounded) P.coyote = 0.13;
  if (P.buffer > 0 && (P.grounded || P.coyote > 0)) {
    P.vel.y = 9.2; P.grounded = false; P.coyote = 0; P.buffer = 0; sfx.jump();
  }
  // ride mover: if standing on it, add its velocity
  const prevX = mover.mesh.position.x;
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; P.pos.y += P.vel.y * dt;
  collidePlayer();
  // carry check (feet near mover top)
  if (Math.abs(P.pos.y - (mover.box.max.y)) < 0.15 &&
      P.pos.x > mover.box.min.x - 0.4 && P.pos.x < mover.box.max.x + 0.4 &&
      P.pos.z > mover.box.min.z - 0.4 && P.pos.z < mover.box.max.z + 0.4) {
    P.pos.x += (mover.mesh.position.x - prevX);
  }
  void acc;

  // lava / fall
  const inLava = P.pos.x > LAVA.x0 && P.pos.x < LAVA.x1 && P.pos.z > LAVA.z0 && P.pos.z < LAVA.z1 && P.pos.y < 3.2;
  if (inLava || P.pos.y < -6) {
    if (S.started) { toast('🔥 Ouch! Back to checkpoint'); respawn(); }
    else { P.pos.copy(S.spawn); P.vel.set(0, 0, 0); }
  }

  // spinner knock
  {
    const dx = P.pos.x - spinner.position.x, dz = P.pos.z - spinner.position.z;
    if (Math.abs(P.pos.y - 6) < 2 && Math.hypot(dx, dz) < 4.2) {
      const ang = Math.atan2(dx, dz) - spinner.rotation.y;
      const bx = Math.sin(spinner.rotation.y) * 3.8, bz = Math.cos(spinner.rotation.y) * 3.8;
      if (Math.abs(dx * Math.cos(spinner.rotation.y) - dz * Math.sin(spinner.rotation.y)) < 1 && Math.abs(dx * Math.sin(spinner.rotation.y) + dz * Math.cos(spinner.rotation.y)) < 4) {
        P.vel.x = bx * 2.2; P.vel.z = bz * 2.2; P.vel.y = 6;
        toast('🌀 Bonk! Time it right'); tone(200, 0.2, 'sawtooth', 0.1, -100);
      }
      void ang;
    }
  }

  // studs
  studs.forEach(s => {
    if (s.taken || !S.started) return;
    if (s.mesh.position.distanceToSquared(new THREE.Vector3(P.pos.x, P.pos.y + 1, P.pos.z)) < 1.7) {
      s.taken = true; s.mesh.visible = false; S.studs++; sfx.coin();
      if (S.studs === S.totalStuds) toast('⭐ ALL STUDS! Amazing!');
      else if (S.studs % 6 === 0) toast(`⭐ ${S.studs}/${S.totalStuds} studs!`);
    }
  });

  // checkpoints
  checkpoints.forEach((c, i) => {
    if (c.hit) return;
    if (Math.hypot(P.pos.x - c.pos.x, P.pos.z - c.pos.z) < 2.4 && Math.abs(P.pos.y - c.pos.y) < 3) {
      c.hit = true; S.flags++; c.flag.material.color.set(0x22c55e);
      S.spawn.set(c.pos.x, c.pos.y + 0.4, c.pos.z);
      sfx.check();
      cpMsg.textContent = `🏁 Checkpoint ${S.flags}/${S.totalFlags}!`;
      cpMsg.style.opacity = 1; setTimeout(() => cpMsg.style.opacity = 0, 1400);
    }
  });

  // trophy win
  if (S.started && !S.won && Math.hypot(P.pos.x - trophyG.position.x, P.pos.z - trophyG.position.z) < 2.4 && Math.abs(P.pos.y - 6) < 3) winGame();

  // avatar animation
  player.position.copy(P.pos);
  if (hasInput) {
    const target = Math.atan2(wx, wz);
    let d = target - P.face;
    while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    P.face += d * Math.min(1, 12 * dt);
    P.walk += dt * 11;
  } else P.walk *= 0.9;
  player.rotation.y = P.face;
  const sw = hasInput && P.grounded ? Math.sin(P.walk) * 0.7 : 0;
  armL.rotation.x = sw; armR.rotation.x = -sw; legL.rotation.x = -sw; legR.rotation.x = sw;
  if (!P.grounded) { armL.rotation.x = -0.6; armR.rotation.x = -0.6; }

  // ghost preview
  if (S.started) {
    const fx = Math.sin(P.face), fz = Math.cos(P.face);
    ghost.position.set(P.pos.x + fx * 2.6, P.pos.y + 0.6, P.pos.z + fz * 2.6);
    ghost.visible = true; ghost.rotation.y = elapsed;
  } else ghost.visible = false;

  // confetti fall
  if (confetti.count > 0) {
    const d = new THREE.Object3D();
    for (let i = 0; i < CONF_N; i++) {
      confetti.getMatrixAt(i, d.matrix); d.matrix.decompose(d.position, d.quaternion, d.scale);
      d.position.addScaledVector(confettiVel[i], dt);
      d.rotation.x += dt * 3; d.rotation.z += dt * 2;
      if (d.position.y < 6.4) { d.position.y = P.pos.y + 6 + Math.random() * 3; }
      d.updateMatrix(); confetti.setMatrixAt(i, d.matrix);
    }
    confetti.instanceMatrix.needsUpdate = true;
  }

  // camera
  let cx, cy, cz, look;
  if (!S.started) { // menu orbit
    const a = elapsed * 0.25;
    cx = P.pos.x + Math.sin(a) * 11; cz = P.pos.z + Math.cos(a) * 11; cy = P.pos.y + 5;
    camera.position.set(cx, cy, cz); camera.lookAt(P.pos.x, P.pos.y + 1.4, P.pos.z);
  } else {
    const cd = S.dist;
    cx = P.pos.x - Math.sin(S.yaw) * Math.cos(S.pitch) * cd;
    cz = P.pos.z - Math.cos(S.yaw) * Math.cos(S.pitch) * cd;
    cy = P.pos.y + 1.6 + Math.sin(S.pitch) * cd;
    cy = Math.max(cy, 0.6);
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, 10 * dt));
    look = new THREE.Vector3(P.pos.x, P.pos.y + 1.5, P.pos.z);
    camera.lookAt(look);
  }

  // HUD
  if (S.started) {
    scoreEl.textContent = `⭐ ${S.studs}/${S.totalStuds}`;
    flagsEl.textContent = `🏁 ${S.flags}/${S.totalFlags}`;
    timerEl.textContent = '⏱ ' + fmtTime(S.time);
  }
  renderer.render(scene, camera);
}
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// expose for automated checks
window.__blockverse = { S, P, studs, checkpoints, respawn, placeBlock };
