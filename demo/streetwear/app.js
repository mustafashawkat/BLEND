/* KHAYT, a concept page by Blend. The 3D fitting room.
 *
 * One WebGL canvas sits fixed behind the page. A faceless mannequin stands in
 * it, and every garment is made of pattern pieces: each piece is a grid that
 * knows two shapes, flat (as it was cut) and wrapped (as it sits on the body).
 * The flat shape is the wrapped one unrolled, so the pieces have the outlines
 * of real patterns. Scrolling the story moves the pieces:
 *
 *   on the body  ->  laid flat on the fabric  ->  cut out
 *   ->  the table slides aside  ->  flown back and wrapped on, one garment at a time
 *
 * A piece has three poses while flat (layout: on the fabric; aside: the
 * table moved beside him; tangent: touching the body where it will sit) and one
 * deformation, the wrap, which bends it round the body like a page curling.
 * The customizer drives the same parameters with time instead of scroll.
 */
import * as THREE from 'three';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot');                         // product photography mode
const REDUCE = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOBILE = matchMedia('(max-width: 760px)').matches;

/* ---------- small maths ---------- */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const smooth = t => t * t * (3 - 2 * t);
const sgnpow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

function table(rows) {                      // Catmull-Rom through [y, a, b] rows
  const n = rows.length;
  return y => {
    if (y <= rows[0][0]) return [rows[0][1], rows[0][2]];
    if (y >= rows[n - 1][0]) return [rows[n - 1][1], rows[n - 1][2]];
    let i = 0; while (rows[i + 1][0] < y) i++;
    const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[i + 1], p3 = rows[Math.min(n - 1, i + 2)];
    const t = (y - p1[0]) / (p2[0] - p1[0]);
    const cr = (a, b, c, d) => .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    return [cr(p0[1], p1[1], p2[1], p3[1]), cr(p0[2], p1[2], p2[2], p3[2])];
  };
}

/* ---------- the body ---------- */
// torso cross-section: half width a (x) and half depth b (z) at height y
const TORSO = table([
  [0.76, 0.150, 0.104], [0.86, 0.166, 0.112], [0.95, 0.171, 0.111], [1.05, 0.157, 0.101],
  [1.12, 0.149, 0.098], [1.22, 0.158, 0.107], [1.32, 0.170, 0.116], [1.40, 0.178, 0.110],
  [1.45, 0.181, 0.097], [1.48, 0.160, 0.085], [1.505, 0.108, 0.068], [1.525, 0.064, 0.056],
  [1.545, 0.051, 0.050], [1.68, 0.047, 0.047]]);

function torsoPt(theta, y, off = 0) {      // theta 0 = front (+z), pi/2 = +x
  const [a, b] = TORSO(y);
  const s = Math.sin(theta), c = Math.cos(theta);
  return V((a + off) * sgnpow(s, .86), y, (b + off) * sgnpow(c, .86) + 0.006 * smooth(seg(y, 1.1, 1.32)) * Math.max(0, c));
}

// limbs are tubes along a curve with a radius profile
function limb(points, radii) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const n = radii.length;
  const radius = s => {
    const f = s * (n - 1), i = Math.min(n - 2, Math.floor(f)), t = smooth(f - i);
    return lerp(radii[i], radii[i + 1], t);
  };
  const ref = V(0, 0, 1);
  return {
    curve, radius,
    frame(s) {
      const c = curve.getPointAt(s), T = curve.getTangentAt(s);
      const N = ref.clone().sub(T.clone().multiplyScalar(ref.dot(T))).normalize();
      const B = new THREE.Vector3().crossVectors(T, N).normalize();
      return { c, T, N, B };
    },
    pt(theta, s, off = 0) {
      const { c, N, B } = this.frame(s);
      const r = radius(s) + off;
      return c.clone().addScaledVector(N, Math.cos(theta) * r).addScaledVector(B, Math.sin(theta) * r);
    },
    // the angle on this tube that faces a given direction (for putting seams on the inside)
    angleFacing(dir, s = .5) {
      const { N, B } = this.frame(s);
      return Math.atan2(dir.dot(B), dir.dot(N));
    },
  };
}

const ARM = side => limb(
  [V(side * .142, 1.445, -.006), V(side * .192, 1.40, -.010), V(side * .228, 1.17, -.012), V(side * .254, .945, .022), V(side * .262, .83, .036)],
  [.052, .047, .036, .027, .021]);
const LEG = side => limb(
  [V(side * .088, .93, 0), V(side * .092, .70, .004), V(side * .098, .48, .012), V(side * .100, .26, -.004), V(side * .102, .085, -.010)],
  [.090, .074, .052, .054, .034]);

const ARMS = { L: ARM(-1), R: ARM(1) };
const LEGS = { L: LEG(-1), R: LEG(1) };
const HEAD = { c: V(0, 1.748, .008), r: V(.088, .118, .100) };

/* ---------- renderer ---------- */
const canvas = document.getElementById('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!SHOT });
} catch (e) {
  document.documentElement.classList.add('no-gl');
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MOBILE ? 1.35 : 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), .04).texture;

const camera = new THREE.PerspectiveCamera(30, 1, .05, 30);

// light: a white key with the shadow, and two coloured rims that draw the
// silhouette in the brand's orange and cobalt
scene.add(new THREE.HemisphereLight(0xffffff, 0x221a14, .35));
const key = new THREE.DirectionalLight(0xfff4ea, 2.4);
key.position.set(1.6, 3.2, 2.4);
key.castShadow = true;
key.shadow.mapSize.set(MOBILE ? 1024 : 1536, MOBILE ? 1024 : 1536);
Object.assign(key.shadow.camera, { left: -1.3, right: 1.3, top: 2.1, bottom: -.3, near: .5, far: 8 });
key.shadow.bias = -.0004; key.shadow.normalBias = .02;
scene.add(key);
const rimO = new THREE.DirectionalLight(0xff5a1f, 3.4); rimO.position.set(-2.4, 2.0, -1.6); scene.add(rimO);
const rimB = new THREE.DirectionalLight(0x3d63ff, 3.0); rimB.position.set(2.6, 1.4, -1.8); scene.add(rimB);
const fill = new THREE.DirectionalLight(0xffffff, .5); fill.position.set(-1.5, 1.2, 2.5); scene.add(fill);

const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 48), new THREE.ShadowMaterial({ opacity: .42 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);

const body = new THREE.Group();           // the mannequin and everything worn
scene.add(body);

/* ---------- the mannequin ---------- */
const skin = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: .3, metalness: 0, clearcoat: .9, clearcoatRoughness: .22, envMapIntensity: .9 });

