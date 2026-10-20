// ============================================================
// models.js — low-poly meshes built from simple shapes.
// Vehicles face +Z. Props are "part lists" so they can be
// drawn as instanced batches and cloned when they go flying.
// ============================================================

const MAT = {};
function lam(color, emissive, ei) {
  const key = `l${color}_${emissive || 0}_${ei || 0}`;
  if (!MAT[key]) MAT[key] = new THREE.MeshLambertMaterial({ color, emissive: emissive || 0, emissiveIntensity: ei == null ? 1 : ei });
  return MAT[key];
}
function basic(color, opts) {
  const key = `b${color}_${JSON.stringify(opts || {})}`;
  if (!MAT[key]) MAT[key] = new THREE.MeshBasicMaterial(Object.assign({ color }, opts || {}));
  return MAT[key];
}
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(.5, .5, 1, 10),
  wheel: new THREE.CylinderGeometry(.5, .5, 1, 12).rotateZ(Math.PI / 2),
  cone: new THREE.ConeGeometry(.5, 1, 10),
  ico: new THREE.IcosahedronGeometry(1, 0),
  sphere: new THREE.SphereGeometry(.5, 8, 6),
  octa: new THREE.OctahedronGeometry(1, 0),
  ring: new THREE.RingGeometry(.7, 1, 40).rotateX(-Math.PI / 2),
  disc: new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};

// One part = geometry + material + position/scale/rotation.
const P = (g, m, p, s, r) => ({ g, m, p, s, r: r || [0, 0, 0] });
function partMatrix(pt) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(...pt.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...pt.r)), new THREE.Vector3(...pt.s));
  return m;
}
function partsToGroup(parts) {
  const g = new THREE.Group();
  for (const pt of parts) {
    const mesh = new THREE.Mesh(GEO[pt.g], pt.m);
    mesh.position.set(...pt.p); mesh.scale.set(...pt.s); mesh.rotation.set(...pt.r);
    g.add(mesh);
  }
  return g;
}

// ---------- shared colours ----------
const C = {
  glass: 0x141b2b, tyre: 0x15161a, rim: 0x8a8f99, head: 0xfff3d1, tail: 0xff2236,
  skin: [0xf1c27d, 0xc68642, 0x8d5524, 0xffdbac, 0xe0ac69],
  shirts: [0xff5964, 0x35a7ff, 0xffe74c, 0x6bf178, 0xb388eb, 0xff9f1c, 0xf7f7ff, 0x2ec4b6],
  cars: [0xd7263d, 0x1b998b, 0xf46036, 0xe2e2e2, 0x2e294e, 0x8f8f8f, 0x3d5a80, 0xf2c14e, 0x111111, 0x5c946e],
};

function wheels(list, r, w) {
  return list.map(([x, z]) => P('wheel', lam(C.tyre), [x, r, z], [w, r * 2, r * 2]));
}
function lights(x, y, zf, zb, size) {
  const s = size || [.42, .16, .06];
  return [
    P('box', lam(C.head, C.head, 1.4), [x, y, zf], s), P('box', lam(C.head, C.head, 1.4), [-x, y, zf], s),
    P('box', lam(C.tail, C.tail, 1.2), [x, y, zb], s), P('box', lam(C.tail, C.tail, 1.2), [-x, y, zb], s),
  ];
}

