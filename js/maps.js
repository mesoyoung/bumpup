// ============================================================
// maps.js — the maps you can pick. Every map shares the same road
// grid (so traffic, police and lanes work everywhere) but fills the
// blocks differently: solid towers, open plazas, car parks, beach,
// container yards. Each map is seeded, so it's the same every time.
// ============================================================

const MAPS = [   // ordered easiest first
  {
    id: 'flats', name: 'Salt Flats', blurb: 'Wide-open desert with no roads and no walls. Chase anything, anywhere.',
    seed: 4409, open: 3, difficulty: 'Easiest', coins: .5, arena: true,
    pal: { sky: 0x0b0d1c, fog: 0x141a2c, fogNear: 70, fogFar: 300, ground: 0xa6583c, road: 0x8f8775, hemiSky: 0x7084c8, hemiGround: 0x3a3226, sea: null },
    day: { sky: 0xd9b6a3, fog: 0xd9b6a3, fogNear: 110, fogFar: 420, hemiSky: 0xfff0e6, hemiGround: 0xa6583c, sea: null, ground: 0xbf754b },
  },
  {
    id: 'seaside', name: 'Seaside Strip', blurb: 'Wide plazas, car parks and a beach. Room to roam and chase.',
    seed: 2207, open: 3, difficulty: 'Easy', coins: .75,
    pal: { sky: 0x1b1030, fog: 0x2a1838, fogNear: 60, fogFar: 270, ground: 0x3a3442, road: 0x1b1a22, hemiSky: 0xb08ad0, hemiGround: 0x2a1520, sea: 0x14204a },
    day: { sky: 0x7cc6f0, fog: 0xbfe3f2, fogNear: 90, fogFar: 380, hemiSky: 0xffffff, hemiGround: 0xb89a70, sea: 0x2a86c0 },
  },
  {
    id: 'docks', name: 'The Docks', blurb: 'Container yards and warehouses. Open lots between narrow stacks.',
    seed: 3301, open: 2, difficulty: 'Medium', coins: 1,
    pal: { sky: 0x06121a, fog: 0x0b1b24, fogNear: 50, fogFar: 250, ground: 0x34383b, road: 0x17191b, hemiSky: 0x6aa0b8, hemiGround: 0x12181a, sea: 0x0a2430 },
    day: { sky: 0x9bb3c2, fog: 0xb4c4cc, fogNear: 80, fogFar: 340, hemiSky: 0xe8f0f5, hemiGround: 0x5a6066, sea: 0x2e6a84 },
  },
  {
    id: 'downtown', name: 'Downtown', blurb: 'Neon towers on a tight grid. Sharp corners and plenty to dodge.',
    seed: 1103, open: 1, difficulty: 'Hard', coins: 1.5,
    pal: { sky: 0x070a16, fog: 0x0a0e1e, fogNear: 45, fogFar: 230, ground: 0x2b2e38, road: 0x15171d, hemiSky: 0x7084c8, hemiGround: 0x20121c, sea: null },
    day: { sky: 0x8fb8e8, fog: 0xa9c4e0, fogNear: 80, fogFar: 360, hemiSky: 0xe6f0ff, hemiGround: 0x6a6458, sea: null },
  },
];
const mapById = id => MAPS.find(m => m.id === id) || MAPS[0];

// Small seeded random generator, so a map lays out identically every time
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Run fn with Math.random replaced by the map's seeded generator (rand/pick then follow the seed too)
function withSeed(seed, fn) {
  const real = Math.random; Math.random = seeded(seed);
  try { return fn(); } finally { Math.random = real; }
}

// ---------- layout: pure data, used to build the 3D world and to draw the preview ----------
// block.type: build | park | plaza | carpark | island | beach | yard | warehouse | quay
// block.boxes: solid things you bump into [{x0,z0,x1,z1,h,style}], style: tower | low | warehouse | container
function makeLayout(map) {
  return withSeed(map.seed, () => {
    const blocks = [], mid = SIZE / 2;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const x0 = i * CELL + SW, z0 = j * CELL + SW, x1 = (i + 1) * CELL - SW, z1 = (j + 1) * CELL - SW;
      const b = { i, j, x0, z0, x1, z1, boxes: [], trees: [], spots: [], scatter: [] };
      const d = Math.hypot((i + .5) * CELL - mid, (j + .5) * CELL - mid);
      if (map.id === 'downtown') layoutDowntown(b, d);
      else if (map.id === 'seaside') layoutSeaside(b, i, j);
      else if (map.arena) layoutFlats(b, i, j);
      else layoutDocks(b, i, j);
      blocks.push(b);
    }
    return blocks;
  });
}