function gridGeometry(nu, nv, fn) {        // fn(u, v) -> Vector3, u,v in [0,1]
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3), idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv), k = (j * (nu + 1) + i) * 3;
    pos[k] = p.x; pos[k + 1] = p.y; pos[k + 2] = p.z;
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
function addSkin(geo) {
  const m = new THREE.Mesh(geo, skin);
  m.castShadow = true; m.receiveShadow = true;
  body.add(m); return m;
}
// torso, closed at the bottom
addSkin(gridGeometry(72, 70, (u, v) => torsoPt(-u * TAU, lerp(1.68, .76, v))));
{
  const cap = gridGeometry(72, 6, (u, v) => { const p = torsoPt(-u * TAU, .76); return V(p.x * (1 - v), .76 - .02 * Math.sin(v * Math.PI / 2), p.z * (1 - v)); });
  addSkin(cap);
}
// head: an egg, no face
{
  const h = addSkin(new THREE.SphereGeometry(1, 56, 40));
  h.scale.copy(HEAD.r); h.position.copy(HEAD.c); h.rotation.x = -.1;
}
for (const s of ['L', 'R']) {
  const a = ARMS[s], l = LEGS[s], sx = s === 'L' ? -1 : 1;
  addSkin(gridGeometry(36, 60, (u, v) => a.pt(u * TAU, v)));
  addSkin(gridGeometry(36, 70, (u, v) => l.pt(u * TAU, v)));
  const sh = addSkin(new THREE.SphereGeometry(.049, 32, 24)); sh.position.set(sx * .162, 1.43, -.006);
  const hand = addSkin(new THREE.SphereGeometry(1, 24, 18)); hand.scale.set(.022, .05, .032); hand.position.copy(a.curve.getPointAt(1)).add(V(sx * .002, -.035, 0));
}

/* ---------- sneakers (always on) ---------- */
{
  const sole = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: .55 });
  const upper = new THREE.MeshPhysicalMaterial({ color: 0xe9e4da, roughness: .7, sheen: .6, sheenColor: 0xffffff });
  const tab = new THREE.MeshStandardMaterial({ color: 0xff4f1a, roughness: .5 });
  for (const sx of [-1, 1]) {
    const g = new THREE.Group(); g.position.set(sx * .104, 0, .035); g.rotation.y = sx * .08;
    const so = new THREE.Mesh(new THREE.CapsuleGeometry(.05, .19, 8, 20), sole);
    so.rotation.x = Math.PI / 2; so.scale.set(1.05, 1, .42); so.position.set(0, .021, 0);
    const up = new THREE.Mesh(new THREE.CapsuleGeometry(.046, .15, 8, 20), upper);
    up.rotation.x = Math.PI / 2; up.scale.set(.95, 1, .8); up.position.set(0, .056, -.012);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(.04, .046, .07, 20), upper); collar.position.set(0, .085, -.06);
    const heel = new THREE.Mesh(new THREE.BoxGeometry(.012, .05, .02), tab); heel.position.set(0, .09, -.105);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(.094, .012, .16), tab); stripe.position.set(0, .046, -.005);
    for (const m of [so, up, collar, heel, stripe]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    body.add(g);
  }
}

/* ---------- fabric textures, drawn once ---------- */
function canvasTex(size, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseField(size, cell) {             // smooth value noise, 0..1
  const g = [], n = Math.ceil(size / cell) + 1;
  for (let i = 0; i < n * n; i++) g.push(Math.random());
  return (x, y) => {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy), tx = smooth(fx - ix), ty = smooth(fy - iy);
    const at = (a, b) => g[((b % (n - 1)) * n) + (a % (n - 1))];
    return lerp(lerp(at(ix, iy), at(ix + 1, iy), tx), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), tx), ty);
  };
}
function heightToNormal(h, size, strength) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d'), img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), k = (y * size + x) * 4;
    img.data[k] = (-dx / l * .5 + .5) * 255; img.data[k + 1] = (dy / l * .5 + .5) * 255; img.data[k + 2] = (1 / l * .5 + .5) * 255; img.data[k + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}