// ---------- vehicles ----------
function sedanParts(color) {
  const b = lam(color);
  return [
    P('box', b, [0, .62, 0], [1.9, .62, 4.4]),
    P('box', lam(C.glass), [0, 1.17, -.2], [1.7, .52, 2.2]),
    P('box', b, [0, 1.45, -.25], [1.62, .06, 1.9]),
    ...wheels([[.9, 1.4], [-.9, 1.4], [.9, -1.4], [-.9, -1.4]], .36, .32),
    ...lights(.6, .7, 2.21, -2.21),
  ];
}
function suvParts(color) {
  const b = lam(color);
  return [
    P('box', b, [0, .9, 0], [2.2, .9, 4.9]),
    P('box', lam(C.glass), [0, 1.66, -.35], [2.02, .66, 3.1]),
    P('box', b, [0, 2.02, -.35], [1.95, .08, 3.0]),
    P('box', lam(0x222222), [0, 2.12, -.35], [1.6, .08, 2.4]),
    P('box', lam(0x2a2a2a), [0, .55, 2.48], [2.2, .35, .12]),
    ...wheels([[1.05, 1.55], [-1.05, 1.55], [1.05, -1.55], [-1.05, -1.55]], .46, .4),
    ...lights(.72, 1.0, 2.46, -2.46),
  ];
}
function pickupParts(color) { // player tier 3: lifted monster pickup
  const b = lam(color);
  return [
    P('box', lam(0x1d1f24), [0, 1.35, 0], [2.2, .3, 6.0]),
    P('box', b, [0, 1.95, .9], [2.6, 1.0, 4.0]),
    P('box', lam(C.glass), [0, 2.75, .35], [2.35, .7, 2.0]),
    P('box', b, [0, 3.13, .35], [2.3, .08, 1.9]),
    P('box', b, [0, 1.8, -1.9], [2.6, .7, 2.3]),
    P('box', lam(0x111111), [0, 2.2, -1.9], [2.2, .1, 2.0]),
    P('box', lam(0x333333), [0, 3.2, 1.55], [2.0, .14, .14]),
    P('box', lam(C.head, C.head, 1.6), [0, 3.32, 1.55], [1.6, .14, .1]),
    P('box', lam(0x444444), [0, 1.35, 3.1], [2.8, .45, .3]),
    ...wheels([[1.35, 2.0], [-1.35, 2.0], [1.35, -2.0], [-1.35, -2.0]], .85, .8),
    ...lights(.85, 2.05, 2.91, -3.06),
  ];
}
function truckParts(color) {
  const b = lam(color || pick([0xe9e9e9, 0x3266a8, 0xc0392b, 0x2f8f5b]));
  return [
    P('box', b, [0, 1.75, 3.3], [2.5, 2.3, 2.2]),
    P('box', lam(C.glass), [0, 2.35, 4.41], [2.2, .9, .05]),
    P('box', lam(pick([0xd9d4c7, 0xb5b9c2, 0x8c6d4f, 0xf2f2f2])), [0, 2.25, -1.2], [2.6, 3.1, 6.6]),
    P('box', lam(0x222222), [0, .8, -1.2], [2.1, .3, 6.4]),
    ...wheels([[1.15, 3.3], [-1.15, 3.3], [1.15, -.6], [-1.15, -.6], [1.15, -3.5], [-1.15, -3.5]], .55, .5),
    ...lights(.9, 1.2, 4.41, -4.51),
  ];
}
function busParts(color, armored) {
  const b = lam(color || 0xf2b705);
  const parts = [
    P('box', b, [0, 1.85, 0], [2.8, 2.7, 11]),
    P('box', lam(0x9fd8ff, 0x9fd8ff, .55), [0, 2.35, -.3], [2.86, .85, 9.6]),
    P('box', lam(C.glass), [0, 2.1, 5.51], [2.4, 1.4, .05]),
    P('box', lam(0x2a2a2a), [0, .65, 0], [2.6, .3, 10.6]),
    P('box', lam(0xff7b00, 0xff7b00, 1.2), [0, 3.1, 5.52], [1.6, .3, .05]),
    ...wheels([[1.25, 3.6], [-1.25, 3.6], [1.25, -3.6], [-1.25, -3.6]], .58, .5),
    ...lights(1.0, 1.0, 5.51, -5.51),
  ];
  if (armored) parts.push(
    P('box', lam(0x55595f), [0, .9, 5.9], [3.4, 1.2, .5], [.35, 0, 0]),
    P('box', lam(0xff2236, 0xff2236, 1.4), [0, 3.3, 0], [2.4, .12, .4]),
  );
  return parts;
}
function policeParts() {
  const p = sedanParts(0xf4f4f4);
  p.push(
    P('box', lam(0x111111), [0, .42, 0], [1.94, .3, 4.42]),
    P('box', basic(0xff1a3c), [.4, 1.56, -.25], [.6, .16, .3]),
    P('box', basic(0x2a6bff), [-.4, 1.56, -.25], [.6, .16, .3]),
  );
  return p;
}
function foodTruckParts() {
  return [
    P('box', lam(0xff4fa3), [0, 1.6, 0], [2.3, 2.6, 5.6]),
    P('box', lam(0x2bd9c5, 0x2bd9c5, .9), [1.16, 1.9, -.4], [.05, 1.1, 3.2]),
    P('box', lam(0xffffff, 0xffffff, .6), [0, 3.05, -.4], [2.0, .3, 3.0]),
    P('box', lam(C.glass), [0, 2.1, 2.81], [2.0, .8, .05]),
    ...wheels([[1.05, 1.8], [-1.05, 1.8], [1.05, -1.8], [-1.05, -1.8]], .45, .4),
  ];
}
const siren = (y, z, w) => [
  P('box', basic(0xff1a3c), [w * .3, y, z], [w * .38, .18, .32]),
  P('box', basic(0x2a6bff), [-w * .3, y, z], [w * .38, .18, .32]),
];
function policeSuvParts() {   // size 3: chases the SUV player
  const p = suvParts(0xf0f0f0);
  p.push(P('box', lam(0x111111), [0, .55, 0], [2.24, .5, 4.92]), ...siren(2.22, -.35, 1.9));
  return p;
}
function swatParts() {        // size 4: armoured SWAT van
  const b = lam(0x1b1f2a);
  return [
    P('box', b, [0, 1.9, -.3], [2.5, 2.6, 6.6]),
    P('box', b, [0, 1.55, 3.4], [2.4, 1.9, 1.4]),
    P('box', lam(C.glass), [0, 2.0, 4.11], [2.1, .7, .05]),
    P('box', lam(0x2a6bff, 0x1a3cff, .5), [1.26, 2.0, -.3], [.04, .3, 6]),
    P('box', lam(0x2a6bff, 0x1a3cff, .5), [-1.26, 2.0, -.3], [.04, .3, 6]),
    P('box', lam(0x3a3f4a), [0, .9, 4.25], [2.6, .6, .3]),
    ...siren(3.3, 1, 2.2),
    ...wheels([[1.15, 2.9], [-1.15, 2.9], [1.15, -2.4], [-1.15, -2.4]], .6, .55),
    ...lights(.85, 1.2, 4.13, -3.61),
  ];
}
function riotParts() {        // size 5: police riot truck with a plough
  const b = lam(0x16233f);
  return [
    P('box', b, [0, 2.1, -.6], [2.8, 2.9, 7.8]),
    P('box', b, [0, 1.8, 4.0], [2.7, 2.3, 1.9]),
    P('box', lam(C.glass), [0, 2.45, 4.96], [2.3, .6, .05]),
    P('box', lam(0x5a606e), [0, 1.0, 5.4], [3.4, 1.3, .5], [.35, 0, 0]),
    P('box', lam(0xe9e9e9), [1.41, 2.3, -.6], [.04, .5, 7.4]),
    P('box', lam(0xe9e9e9), [-1.41, 2.3, -.6], [.04, .5, 7.4]),
    ...siren(3.7, 3.4, 2.4), ...siren(3.7, -4.2, 2.4),
    ...wheels([[1.3, 3.6], [-1.3, 3.6], [1.3, -1.2], [-1.3, -1.2], [1.3, -3.8], [-1.3, -3.8]], .7, .6),
    ...lights(1.0, 1.3, 4.97, -4.51),
  ];
}
function armorParts() {       // size 5: armoured cash van
  const b = lam(0x6b7280);
  return [
    P('box', b, [0, 1.9, -.4], [2.6, 2.7, 6.0]),
    P('box', b, [0, 1.6, 3.2], [2.5, 2.1, 1.6]),
    P('box', lam(C.glass), [0, 2.1, 4.01], [2.1, .5, .05]),
    P('box', lam(0xd4a017, 0x7a5a00, .5), [1.31, 2.1, -.4], [.04, .9, 3]),
    P('box', lam(0xd4a017, 0x7a5a00, .5), [-1.31, 2.1, -.4], [.04, .9, 3]),
    P('box', lam(0x444444), [0, .9, 4.1], [2.6, .5, .3]),
    ...wheels([[1.2, 2.6], [-1.2, 2.6], [1.2, -2.4], [-1.2, -2.4]], .62, .55),
    ...lights(.9, 1.2, 4.03, -3.41),
  ];
}
function tankParts() {        // size 6: the only thing a bus should fear
  const b = lam(0x4b5d3a);
  return [
    P('box', lam(0x23261f), [1.45, .7, 0], [.8, 1.2, 7.4]),
    P('box', lam(0x23261f), [-1.45, .7, 0], [.8, 1.2, 7.4]),
    P('box', b, [0, 1.35, 0], [3.0, 1.0, 7.0]),
    P('box', b, [0, 2.3, -.6], [2.2, .9, 3.0]),
    P('cyl', lam(0x3c4a2e), [0, 2.35, 2.6], [.28, 4.2, .28], [Math.PI / 2, 0, 0]),
    P('box', lam(0xff2236, 0xff2236, 1), [0, 2.8, -.6], [.3, .1, .3]),
  ];
}
const VEHICLE_PARTS = { sedan: sedanParts, suv: suvParts, pickup: pickupParts, truck: truckParts, bus: busParts, police: policeParts, psuv: policeSuvParts, swat: swatParts, riot: riotParts, armor: armorParts, tank: tankParts, food: foodTruckParts };

