// ============================================================
// world.js — the night city: roads, blocks, buildings, neon,
// sidewalk props (instanced), building colliders, lanes.
// ============================================================

const World = {
  blocks: [],        // {i,j,type:'build'|'park', x0,z0,x1,z1}
  props: [],         // every sidewalk prop item
  batches: {},       // kind -> PropBatch
  hash: new Map(),   // spatial hash of props
  loops: [],         // pedestrian loops (rects)
};

// ---------- instanced prop batch ----------
class PropBatch {
  constructor(scene, kind, max) {
    this.kind = kind; this.max = max; this.count = 0;
    this.parts = PROP_PARTS[kind]();
    this.partM = this.parts.map(partMatrix);
    this.meshes = this.parts.map(p => {
      const m = new THREE.InstancedMesh(GEO[p.g], p.m, max);
      m.frustumCulled = false; m.count = 0; scene.add(m); return m;
    });
    this.ringMat = ringMaterial();
    this.ring = new THREE.InstancedMesh(GEO.ring, this.ringMat, max);
    this.ring.frustumCulled = false; this.ring.count = 0; scene.add(this.ring);
    if (kind === 'lamp') {
      this.glow = new THREE.InstancedMesh(GEO.plane, new THREE.MeshBasicMaterial({ color: 0xffa040, map: GLOW_TEX, transparent: true, opacity: .32, blending: THREE.AdditiveBlending, depthWrite: false }), max);
      this.glow.frustumCulled = false; this.glow.count = 0; scene.add(this.glow);
    }
  }
  add(x, z, rot) {
    const k = KINDS[this.kind];
    const it = { kind: this.kind, batch: this, idx: this.count++, x, z, rot, alive: true, respawnAt: 0, hl: k.hl, hw: k.hw };
    for (const m of this.meshes) m.count = this.count;
    this.ring.count = this.count; if (this.glow) this.glow.count = this.count;
    this.show(it, true);
    return it;
  }
  show(it, on) {
    const base = new THREE.Matrix4().makeRotationY(it.rot).setPosition(it.x, 0, it.z);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const m = new THREE.Matrix4();
    this.meshes.forEach((mesh, i) => {
      mesh.setMatrixAt(it.idx, on ? m.multiplyMatrices(base, this.partM[i]) : zero);
      mesh.instanceMatrix.needsUpdate = true;
    });
    // trees get a canopy-sized ring so it isn't hidden under the leaves
    const rr = this.kind === 'tree' ? 2.1 : 0;
    const rs = new THREE.Matrix4().makeScale(Math.max(it.hw + .55, rr), 1, Math.max(it.hl + .55, rr)).setPosition(0, .05, 0);
    this.ring.setMatrixAt(it.idx, on ? m.multiplyMatrices(base, rs) : zero);
    this.ring.instanceMatrix.needsUpdate = true;
    if (this.glow) {
      const gs = new THREE.Matrix4().makeScale(9, 1, 9).setPosition(0, .06, 1.6);
      this.glow.setMatrixAt(it.idx, on ? m.multiplyMatrices(base, gs) : zero);
      this.glow.instanceMatrix.needsUpdate = true;
    }
  }
  setThreat(level) {
    const t = threatOf(KINDS[this.kind].size, level);
    this.threat = t;
    this.ringMat.color.setHex(THREAT[t]);
    this.ringMat.opacity = t === 'smash' ? .75 : t === 'bounce' ? .65 : .6;
  }
}

// ---------- spatial hash ----------
const HC = 20;
function hashAdd(it) {
  const k = `${Math.floor(it.x / HC)},${Math.floor(it.z / HC)}`;
  if (!World.hash.has(k)) World.hash.set(k, []);
  World.hash.get(k).push(it);
}
function hashQuery(x, z, r) {
  const out = [];
  for (let cx = Math.floor((x - r) / HC); cx <= Math.floor((x + r) / HC); cx++)
    for (let cz = Math.floor((z - r) / HC); cz <= Math.floor((z + r) / HC); cz++) {
      const a = World.hash.get(`${cx},${cz}`); if (a) out.push(...a);
    }
  return out;
}