function fabric(kind) {
  const S = 256, h = new Float32Array(S * S), col = new Float32Array(S * S);
  const nz = noiseField(S, 16), nz2 = noiseField(S, 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let hh, cc;
    if (kind === 'jersey') {                // knit: columns of little Vs
      const cx = x % 8, cy = y % 8, v = Math.abs(cx - 3.5) - (cy - 4) * .45;
      hh = .5 + .5 * Math.cos(v * 1.4) * Math.sin((x % 8) / 8 * Math.PI);
      cc = .86 + .1 * nz(x, y) + .05 * nz2(x, y);
    } else if (kind === 'twill') {          // fine diagonal wale
      hh = .5 + .5 * Math.sin((x + y) / S * TAU * 48);
      cc = .84 + .1 * nz(x, y) + .06 * (hh - .5);
    } else {                                // denim: steep twill, white weft showing, slubs
      const w = .5 + .5 * Math.sin((x * 2 + y) / S * TAU * 36);
      const slub = Math.pow(nz(x * 6 % S, y), 6);
      hh = w;
      cc = .62 + .26 * w + .16 * slub + .06 * nz2(x, y);
    }
    h[y * S + x] = hh; col[y * S + x] = Math.min(1, cc);
  }
  const map = canvasTex(S, (ctx) => {
    const img = ctx.createImageData(S, S);
    for (let i = 0; i < S * S; i++) { const v = col[i] * 255; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  });
  return { map, normalMap: heightToNormal(h, S, kind === 'denim' ? 2.2 : 1.6) };
}

/* ---------- garments ---------- */
const COLORS = {
  tee:    { 'Washed black': 0x2a2a2d, 'Bone': 0xe7e0d2, 'Safety orange': 0xff5a1f, 'Cobalt': 0x2f4fe0 },
  cargo:  { 'Olive': 0x5d6142, 'Black': 0x232325, 'Sand': 0xb9a888 },
  jacket: { 'Indigo': 0x2a3d63, 'Black': 0x26272c, 'Ice': 0x8fa3bd },
};
const PRICE = { tee: 850, cargo: 1250, jacket: 1900 };
const KIND = { tee: 'jersey', cargo: 'twill', jacket: 'denim' };
const DENSITY = { jersey: 7, twill: 6, denim: 5 };

const MATS = {};
for (const g of ['tee', 'cargo', 'jacket']) {
  const f = fabric(KIND[g]);
  const first = Object.values(COLORS[g])[0];
  MATS[g] = new THREE.MeshPhysicalMaterial({
    color: first, map: f.map, normalMap: f.normalMap, normalScale: new THREE.Vector2(.55, .55),
    roughness: g === 'jacket' ? .78 : .9, sheen: g === 'tee' ? 1 : .5, sheenRoughness: .7, sheenColor: 0xffffff,
    side: THREE.DoubleSide, envMapIntensity: .55,
  });
  MATS[g + 'Trim'] = MATS[g].clone();
  MATS[g + 'Trim'].color.multiplyScalar(.72);
}

// the print on the tee's chest, redrawn when the choice changes
const printCanvas = document.createElement('canvas'); printCanvas.width = 512; printCanvas.height = 384;
const printTex = new THREE.CanvasTexture(printCanvas); printTex.colorSpace = THREE.SRGBColorSpace;
const printMat = new THREE.MeshStandardMaterial({ map: printTex, transparent: true, roughness: .55, polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false, side: THREE.DoubleSide });
function drawPrint(kind, teeHex) {
  const c = printCanvas.getContext('2d'), W = 512, H = 384;
  c.clearRect(0, 0, W, H);
  const lum = ((teeHex >> 16 & 255) * .3 + (teeHex >> 8 & 255) * .59 + (teeHex & 255) * .11) / 255;
  const ink = lum > .55 ? '#141416' : '#efe9dd';
  c.fillStyle = ink; c.textAlign = 'center'; c.textBaseline = 'middle';
  if (kind === 'KHAYT') {
    if ('fontStretch' in c) c.fontStretch = 'expanded';
    c.font = '900 118px Archivo, Impact, sans-serif'; c.fillText('KHAYT', W / 2, H / 2 - 20);
    if ('fontStretch' in c) c.fontStretch = 'normal';
    c.fillStyle = '#ff4f1a'; c.font = 'bold 30px "Space Mono", monospace'; c.fillText('DROP 03 · CAIRO', W / 2, H / 2 + 92);
  } else if (kind === 'خيط') {
    c.font = '250px Lalezar, sans-serif'; c.fillText('خيط', W / 2, H / 2 + 10);
  }
  printTex.needsUpdate = true;
}

/* A piece: a (nu+1) x (nv+1) grid. fn(u, v) gives the wrapped position on the
   body (v = 0 is the top edge). span is the angle the piece wraps through,
   used to pick the bend radius of each row. */
function makePiece(garment, name, nu, nv, fn, span, opts = {}) {
  const n = (nu + 1) * (nv + 1);
  const W = new Float32Array(n * 3), F = new Float32Array(n * 2), R = new Float32Array(n), VF = new Float32Array(n);
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const p = fn(i / nu, j / nv), k = j * (nu + 1) + i;
    W[k * 3] = p.x; W[k * 3 + 1] = p.y; W[k * 3 + 2] = p.z;
  }
  const w = k => V(W[k * 3], W[k * 3 + 1], W[k * 3 + 2]);
  // unroll: x is arc length along each row, y is arc length down the middle column
  const ic = nu >> 1, jc = nv >> 1;
  const fy = [0];
  for (let j = 1; j <= nv; j++) fy.push(fy[j - 1] + w(j * (nu + 1) + ic).distanceTo(w((j - 1) * (nu + 1) + ic)));
  for (let j = 0; j <= nv; j++) {
    const xs = [0];
    for (let i = 1; i <= nu; i++) xs.push(xs[i - 1] + w(j * (nu + 1) + i).distanceTo(w(j * (nu + 1) + i - 1)));
    const len = xs[nu], mid = xs[ic];
    for (let i = 0; i <= nu; i++) {
      const k = j * (nu + 1) + i;
      F[k * 2] = xs[i] - mid; F[k * 2 + 1] = fy[jc] - fy[j];
      R[k] = Math.max(.02, len / span); VF[k] = j / nv;
    }
  }
  // the tangent frame at the centre: where the flat piece first touches the body
  const kc = jc * (nu + 1) + ic;
  const P = w(kc);
  let X = w(kc + 1).sub(w(kc - 1)).normalize();
  const up = w(kc - (nu + 1)).sub(w(kc + (nu + 1)));
  let Z = new THREE.Vector3().crossVectors(X, up).normalize();
  const rowMid = new THREE.Vector3(); for (let i = 0; i <= nu; i++) rowMid.add(w(jc * (nu + 1) + i)); rowMid.divideScalar(nu + 1);
  if (span < 6 ? Z.dot(P.clone().sub(rowMid)) < 0 : Z.dot(P.clone().sub(opts.axis || rowMid)) < 0) {
    X.negate(); for (let k = 0; k < n; k++) F[k * 2] = -F[k * 2];
    Z = new THREE.Vector3().crossVectors(X, up).normalize();
  }
  const Y = new THREE.Vector3().crossVectors(Z, X).normalize();
  const tq = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));

  const geo = gridGeometry(nu, nv, () => V(0, 0, 0));
  const uv = new Float32Array(n * 2), d = DENSITY[KIND[garment]];
  for (let k = 0; k < n; k++) { uv[k * 2] = F[k * 2] * d; uv[k * 2 + 1] = F[k * 2 + 1] * d; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(geo, opts.mat || MATS[garment]);
  mesh.castShadow = true; mesh.receiveShadow = true;
  body.add(mesh);
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (let k = 0; k < n; k++) { minX = Math.min(minX, F[k * 2]); maxX = Math.max(maxX, F[k * 2]); minY = Math.min(minY, F[k * 2 + 1]); maxY = Math.max(maxY, F[k * 2 + 1]); }
  // wrapped normals, for decals and stitches that sit just above the cloth
  const wg = gridGeometry(nu, nv, (u, v) => fn(u, v));
  const WN = wg.attributes.normal.array; wg.dispose();
  // normals of a grid built this way point inward or outward depending on winding; make them point out
  const flip = (() => { const nn = V(WN[kc * 3], WN[kc * 3 + 1], WN[kc * 3 + 2]); return nn.dot(Z) < 0 ? -1 : 1; })();
  const piece = { garment, name, nu, nv, n, W, F, R, VF, WN, flip, P, X, Y, Z, tq, mesh, geo,
    bounds: { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY }, mode: null, last: -1, children: [] };
  return piece;
}

/* a patch that lives on a piece (the print, a pocket): the same mapping, on a
   sub-rectangle of the piece's grid, lifted a little off the cloth */
function makeDecal(parent, i0, i1, j0, j1, nu, nv, lift, mat, uvMode = 'unit') {
  const P = parent, n = (nu + 1) * (nv + 1);
  const W = new Float32Array(n * 3), F = new Float32Array(n * 2), R = new Float32Array(n), VF = new Float32Array(n), UV = new Float32Array(n * 2);
  const at = (arr, dim, fi, fj, c) => {
    const i = Math.min(P.nu - 1, Math.floor(fi)), j = Math.min(P.nv - 1, Math.floor(fj)), ti = fi - i, tj = fj - j;
    const k = (a, b) => (b * (P.nu + 1) + a) * dim + c;
    return lerp(lerp(arr[k(i, j)], arr[k(i + 1, j)], ti), lerp(arr[k(i, j + 1)], arr[k(i + 1, j + 1)], ti), tj);
  };
  const d = DENSITY[KIND[P.garment]];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const fi = lerp(i0, i1, i / nu), fj = lerp(j0, j1, j / nv), k = j * (nu + 1) + i;
    const nrm = V(at(P.WN, 3, fi, fj, 0), at(P.WN, 3, fi, fj, 1), at(P.WN, 3, fi, fj, 2)).normalize().multiplyScalar(P.flip * lift);
    for (let c = 0; c < 3; c++) W[k * 3 + c] = at(P.W, 3, fi, fj, c) + nrm.getComponent(c);
    F[k * 2] = at(P.F, 2, fi, fj, 0); F[k * 2 + 1] = at(P.F, 2, fi, fj, 1);
    R[k] = at(P.R, 1, fi, fj, 0) + lift; VF[k] = at(P.VF, 1, fi, fj, 0);
    if (uvMode === 'unit') { UV[k * 2] = i / nu; UV[k * 2 + 1] = 1 - j / nv; }
    else { UV[k * 2] = F[k * 2] * d; UV[k * 2 + 1] = F[k * 2 + 1] * d; }
  }
  const geo = gridGeometry(nu, nv, () => V(0, 0, 0));
  geo.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = mat !== printMat; mesh.receiveShadow = true; mesh.renderOrder = 2;
  body.add(mesh);
  const dec = { decal: true, parent: P, n, nu, nv, W, F, R, VF, lift, mesh, geo, mode: null, last: -1 };
  P.children.push(dec);
  return dec;
}