// ---------- paint designs (see PAINTS in config.js) ----------
// A fake city to reflect in chrome paint: bright sky above, dark road below, and a horizon of
// streaky neon lights all round. Metal reflects it, so chrome reads as chrome instead of flat colour.
let CHROME_ENV = null;
function chromeEnv() {
  if (CHROME_ENV) return CHROME_ENV;
  const face = side => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    if (side === 'top') { const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9d3e8'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); }
    else if (side === 'bottom') { x.fillStyle = '#16181f'; x.fillRect(0, 0, 128, 128); }
    else {
      const g = x.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0, '#f4f7ff'); g.addColorStop(.42, '#9aa6c4'); g.addColorStop(.5, '#ffffff'); g.addColorStop(.56, '#2a2e3a'); g.addColorStop(1, '#0c0d12');
      x.fillStyle = g; x.fillRect(0, 0, 128, 128);
      for (let k = 0; k < 7; k++) { x.fillStyle = ['#ff4fa3', '#2ff3ff', '#ffb347', '#ffffff'][k % 4]; x.fillRect(Math.random() * 120, 60 + Math.random() * 14, 6 + Math.random() * 18, 3); }
    }
    return c;
  };
  CHROME_ENV = new THREE.CubeTexture(['px', 'nx', 'top', 'bottom', 'pz', 'nz'].map(face));
  CHROME_ENV.needsUpdate = true;
  return CHROME_ENV;
}
// Repaints the body parts of a built vehicle and adds stripes / bands on top of them.
function applyDesign(group, d) {
  const base = lam(d.color);
  const parts = group.children.filter(c => c.material === base && c.geometry === GEO.box && !c.rotation.x && !c.rotation.z);
  if (d.finish) {
    const mat = d.finish === 'chrome'
      ? new THREE.MeshStandardMaterial({ color: d.color, metalness: 1, roughness: .16, envMap: chromeEnv(), envMapIntensity: 1.35 })
      : new THREE.MeshLambertMaterial({ color: d.color, emissive: d.color, emissiveIntensity: .6 });
    group.children.forEach(c => { if (c.material === base) c.material = mat; });
  }
  if (!d.look) return;
  const acc = d.accentGlow ? lam(d.accent, d.accent, 1.2) : lam(d.accent);
  const add = (mat, x, y, z, sx, sy, sz) => { const s = new THREE.Mesh(GEO.box, mat); s.position.set(x, y, z); s.scale.set(sx, sy, sz); group.add(s); };
  for (const c of parts) {
    const { x, y, z } = c.position, w = c.scale.x, h = c.scale.y, L = c.scale.z;
    if (d.look === 'stripes' && w > 1.1) for (const sx of [-.2, .2]) add(acc, x + sx, y + h / 2 + .012, z, .2, .025, L * .98);
    if (d.look === 'twotone' && h > .25) add(acc, x, y - h * .27, z, w + .02, h * .46, L + .02);
    if (d.look === 'side' && h > .45) {
      for (const s of [-1, 1]) add(acc, x + s * (w / 2 + .012), y, z, .025, Math.max(.12, h * .2), L * .9);
      add(acc, x, y, z - L / 2 - .012, w * .9, Math.max(.12, h * .2), .025);   // carried across the back
    }
    if (d.look === 'checker' && h > .45) {
      const white = lam(0xffffff), n = Math.floor(L * .9 / .3), nb = Math.floor(w * .9 / .3);
      for (const row of [0, 1]) {
        for (const s of [-1, 1]) for (let k = 0; k < n; k++) add((k + row) % 2 ? acc : white, x + s * (w / 2 + .012), y + (row - .5) * .14, z - L * .45 + (k + .5) * .3, .025, .14, .3);
        for (let k = 0; k < nb; k++) add((k + row) % 2 ? acc : white, x - w * .45 + (k + .5) * .3, y + (row - .5) * .14, z - L / 2 - .012, .3, .14, .025);
      }
    }
  }
  // taxi: a lit sign on the highest roof
  if (d.look === 'checker' && parts.length) {
    const top = parts.reduce((a, c) => (c.position.y + c.scale.y / 2 > a.position.y + a.scale.y / 2 ? c : a));
    add(lam(0xfff3b0, 0xffd23a, 1.3), top.position.x, top.position.y + top.scale.y / 2 + .14, top.position.z, .7, .26, .32);
  }
}
const underglowOf = d => d.under || (d.accentGlow ? d.accent : d.color);
// CSS preview for the paint shop swatch
function designSwatch(d) {
  const c = '#' + d.color.toString(16).padStart(6, '0'), a = '#' + (d.accent || 0).toString(16).padStart(6, '0');
  let bg = c;
  if (d.look === 'stripes') bg = `linear-gradient(90deg, ${c} 36%, ${a} 36% 46%, ${c} 46% 54%, ${a} 54% 64%, ${c} 64%)`;
  if (d.look === 'twotone') bg = `linear-gradient(180deg, ${c} 52%, ${a} 52%)`;
  if (d.look === 'side') bg = `linear-gradient(180deg, ${c} 40%, ${a} 40% 60%, ${c} 60%)`;
  if (d.look === 'checker') bg = `linear-gradient(180deg, ${c} 0 38%, transparent 38% 66%, ${c} 66%), repeating-linear-gradient(90deg, ${a} 0 5px, #fff 5px 10px)`;
  if (d.finish === 'chrome') bg = `linear-gradient(135deg, rgba(255,255,255,.85) 0, transparent 30%, rgba(0,0,0,.35) 55%, transparent 75%, rgba(255,255,255,.6)), ${bg}`;
  const glow = '#' + underglowOf(d).toString(16).padStart(6, '0');
  return `--paint:${glow};background:${bg}` + (d.finish === 'glow' ? `;box-shadow:0 0 18px ${c}, 0 0 4px ${c}` : '');
}