// ---------- textures ----------
function windowTexture(lit, wall) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = wall; x.fillRect(0, 0, 256, 256);
  for (let r = 0; r < 8; r++) for (let col = 0; col < 8; col++) {
    const on = Math.random() < .42;
    x.fillStyle = on ? pick(lit) : '#0d1220';
    x.fillRect(col * 32 + 6, r * 32 + 8, 20, 17);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  return t;
}

// ---------- lanes / road graph ----------
const DIRS = [{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }];
const laneOff = d => ({ x: d.dz * LANE, z: -d.dx * LANE });
const validDir = (i, j, d) => i + d.dx >= 0 && i + d.dx <= N && j + d.dz >= 0 && j + d.dz <= N;

function buildWorld(scene) {
  // Ground + sidewalks (one dark slab) and roads on top
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + EXT * 2 + 400, SIZE + EXT * 2 + 400).rotateX(-Math.PI / 2), lam(0x2b2e38));
  ground.position.set(SIZE / 2, 0, SIZE / 2); scene.add(ground);
  const roadMat = lam(0x15171d);
  for (let i = 0; i <= N; i++) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(RW * 2, SIZE + RW * 2).rotateX(-Math.PI / 2), roadMat);
    a.position.set(i * CELL, .02, SIZE / 2); scene.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + RW * 2, RW * 2).rotateX(-Math.PI / 2), roadMat);
    b.position.set(SIZE / 2, .021, i * CELL); scene.add(b);
  }
  // Lane dashes
  const dashes = new THREE.InstancedMesh(GEO.plane, basic(0xd8c46a), 6000);
  dashes.frustumCulled = false;
  let dc = 0; const m = new THREE.Matrix4();
  for (let i = 0; i <= N; i++) for (let s = 0; s < N; s++) for (let t = SW + 1.5; t < CELL - SW - 1; t += 4.5) {
    m.makeScale(.22, 1, 2.2).setPosition(i * CELL, .04, s * CELL + t); dashes.setMatrixAt(dc++, m);
    m.makeScale(2.2, 1, .22).setPosition(s * CELL + t, .04, i * CELL); dashes.setMatrixAt(dc++, m);
  }
  dashes.count = dc; scene.add(dashes);

  // Curbs around every block
  const curbs = new THREE.InstancedMesh(GEO.box, lam(0x6d7385), N * N * 4);
  curbs.frustumCulled = false; let cc = 0;
  const L = CELL - RW * 2;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const cx = (i + .5) * CELL, cz = (j + .5) * CELL;
    m.makeScale(L, .16, .35).setPosition(cx, .08, j * CELL + RW); curbs.setMatrixAt(cc++, m);
    m.makeScale(L, .16, .35).setPosition(cx, .08, (j + 1) * CELL - RW); curbs.setMatrixAt(cc++, m);
    m.makeScale(.35, .16, L).setPosition(i * CELL + RW, .08, cz); curbs.setMatrixAt(cc++, m);
    m.makeScale(.35, .16, L).setPosition((i + 1) * CELL - RW, .08, cz); curbs.setMatrixAt(cc++, m);
  }
  scene.add(curbs);

  // Building materials
  const wallMats = [
    windowTexture(['#ffd38a', '#ffc46b', '#fff0c9'], '#20232e'),
    windowTexture(['#bfe6ff', '#e9f6ff', '#8fd3ff'], '#1a2130'),
    windowTexture(['#ffd38a', '#ff9fd6', '#a0ffe6'], '#251f2c'),
  ].map(t => new THREE.MeshLambertMaterial({ color: 0x9aa0b5, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .85 }));
  const roofMat = lam(0x14161c);

  // Neon signs + storefront bands (one instanced batch with per-instance colour)
  const neon = new THREE.InstancedMesh(GEO.box, new THREE.MeshBasicMaterial({ color: 0xffffff }), 900);
  neon.frustumCulled = false; let nc = 0;
  const NEON = [0xff2f92, 0x2ff3ff, 0xffb347, 0x9b5cff, 0x4dff8a, 0xff4040];
  const col = new THREE.Color();
  const addNeon = (x, y, z, sx, sy, sz, hex) => {
    if (nc >= 900) return;
    m.makeScale(sx, sy, sz).setPosition(x, y, z); neon.setMatrixAt(nc, m);
    neon.setColorAt(nc, col.setHex(hex)); nc++;
  };

  const mid = SIZE / 2;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x0 = i * CELL + SW, z0 = j * CELL + SW, x1 = (i + 1) * CELL - SW, z1 = (j + 1) * CELL - SW;
    const d = Math.hypot((i + .5) * CELL - mid, (j + .5) * CELL - mid);
    const zone = d < SIZE * .2 ? 'downtown' : d < SIZE * .37 ? 'mid' : 'outer';
    const isPark = (zone !== 'downtown' && Math.random() < .2) || (i === 3 && j === 4);
    const block = { i, j, zone, type: isPark ? 'park' : 'build', x0, z0, x1, z1 };
    World.blocks.push(block);
    World.loops.push({ x0: i * CELL + PED_PATH, z0: j * CELL + PED_PATH, x1: (i + 1) * CELL - PED_PATH, z1: (j + 1) * CELL - PED_PATH });

    if (isPark) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), lam(0x1c3a27));
      g.position.set((x0 + x1) / 2, .03, (z0 + z1) / 2); scene.add(g);
      block.trees = [];
      for (let k = 0; k < 6; k++) block.trees.push([rand(x0 + 4, x1 - 4), rand(z0 + 4, z1 - 4)]);
      continue;
    }
    // Split the block into 1, 2 or 4 buildings
    const split = pick(zone === 'downtown' ? [1, 2, 4] : [2, 4, 4]);
    const rects = [];
    const mx = (x0 + x1) / 2 + rand(-5, 5), mz = (z0 + z1) / 2 + rand(-5, 5);
    if (split === 1) rects.push([x0, z0, x1, z1]);
    else if (split === 2) Math.random() < .5 ? rects.push([x0, z0, mx, z1], [mx, z0, x1, z1]) : rects.push([x0, z0, x1, mz], [x0, mz, x1, z1]);
    else rects.push([x0, z0, mx, mz], [mx, z0, x1, mz], [x0, mz, mx, z1], [mx, mz, x1, z1]);

    for (const [a, b, c, e] of rects) {
      const w = c - a - .6, dd = e - b - .6;
      const h = zone === 'downtown' ? rand(26, 62) : zone === 'mid' ? rand(12, 28) : rand(7, 14);
      const geo = new THREE.BoxGeometry(w, h, dd);
      const uv = geo.attributes.uv;
      for (let f = 0; f < 6; f++) {
        if (f === 2 || f === 3) continue;
        const across = f < 2 ? dd : w;
        for (let v = 0; v < 4; v++) { const n = f * 4 + v; uv.setXY(n, uv.getX(n) * across / 32, uv.getY(n) * h / 28); }
      }
      const wm = pick(wallMats);
      const bld = new THREE.Mesh(geo, [wm, wm, roofMat, roofMat, wm, wm]);
      bld.position.set((a + c) / 2, h / 2, (b + e) / 2); scene.add(bld);
      // storefront bands on the faces that touch a road
      const shop = pick([0xffc46b, 0xff7ab8, 0x7af0ff, 0xfff3d6]);
      if (a === x0) addNeon(a - .05, 3.4, (b + e) / 2, .12, .35, dd * .85, shop);
      if (c === x1) addNeon(c + .05, 3.4, (b + e) / 2, .12, .35, dd * .85, shop);
      if (b === z0) addNeon((a + c) / 2, 3.4, b - .05, w * .85, .35, .12, shop);
      if (e === z1) addNeon((a + c) / 2, 3.4, e + .05, w * .85, .35, .12, shop);
      // a vertical neon sign
      if (Math.random() < .55) {
        const hue = pick(NEON), sy = rand(3.5, 7), y = rand(6.5, Math.min(h - 2, 16));
        if (y > 6) {
          if (a === x0) addNeon(a - .5, y, rand(b + 3, e - 3), .3, sy, 1.1, hue);
          else if (b === z0) addNeon(rand(a + 3, c - 3), y, b - .5, 1.1, sy, .3, hue);
          else if (c === x1) addNeon(c + .5, y, rand(b + 3, e - 3), .3, sy, 1.1, hue);
          else if (e === z1) addNeon(rand(a + 3, c - 3), y, e + .5, 1.1, sy, .3, hue);
        }
      }
      if (h > 45) addNeon((a + c) / 2, h + .6, (b + e) / 2, .8, .8, .8, 0xff2030); // aviation light
    }
  }
  neon.count = nc; if (neon.instanceColor) neon.instanceColor.needsUpdate = true;
  scene.add(neon);

  // City edge: glowing barriers + distant silhouettes
  const barrierMat = lam(0x5a606e), stripe = basic(0xff7b00);
  const E0 = -SW - .6, E1 = SIZE + SW + .6, len = SIZE + SW * 2 + 1.2;
  [[SIZE / 2, E0, len, .8], [SIZE / 2, E1, len, .8], [E0, SIZE / 2, .8, len], [E1, SIZE / 2, .8, len]].forEach(([x, z, sx, sz]) => {
    const b = new THREE.Mesh(GEO.box, barrierMat); b.scale.set(sx, 1.1, sz); b.position.set(x, .55, z); scene.add(b);
    const s = new THREE.Mesh(GEO.box, stripe); s.scale.set(sx + .02, .12, sz + .02); s.position.set(x, .9, z); scene.add(s);
  });
  const sil = new THREE.InstancedMesh(GEO.box, lam(0x10131f), 120);
  let sc = 0;
  for (let k = 0; k < 120; k++) {
    const ang = k / 120 * Math.PI * 2, r = SIZE * .72 + rand(60, 200);
    const h = rand(30, 140), w = rand(18, 40);
    m.makeScale(w, h, w).setPosition(mid + Math.cos(ang) * r, h / 2, mid + Math.sin(ang) * r); sil.setMatrixAt(sc++, m);
  }
  sil.frustumCulled = false; scene.add(sil);

  buildProps(scene);
  buildRamps(scene);
}