/* stitches: dashed orange lines along seams and hems, only on the finished garment */
const stitchMat = new THREE.LineDashedMaterial({ color: 0xff5a1f, dashSize: .007, gapSize: .005, transparent: true, opacity: 0 });
function stitchLine(piece, list) {         // list of grid [i, j] (fractional ok) along the seam
  const pts = list.map(([fi, fj]) => {
    const i = Math.min(piece.nu - 1, Math.floor(fi)), j = Math.min(piece.nv - 1, Math.floor(fj)), ti = fi - i, tj = fj - j;
    const g = (a, b, c) => piece.W[(b * (piece.nu + 1) + a) * 3 + c], gn = (a, b, c) => piece.WN[(b * (piece.nu + 1) + a) * 3 + c];
    const bl = (f, c) => lerp(lerp(f(i, j, c), f(i + 1, j, c), ti), lerp(f(i, j + 1, c), f(i + 1, j + 1, c), ti), tj);
    const nn = V(bl(gn, 0), bl(gn, 1), bl(gn, 2)).normalize().multiplyScalar(piece.flip * .0035);
    return V(bl(g, 0), bl(g, 1), bl(g, 2)).add(nn);
  });
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, stitchMat);
  line.computeLineDistances();
  line.userData.count = pts.length;
  body.add(line);
  return line;
}
const rowLine = (p, j, i0 = 0, i1 = p.nu, steps = 60) => Array.from({ length: steps + 1 }, (_, s) => [lerp(i0, i1, s / steps), j]);
const colLine = (p, i, j0 = 0, j1 = p.nv, steps = 60) => Array.from({ length: steps + 1 }, (_, s) => [i, lerp(j0, j1, s / steps)]);

const G = { tee: [], cargo: [], jacket: [] };      // pieces per garment
const STITCH = { tee: [], cargo: [], jacket: [] };
const EXTRA = { tee: [], cargo: [], jacket: [] };  // rigid trims shown only when finished

// small wrinkles: folds that run down the cloth, and a few across at the waist
const folds = (theta, y, amp, lo, hi) => amp * Math.sin(theta * 7 + y * 9) * Math.sin(theta * 3.1 - y * 4.7) * seg(y, hi, lo);

/* --- the tee: jersey, boxy, dropped shoulder --- */
{
  const off = .011;
  const yTopF = th => 1.53 - .042 * Math.pow(Math.cos(th), 2);
  const yTopB = th => 1.538 - .012 * Math.pow(Math.cos(th - Math.PI), 2);
  const hem = .925;
  const tee = (th, y) => {
    const flare = .012 * smooth(seg(y, 1.17, 1.07)) + .012 * smooth(seg(y, 1.06, hem)) + .004 * smooth(seg(y, 1.2, 1.38));
    return torsoPt(th, y, off + flare + folds(th, y, .004, 1.2, hem));
  };
  const front = makePiece('tee', 'front', 40, 46, (u, v) => { const th = lerp(-Math.PI / 2, Math.PI / 2, u); return tee(th, lerp(yTopF(th), hem, v)); }, Math.PI);
  const back = makePiece('tee', 'back', 40, 46, (u, v) => { const th = lerp(Math.PI / 2, Math.PI * 1.5, u); return tee(th, lerp(yTopB(th), hem, v)); }, Math.PI);
  G.tee.push(front, back);
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    const sl = limb([V(sx * .112, 1.452, -.006), V(sx * .184, 1.40, -.010), V(sx * .216, 1.275, -.012)], [.064, .076, .072]);
    const th0 = sl.angleFacing(V(-sx, -.2, 0).normalize());
    const p = makePiece('tee', 'sleeve' + s, 30, 18, (u, v) => {
      const th = th0 + u * TAU;
      return sl.pt(th, v, .004 * Math.sin(th * 5 + v * 7) + .006 * v);
    }, TAU);
    G.tee.push(p);
    STITCH.tee.push(stitchLine(p, rowLine(p, p.nv - 1.2)));
  }
  STITCH.tee.push(stitchLine(front, rowLine(front, front.nv - 1.1)), stitchLine(back, rowLine(back, back.nv - 1.1)));
  // collar rib
  const ring = [];
  for (let k = 0; k < 64; k++) { const th = k / 64 * TAU; const y = Math.cos(th) > 0 ? yTopF(th) : yTopB(th); ring.push(torsoPt(th, y + .004, off + .004)); }
  const rib = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 96, .0075, 10, true), MATS.teeTrim);
  rib.castShadow = true; body.add(rib); EXTRA.tee.push(rib);
  // the chest print sits on the front panel
  makeDecal(front, 12, 28, 6.5, 17.5, 24, 16, .0018, printMat);
}

/* --- the cargo: twill, side pockets, a little bunching at the ankle --- */
{
  const off = .009;
  const yBot = th => .885;
  const top = 1.075;
  const hip = (th, y) => torsoPt(th, y, off + folds(th, y, .003, 1.0, .82));
  const pf = makePiece('cargo', 'front', 36, 22, (u, v) => { const th = lerp(-Math.PI / 2, Math.PI / 2, u); return hip(th, lerp(top, yBot(th), v)); }, Math.PI);
  const pb = makePiece('cargo', 'back', 36, 22, (u, v) => { const th = lerp(Math.PI / 2, Math.PI * 1.5, u); return hip(th, lerp(top, yBot(th), v)); }, Math.PI);
  G.cargo.push(pf, pb);
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    const lg = limb([V(sx * .089, .925, 0), V(sx * .094, .70, .004), V(sx * .099, .48, .01), V(sx * .101, .26, -.004), V(sx * .103, .095, -.008)],
      [.100, .089, .076, .071, .066]);
    const th0 = lg.angleFacing(V(-sx, 0, 0));
    const p = makePiece('cargo', 'leg' + s, 32, 64, (u, v) => {
      const th = th0 + u * TAU;
      const bunch = .007 * Math.sin(v * 70) * smooth(seg(v, .82, 1)) + .006 * smooth(seg(v, .9, 1));
      const knee = .0035 * Math.sin(th * 3 + v * 42) * Math.exp(-Math.pow((v - .52) / .08, 2));
      const tp = lg.pt(th, v, bunch + knee + .002 * Math.sin(th * 6 + v * 20));
      // up at the hip a trouser leg is not a tube: it fills half the pelvis and
      // meets the other leg at the centre seam. Push the top of the tube out to
      // that shape and let it ease back to a tube by mid-thigh.
      const wt = smooth(seg(v, .26, 0));
      if (wt > 0) {
        const c = lg.curve.getPointAt(v), dx = tp.x - c.x, dz = tp.z - c.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
        const [a, b] = TORSO(tp.y), A = a + off + .012, B = b + off + .012;
        const qa = (ux / A) ** 2 + (uz / B) ** 2, qb = 2 * (c.x * ux / (A * A) + c.z * uz / (B * B)), qc = (c.x / A) ** 2 + (c.z / B) ** 2 - 1;
        let t = (-qb + Math.sqrt(Math.max(0, qb * qb - 4 * qa * qc))) / (2 * qa);
        if (ux * sx < 0) t = Math.min(t, -c.x / ux + .002);
        tp.x = lerp(tp.x, c.x + ux * t, wt); tp.z = lerp(tp.z, c.z + uz * t, wt);
      }
      return tp;
    }, TAU);
    G.cargo.push(p);
    // pocket on the outside of the thigh (u = 0.5 is the outside, the seam is on the inner leg)
    const pocket = makeDecal(p, 11, 21, 15, 27, 10, 12, .009, MATS.cargoTrim, 'cloth');
    const flap = makeDecal(p, 10.6, 21.4, 14.2, 18, 10, 4, .014, MATS.cargoTrim, 'cloth');
    STITCH.cargo.push(stitchLine(p, rowLine(p, p.nv - 1.5)), stitchLine(p, colLine(p, 11.3, 18, 26.6, 20)), stitchLine(p, colLine(p, 20.7, 18, 26.6, 20)));
    void pocket; void flap;
  }
  // waistband
  const band = makePiece('cargo', 'band', 60, 3, (u, v) => torsoPt(u * TAU, lerp(top + .004, top - .03, v), off + .006), TAU, { mat: MATS.cargoTrim, axis: V(0, top, 0) });
  G.cargo.push(band);
  STITCH.cargo.push(stitchLine(band, rowLine(band, 2.6, 0, band.nu, 120)));
}