function splitRects(b, split) {
  const { x0, z0, x1, z1 } = b, rects = [];
  const mx = (x0 + x1) / 2 + rand(-5, 5), mz = (z0 + z1) / 2 + rand(-5, 5);
  if (split === 1) rects.push([x0, z0, x1, z1]);
  else if (split === 2) Math.random() < .5 ? rects.push([x0, z0, mx, z1], [mx, z0, x1, z1]) : rects.push([x0, z0, x1, mz], [x0, mz, x1, z1]);
  else rects.push([x0, z0, mx, mz], [mx, z0, x1, mz], [x0, mz, mx, z1], [mx, mz, x1, z1]);
  return rects;
}
function addTrees(b, n, inset) {
  for (let k = 0; k < n; k++) b.trees.push([rand(b.x0 + inset, b.x1 - inset), rand(b.z0 + inset, b.z1 - inset)]);
}
function addScatter(b, kind, n, inset) {
  for (let k = 0; k < n; k++) b.scatter.push({ kind, x: rand(b.x0 + inset, b.x1 - inset), z: rand(b.z0 + inset, b.z1 - inset) });
}
// rows of parked cars across a car park block
function addParking(b, kinds) {
  // only a few cars per car park: each one is a full model, and lots of them would slow phones down
  const rows = [b.z0 + 7, (b.z0 + b.z1) / 2, b.z1 - 7];
  for (const z of rows) for (let x = b.x0 + 4; x < b.x1 - 3; x += 3.4) {
    if (b.spots.length < 3 && Math.random() < .12) b.spots.push({ x, z, rot: Math.random() < .5 ? 0 : Math.PI, kind: pick(kinds) });
  }
}

function layoutDowntown(b, d) {
  const zone = d < SIZE * .2 ? 'downtown' : d < SIZE * .37 ? 'mid' : 'outer';
  if ((zone !== 'downtown' && Math.random() < .2) || (b.i === 3 && b.j === 4)) { b.type = 'park'; addTrees(b, 6, 4); return; }
  b.type = 'build';
  const split = pick(zone === 'downtown' ? [1, 2, 4] : [2, 4, 4]);
  for (const [a, c, e, f] of splitRects(b, split)) {
    const h = zone === 'downtown' ? rand(26, 62) : zone === 'mid' ? rand(12, 28) : rand(7, 14);
    b.boxes.push({ x0: a, z0: c, x1: e, z1: f, h, style: 'tower' });
  }
}

function layoutSeaside(b, i, j) {
  if (j === N - 1) { b.type = 'beach'; addTrees(b, 4, 5); addScatter(b, 'cone', 3, 4); addScatter(b, 'bin', 2, 4); return; }
  const r = Math.random();
  if (r < .34) { b.type = 'plaza'; addScatter(b, 'bin', 4, 4); addScatter(b, 'hydrant', 2, 5); addTrees(b, 2, 6); }
  else if (r < .56) { b.type = 'carpark'; addParking(b, ['sedan', 'sedan', 'sedan', 'suv']); }
  else if (r < .9) {
    // one low building standing on its own, with open space all round it
    b.type = 'island';
    const w = rand(11, 17), dd = rand(11, 17), cx = rand(b.x0 + w / 2 + 5, b.x1 - w / 2 - 5), cz = rand(b.z0 + dd / 2 + 5, b.z1 - dd / 2 - 5);
    b.boxes.push({ x0: cx - w / 2, z0: cz - dd / 2, x1: cx + w / 2, z1: cz + dd / 2, h: rand(7, 16), style: 'low' });
    addScatter(b, 'bin', 2, 3);
  } else { b.type = 'park'; addTrees(b, 4, 5); addScatter(b, 'bin', 2, 4); }
}

// Salt Flats: no roads. Open ground with the odd rock mesa, little camps and scattered junk.
function layoutFlats(b, i, j) {
  b.type = 'flat';
  // stretch the block over the (invisible) road grid so the open ground is continuous
  const nearStart = Math.hypot((i + .5) * CELL - START.x, (j + .5) * CELL - START.z) < CELL * 1.1;
  const r = Math.random();
  if (!nearStart && r < .28) {
    const w = rand(7, 15), dd = rand(7, 15), cx = rand(b.x0 + w / 2, b.x1 - w / 2), cz = rand(b.z0 + dd / 2, b.z1 - dd / 2);
    b.boxes.push({ x0: cx - w / 2, z0: cz - dd / 2, x1: cx + w / 2, z1: cz + dd / 2, h: rand(4, 11), style: 'rock' });
  } else if (!nearStart && r < .42) {
    b.type = 'camp'; addParking(b, ['sedan', 'suv', 'suv']); addScatter(b, 'bin', 3, 4);
  }
  addScatter(b, 'bin', 2 + Math.floor(Math.random() * 3), 2);
  addScatter(b, 'cone', 2 + Math.floor(Math.random() * 3), 2);
  if (Math.random() < .3) addScatter(b, 'hydrant', 1, 3);
  if (Math.random() < .35) addTrees(b, 1, 4);          // cacti
}

