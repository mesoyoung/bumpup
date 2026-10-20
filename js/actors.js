// ============================================================
// actors.js — everything that moves besides the player:
// pedestrians, traffic, police, food trucks, flying debris,
// particles.
// ============================================================

const RING_MATS = {};
for (const k of Object.keys(THREAT)) {
  RING_MATS[k] = new THREE.MeshBasicMaterial({ color: THREAT[k], transparent: true, opacity: k === 'smash' || k === 'gold' ? .75 : .5, blending: THREE.AdditiveBlending, depthWrite: false });
}
const GOLD_MAT = new THREE.MeshLambertMaterial({ color: 0xffd23a, emissive: 0xb07800, emissiveIntensity: .9 });

// ---------------- Pedestrians ----------------
const Peds = { list: [] };
function loopPoint(L, t) {
  const w = L.x1 - L.x0, d = L.z1 - L.z0, per = 2 * (w + d);
  t = ((t % per) + per) % per;
  if (t < w) return { x: L.x0 + t, z: L.z0, tx: 1, tz: 0 };
  t -= w; if (t < d) return { x: L.x1, z: L.z0 + t, tx: 0, tz: 1 };
  t -= d; if (t < w) return { x: L.x1 - t, z: L.z1, tx: -1, tz: 0 };
  t -= w; return { x: L.x0, z: L.z1 - t, tx: 0, tz: -1 };
}
function nearestT(L, x, z) {
  const w = L.x1 - L.x0, d = L.z1 - L.z0;
  const cands = [
    [Math.abs(z - L.z0), clamp(x - L.x0, 0, w)],
    [Math.abs(x - L.x1), w + clamp(z - L.z0, 0, d)],
    [Math.abs(z - L.z1), w + d + clamp(L.x1 - x, 0, w)],
    [Math.abs(x - L.x0), 2 * w + d + clamp(L.z1 - z, 0, d)],
  ];
  cands.sort((a, b) => a[0] - b[0]);
  return cands[0][1];
}
function initPeds(scene) {
  const mk = (part, mat) => {
    const m = new THREE.InstancedMesh(GEO[part.g], mat, PED_COUNT);
    m.frustumCulled = false; scene.add(m); return m;
  };
  Peds.legs = mk(PED_PARTS.legs, lam(0x2b2d42));
  Peds.torso = mk(PED_PARTS.torso, new THREE.MeshLambertMaterial({ color: 0xffffff }));
  Peds.head = mk(PED_PARTS.head, new THREE.MeshLambertMaterial({ color: 0xffffff }));
  Peds.ring = new THREE.InstancedMesh(GEO.ring, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false }), PED_COUNT);
  Peds.ring.frustumCulled = false; scene.add(Peds.ring);
  Peds.partM = ['legs', 'torso', 'head'].map(k => partMatrix(P('box', null, PED_PARTS[k].p, PED_PARTS[k].s)));
  for (let i = 0; i < PED_COUNT; i++) {
    const p = { idx: i, alive: true, respawnAt: 0 };
    Peds.list.push(p);   // placed when a map loads
  }
}
function spawnPed(p, px, pz, minDist) {
  let L;
  for (let k = 0; k < 30; k++) {
    L = pick(World.loops);
    if (Math.hypot((L.x0 + L.x1) / 2 - px, (L.z0 + L.z1) / 2 - pz) > minDist) break;
  }
  p.loop = L; p.t = rand(0, 400); p.dir = Math.random() < .5 ? 1 : -1;
  p.speed = rand(1.1, 1.8); p.state = 'walk'; p.timer = 0; p.phase = rand(0, 6);
  p.golden = Math.random() < GOLDEN_CHANCE;
  p.shirt = p.golden ? 0xffd23a : pick(C.shirts); p.skin = pick(C.skin);
  const q = loopPoint(L, p.t); p.x = q.x; p.z = q.z; p.h = 0; p.goal = null;
  if (World.map && World.map.arena) { p.x = rand(L.x0, L.x1); p.z = rand(L.z0, L.z1); }
  p.alive = true; p.hl = .3; p.hw = .3;
  const c = new THREE.Color();
  Peds.torso.setColorAt(p.idx, c.setHex(p.shirt)); Peds.head.setColorAt(p.idx, c.setHex(p.skin));
  Peds.torso.instanceColor.needsUpdate = Peds.head.instanceColor.needsUpdate = true;
}
function setPedThreat(level) {
  const t = threatOf(KINDS.ped.size, level), c = new THREE.Color();
  for (const p of Peds.list) Peds.ring.setColorAt(p.idx, c.setHex(p.golden ? THREAT.gold : THREAT[t]));
  if (Peds.ring.instanceColor) Peds.ring.instanceColor.needsUpdate = true;
}
function updatePeds(dt, player, now) {
  const m = new THREE.Matrix4(), base = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const rs = new THREE.Matrix4().makeScale(.9, 1, .9).setPosition(0, .05, 0);
  for (const p of Peds.list) {
    if (!p.alive) {
      if (now > p.respawnAt) { spawnPed(p, player.x, player.z, 90); setPedThreat(player.level); }
      else { for (const k of ['legs', 'torso', 'head', 'ring']) Peds[k].setMatrixAt(p.idx, zero); continue; }
    }
    const dp = Math.hypot(p.x - player.x, p.z - player.z);
    // they notice you late, freeze for a moment, then scramble (slowly) out of the way
    if (p.state !== 'flee' && p.state !== 'startle' && dp < PED_NOTICE && player.speed > 6) { p.state = 'startle'; p.timer = PED_FREEZE; }
    if (p.state === 'startle') { p.timer -= dt; p.phase += dt * 30; if (p.timer <= 0) { p.state = 'flee'; p.timer = rand(1, 1.6); } }
    if (p.state === 'walk' && World.map && World.map.arena) {
      // no sidewalks in the open: stroll between nearby random points
      if (!p.goal || Math.hypot(p.goal.x - p.x, p.goal.z - p.z) < .6) p.goal = { x: clamp(p.x + rand(-25, 25), 5, SIZE - 5), z: clamp(p.z + rand(-25, 25), 5, SIZE - 5) };
      const dx = p.goal.x - p.x, dz = p.goal.z - p.z, d = Math.hypot(dx, dz) || 1;
      p.x += dx / d * p.speed * dt; p.z += dz / d * p.speed * dt; p.h = Math.atan2(dx, dz); p.phase += dt * 8;
      const hit = pushOutOfBuildings(p.x, p.z, .4); if (hit) { p.x = hit.x; p.z = hit.z; p.goal = null; }
    } else if (p.state === 'walk') {
      p.t += p.dir * p.speed * dt;
      const q = loopPoint(p.loop, p.t); p.x = q.x; p.z = q.z; p.h = Math.atan2(q.tx * p.dir, q.tz * p.dir);
      p.phase += dt * 8;
    } else if (p.state === 'startle') {
      // frozen on the spot (bob shows the panic)
    } else if (p.state === 'flee') {
      let ax = p.x - player.x, az = p.z - player.z; const d = Math.hypot(ax, az) || 1;
      // run sideways out of the car's path
      const side = (ax * player.fz - az * player.fx) >= 0 ? 1 : -1;
      ax = ax / d * .6 + player.fz * side * .8; az = az / d * .6 - player.fx * side * .8;
      const n = Math.hypot(ax, az) || 1;
      p.x += ax / n * PED_RUN * dt; p.z += az / n * PED_RUN * dt; p.h = Math.atan2(ax, az);
      p.phase += dt * 18;
      const hit = pushOutOfBuildings(p.x, p.z, .4); if (hit) { p.x = hit.x; p.z = hit.z; }
      if ((p.timer -= dt) <= 0) p.state = World.map && World.map.arena ? 'walk' : 'return';
    } else {
      p.t = nearestT(p.loop, p.x, p.z);
      const q = loopPoint(p.loop, p.t), dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d < .3) p.state = 'walk';
      else { p.x += dx / d * 2.4 * dt; p.z += dz / d * 2.4 * dt; p.h = Math.atan2(dx, dz); p.phase += dt * 10; }
    }
    const bob = Math.abs(Math.sin(p.phase)) * .08;
    base.makeRotationY(p.h).setPosition(p.x, bob, p.z);
    Peds.legs.setMatrixAt(p.idx, m.multiplyMatrices(base, Peds.partM[0]));
    Peds.torso.setMatrixAt(p.idx, m.multiplyMatrices(base, Peds.partM[1]));
    Peds.head.setMatrixAt(p.idx, m.multiplyMatrices(base, Peds.partM[2]));
    base.makeRotationY(0).setPosition(p.x, 0, p.z);
    Peds.ring.setMatrixAt(p.idx, m.multiplyMatrices(base, rs));
  }
  for (const k of ['legs', 'torso', 'head', 'ring']) Peds[k].instanceMatrix.needsUpdate = true;
}