/* --- the jacket: denim, worn open over the tee, hood up --- */
{
  const off = .036;
  const hem = .895;
  const yTop = th => 1.548 - .006 * Math.pow(Math.cos(th), 2);
  const jk = (th, y) => {
    const boxy = .012 * smooth(seg(y, 1.15, hem)) + .006 * smooth(seg(y, 1.25, 1.42));
    return torsoPt(th, y, off + boxy + folds(th, y, .005, 1.25, hem));
  };
  const gap = .13;
  const fa = makePiece('jacket', 'frontR', 22, 46, (u, v) => { const th = lerp(gap, Math.PI / 2, u); return jk(th, lerp(yTop(th), hem, v)); }, Math.PI / 2 - gap);
  const fb = makePiece('jacket', 'frontL', 22, 46, (u, v) => { const th = lerp(-Math.PI / 2, -gap, u); return jk(th, lerp(yTop(th), hem, v)); }, Math.PI / 2 - gap);
  const bk = makePiece('jacket', 'back', 40, 46, (u, v) => { const th = lerp(Math.PI / 2, Math.PI * 1.5, u); return jk(th, lerp(yTop(th), hem, v)); }, Math.PI);
  G.jacket.push(fa, fb, bk);
  STITCH.jacket.push(stitchLine(fa, colLine(fa, .9)), stitchLine(fb, colLine(fb, fb.nu - .9)),
    stitchLine(fa, rowLine(fa, fa.nv - 1.4)), stitchLine(fb, rowLine(fb, fb.nv - 1.4)), stitchLine(bk, rowLine(bk, bk.nv - 1.4)),
    stitchLine(bk, rowLine(bk, 12)));
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? -1 : 1;
    const sl = limb([V(sx * .118, 1.455, -.006), V(sx * .19, 1.40, -.010), V(sx * .228, 1.17, -.012), V(sx * .254, .955, .022)], [.07, .084, .068, .054]);
    const th0 = sl.angleFacing(V(-sx, -.2, 0).normalize());
    const p = makePiece('jacket', 'sleeve' + s, 30, 56, (u, v) => {
      const th = th0 + u * TAU;
      const elbow = .006 * Math.sin(th * 2 + v * 50) * Math.exp(-Math.pow((v - .5) / .1, 2));
      return sl.pt(th, v, elbow + .003 * Math.sin(th * 5 + v * 13) - .01 * smooth(seg(v, .9, 1)));
    }, TAU);
    G.jacket.push(p);
    STITCH.jacket.push(stitchLine(p, rowLine(p, p.nv - 2.5)));
  }
  // hood up: a shell round the head, open at the face, gathered at the neck
  const C = HEAD.c, rr = V(HEAD.r.x + .042, HEAD.r.y + .034, HEAD.r.z + .052);
  const hood = makePiece('jacket', 'hood', 40, 26, (u, v) => {
    // polar angle measured from the face direction: v = 0 is the opening's edge
    const phi = lerp(.62, 2.75, v), az = u * TAU - Math.PI / 2;       // seam under the chin
    const dir = V(Math.sin(phi) * Math.cos(az), Math.sin(phi) * Math.sin(az), Math.cos(phi));
    // fuller at the back, the way a hood falls
    const back = Math.max(0, -dir.z);
    const p = V(C.x + dir.x * rr.x, C.y + dir.y * rr.y + .012 - .02 * back * back, C.z + dir.z * (rr.z + .025 * back) - .018);
    // below the jaw the shell narrows into the collar instead of closing under the chin
    const low = smooth(seg(-dir.y, .25, .95));
    p.y = Math.max(p.y, lerp(p.y, 1.575, low));
    p.x *= lerp(1, .78, low); p.z = lerp(p.z, p.z * .8 - .02, low);
    return p.add(V(0, 0, 0).setScalar(0)).addScaledVector(dir, .004 * Math.sin(az * 6 + phi * 4));
  }, TAU, { axis: C });
  G.jacket.push(hood);
  STITCH.jacket.push(stitchLine(hood, rowLine(hood, .8, 0, hood.nu, 120)));
}

/* ---------- poses ---------- */
const ALL = [...G.tee, ...G.cargo, ...G.jacket];

