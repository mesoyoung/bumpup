// ============================================================
// world.js — the night city: roads, blocks, buildings, neon,
// sidewalk props (instanced), building colliders, lanes.
// ============================================================

const World = {
  blocks: [],        // from makeLayout: {i,j,type, x0,z0,x1,z1, boxes:[...]}
  props: [],         // every sidewalk prop item
  batches: {},       // kind -> PropBatch
  hash: new Map(),   // spatial hash of props
  loops: [],         // pedestrian loops (rects)
  ramps: [], foodSpots: [], parkSpots: [],
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
    styleRing(this.ringMat, t);
    this.ringMat.opacity = Lighting.bright ? .9 : t === 'smash' ? .75 : t === 'bounce' ? .65 : .6;
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

// Build the whole map into one group, so switching maps can throw it away and build another.
function buildWorld(scene, map) {
  World.root = new THREE.Group(); scene.add(World.root);
  World.map = map; World.disposables = [];
  withSeed(map.seed + 7, () => buildMap(World.root, map, makeLayout(map)));
}
function clearWorld(scene) {
  if (!World.root) return;
  scene.remove(World.root);
  for (const d of World.disposables) d.dispose();
  Object.assign(World, { blocks: [], props: [], batches: {}, hash: new Map(), loops: [], ramps: [], foodSpots: [], parkSpots: [], root: null });
}
const keep = x => { World.disposables.push(x); return x; };

function buildMap(scene, map, layout) {
  const P = map.pal;
  // Ground + sidewalks (one slab) and roads on top
  const ground = new THREE.Mesh(keep(new THREE.PlaneGeometry(SIZE + EXT * 2 + 400, SIZE + EXT * 2 + 400).rotateX(-Math.PI / 2)), lam(P.ground));
  ground.material = keep(new THREE.MeshLambertMaterial({ color: P.ground }));   // own material so daytime can tone it down
  ground.position.set(SIZE / 2, 0, SIZE / 2); scene.add(ground); World.ground = ground;
  if (P.sea) { // water beyond the far edge
    const sea = new THREE.Mesh(keep(new THREE.PlaneGeometry(SIZE + EXT * 2 + 400, 300).rotateX(-Math.PI / 2)), keep(new THREE.MeshLambertMaterial({ color: P.sea, emissive: P.sea, emissiveIntensity: .35 })));
    World.sea = sea;
    sea.position.set(SIZE / 2, .015, SIZE + SW + 150.6); scene.add(sea);
  }
  const arena = !!map.arena;
  const roadMat = lam(P.road);
  if (!arena) for (let i = 0; i <= N; i++) {
    const a = new THREE.Mesh(keep(new THREE.PlaneGeometry(RW * 2, SIZE + RW * 2).rotateX(-Math.PI / 2)), roadMat);
    a.position.set(i * CELL, .02, SIZE / 2); scene.add(a);
    const b = new THREE.Mesh(keep(new THREE.PlaneGeometry(SIZE + RW * 2, RW * 2).rotateX(-Math.PI / 2)), roadMat);
    b.position.set(SIZE / 2, .021, i * CELL); scene.add(b);
  }
  // Lane dashes + car park bay lines
  const dashes = new THREE.InstancedMesh(GEO.plane, basic(0xd8c46a), 8000);
  dashes.frustumCulled = false;
  let dc = 0; const m = new THREE.Matrix4();
  if (!arena) for (let i = 0; i <= N; i++) for (let s = 0; s < N; s++) for (let t = SW + 1.5; t < CELL - SW - 1; t += 4.5) {
    m.makeScale(.22, 1, 2.2).setPosition(i * CELL, .04, s * CELL + t); dashes.setMatrixAt(dc++, m);
    m.makeScale(2.2, 1, .22).setPosition(s * CELL + t, .04, i * CELL); dashes.setMatrixAt(dc++, m);
  }
  scene.add(dashes);

  // Curbs around every block
  const curbs = new THREE.InstancedMesh(GEO.box, lam(0x6d7385), N * N * 4);
  curbs.frustumCulled = false; let cc = 0;
  const L = CELL - RW * 2;
  if (!arena) for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const cx = (i + .5) * CELL, cz = (j + .5) * CELL;
    m.makeScale(L, .16, .35).setPosition(cx, .08, j * CELL + RW); curbs.setMatrixAt(cc++, m);
    m.makeScale(L, .16, .35).setPosition(cx, .08, (j + 1) * CELL - RW); curbs.setMatrixAt(cc++, m);
    m.makeScale(.35, .16, L).setPosition(i * CELL + RW, .08, cz); curbs.setMatrixAt(cc++, m);
    m.makeScale(.35, .16, L).setPosition((i + 1) * CELL - RW, .08, cz); curbs.setMatrixAt(cc++, m);
  }
  scene.add(curbs);

  // Building materials (window textures), tinted per map
  const tint = map.id === 'seaside' ? [['#ffd38a', '#ffb0d8', '#fff0c9'], '#3a2a3e'] : map.id === 'docks' ? [['#bfe6ff', '#e9f6ff', '#ffd38a'], '#1e2830'] : null;
  const wallMats = [
    tint || [['#ffd38a', '#ffc46b', '#fff0c9'], '#20232e'],
    [['#bfe6ff', '#e9f6ff', '#8fd3ff'], '#1a2130'],
    [['#ffd38a', '#ff9fd6', '#a0ffe6'], '#251f2c'],
  ].map(([lit, wall]) => { const t = keep(windowTexture(lit, wall)); return keep(new THREE.MeshLambertMaterial({ color: 0x9aa0b5, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: .85 })); });
  World.wallMats = wallMats;
  const roofMat = lam(0x14161c);
  const shedMat = lam(0x5d6873), shedRoof = lam(0x3a4148), shedLight = lam(0xfff1c9, 0xfff1c9, 1);

  // Neon signs + storefront bands (one instanced batch with per-instance colour)
  const neon = new THREE.InstancedMesh(GEO.box, keep(new THREE.MeshBasicMaterial({ color: 0xffffff })), 1200);
  neon.frustumCulled = false; let nc = 0;
  const NEON = [0xff2f92, 0x2ff3ff, 0xffb347, 0x9b5cff, 0x4dff8a, 0xff4040];
  const col = new THREE.Color();
  const addNeon = (x, y, z, sx, sy, sz, hex) => {
    if (nc >= 1200) return;
    m.makeScale(sx, sy, sz).setPosition(x, y, z); neon.setMatrixAt(nc, m);
    neon.setColorAt(nc, col.setHex(hex)); nc++;
  };
  // Shipping containers: one instanced batch
  const boxes = layout.flatMap(b => b.boxes.filter(x => x.style === 'container'));
  const cont = new THREE.InstancedMesh(GEO.box, keep(new THREE.MeshLambertMaterial({ color: 0xffffff })), Math.max(1, boxes.length));
  cont.frustumCulled = false; let kc = 0;
  const CONT = [0xc0392b, 0x2f6fc0, 0xd8902a, 0x2f9a66, 0x8e44ad, 0xb8bcc4];

  const rockMat = lam(0x734434), rockTop = lam(0x732f17);
  const GROUND = { camp: 0xa99f8a, park: 0x1c3a27, plaza: 0x4a4256, island: 0x433b4d, beach: 0x8f7650, carpark: 0x22242b, yard: 0x3a3e42, warehouse: 0x3a3e42, quay: 0x484e53 };
  for (const b of layout) {
    World.blocks.push(b);
    World.loops.push({ x0: b.i * CELL + PED_PATH, z0: b.j * CELL + PED_PATH, x1: (b.i + 1) * CELL - PED_PATH, z1: (b.j + 1) * CELL - PED_PATH });
    if (GROUND[b.type]) {
      const g = new THREE.Mesh(keep(new THREE.PlaneGeometry(b.x1 - b.x0, b.z1 - b.z0).rotateX(-Math.PI / 2)), lam(GROUND[b.type]));
      g.position.set((b.x0 + b.x1) / 2, .03, (b.z0 + b.z1) / 2); scene.add(g);
    }
    if (b.type === 'carpark') { // painted bays
      for (const z of [b.z0 + 7, (b.z0 + b.z1) / 2, b.z1 - 7]) for (let x = b.x0 + 2.3; x < b.x1 - 2; x += 3.4) {
        m.makeScale(.14, 1, 4.6).setPosition(x, .05, z); dashes.setMatrixAt(dc++, m);
      }
    }
    for (const s of b.spots) World.parkSpots.push(s);
    for (const x of b.boxes) {
      const w = x.x1 - x.x0, dd = x.z1 - x.z0, h = x.h, cx = (x.x0 + x.x1) / 2, cz = (x.z0 + x.z1) / 2;
      if (x.style === 'container') {
        m.makeScale(w - .2, h, dd - .1).setPosition(cx, h / 2, cz); cont.setMatrixAt(kc, m);
        cont.setColorAt(kc, col.setHex(pick(CONT))); kc++; continue;
      }
      if (x.style === 'rock') {   // desert mesa: stacked, slightly offset slabs
        const r1 = new THREE.Mesh(GEO.box, rockMat); r1.scale.set(w, h * .7, dd); r1.position.set(cx, h * .35, cz); scene.add(r1);
        const r2 = new THREE.Mesh(GEO.box, rockTop); r2.scale.set(w * .82, h * .32, dd * .82); r2.position.set(cx + w * .05, h * .84, cz - dd * .04); scene.add(r2);
        continue;
      }
      if (x.style === 'warehouse') {
        const shed = new THREE.Mesh(GEO.box, shedMat); shed.scale.set(w - .4, h, dd - .4); shed.position.set(cx, h / 2, cz); scene.add(shed);
        const roof = new THREE.Mesh(GEO.box, shedRoof); roof.scale.set(w, .5, dd); roof.position.set(cx, h + .25, cz); scene.add(roof);
        const strip = new THREE.Mesh(GEO.box, shedLight); strip.scale.set(w * .7, .4, .1); strip.position.set(cx, h - 1.2, x.z0 + .1 - .2); scene.add(strip);
        addNeon(cx, h * .45, x.z0 - .25, w * .35, 3.2, .1, 0x2b3038); // big loading door
        continue;
      }
      const geo = keep(new THREE.BoxGeometry(w - .6, h, dd - .6));
      const uv = geo.attributes.uv;
      for (let f = 0; f < 6; f++) {
        if (f === 2 || f === 3) continue;
        const across = f < 2 ? dd : w;
        for (let v = 0; v < 4; v++) { const n = f * 4 + v; uv.setXY(n, uv.getX(n) * across / 32, uv.getY(n) * h / 28); }
      }
      const wm = x.style === 'low' && tint ? wallMats[0] : pick(wallMats);
      const bld = new THREE.Mesh(geo, [wm, wm, roofMat, roofMat, wm, wm]);
      bld.position.set(cx, h / 2, cz); scene.add(bld);
      // storefront bands: on faces that touch the street, or all round for free-standing buildings
      const shop = pick([0xffc46b, 0xff7ab8, 0x7af0ff, 0xfff3d6]), all = x.style === 'low';
      if (all || x.x0 === b.x0) addNeon(x.x0 - .05, 3.4, cz, .12, .35, dd * .85, shop);
      if (all || x.x1 === b.x1) addNeon(x.x1 + .05, 3.4, cz, .12, .35, dd * .85, shop);
      if (all || x.z0 === b.z0) addNeon(cx, 3.4, x.z0 - .05, w * .85, .35, .12, shop);
      if (all || x.z1 === b.z1) addNeon(cx, 3.4, x.z1 + .05, w * .85, .35, .12, shop);
      if (Math.random() < .55) {
        const hue = pick(NEON), sy = rand(3.5, 7), y = rand(6.5, Math.min(h - 2, 16));
        if (y > 6) {
          if (all || x.x0 === b.x0) addNeon(x.x0 - .5, y, rand(x.z0 + 3, x.z1 - 3), .3, sy, 1.1, hue);
          else if (x.z0 === b.z0) addNeon(rand(x.x0 + 3, x.x1 - 3), y, x.z0 - .5, 1.1, sy, .3, hue);
          else if (x.x1 === b.x1) addNeon(x.x1 + .5, y, rand(x.z0 + 3, x.z1 - 3), .3, sy, 1.1, hue);
          else if (x.z1 === b.z1) addNeon(rand(x.x0 + 3, x.x1 - 3), y, x.z1 + .5, 1.1, sy, .3, hue);
        }
      }
      if (h > 45) addNeon(cx, h + .6, cz, .8, .8, .8, 0xff2030); // aviation light
    }
  }
  dashes.count = dc;
  neon.count = nc; if (neon.instanceColor) neon.instanceColor.needsUpdate = true;
  scene.add(neon);
  cont.count = kc; if (cont.instanceColor) cont.instanceColor.needsUpdate = true;
  scene.add(cont);

  // Dock cranes across the water edge (scenery)
  if (map.id === 'docks') for (let k = 0; k < 4; k++) {
    const x = (k + .5) * SIZE / 4, z = SIZE + SW + 6, crane = new THREE.Group(), steel = lam(0xd8902a), red = basic(0xff2030);
    for (const lx of [-4, 4]) for (const lz of [-3, 3]) { const leg = new THREE.Mesh(GEO.box, steel); leg.scale.set(.8, 26, .8); leg.position.set(lx, 13, lz); crane.add(leg); }
    const boom = new THREE.Mesh(GEO.box, steel); boom.scale.set(1.4, 1.4, 44); boom.position.set(0, 27, -6); crane.add(boom);
    const tip = new THREE.Mesh(GEO.box, red); tip.scale.set(.8, .8, .8); tip.position.set(0, 28.4, -27); crane.add(tip);
    crane.position.set(x, 0, z); scene.add(crane);
  }

  // City edge: glowing barriers + distant silhouettes
  const barrierMat = lam(0x5a606e), stripe = basic(0xff7b00);
  const E0 = -SW - .6, E1 = SIZE + SW + .6, len = SIZE + SW * 2 + 1.2;
  [[SIZE / 2, E0, len, .8], [SIZE / 2, E1, len, .8], [E0, SIZE / 2, .8, len], [E1, SIZE / 2, .8, len]].forEach(([x, z, sx, sz]) => {
    const b = new THREE.Mesh(GEO.box, barrierMat); b.scale.set(sx, 1.1, sz); b.position.set(x, .55, z); scene.add(b);
    const s = new THREE.Mesh(GEO.box, stripe); s.scale.set(sx + .02, .12, sz + .02); s.position.set(x, .9, z); scene.add(s);
  });
  const sil = new THREE.InstancedMesh(GEO.box, lam(map.arena ? 0x2a2026 : 0x10131f), 120);   // distant towers, or distant mesas in the desert
  let sc = 0; const mid = SIZE / 2;
  for (let k = 0; k < 120; k++) {
    const ang = k / 120 * Math.PI * 2, r = SIZE * .72 + rand(60, 200);
    const sz = mid + Math.sin(ang) * r;
    if (P.sea && sz > SIZE + SW) continue;  // open water on the sea side
    const h = rand(30, 140), w = rand(18, 40);
    m.makeScale(w, h, w).setPosition(mid + Math.cos(ang) * r, h / 2, sz); sil.setMatrixAt(sc++, m);
  }
  sil.count = sc; sil.frustumCulled = false; scene.add(sil);

  buildProps(scene);
  buildRamps(scene);
}