// ---------------- Vehicles (traffic, police, food trucks) ----------------
function makeVehicleMesh(kind, color, golden) {
  const g = partsToGroup(VEHICLE_PARTS[kind](color));
  if (golden) {
    const body = lam(color);
    g.children.forEach(c => { if (c.material === body) c.material = GOLD_MAT; });
  }
  return g;
}

class Car {
  constructor(scene, kind) {
    this.scene = scene; this.kind = kind;
    const k = KINDS[kind]; this.size = k.size; this.hl = k.hl; this.hw = k.hw;
    this.golden = (kind === 'sedan' || kind === 'suv') && Math.random() < GOLDEN_CHANCE * 2;
    this.color = kind === 'sedan' ? pick(C.cars) : kind === 'suv' ? pick([0x2b2d42, 0xe5e5e5, 0x7d8597, 0x14213d, 0x9e2a2b]) : undefined;
    if (this.golden) this.color = 0xffd23a;
    this.mesh = makeVehicleMesh(kind, this.color, this.golden);
    this.ring = new THREE.Mesh(GEO.ring, RING_MATS.smash);
    this.ring.scale.set(this.hw + .9, 1, this.hl + .9); this.ring.position.y = .06;
    this.mesh.add(this.ring);
    scene.add(this.mesh);
    this.alive = true; this.v = 0; this.cruise = (TRAFFIC_SPEED[kind] || 14) * rand(.85, 1.1);
    this.targets = []; this.nearMissAt = -99; this.x = 0; this.z = 0; this.h = 0;
  }
  place(spot) {
    this.x = spot.x; this.z = spot.z; this.h = Math.atan2(spot.d.dx, spot.d.dz);
    this.node = spot.next; this.dir = spot.d; this.targets = []; this.v = this.cruise;
    this.sync();
  }
  setThreat(level) { this.ring.material = RING_MATS[this.golden ? 'gold' : threatOf(this.size, level)]; }
  plan() {
    const B = this.node, d = this.dir;
    let opts = DIRS.filter(o => validDir(B.i, B.j, o) && !(o.dx === -d.dx && o.dz === -d.dz));
    if (!opts.length) opts = [{ dx: -d.dx, dz: -d.dz }];
    // prefer going straight a bit
    const straight = opts.find(o => o.dx === d.dx && o.dz === d.dz);
    const d2 = straight && Math.random() < .5 ? straight : pick(opts);
    const o1 = laneOff(d), o2 = laneOff(d2);
    const bx = B.i * CELL, bz = B.j * CELL;
    this.targets.push({ x: bx - d.dx * SW + o1.x, z: bz - d.dz * SW + o1.z });
    this.targets.push({ x: bx + d2.dx * SW + o2.x, z: bz + d2.dz * SW + o2.z });
    this.node = { i: B.i + d2.dx, j: B.j + d2.dz }; this.dir = d2;
  }
  // Open arena: no lanes, so cars roam between random points and steer round rocks
  wander(dt, cars, player) {
    if (!this.goal || Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < 8 || (this.goalT -= dt) < 0) {
      this.goal = { x: rand(25, SIZE - 25), z: rand(25, SIZE - 25) }; this.goalT = rand(8, 16);
    }
    const want = Math.atan2(this.goal.x - this.x, this.goal.z - this.z), dh = wrapAng(want - this.h);
    const turn = { bus: 1.2, truck: 1.2, armor: 1.4, tank: 1 }[this.kind] || 1.7;
    this.h = wrapAng(this.h + clamp(dh, -turn * dt, turn * dt));
    let target = Math.abs(dh) > .6 ? this.cruise * .55 : this.cruise;
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    for (const o of cars) if (o !== this && o.alive) {
      const ax = o.x - this.x, az = o.z - this.z, along = ax * fx + az * fz, lat = Math.abs(ax * fz - az * fx);
      if (along > 0 && along < this.hl + o.hl + 8 && lat < 3) target = Math.min(target, Math.max(2, (along - this.hl - o.hl - 2) * 1.5));
    }
    this.v += clamp(target - this.v, -18 * dt, 8 * dt);
    this.x += fx * this.v * dt; this.z += fz * this.v * dt;
    const hit = pushOutOfBuildings(this.x, this.z, this.hw + .4);
    if (hit) { this.x = hit.x; this.z = hit.z; this.goal = null; this.v *= .6; }
    this.sync();
  }
  update(dt, cars, player) {
    if (this.parked) return;
    if (World.map && World.map.arena) return this.wander(dt, cars, player);
    if (!this.targets.length) this.plan();
    const t = this.targets[0];
    const dx = t.x - this.x, dz = t.z - this.z, dist = Math.hypot(dx, dz);
    if (dist < 2.5) { this.targets.shift(); if (!this.targets.length) this.plan(); return; }
    const want = Math.atan2(dx, dz), dh = wrapAng(want - this.h);
    const turn = { bus: 1.6, truck: 1.6, armor: 1.8, tank: 1.3 }[this.kind] || 2.2;
    this.h = wrapAng(this.h + clamp(dh, -turn * dt, turn * dt));
    let target = Math.abs(dh) > .35 ? this.cruise * .5 : this.cruise;
    // keep distance from whatever is in front (cars and the player)
    const fx = Math.sin(this.h), fz = Math.cos(this.h);
    const ahead = (ox, oz, len) => {
      const ax = ox - this.x, az = oz - this.z, along = ax * fx + az * fz, lat = Math.abs(ax * fz - az * fx);
      if (along > 0 && along < this.hl + len + 9 && lat < 2.6) target = Math.min(target, Math.max(0, (along - this.hl - len - 2) * 1.6));
    };
    for (const o of cars) if (o !== this && o.alive) ahead(o.x, o.z, o.hl);
    if (player.alive) ahead(player.x, player.z, player.half);
    this.v += clamp(target - this.v, -18 * dt, 8 * dt);
    this.x += fx * this.v * dt; this.z += fz * this.v * dt;
    this.sync();
  }
  sync() { this.mesh.position.set(this.x, 0, this.z); this.mesh.rotation.set(0, this.h, 0); }
  remove() { this.scene.remove(this.mesh); }
}