// ---------- props (sidewalk furniture) ----------
const PROP_PARTS = {
  lamp: () => [
    P('cyl', lam(0x3a3f4a), [0, 3, 0], [.2, 6, .2]),
    P('box', lam(0x3a3f4a), [0, 6, .75], [.12, .12, 1.6]),
    P('box', lam(0xffc46b, 0xffb347, 1.6), [0, 5.92, 1.45], [.45, .14, .65]),
  ],
  bin: () => [
    P('cyl', lam(0x2f6b3c), [0, .45, 0], [.7, .9, .7]),
    P('cyl', lam(0x245530), [0, .94, 0], [.76, .1, .76]),
  ],
  cone: () => [
    P('cone', lam(0xff6a00, 0xff4400, .35), [0, .32, 0], [.5, .64, .5]),
    P('box', lam(0xff6a00), [0, .03, 0], [.6, .06, .6]),
  ],
  hydrant: () => [
    P('cyl', lam(0xd62828), [0, .35, 0], [.36, .7, .36]),
    P('sphere', lam(0xd62828), [0, .72, 0], [.36, .3, .36]),
    P('box', lam(0xb71c1c), [0, .45, 0], [.6, .12, .12]),
  ],
  busstop: () => [
    P('box', lam(0x2d3340), [0, 2.55, 0], [4, .12, 1.6]),
    P('box', lam(0x5ec8ff, 0x3aa0ff, .55), [0, 1.3, -.7], [3.8, 2.2, .08]),
    P('box', lam(0x2d3340), [1.9, 1.3, -.7], [.12, 2.5, .12]),
    P('box', lam(0x2d3340), [-1.9, 1.3, -.7], [.12, 2.5, .12]),
    P('box', lam(0x6b4f3a), [0, .5, -.35], [3, .1, .5]),
  ],
  tree: () => [
    P('cyl', lam(0x5a3d2b), [0, 1.1, 0], [.4, 2.2, .4]),
    P('ico', lam(0x1f5f3a), [0, 3.3, 0], [1.7, 1.6, 1.7]),
    P('ico', lam(0x2a7a49), [.3, 4.3, .2], [1.1, 1.0, 1.1]),
  ],
};