// layout: on three bolts of fabric in front of the mannequin, one row per garment
const LAYOUT = { z: .82, cy: 1.12, scale: .5, gap: .035, rows: {} };
{
  const rows = ['tee', 'cargo', 'jacket'];
  const hs = rows.map(g => Math.max(...G[g].map(p => p.bounds.h)) * LAYOUT.scale);
  const total = hs.reduce((a, b) => a + b, 0) + LAYOUT.gap * 2 * 2;
  let y = LAYOUT.cy + total / 2;
  rows.forEach((g, r) => {
    const h = hs[r];
    const ws = G[g].map(p => p.bounds.w * LAYOUT.scale);
    const width = ws.reduce((a, b) => a + b, 0) + LAYOUT.gap * (ws.length - 1);
    let x = -width / 2;
    G[g].forEach((p, i) => {
      const b = p.bounds;
      p.layout = V(x - b.minX * LAYOUT.scale, y - h / 2 - (b.minY + b.maxY) / 2 * LAYOUT.scale, LAYOUT.z + .004 + i * .0004);
      x += ws[i] + LAYOUT.gap;
    });
    LAYOUT.rows[g] = { y: y - h / 2, w: width + .12, h: h + .07 };
    y -= h + LAYOUT.gap * 2;
  });
}
// the fabric bolts
const SHEETS = {};
for (const g of ['tee', 'cargo', 'jacket']) {
  const r = LAYOUT.rows[g];
  const geo = new THREE.PlaneGeometry(r.w, r.h, 40, 8);
  geo.translate(r.w / 2, 0, 0);
  // same weave density as the pieces lying on it (they are drawn at layout scale too)
  const uv = geo.attributes.uv, d = DENSITY[KIND[g]] / LAYOUT.scale;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r.w * d, uv.getY(i) * r.h * d);
  const mat = MATS[g].clone(); mat.transparent = true; mat.opacity = 0; mat.depthWrite = false;
  const m = new THREE.Mesh(geo, mat);
  m.position.set(-r.w / 2, r.y, LAYOUT.z - .004);
  m.receiveShadow = true; m.visible = false;
  m.userData.base = geo.attributes.position.array.slice();
  body.add(m);
  SHEETS[g] = m;
}
// pattern outlines on the fabric (the cutting lines)
const cutMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: .012, gapSize: .008, transparent: true, opacity: 0, depthTest: false });
const CUTS = ALL.map(p => {
  const pts = [], idx = [];
  for (let i = 0; i <= p.nu; i++) idx.push(i);
  for (let j = 1; j <= p.nv; j++) idx.push(j * (p.nu + 1) + p.nu);
  for (let i = p.nu - 1; i >= 0; i--) idx.push(p.nv * (p.nu + 1) + i);
  for (let j = p.nv - 1; j >= 0; j--) idx.push(j * (p.nu + 1));
  const kc = (p.nv >> 1) * (p.nu + 1) + (p.nu >> 1), cx = p.F[kc * 2], cy = p.F[kc * 2 + 1];
  for (const k of idx) pts.push(V(p.layout.x + (p.F[k * 2] - cx) * LAYOUT.scale, p.layout.y + (p.F[k * 2 + 1] - cy) * LAYOUT.scale, LAYOUT.z + .01));
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.Line(geo, cutMat); l.computeLineDistances(); l.renderOrder = 5; l.visible = false;
  l.userData.count = pts.length;
  body.add(l);
  return l;
});

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
// the rail: where a garment waits, off to the side, while the fitting room has it off
function railPose(p, k) { return { pos: V(-1.7 - k * .03, 1.05 + (k % 4) * .16, -.5 + k * .01), q: new THREE.Quaternion().setFromEuler(_e.set(0, .5, 0)), s: .6 }; }
function layoutPose(p) { return { pos: p.layout.clone(), q: new THREE.Quaternion(), s: LAYOUT.scale }; }
// after the cut the whole table slides aside, smaller and turned toward the camera, so he is in clear view
const ASIDE = { c: V(-.84, 1.0, .28), k: .62, ry: .32 };
function waitPose(p, k, portrait) {
  if (portrait) return railPose(p, k);                // a phone has no room beside him: the pieces wait off screen
  const rel = p.layout.clone().sub(V(0, LAYOUT.cy, LAYOUT.z)).multiplyScalar(ASIDE.k).applyAxisAngle(V(0, 1, 0), ASIDE.ry);
  return { pos: ASIDE.c.clone().add(rel), q: new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ASIDE.ry), s: LAYOUT.scale * ASIDE.k };
}
function sourcePose(p, k, aside, portrait) {
  if (aside <= 0) return layoutPose(p);
  const B = waitPose(p, k, portrait);
  if (aside >= 1) return B;
  const A = layoutPose(p);
  return { pos: A.pos.lerp(B.pos, aside), q: A.q.slerp(B.q, aside), s: lerp(A.s, B.s, aside) };
}
function tangentPose(p) { return { pos: p.P.clone(), q: p.tq.clone(), s: 1 }; }
// interpolate round the body's axis so nothing passes through the mannequin
function travel(A, B, t) {
  const ra = Math.hypot(A.pos.x, A.pos.z), rb = Math.hypot(B.pos.x, B.pos.z);
  const aa = Math.atan2(A.pos.x, A.pos.z); let ab = Math.atan2(B.pos.x, B.pos.z);
  let da = ab - aa; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
  const ta = ease(clamp(t * 1.35)), tr = ease(clamp((t - .2) / .8)), ty = ease(t);
  const a = aa + da * ta, r = lerp(ra, rb, tr) + Math.sin(Math.PI * t) * .06;
  return { pos: V(Math.sin(a) * r, lerp(A.pos.y, B.pos.y, ty), Math.cos(a) * r),
    q: A.q.clone().slerp(B.q, ease(t)), s: lerp(A.s, B.s, ease(t)) };
}

/* write a piece: rigid while flat, deformed vertex by vertex while wrapping */
function writeRigid(o, pose, F, kcx, kcy) {
  const pos = o.geo.attributes.position.array;
  if (o.mode !== 'rigid') {
    for (let k = 0; k < o.n; k++) { pos[k * 3] = F[k * 2] - kcx; pos[k * 3 + 1] = F[k * 2 + 1] - kcy; pos[k * 3 + 2] = (o.decal ? o.lift : 0); }
    o.geo.attributes.position.needsUpdate = true; o.geo.computeVertexNormals();
    o.mode = 'rigid'; o.last = -1;
  }
  o.mesh.position.copy(pose.pos); o.mesh.quaternion.copy(pose.q); o.mesh.scale.setScalar(pose.s);
}
function writeWrap(o, base, w, kcx, kcy) {
  if (o.mode === 'wrap' && Math.abs(o.last - w) < 1e-4) return;
  const pos = o.geo.attributes.position.array, { P, X, Y, Z } = base;
  for (let k = 0; k < o.n; k++) {
    // rows wrap from the top down, a beat apart
    const wk = clamp(w * 1.35 - o.VF[k] * .35);
    const x = o.F[k * 2] - kcx, y = o.F[k * 2 + 1] - kcy;
    const R = o.R[k] / Math.max(wk, 1e-4), ph = x / R;
    const lx = R * Math.sin(ph), lz = R * (Math.cos(ph) - 1) + (o.decal ? o.lift : 0);
    const bx = P.x + X.x * lx + Y.x * y + Z.x * lz, by = P.y + X.y * lx + Y.y * y + Z.y * lz, bz = P.z + X.z * lx + Y.z * y + Z.z * lz;
    const m = smooth(seg(wk, .5, 1));
    pos[k * 3] = lerp(bx, o.W[k * 3], m); pos[k * 3 + 1] = lerp(by, o.W[k * 3 + 1], m); pos[k * 3 + 2] = lerp(bz, o.W[k * 3 + 2], m);
  }
  o.geo.attributes.position.needsUpdate = true;
  o.geo.computeVertexNormals();
  if (o.mode !== 'wrap') { o.mesh.position.set(0, 0, 0); o.mesh.quaternion.identity(); o.mesh.scale.setScalar(1); }
  o.mode = 'wrap'; o.last = w;
}
function placePiece(p, f, w, src) {
  const kc = (p.nv >> 1) * (p.nu + 1) + (p.nu >> 1), kcx = p.F[kc * 2], kcy = p.F[kc * 2 + 1];
  const visible = true;
  p.mesh.visible = visible;
  for (const c of p.children) c.mesh.visible = visible;
  if (w > 0) {
    writeWrap(p, p, w, kcx, kcy);
    for (const c of p.children) writeWrap(c, p, w, kcx, kcy);
    return;
  }
  const pose = f <= 0 ? src : f >= 1 ? tangentPose(p) : travel(src, tangentPose(p), f);
  writeRigid(p, pose, p.F, kcx, kcy);
  for (const c of p.children) writeRigid(c, pose, c.F, kcx, kcy);
}