// Pick a traffic vehicle relative to the player's level (see TRAFFIC_BANDS in config.js)
function pickTrafficKind(level) {
  const bands = [];
  for (const b of TRAFFIC_BANDS) {
    const sizes = b.sizes.map(([o, w]) => [level + o, w]).filter(([s]) => TRAFFIC_BY_SIZE[s]);
    if (sizes.length) bands.push([sizes, b.w]);
  }
  const total = bands.reduce((s, b) => s + b[1], 0);
  let r = Math.random() * total, chosen = bands[0];
  for (const b of bands) { if ((r -= b[1]) <= 0) { chosen = b; break; } }
  const st = chosen[0].reduce((s, x) => s + x[1], 0);
  let q = Math.random() * st, size = chosen[0][0][0];
  for (const [s, w] of chosen[0]) { if ((q -= w) <= 0) { size = s; break; } }
  return pick(TRAFFIC_BY_SIZE[size]);
}

// Police: one size up from the player. Chasers aim where you're going; blockers park across the road.
class Police extends Car {
  constructor(scene, kind, mode) {
    super(scene, kind); this.golden = false; this.stuck = 0; this.mode = mode || 'chase'; this.age = 0;
    const isCol = hex => c => c.material && c.material.color && c.material.color.getHex() === hex;
    this.lightsR = this.mesh.children.filter(isCol(0xff1a3c));
    this.lightsB = this.mesh.children.filter(isCol(0x2a6bff));
  }
  flash(now) {
    const f = Math.floor(now * 6) % 2;
    for (const l of this.lightsR) l.visible = !!f;
    for (const l of this.lightsB) l.visible = !f;
  }
  update(dt, cars, player, now) {
    this.age += dt; this.flash(now);
    if (this.mode === 'block') { this.sync(); return; }
    const T = TIERS[player.tier || 0];
    this.cruise = T.cruise + POLICE_SPEED * (T.boost - T.cruise);
    // lead the target: aim where the player will be
    const d0 = Math.hypot(player.x - this.x, player.z - this.z);
    const lead = clamp(d0 / Math.max(this.v, 12), 0, 1.4);
    let tx = player.x + (player.vx || 0) * lead, tz = player.z + (player.vz || 0) * lead;
    if (d0 > 30 && !World.map.arena) {
      // Route along the road grid toward the player's nearest intersection
      const pi = clamp(Math.round(tx / CELL), 0, N), pj = clamp(Math.round(tz / CELL), 0, N);
      const ni = clamp(Math.round(this.x / CELL), 0, N), nj = clamp(Math.round(this.z / CELL), 0, N);
      const atNode = Math.abs(this.x - ni * CELL) < RW && Math.abs(this.z - nj * CELL) < RW;
      if (atNode) {
        const di = pi - ni, dj = pj - nj;
        if (!di && !dj) { /* keep the lead target */ }
        else if (Math.abs(di) >= Math.abs(dj)) { tx = (ni + Math.sign(di)) * CELL; tz = nj * CELL; }
        else { tx = ni * CELL; tz = (nj + Math.sign(dj)) * CELL; }
        this.goal = { x: tx, z: tz };
      } else if (this.goal && Math.hypot(this.goal.x - this.x, this.goal.z - this.z) < CELL * 1.2) {
        tx = this.goal.x; tz = this.goal.z;
      } else if (Math.abs(this.z - nj * CELL) < RW) { // on an east-west road
        const a = Math.floor(this.x / CELL), b = a + 1;
        tx = (Math.abs(a - pi) <= Math.abs(b - pi) ? a : b) * CELL; tz = nj * CELL;
      } else { // on a north-south road
        const a = Math.floor(this.z / CELL), b = a + 1;
        tz = (Math.abs(a - pj) <= Math.abs(b - pj) ? a : b) * CELL; tx = ni * CELL;
      }
    }
    const want = Math.atan2(tx - this.x, tz - this.z), dh = wrapAng(want - this.h);
    this.h = wrapAng(this.h + clamp(dh, -3 * dt, 3 * dt));
    const target = Math.abs(dh) > .8 ? this.cruise * .45 : this.cruise;
    this.v += clamp(target - this.v, -25 * dt, 14 * dt);
    this.x += Math.sin(this.h) * this.v * dt; this.z += Math.cos(this.h) * this.v * dt;
    const hit = pushOutOfBuildings(this.x, this.z, this.hw + .3);
    if (hit) { this.x = hit.x; this.z = hit.z; this.v *= .9; }
    this.stuck = this.v < 4 ? this.stuck + dt : 0;
    this.sync();
  }
}