// ---------- sidewalk props ----------
function buildProps(scene) {
  const B = World.batches;
  const sides = ((N + 1) * 2 - 2) * N * 2;
  B.lamp = new PropBatch(scene, 'lamp', sides * 3);
  B.bin = new PropBatch(scene, 'bin', sides);
  B.cone = new PropBatch(scene, 'cone', 260);
  B.hydrant = new PropBatch(scene, 'hydrant', sides);
  B.busstop = new PropBatch(scene, 'busstop', 60);
  B.tree = new PropBatch(scene, 'tree', sides + 200);
  World.foodSpots = [];
  // minTier: the tier index at which this prop appears (hazards show up once you can smash them)
  const put = (kind, x, z, rot, minTier) => { if (B[kind].count >= B[kind].max) return null; const it = B[kind].add(x, z, rot); it.minTier = minTier || 0; World.props.push(it); hashAdd(it); return it; };

  let stops = 0;
  // Each road segment has two sides. side = +1/-1 relative to the road centre line.
  for (let line = 0; line <= N; line++) for (let s = 0; s < N; s++) for (const side of [-1, 1]) for (const axis of ['x', 'z']) {
    // axis 'x': road runs along x at z = line*CELL. axis 'z': road runs along z at x = line*CELL.
    if ((line === 0 && side === -1) || (line === N && side === 1)) continue; // outer edge faces the barrier
    const at = (t, off) => axis === 'x' ? [s * CELL + t, line * CELL + side * off] : [line * CELL + side * off, s * CELL + t];
    // lamp arm points toward the road
    const lampRot = axis === 'x' ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
    // Some sides keep a parking bay free in the middle for a food truck
    const bay = Math.random() < .12;
    for (const f of bay ? [.25, .75] : [.25, .5, .75]) { const [x, z] = at(CELL * f, RW + .8); put('lamp', x, z, lampRot, f === .75 ? 0 : 1); }
    if (bay) { const [x, z] = at(CELL * .5, RW + 1.3); World.foodSpots.push({ x, z, rot: axis === 'x' ? Math.PI / 2 : 0 }); continue; }
    if (stops < 50 && Math.random() < .14) { const [x, z] = at(CELL * .375, SW - 1.4); put('busstop', x, z, lampRot, 1); stops++; }
    else if (Math.random() < .75) { const [x, z] = at(CELL * rand(.35, .4), SW - .8); put('bin', x, z, 0); }
    if (Math.random() < .4) { const [x, z] = at(CELL * .62, RW + .9); put('hydrant', x, z, 0); }
    else if (Math.random() < .35) { const [x, z] = at(CELL * .63, SW - .9); put('tree', x, z, 0, 2); }
  }
  // Roadworks: lines of cones along the lane edge
  for (let k = 0; k < 40; k++) {
    const line = 1 + Math.floor(Math.random() * (N - 1)), s = Math.floor(Math.random() * N), side = pick([-1, 1]);
    const axis = pick(['x', 'z']), t0 = rand(SW + 2, CELL - SW - 12);
    for (let c = 0; c < 4; c++) {
      const t = t0 + c * 3.2;
      const [x, z] = axis === 'x' ? [s * CELL + t, line * CELL + side * (RW - .9)] : [line * CELL + side * (RW - .9), s * CELL + t];
      put('cone', x, z, 0);
    }
  }
  // Park trees
  for (const b of World.blocks) if (b.trees) for (const [x, z] of b.trees) put('tree', x, z, rand(0, 6));
}