function layoutDocks(b, i, j) {
  if (j === N - 1) { b.type = 'quay'; addScatter(b, 'cone', 6, 3); return; }
  const r = Math.random();
  if (r < .45) {
    // container yard: short rows of stacked boxes with driving lanes between them
    b.type = 'yard';
    for (let z = b.z0 + 4; z < b.z1 - 4; z += 9.5) for (let x = b.x0 + 3; x < b.x1 - 8; x += 15) {
      if (Math.random() < .25) continue;
      b.boxes.push({ x0: x, z0: z, x1: x + 12, z1: z + 2.6, h: 2.6 * (1 + Math.floor(Math.random() * 3)), style: 'container' });
    }
    addScatter(b, 'cone', 3, 3);
  } else if (r < .75) {
    b.type = 'warehouse';
    const w = rand(18, 24), dd = rand(13, 18), left = Math.random() < .5;
    const x0 = left ? b.x0 + 2 : b.x1 - 2 - w, z0 = rand(b.z0 + 2, b.z1 - 2 - dd);
    b.boxes.push({ x0, z0, x1: x0 + w, z1: z0 + dd, h: rand(8, 12), style: 'warehouse' });
    addScatter(b, 'bin', 3, 3);
  } else { b.type = 'carpark'; addParking(b, ['sedan', 'suv', 'suv']); }
}

// ---------- top-down preview for the map picker ----------
const GROUND_COLOURS = {
  build: '#232838', park: '#1d4a2c', plaza: '#4a4255', carpark: '#2b2d36', island: '#4a4255',
  beach: '#a88c5a', yard: '#3b4045', warehouse: '#3b4045', quay: '#454b50', flat: '#b7ad98', camp: '#a99f8a',
};
const BOX_COLOURS = { tower: '#5b6488', low: '#c06fa0', warehouse: '#7b8794', rock: '#8a5a3c', container: ['#d9534f', '#2f7dd1', '#e8a33d', '#3aa676'] };
function drawMapPreview(canvas, map) {
  const blocks = makeLayout(map), c = canvas.getContext('2d'), W = canvas.width, pad = 10;
  const s = (W - pad * 2) / (SIZE + SW * 2), X = v => pad + (v + SW) * s;
  c.fillStyle = '#' + map.pal.sky.toString(16).padStart(6, '0'); c.fillRect(0, 0, W, W);
  c.fillStyle = '#' + (map.arena ? map.pal.ground : map.pal.road).toString(16).padStart(6, '0'); c.fillRect(X(-SW), X(-SW), (SIZE + SW * 2) * s, (SIZE + SW * 2) * s);
  if (map.pal.sea) { c.fillStyle = '#' + map.pal.sea.toString(16).padStart(6, '0'); c.fillRect(0, X(SIZE + SW), W, W); }
  let k = 0;
  for (const b of blocks) {
    c.fillStyle = GROUND_COLOURS[b.type] || '#2b2e38';
    if (!map.arena) c.fillRect(X(b.x0 - 2), X(b.z0 - 2), (b.x1 - b.x0 + 4) * s, (b.z1 - b.z0 + 4) * s);
    for (const t of b.trees) { c.fillStyle = '#2f8a50'; c.beginPath(); c.arc(X(t[0]), X(t[1]), 1.6, 0, 7); c.fill(); }
    for (const p of b.spots) { c.fillStyle = '#9aa3c0'; c.fillRect(X(p.x) - .8, X(p.z) - 1.4, 1.6, 2.8); }
    for (const x of b.boxes) {
      const col = BOX_COLOURS[x.style];
      c.fillStyle = Array.isArray(col) ? col[k++ % col.length] : col;
      c.fillRect(X(x.x0), X(x.z0), (x.x1 - x.x0) * s, (x.z1 - x.z0) * s);
    }
  }
  // the start spot
  c.fillStyle = '#ffb347'; c.beginPath(); c.arc(X(START.x), X(START.z), 3.5, 0, 7); c.fill();
}