// Food trucks: parked, refuel + repair on touch
class FoodTruck {
  constructor(scene) {
    this.scene = scene; this.mesh = makeVehicleMesh('food');
    this.icon = new THREE.Mesh(GEO.octa, new THREE.MeshBasicMaterial({ color: 0x3dff8f }));
    this.icon.scale.set(.8, 1.2, .8); this.icon.position.y = 5;
    this.beam = new THREE.Mesh(GEO.cyl, new THREE.MeshBasicMaterial({ color: 0x3dff8f, transparent: true, opacity: .14, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.scale.set(3, 40, 3); this.beam.position.y = 20;
    this.pad = new THREE.Mesh(GEO.ring, RING_MATS.smash); this.pad.scale.set(3.6, 1, 4.5); this.pad.position.y = .06;
    this.mesh.add(this.icon, this.beam, this.pad);
    scene.add(this.mesh);
    this.hl = 2.8; this.hw = 1.15; this.alive = true; this.respawnAt = 0;
  }
  // each truck owns one bay and always comes back to it
  place(spot) {
    this.spot = spot; this.x = spot.x; this.z = spot.z; this.rot = spot.rot;
    this.mesh.position.set(spot.x, 0, spot.z); this.mesh.rotation.y = spot.rot;
    this.mesh.visible = true; this.alive = true;
  }
  update(dt, now, px, pz) {
    // after being used it reappears in the same bay, once you've driven away from it
    if (!this.alive) { if (now > this.respawnAt && Math.hypot(this.spot.x - px, this.spot.z - pz) > 40) this.place(this.spot); return; }
    this.icon.rotation.y += dt * 2; this.icon.position.y = 5 + Math.sin(now * 3) * .3;
  }
}

// ---------------- Flying debris ----------------
const Debris = { list: [] };
function launchDebris(scene, obj, x, z, rot, vx, vz, power, life) {
  obj.position.set(x, 0, z); obj.rotation.set(0, rot, 0);
  scene.add(obj);
  Debris.list.push({
    obj, vx: vx + rand(-2, 2), vy: power, vz: vz + rand(-2, 2),
    wx: rand(-6, 6), wy: rand(-4, 4), wz: rand(-6, 6), life: life || 4, scene,
  });
}
function updateDebris(dt) {
  for (let i = Debris.list.length - 1; i >= 0; i--) {
    const d = Debris.list[i], o = d.obj;
    d.life -= dt;
    if (d.life < 1) { o.position.y -= dt * 2.5; if (d.life <= 0) { d.scene.remove(o); Debris.list.splice(i, 1); } continue; }
    d.vy -= 28 * dt;
    o.position.x += d.vx * dt; o.position.y += d.vy * dt; o.position.z += d.vz * dt;
    o.rotation.x += d.wx * dt; o.rotation.y += d.wy * dt; o.rotation.z += d.wz * dt;
    const hit = pushOutOfBuildings(o.position.x, o.position.z, .5);
    if (hit) { o.position.x = hit.x; o.position.z = hit.z; d.vx *= -.4; d.vz *= -.4; }
    if (o.position.y < 0) {
      o.position.y = 0; d.vy = Math.abs(d.vy) > 3 ? -d.vy * .3 : 0;
      d.vx *= .6; d.vz *= .6; d.wx *= .5; d.wy *= .5; d.wz *= .5;
      if (Math.abs(d.vy) < 1) { o.rotation.x *= .9; o.rotation.z *= .9; }
    }
  }
}

// ---------------- Particles (one instanced batch) ----------------
const PMAX = 700;
const Parts = { list: [] };
function initParticles(scene) {
  Parts.mesh = new THREE.InstancedMesh(GEO.box, new THREE.MeshBasicMaterial({ color: 0xffffff }), PMAX);
  Parts.mesh.frustumCulled = false; scene.add(Parts.mesh);
  const c = new THREE.Color(1, 1, 1);
  for (let i = 0; i < PMAX; i++) { Parts.mesh.setColorAt(i, c); Parts.list.push({ life: 0 }); }
  Parts.next = 0;
}
function emit(x, y, z, n, color, o) {
  o = o || {};
  const c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const p = Parts.list[Parts.next]; const idx = Parts.next;
    Parts.next = (Parts.next + 1) % PMAX;
    const a = rand(0, Math.PI * 2), sp = rand(.3, 1) * (o.speed || 8);
    p.x = x; p.y = y; p.z = z;
    p.vx = Math.cos(a) * sp + (o.vx || 0); p.vz = Math.sin(a) * sp + (o.vz || 0); p.vy = rand(.4, 1) * (o.up || 8);
    p.life = p.max = rand(.6, 1) * (o.life || 1); p.size = rand(.6, 1) * (o.size || .3); p.g = o.grav == null ? 22 : o.grav;
    Parts.mesh.setColorAt(idx, c.setHex(Array.isArray(color) ? pick(color) : color));
  }
  Parts.mesh.instanceColor.needsUpdate = true;
}
function updateParticles(dt) {
  const m = new THREE.Matrix4();
  for (let i = 0; i < PMAX; i++) {
    const p = Parts.list[i];
    if (p.life <= 0) { m.makeScale(0, 0, 0); Parts.mesh.setMatrixAt(i, m); continue; }
    p.life -= dt; p.vy -= p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < .05) { p.y = .05; p.vy *= -.3; p.vx *= .7; p.vz *= .7; }
    const s = p.size * Math.max(0, p.life / p.max);
    m.makeScale(s, s, s).setPosition(p.x, p.y, p.z); Parts.mesh.setMatrixAt(i, m);
  }
  Parts.mesh.instanceMatrix.needsUpdate = true;
}