// ---------- building collision ----------
// Pushes a circle out of any building block. Returns the push normal or null.
function pushOutOfBuildings(x, z, r) {
  const bi = Math.floor(x / CELL), bj = Math.floor(z / CELL);
  let hit = null;
  for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++) {
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const b = World.blocks[i * N + j];
    if (b.type !== 'build') continue;
    const cx = clamp(x, b.x0, b.x1), cz = clamp(z, b.z0, b.z1);
    let dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz);
    if (d < r) {
      if (d < 1e-4) { // centre inside: push out the shortest way
        const opts = [[b.x0 - x, 0], [b.x1 - x, 0], [0, b.z0 - z], [0, b.z1 - z]];
        opts.sort((p, q) => Math.abs(p[0] + p[1]) - Math.abs(q[0] + q[1]));
        dx = Math.sign(opts[0][0]); dz = Math.sign(opts[0][1]); d = 0;
        x += opts[0][0] + dx * r; z += opts[0][1] + dz * r;
      } else {
        const push = r - d; dx /= d; dz /= d; x += dx * push; z += dz * push;
      }
      hit = { x, z, nx: dx, nz: dz };
    }
  }
  // City edge
  const lo = -SW + r, hi = SIZE + SW - r;
  if (x < lo) hit = { x: lo, z: hit ? hit.z : z, nx: 1, nz: 0 };
  if (x > hi) hit = { x: hi, z: hit ? hit.z : z, nx: -1, nz: 0 };
  if (z < lo) hit = { x: hit ? hit.x : x, z: lo, nx: 0, nz: 1 };
  if (z > hi) hit = { x: hit ? hit.x : x, z: hi, nx: 0, nz: -1 };
  return hit;
}