/* ---------- the director: everything the scene shows comes from here ---------- */
const state = {
  t: 0, rot: 0, rotTarget: 0, drag: 0,
  d: { tee: 2, cargo: 2, jacket: 2 },           // shown
  custom: { tee: 2, cargo: 2, jacket: 2 },      // customizer targets, animated in time
  customAnim: { tee: 2, cargo: 2, jacket: 2 },
  on: { tee: true, cargo: true, jacket: true },
  color: { tee: 'Washed black', cargo: 'Olive', jacket: 'Indigo' },
  print: 'خيط', size: 'L',
  pending: {},                                  // colour waiting for the garment to come off
};

function garmentPose(g, d, srcFor, hideAtZero) {
  const ps = G[g], n = ps.length;
  const f = clamp(d), w = clamp(d - 1);
  ps.forEach((p, k) => {
    const o = n > 1 ? k / (n - 1) : 0;
    const fk = f >= 1 ? 1 : clamp(f * 1.4 - .4 * o), wk = w >= 1 ? 1 : w > 0 ? clamp(w * 1.25 - .25 * o) : 0;
    placePiece(p, fk >= 1 && w > 0 ? 1 : fk, fk >= 1 ? wk : 0, srcFor(p, k));
    if (hideAtZero && d <= 0) { p.mesh.visible = false; for (const c of p.children) c.mesh.visible = false; }
  });
  const done = smooth(seg(d, 1.86, 2));
  for (const s of STITCH[g]) { s.visible = done > 0; s.geometry.setDrawRange(0, Math.ceil(s.userData.count * done)); }
  for (const e of EXTRA[g]) e.visible = d > 1.97;
}

const els = {
  hero: document.getElementById('hero'), story: document.getElementById('story'),
  fit: document.getElementById('fit'), cover: document.querySelectorAll('[data-cover]'),
  chapters: [...document.querySelectorAll('.chapter')], steps: [...document.querySelectorAll('.steps .s')],
  bar: document.querySelector('.steps .fill'),
};
const CHAPTERS = [0, .12, .26, .46, .64, .84];   // where each chapter's text takes over

const CAM = {
  hero:   { pos: V(0, 1.12, 3.95), tgt: V(0, .98, 0) },
  layout: { pos: V(0, 1.12, 3.2), tgt: V(0, 1.12, .82) },
  build:  { pos: V(.55, 1.2, 3.45), tgt: V(-.3, 1.0, 0) },
  tee:    { pos: V(.5, 1.32, 2.95), tgt: V(-.25, 1.12, 0) },
  cargo:  { pos: V(.42, .98, 3.05), tgt: V(-.25, .78, 0) },
  jacket: { pos: V(.5, 1.26, 3.3), tgt: V(-.25, 1.02, 0) },
  drop:   { pos: V(0, 1.16, 4.05), tgt: V(0, .97, 0) },
};
// few, slow camera moves: one to the fabric, one to the build, a small push per garment, out for the drop
const CAMKEYS = [[0, 'hero'], [.1, 'layout'], [.2, 'layout'], [.27, 'build'], [.31, 'tee'], [.45, 'tee'], [.49, 'cargo'], [.63, 'cargo'], [.67, 'jacket'], [.84, 'jacket'], [.92, 'drop'], [1, 'drop']];
function camAt(p) {
  let i = 0; while (i < CAMKEYS.length - 2 && CAMKEYS[i + 1][0] <= p) i++;
  const [pa, a] = CAMKEYS[i], [pb, b] = CAMKEYS[i + 1];
  const t = ease(seg(p, pa, pb));
  return { pos: CAM[a].pos.clone().lerp(CAM[b].pos, t), tgt: CAM[a].tgt.clone().lerp(CAM[b].tgt, t) };
}

let W = 0, H = 0;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// fit the layout to narrow screens: pull the camera back until the fabric fits
function fitDistance(width, height) {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  return Math.max(height / (2 * t), width / (2 * t * camera.aspect)) * 1.08;
}

/* drag to turn the mannequin */
let dragging = null;
canvas.addEventListener('pointerdown', e => { dragging = { x: e.clientX, r: state.drag }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (dragging) state.drag = dragging.r + (e.clientX - dragging.x) / 160; });
const endDrag = () => { dragging = null; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);