// ---------- sidewalk props ----------
function buildProps(scene) {
  const B = World.batches;
  const sides = ((N + 1) * 2 - 2) * N * 2;
  B.lamp = new PropBatch(scene, 'lamp', sides * 3);
  B.bin = new PropBatch(scene, 'bin', sides + 400);
  B.cone = new PropBatch(scene, 'cone', 600);
  B.hydrant = new PropBatch(scene, 'hydrant', sides + 200);
  B.busstop = new PropBatch(scene, 'busstop', 60);
  B.tree = new PropBatch(scene, 'tree', sides + 400);
  // minTier: the tier index at which this prop appears (hazards show up once you can smash them)
  const put = (kind, x, z, rot, minTier) => { if (B[kind].count >= B[kind].max) return null; const it = B[kind].add(x, z, rot); it.minTier = minTier || 0; World.props.push(it); hashAdd(it); return it; };

  if (World.map.arena) {
    // No roads: one food truck near the centre of each zone, nudged off any rock
    for (let a = 0; a < FOOD_GRID; a++) for (let b = 0; b < FOOD_GRID; b++) {
      let x = (a + .5) / FOOD_GRID * SIZE, z = (b + .5) / FOOD_GRID * SIZE;
      if (Math.hypot(x - START.x, z - START.z) < 40) z += 45;   // keep the start line clear
      for (let k = 0; k < 20 && pushOutOfBuildings(x, z, 6); k++) { x += rand(-8, 8); z += rand(-8, 8); }
      World.foodSpots.push({ x, z, rot: rand(0, 6.28), zone: a * FOOD_GRID + b });
    }
    // Lone signposts out in the open (they appear once you can knock them over)
    for (let k = 0; k < 70; k++) { const x = rand(0, SIZE), z = rand(0, SIZE); if (!pushOutOfBuildings(x, z, 2)) put('lamp', x, z, rand(0, 6.28), 1); }
  } else {
  // Food truck bays: the city is split into an even FOOD_GRID x FOOD_GRID grid of zones, and each
    // zone gets one bay on the road side closest to its centre, so trucks are spread out evenly.
    const bays = new Map();
    for (let a = 0; a < FOOD_GRID; a++) for (let b = 0; b < FOOD_GRID; b++) {
      const tx = (a + .5) / FOOD_GRID * SIZE, tz = (b + .5) / FOOD_GRID * SIZE;
      let best = null, bd = 1e9;
      for (let line = 0; line <= N; line++) for (let s = 0; s < N; s++) for (const side of [-1, 1]) for (const axis of ['x', 'z']) {
        if ((line === 0 && side === -1) || (line === N && side === 1)) continue;
        const x = axis === 'x' ? s * CELL + CELL / 2 : line * CELL + side * (RW + 1.3);
        const z = axis === 'x' ? line * CELL + side * (RW + 1.3) : s * CELL + CELL / 2;
        if (Math.hypot(x - START.x, z - START.z) < 40) continue;
        const d = Math.hypot(x - tx, z - tz);
        if (d < bd) { bd = d; best = `${line},${s},${side},${axis}`; }
      }
      bays.set(best, a * FOOD_GRID + b);
    }
    let stops = 0;
    // Each road segment has two sides. side = +1/-1 relative to the road centre line.
    for (let line = 0; line <= N; line++) for (let s = 0; s < N; s++) for (const side of [-1, 1]) for (const axis of ['x', 'z']) {
      // axis 'x': road runs along x at z = line*CELL. axis 'z': road runs along z at x = line*CELL.
      if ((line === 0 && side === -1) || (line === N && side === 1)) continue; // outer edge faces the barrier
      const at = (t, off) => axis === 'x' ? [s * CELL + t, line * CELL + side * off] : [line * CELL + side * off, s * CELL + t];
      // lamp arm points toward the road
      const lampRot = axis === 'x' ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
      // Some sides keep a parking bay free in the middle for a food truck
      const bay = bays.has(`${line},${s},${side},${axis}`);
      for (const f of bay ? [.25, .75] : [.25, .5, .75]) { const [x, z] = at(CELL * f, RW + .8); put('lamp', x, z, lampRot, f === .75 ? 0 : 1); }
      if (bay) { const [x, z] = at(CELL * .5, RW + 1.3); World.foodSpots.push({ x, z, rot: axis === 'x' ? Math.PI / 2 : 0, zone: bays.get(`${line},${s},${side},${axis}`) }); continue; }
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
  }
  // Trees and loose props inside the blocks (parks, plazas, beach, yards)
  for (const b of World.blocks) {
    for (const [x, z] of b.trees) put('tree', x, z, rand(0, 6), b.type === 'park' ? 0 : 1);
    for (const s of b.scatter) put(s.kind, s.x, s.z, rand(0, 6));
  }
}

// ---------- building collision ----------
// Pushes a circle out of any building block. Returns the push normal or null.
function pushOutOfBuildings(x, z, r) {
  const bi = Math.floor(x / CELL), bj = Math.floor(z / CELL);
  let hit = null;
  for (let i = bi - 1; i <= bi + 1; i++) for (let j = bj - 1; j <= bj + 1; j++) {
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const blk = World.blocks[i * N + j];
    if (!blk) continue;
    for (const b of blk.boxes) {
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
function buildRamps(scene) {
  const deck = lam(0x30343f), edge = basic(0xff7b00), arrow = basic(0xffd23a);
  const used = new Set();
  const count = World.map.arena ? RAMP_COUNT + 12 : RAMP_COUNT;
  for (let k = 0; k < count * 6 && World.ramps.length < count; k++) {
    const line = Math.floor(Math.random() * (N + 1)), s = Math.floor(Math.random() * N), axis = pick(['x', 'z']);
    const key = `${axis}${line}_${s}`; if (used.has(key)) continue; used.add(key);
    const dir = pick([1, -1]), t = CELL / 2;
    let x = axis === 'x' ? s * CELL + t : line * CELL, z = axis === 'x' ? line * CELL : s * CELL + t;
    if (World.map.arena) { x = rand(20, SIZE - 20); z = rand(20, SIZE - 20); if (pushOutOfBuildings(x, z, 8)) continue; }
    if (Math.hypot(x - START.x, z - START.z) < 50) continue; // keep the start clear
    const rot = World.map.arena ? rand(0, Math.PI * 2) : axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
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