// Circle vs oriented box. Returns {nx,nz,depth} pointing from the box to the circle, or null.
function circleOBB(cx, cz, r, ox, oz, rot, hl, hw) {
  const s = Math.sin(rot), c = Math.cos(rot);
  const dx = cx - ox, dz = cz - oz;
  const lx = dx * c - dz * s, lz = dx * s + dz * c;   // into box space (x = width, z = length)
  const px = clamp(lx, -hw, hw), pz = clamp(lz, -hl, hl);
  let ex = lx - px, ez = lz - pz, d = Math.hypot(ex, ez);
  if (d >= r) return null;
  if (d < 1e-4) { ex = 0; ez = lz >= 0 ? 1 : -1; d = 0; } else { ex /= d; ez /= d; }
  return { nx: ex * c + ez * s, nz: -ex * s + ez * c, depth: r - d };
}

// Random point on a road lane, far from (px,pz)
function randomLaneSpot(px, pz, minDist) {
  for (let tries = 0; tries < 60; tries++) {
    const i = Math.floor(Math.random() * (N + 1)), j = Math.floor(Math.random() * (N + 1));
    const d = pick(DIRS); if (!validDir(i, j, d)) continue;
    const t = rand(.3, .7) * CELL, o = laneOff(d);
    const x = i * CELL + d.dx * t + o.x, z = j * CELL + d.dz * t + o.z;
    if (Math.hypot(x - px, z - pz) < minDist) continue;
    return { x, z, d, next: { i: i + d.dx, j: j + d.dz } };
  }
  return null;
}