// ---------- pedestrians (instanced parts, each coloured per person) ----------
const PED_PARTS = {
  legs: { g: 'box', p: [0, .45, 0], s: [.42, .9, .26] },
  torso: { g: 'box', p: [0, 1.2, 0], s: [.52, .72, .3] },
  head: { g: 'box', p: [0, 1.75, 0], s: [.32, .34, .32] },
};
function pedGroup(shirt, skin) {
  return partsToGroup([
    P('box', lam(0x2b2d42), PED_PARTS.legs.p, PED_PARTS.legs.s),
    P('box', lam(shirt), PED_PARTS.torso.p, PED_PARTS.torso.s),
    P('box', lam(skin), PED_PARTS.head.p, PED_PARTS.head.s),
  ]);
}

// ---------- glow ring textures ----------
function radialTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}
const GLOW_TEX = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');

// Threat colours for the "what can I smash?" rings
const THREAT = { smash: 0x3dff8f, bounce: 0xffae2b, wreck: 0xff2e4d, gold: 0xffd23a };
// On light ground (daytime, salt flats) glowing additive rings wash out to white,
// so rings switch to solid, deeper colours there.
const THREAT_BRIGHT = { smash: 0x0aa84a, bounce: 0xe07a00, wreck: 0xd0102c, gold: 0xc99400 };
const threatColor = t => (Lighting.bright ? THREAT_BRIGHT : THREAT)[t];
function styleRing(mat, t) {
  mat.color.setHex(threatColor(t));
  const blend = Lighting.bright ? THREE.NormalBlending : THREE.AdditiveBlending;
  if (mat.blending !== blend) { mat.blending = blend; mat.needsUpdate = true; }
}
function threatOf(size, level) {
  if (size <= level) return 'smash';
  if (size === level + 1) return 'bounce'; // boosting rams through these (see Ram in config.js)
  return 'wreck';
}
function ringMaterial() {
  return new THREE.MeshBasicMaterial({ color: THREAT.smash, transparent: true, opacity: .55, blending: THREE.AdditiveBlending, depthWrite: false });
}