let lastT = performance.now(), running = true;
function frame(now) {
  const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
  if (!REDUCE) state.t += dt;
  requestAnimationFrame(frame);

  // is the canvas covered by a solid section? then do nothing
  let covered = false;
  for (const c of els.cover) { const r = c.getBoundingClientRect(); if (r.top <= 0 && r.bottom >= H) covered = true; }
  if (covered) { if (running) { canvas.style.visibility = 'hidden'; running = false; } return; }
  if (!running) { canvas.style.visibility = ''; running = true; }

  const sr = els.story.getBoundingClientRect(), fr = els.fit.getBoundingClientRect();
  const p = clamp(-sr.top / (sr.height - H));
  const inHero = sr.top > 0;
  const fitF = smooth(clamp(1 - fr.top / H));          // 0 until the fitting room scrolls in
  const custom = fitF > .5;

  const portrait = W / H < .8;
  // garments: off the body onto the fabric (outer layers first), cut, then on again one at a time
  const aside = inHero || custom ? 0 : ease(seg(p, .2, .26));
  const srcFor = custom ? railPose : (pc, k) => sourcePose(pc, k, aside, portrait);
  const OFF = { jacket: [.0, .07], cargo: [.025, .095], tee: [.05, .12] };
  const ON = { tee: [.28, .44], cargo: [.48, .63], jacket: [.66, .83] };
  for (const g of ['tee', 'cargo', 'jacket']) {
    // customizer: move toward the target at a steady speed
    const c = state.customAnim;
    const tgt = state.custom[g];
    if (c[g] !== tgt) { const s = Math.sign(tgt - c[g]) * dt * 2.1; c[g] = Math.abs(tgt - c[g]) <= Math.abs(s) ? tgt : c[g] + s; }
    if (c[g] === 0 && state.pending[g]) { state.pending[g](); delete state.pending[g]; }
    const story = inHero ? 2 : p < .14 ? 2 * (1 - seg(p, OFF[g][0], OFF[g][1])) : 2 * seg(p, ON[g][0], ON[g][1]);
    state.d[g] = custom ? c[g] : story;
    garmentPose(g, state.d[g], srcFor, custom);
  }

  // fabric bolts (they roll out first, so the pieces have somewhere to land) and cutting lines
  const sheetIn = inHero || custom ? 0 : ease(seg(p, 0, .06)), sheetOut = inHero || custom ? 0 : seg(p, .17, .2);
  for (const g in SHEETS) {
    const m = SHEETS[g];
    m.visible = sheetIn > 0 && sheetOut < 1;
    m.scale.x = Math.max(.001, sheetIn);
    m.material.opacity = 1 - sheetOut;
  }
  const cutDraw = inHero || custom ? 0 : seg(p, .12, .17), cutFade = seg(p, .19, .22);
  cutMat.opacity = .9 * (1 - cutFade);
  for (const l of CUTS) { l.visible = cutDraw > 0 && cutFade < 1; l.geometry.setDrawRange(0, Math.ceil(l.userData.count * cutDraw)); }

  // turning: idle sway in the hero, still while the pieces fly, a full turn at the end
  let rot;
  if (custom) rot = state.drag + (REDUCE ? 0 : Math.sin(state.t * .3) * .12);
  else if (inHero) rot = state.drag + (REDUCE ? 0 : Math.sin(state.t * .25) * .3);
  else rot = (p > .86 ? Math.sin(ease(seg(p, .86, 1)) * Math.PI) * .9 : 0) + state.drag * (p > .86 ? 1 : 0);
  if (!inHero && !custom && p < .86) state.drag *= .9;
  // take the short way round: a full turn and no turn look the same
  rot += Math.round((state.rot - rot) / TAU) * TAU;
  state.rot += (rot - state.rot) * Math.min(1, dt * 6);
  body.rotation.y = state.rot;

  // camera
  let c = inHero ? { pos: CAM.hero.pos.clone(), tgt: CAM.hero.tgt.clone() } : camAt(p);
  // a phone is narrow: step back from the close-ups so the garment is not cropped
  if (portrait && !inHero) { c.tgt.x = 0; c.pos.x *= .5; c.pos.sub(c.tgt).multiplyScalar(1.22).add(c.tgt); }
  if (!inHero && p < .27) {                          // keep the whole fabric in frame, on any screen
    const r = LAYOUT.rows;
    const need = fitDistance(Math.max(r.tee.w, r.cargo.w, r.jacket.w) * 1.04, (r.tee.h + r.cargo.h + r.jacket.h) * 1.12 + .1);
    const k = ease(seg(p, 0, .1)) * (1 - ease(seg(p, .2, .26)));
    c.pos.z = lerp(c.pos.z, LAYOUT.z + need, k);
  }
  if (custom || fitF > 0) {
    const tgt = CAM.drop;
    const k = fitF;
    c.pos.lerp(tgt.pos, k); c.tgt.lerp(tgt.tgt, k);
    if (portrait) c.pos.z += 1.5 * k;
  }
  camera.position.copy(c.pos); camera.lookAt(c.tgt);
  // in the fitting room the mannequin moves aside for the panel
  // on a phone the words sit at the bottom, so the mannequin moves up out of their way
  const storyF = clamp(-sr.top / H);
  const offX = portrait ? 0 : W * .2 * fitF;
  const offY = portrait ? H * (.2 * fitF + .08 * storyF * (1 - fitF)) : 0;
  if (offX || offY) camera.setViewOffset(W, H, offX, offY, W, H); else camera.clearViewOffset();

  // overlays
  if (!inHero && els.chapters.length) {
    let ci = 0; for (let i = 0; i < CHAPTERS.length; i++) if (p >= CHAPTERS[i]) ci = i;
    els.chapters.forEach((el, i) => el.classList.toggle('on', i === ci && p < 1));
    els.steps.forEach((el, i) => el.classList.toggle('on', i <= ci));
    if (els.bar) els.bar.style.transform = `scaleX(${p})`;
  }

  renderer.render(scene, camera);
  if (SHOT && !window.__ready && state.t > 0) { window.__frames = (window.__frames || 0) + 1; if (window.__frames > 3) window.__ready = true; }
}

/* ---------- the fitting room ---------- */
function setColor(g, name) {
  const apply = () => {
    state.color[g] = name;
    const hex = COLORS[g][name];
    MATS[g].color.setHex(hex);
    MATS[g + 'Trim'].color.setHex(hex).multiplyScalar(.72);
    for (const s in SHEETS) SHEETS[s].material.color.copy(MATS[s].color);
    if (g === 'tee') drawPrint(state.print, hex);
  };
  if (!state.on[g] || SHOT) { apply(); return; }
  // take it off, change it, put it back on: the piece you chose is dressed onto the mannequin
  state.custom[g] = 0;
  state.pending[g] = () => { apply(); state.custom[g] = 2; };
}
function setPrint(kind) {
  state.print = kind;
  if (!state.on.tee) { drawPrint(kind, COLORS.tee[state.color.tee]); return; }
  state.custom.tee = 0;
  state.pending.tee = () => { drawPrint(kind, COLORS.tee[state.color.tee]); state.custom.tee = 2; };
}
function setOn(g, on) { state.on[g] = on; state.custom[g] = on ? 2 : 0; delete state.pending[g]; }

window.KHAYT = { setColor, setPrint, setOn, state, COLORS, PRICE,
  focus() { state.drag = 0; } };

// product photography for the drop cards: ?shot=tee|cargo|jacket|fit
if (SHOT) {
  document.documentElement.classList.add('shot');
  rimO.intensity = 1.6; rimB.intensity = 1.3; key.intensity = 2.8;
  const only = SHOT === 'fit' ? null : SHOT;
  const pose = { tee: 2, cargo: 2, jacket: 2 };
  if (only === 'tee') { pose.cargo = 2; pose.jacket = 0; }
  if (only === 'cargo') { pose.jacket = 0; }
  for (const g of ['tee', 'cargo', 'jacket']) {
    if (Q.get(g)) setColor(g, Q.get(g));
  }
  if (Q.get('print')) state.print = Q.get('print');
  const camK = { tee: { pos: V(.7, 1.4, 2.25), tgt: V(0, 1.22, 0) }, cargo: { pos: V(-.85, .92, 2.75), tgt: V(0, .6, 0) }, jacket: { pos: V(.95, 1.35, 3.1), tgt: V(0, 1.1, 0) }, fit: { pos: V(.7, 1.2, 3.9), tgt: V(0, .97, 0) } }[SHOT];
  const shotFrame = () => {
    requestAnimationFrame(shotFrame);
    for (const g of ['tee', 'cargo', 'jacket']) garmentPose(g, pose[g], railPose, true);
    // hide what is parked so the photograph is clean
    for (const g of ['tee', 'cargo', 'jacket']) if (pose[g] === 0) for (const p of G[g]) { p.mesh.visible = false; p.children.forEach(c => c.mesh.visible = false); }
    for (const s in SHEETS) SHEETS[s].visible = false; for (const l of CUTS) l.visible = false;
    body.rotation.y = +(Q.get('rot') || .35);
    camera.position.copy(camK.pos); camera.lookAt(camK.tgt);
    renderer.render(scene, camera);
    window.__frames = (window.__frames || 0) + 1; if (window.__frames > 4) window.__ready = true;
  };
  document.fonts.ready.then(() => { drawPrint(state.print, COLORS.tee[state.color.tee]); requestAnimationFrame(shotFrame); });
} else {
  drawPrint(state.print, COLORS.tee[state.color.tee]);
  document.fonts.ready.then(() => drawPrint(state.print, COLORS.tee[state.color.tee]));
  document.documentElement.classList.add('gl-ready');
  requestAnimationFrame(frame);
}