// ---------- jump ramps on the road centre lines ----------
World.ramps = [];
function buildRamps(scene) {
  const deck = lam(0x30343f), edge = basic(0xff7b00), arrow = basic(0xffd23a);
  const used = new Set();
  for (let k = 0; k < RAMP_COUNT * 4 && World.ramps.length < RAMP_COUNT; k++) {
    const line = Math.floor(Math.random() * (N + 1)), s = Math.floor(Math.random() * N), axis = pick(['x', 'z']);
    const key = `${axis}${line}_${s}`; if (used.has(key)) continue; used.add(key);
    const dir = pick([1, -1]), t = CELL / 2;
    const x = axis === 'x' ? s * CELL + t : line * CELL, z = axis === 'x' ? line * CELL : s * CELL + t;
    if (Math.hypot(x - START.x, z - START.z) < 50) continue; // keep the start clear
    const rot = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    const g = new THREE.Group();
    const L = 7, H = 1.6, ang = Math.atan2(H, L), slope = Math.hypot(L, H);
    const top = new THREE.Mesh(GEO.box, deck); top.scale.set(3.2, .25, slope); top.rotation.x = -ang; top.position.set(0, H / 2, 0); g.add(top);
    const back = new THREE.Mesh(GEO.box, deck); back.scale.set(3.2, H, .25); back.position.set(0, H / 2, L / 2); g.add(back);
    for (const sx of [-1.6, 1.6]) { const e = new THREE.Mesh(GEO.box, edge); e.scale.set(.14, .3, slope); e.rotation.x = -ang; e.position.set(sx, H / 2 + .1, 0); g.add(e); }
    for (let c = 0; c < 3; c++) { const a = new THREE.Mesh(GEO.box, arrow); a.scale.set(1.4, .06, .35); a.rotation.x = -ang; a.position.set(0, H / 2 - L / 2 * Math.sin(ang) + (c + 1) * (H / 4) + .15, -L / 2 + (c + 1) * (L / 4)); g.add(a); }
    g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
    World.ramps.push({ x, z, rot, hl: L / 2, hw: 1.6 });
  }
}

// Show or hide street props for the player's tier. Locked props are invisible and can't be hit.
function applyPropTier(tier) {
  for (const it of World.props) {
    if (it.minTier > tier) { if (!it.locked) { it.locked = true; it.alive = false; it.batch.show(it, false); } }
    else if (it.locked) { it.locked = false; it.alive = true; it.batch.show(it, true); }
  }
}

// A lane spot between min and max metres ahead of the player (roughly in their direction of travel)
function laneSpotAhead(P, min, max) {
  for (let tries = 0; tries < 80; tries++) {
    const s = randomLaneSpot(P.x, P.z, min); if (!s) return null;
    const dx = s.x - P.x, dz = s.z - P.z, d = Math.hypot(dx, dz);
    if (d <= max && (dx * P.fx + dz * P.fz) / d > .45) return s;
  }
  return null;
}
