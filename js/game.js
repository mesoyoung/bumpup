// ============================================================
// game.js — boots the scene, runs the loop, handles smashing,
// scoring, combos, upgrades, police heat and game over.
// ============================================================

const Game = {
  state: 'title',
  G: { traffic: [], police: [], food: [], time: 0, stars: 0 },
};

(function boot() {
  const canvas = $('game');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070a16);
  scene.fog = new THREE.Fog(0x0a0e1e, 45, 230);
  const camera = new THREE.PerspectiveCamera(62, 1, .5, 1000);
  const hemi = new THREE.HemisphereLight(0x7084c8, 0x20121c, .75); scene.add(hemi);
  const moon = new THREE.DirectionalLight(0x9db4ff, .55); moon.position.set(-1, 2, .6); scene.add(moon);
  const ambient = new THREE.AmbientLight(0xffb070, .12); scene.add(ambient);

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w < h ? 74 : 60; camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  initPeds(scene);
  initParticles(scene);
  initInput(canvas);
  UI.init();

  const G = Game.G;
  const save = {
    best: store.get('best', 0), coins: store.get('coins', 0),
    paint: store.get('paint', 'blue'), owned: store.get('owned', ['blue']), map: store.get('map', 'flats'), time: store.get('time', 'night'),
  };
  const paintDesign = () => PAINTS.find(p => p.id === save.paint) || PAINTS[0];
  const paintColor = () => underglowOf(paintDesign());
  const emitters = [];

  // ---------- spawning ----------
  function spawnTraffic(minDist) {
    const car = new Car(scene, pickTrafficKind(Player.level || 1));
    const spot = randomLaneSpot(Player.x, Player.z, minDist);
    if (!spot) { car.remove(); return; }
    car.place(spot); car.setThreat(Player.level || 1);
    G.traffic.push(car);
  }
  function spawnPolice() {
    const p = new Police(scene, POLICE_BY_TIER[Player.tier], 'chase');
    // half the time they come at you from up ahead instead of from behind
    const spot = (Math.random() < .5 && laneSpotAhead(Player, 70, 130)) || randomLaneSpot(Player.x, Player.z, 90);
    if (!spot) { p.remove(); return; }
    p.place(spot); p.setThreat(Player.level); G.police.push(p);
  }
  function setThreatAll(level) {
    for (const k in World.batches) World.batches[k].setThreat(level);
    setPedThreat(level);
    for (const c of G.traffic) c.setThreat(level);
    for (const p of G.police) p.setThreat(level);
  }

  // ---------- run lifecycle ----------
  function resetWorld() {
    for (const c of G.traffic) c.remove();
    for (const p of G.police) p.remove();
    G.traffic = []; G.police = [];
    for (const it of World.props) { it.locked = false; if (!it.alive) { it.alive = true; it.batch.show(it, true); } }
    applyPropTier(0);
    for (const p of Peds.list) spawnPed(p, Player.x, Player.z, 20);
    for (const d of Debris.list) d.scene.remove(d.obj);
    Debris.list = []; emitters.length = 0;
    for (let i = 0; i < TRAFFIC_COUNT; i++) spawnTraffic(35);
    spawnParked();
    placeFoodTrucks();
  }
  // One food truck per bay (one bay per zone of the city grid)
  function placeFoodTrucks() {
    while (G.food.length < World.foodSpots.length) G.food.push(new FoodTruck(scene));
    while (G.food.length > World.foodSpots.length) { const f = G.food.pop(); scene.remove(f.mesh); }
    G.food.forEach((f, i) => f.place(World.foodSpots[i]));
  }
  // Parked cars in car parks: smashable, they don't drive and aren't replaced once wrecked
  function spawnParked() {
    for (const s of World.parkSpots) {
      const c = new Car(scene, s.kind); c.parked = true;
      c.x = s.x; c.z = s.z; c.h = s.rot; c.v = 0; c.sync(); c.setThreat(Player.level || 1);
      G.traffic.push(c);
    }
  }
  // ---------- maps ----------
  // Day or night: sky, fog, sun/moon and how much the windows and street lights glow. No rebuild needed.
  function applyPalette(map) {
    const day = save.time === 'day', p = day ? Object.assign({}, map.pal, map.day) : map.pal;
    Lighting.day = day; document.body.classList.toggle('day', day);
    Lighting.bright = day || !!map.arena; restyleRings(); setThreatAll(Player.level || 1);
    scene.background.setHex(p.sky); scene.fog.color.setHex(p.fog); scene.fog.near = p.fogNear; scene.fog.far = p.fogFar;
    hemi.color.setHex(p.hemiSky); hemi.groundColor.setHex(p.hemiGround); hemi.intensity = day ? 1.05 : .75;
    moon.color.setHex(day ? 0xfff1d6 : 0x9db4ff); moon.intensity = day ? 1 : .55; moon.position.set(day ? .6 : -1, 2, day ? .9 : .6);
    ambient.color.setHex(day ? 0xffffff : 0xffb070); ambient.intensity = day ? .22 : .12;
    for (const m of World.wallMats || []) m.emissiveIntensity = day ? .1 : .85;
    if (World.ground) World.ground.material.color.setHex(p.ground);   // the salt flats get a less dazzling sand by day
    if (World.sea) { World.sea.material.color.setHex(p.sea); World.sea.material.emissive.setHex(p.sea); World.sea.material.emissiveIntensity = day ? .15 : .35; }
    if (World.batches.lamp && World.batches.lamp.glow) World.batches.lamp.glow.visible = !day;
    $('timeBtn').textContent = day ? '☀ Day' : '☾ Night';
  }
  function loadMap(id) {
    const map = mapById(id);
    for (const c of G.traffic) c.remove();
    for (const p of G.police) p.remove();
    G.traffic = []; G.police = [];
    for (const d of Debris.list) d.scene.remove(d.obj);
    Debris.list = []; emitters.length = 0;
    clearWorld(scene); buildWorld(scene, map); applyPalette(map);
    Player.x = START.x; Player.z = START.z;
    for (let i = 0; i < TRAFFIC_COUNT; i++) spawnTraffic(0);
    spawnParked();
    for (const p of Peds.list) spawnPed(p, START.x, START.z, 20);
    placeFoodTrucks();
    setThreatAll(1); applyPropTier(0);
    save.map = map.id; store.set('map', map.id);
    UI.mapLabel(map);
  }
  Game.loadMap = loadMap;

  function startRun() {
    Sound.init(); Sound.resume();
    Player.reset(scene, paintDesign());
    Object.assign(G, {
      score: 0, combo: 0, comboTimer: 0, pending: 0, bestCombo: 0, biggest: null, biggestSize: 0,
      counts: {}, upgrades: [{ tier: 0, time: 0 }], time: 0, heat: 0, stars: 0, lastSmash: 0,
      shake: 0, hitPause: 0, slow: 0, deathReason: '', dyingT: 0, respawnQueue: [], lastBlock: 0,
    });
    Ram.on = false;
    resetWorld();
    Missions.runStart();
    setThreatAll(1);
    camPos.copy(camera.position); camYaw = Player.h;   // glide from the landing view into the chase cam
    UI.clearFloats();
    UI.show(null);
    Game.state = 'play';
    const touchUI = matchMedia('(pointer: coarse)').matches;
    UI.banner('Sedan', `Smash people and bins. ${touchUI ? 'Swipe up' : 'Press ↑'} to hop over cars you can't smash yet.`, 'tier');
    $('gestures').classList.add('on'); clearTimeout(Game.gt); Game.gt = setTimeout(() => $('gestures').classList.remove('on'), 6000);
  }
  // The landing screen is the live city: your car waits on the centre line while traffic drives past.
  function parkCar() {
    Player.reset(scene, paintDesign()); Player.alive = false; Player.speed = 0;
    dummy.x = Player.x; dummy.z = Player.z;
  }
  function toTitle() {
    Game.state = 'title'; Ram.on = false;
    parkCar();
    UI.title(save.best, save.coins, save.paint, save.owned);
    UI.show('titleScreen');
  }
  function gameOver() {
    Game.state = 'over';
    const earned = Math.floor(G.score / COINS_PER * (mapById(save.map).coins || 1));
    save.coins += earned; store.set('coins', save.coins);
    const missionCoins = Missions.completedThisRun.reduce((s, m) => s + m.reward, 0);
    const setDone = Missions.settle();
    const isBest = G.score > save.best;
    if (isBest) { save.best = G.score; store.set('best', save.best); }
    UI.over(G, Player, earned, save.best, isBest, Missions.completedThisRun, missionCoins, setDone);
    UI.show('overScreen');
    Sound.siren(0);
  }
  function die(reason) {
    if (!Player.alive) return;
    Player.alive = false; G.deathReason = reason; Ram.on = false;
    Game.state = 'dying'; G.dyingT = 1.6; G.slow = 1.6;
    Sound.wreck();
    emit(Player.x, 1.5, Player.z, 60, [0xff7b00, 0xffd23a, 0xff2e4d, 0x333333], { speed: 16, up: 16, size: .7, life: 1.4 });
    G.shake = 1.4; UI.flash('red');
    scene.remove(Player.glow, Player.beam); Sound.screech(0);
    const wreck = Player.mesh; Player.mesh = null;
    launchDebris(scene, wreck, Player.x, Player.z, Player.h, Player.vx * .3, Player.vz * .3, 12, 5);
  }

  // ---------- scoring ----------
  function addScore(pts, x, y, z, label, cls) {
    G.score += pts; G.pending += pts;
    Missions.event('score', { score: G.score });
    UI.float(x, y, z, label, cls);
    const next = TIERS[Player.tier + 1];
    if (next && G.score >= next.at) upgrade();
  }
  function upgrade() {
    const t = Player.tier + 1;
    Player.setTier(t);
    G.upgrades.push({ tier: t, time: G.time });
    Missions.event('tier', { tier: t });
    // police come back one size up; far-off traffic re-rolls so the mix matches your new size
    for (const p of G.police) p.remove(); G.police = [];
    G.traffic = G.traffic.filter(c => {
      if (!c.parked && Math.hypot(c.x - Player.x, c.z - Player.z) > 60 && Math.random() < .6) { c.remove(); G.respawnQueue.push(G.time + rand(.2, 4)); return false; }
      return true;
    });
    setThreatAll(Player.level);
    applyPropTier(t);
    Sound.upgrade(); UI.flash('gold');
    emit(Player.x, 1, Player.z, 40, [0xffd23a, paintColor(), 0xffffff], { speed: 16, up: 14, size: .22, life: 1.1 });
    const what = { 1: 'Sedans, lamp posts and bus stops are prey. Police send SUVs now.', 2: 'SUVs and trees go down. SWAT vans are coming for you.', 3: 'Trucks are prey. Buses and armoured vans match you, and the tanks are out.' }[t];
    UI.banner(TIERS[t].name + '!', what, 'tier');
  }

  function smash(obj, type, kind, x, z) {
    const k = KINDS[kind], P = Player;
    const tiny = k.size <= P.level - 2;   // far below you: small change, no fuel, doesn't feed the combo
    if (!tiny) {
      G.combo = G.comboTimer > 0 ? Math.min(COMBO_MAX, G.combo + 1) : 1;
      G.comboTimer = Garage.comboWindow; G.bestCombo = Math.max(G.bestCombo, G.combo);
    }
    const gold = obj.golden ? 5 : 1, same = k.size === P.level ? 2 : 1, boost = P.boosting ? BOOST_SCORE : 1;
    const ram = k.size > P.level; // Power Ram: smashing one size up while boosting
    const pts = tiny ? Math.max(1, Math.round(k.pts * TINY_PTS * gold * boost)) : k.pts * gold * same * boost * G.combo;
    Missions.event('smash', { kind, police: obj instanceof Police, golden: !!obj.golden, ram, boost: P.boosting, tiny });
    if (!tiny) Missions.event('combo', { combo: G.combo });
    G.counts[k.group] = (G.counts[k.group] || 0) + 1;
    if (k.size >= G.biggestSize) { G.biggestSize = k.size; G.biggest = k.name; }
    if (!tiny) P.fuel = Math.min(P.fuelMax, P.fuel + k.fuel * (obj.golden ? 3 : 1) * (P.boosting ? BOOST_FUEL : 1));
    if (ram) { P.fuel -= RAM_DAMAGE * Garage.damage; G.shake = Math.max(G.shake, .5); UI.flash('gold'); }
    G.heat += k.pts * (obj instanceof Police ? 3 : 1) * (tiny ? TINY_PTS : 1) / HEAT_TIER[P.tier]; G.lastSmash = G.time;
    // launch it
    const push = 1.15 + (P.level - k.size) * .25;
    const vx = P.vx * push, vz = P.vz * push;
    const up = kind === 'ped' ? rand(10, 14) : 5 + (P.level - k.size) * 3 + rand(0, 3);
    if (type === 'prop') {
      obj.alive = false; obj.respawnAt = G.time + 30; obj.batch.show(obj, false);
      launchDebris(scene, partsToGroup(obj.batch.parts), obj.x, obj.z, obj.rot, vx, vz, up, 4);
      if (kind === 'hydrant') emitters.push({ x: obj.x, z: obj.z, until: G.time + 2.5 });
    } else if (type === 'ped') {
      obj.alive = false; obj.respawnAt = G.time + 8;
      launchDebris(scene, pedGroup(obj.shirt, obj.skin), obj.x, obj.z, obj.h, vx, vz, up, 3.5);
    } else { // car or police
      obj.alive = false; obj.mesh.remove(obj.ring);
      launchDebris(scene, obj.mesh, obj.x, obj.z, obj.h, vx * .8, vz * .8, up, 5);
      if (!(obj instanceof Police) && !obj.parked) G.respawnQueue.push(G.time + 3);
    }
    // juice
    const col = { ped: [obj.shirt || 0xffffff, 0xffffff], bin: [0x2f6b3c, 0xb5a17a, 0xdddddd], cone: [0xff6a00, 0xffffff], hydrant: [0x3aa0ff, 0xd62828],
      lamp: [0xffc46b, 0xffffff, 0x3a3f4a], busstop: [0x9fe0ff, 0xffffff], tree: [0x2a7a49, 0x5a3d2b] }[kind] || [obj.color || 0xcccccc, 0x333333, 0xffd23a];
    emit(x, 1, z, 10 + k.size * 8, col, { speed: 6 + k.size * 2, up: 7 + k.size * 2, size: .14 + k.size * .07, vx: P.vx * .3, vz: P.vz * .3 });
    if (!tiny && k.size >= 2) G.shake = Math.max(G.shake, .18 + k.size * .1);       // no shake for bins, people or tiny stuff
    if (!tiny && k.size >= 3) G.hitPause = .07;                                      // rare freeze on the big ones
    if (!tiny && k.size >= 2) P.hop(1.5 + k.size * 1.3);
    Sound.smash(kind, k.size); if (!tiny && G.combo > 1) Sound.combo(G.combo);
    const label = (ram ? 'POWER RAM ' : '') + `+${fmt(pts)}` + (gold > 1 ? ' GOLD' : '') + (!tiny && G.combo > 1 ? `  x${G.combo}` : '');
    addScore(pts, x, 2.5 + k.size * .6, z, label, tiny ? 'tiny' : gold > 1 ? 'gold' : ram ? 'ram' : boost > 1 ? 'boosted' : k.size === P.level ? 'big' : '');
    if (ram && P.fuel <= 0) die(`Rammed one ${KINDS[kind].name.toLowerCase()} too many`);
  }

  function bounce(obj, kind, res, mover) {
    const P = Player;
    P.x += res.nx * res.depth; P.z += res.nz * res.depth;
    const into = -(P.vx * res.nx + P.vz * res.nz);
    if (into > 0) { P.vx += res.nx * into * 1.5; P.vz += res.nz * into * 1.5; }
    if (mover) { mover.x -= res.nx * .4; mover.z -= res.nz * .4; mover.v *= .3; }
    if (P.invuln > 0) return;
    P.scaleSpeed(.45); P.drifting = false; P.fuel -= BOUNCE_DAMAGE * Garage.damage; P.invuln = .9;
    G.shake = Math.max(G.shake, .5); Sound.bonk(); UI.flash('red');
    emit(P.x + res.nx * -1, 1.2, P.z - res.nz, 14, [0xffd23a, 0xffffff, 0xff7b00], { speed: 8, up: 6, size: .18 });
    const need = TIERS.find(t => TIERS.indexOf(t) + 1 >= KINDS[kind].size);
    if (P.fuel <= 0) die(`Wrecked by a ${KINDS[kind].name.toLowerCase()}`);
    else UI.toast(`Too big! ${KINDS[kind].name}s need a ${need ? need.name : 'bigger ride'}`);
  }
  function onWall(into) {
    const P = Player;
    if (P.invuln > 0 || into < 12) { G.shake = Math.max(G.shake, .15); Sound.bonk(); return; }
    P.fuel -= Math.min(BOUNCE_DAMAGE, into * 1.1) * Garage.damage; P.invuln = .7;
    G.shake = Math.max(G.shake, .45); Sound.bonk(); UI.flash('red');
    emit(P.x + P.fx * P.half, 1, P.z + P.fz * P.half, 12, [0xffd23a, 0xffffff], { speed: 7, up: 5, size: .16 });
    if (P.fuel <= 0) die('Wrecked against a building');
  }

  // test the player against one object; returns true if it touched
  function testHit(obj, type, kind, ox, oz, rot, hl, hw, mover) {
    const P = Player;
    if (P.y > KINDS[kind].ht) return false; // sailing over it
    for (const c of P.circles()) {
      const res = circleOBB(c.x, c.z, c.r, ox, oz, rot, hl, hw);
      if (!res) continue;
      let th = threatOf(KINDS[kind].size, P.level);
      if (th === 'wreck' && type === 'prop') th = 'bounce'; // street furniture never kills outright
      if (th === 'bounce' && Ram.on && threatOf(KINDS[kind].size, P.level) === 'bounce') th = 'smash'; // Power Ram
      if (th === 'smash') smash(obj, type, kind, ox, oz);
      else if (th === 'bounce') bounce(obj, kind, res, mover);
      else die(`Flattened by a ${KINDS[kind].name.toLowerCase()}`);
      return true;
    }
    return false;
  }
  function nearMissCheck(car) {
    const P = Player;
    if (G.time - car.nearMissAt < 3 || Math.hypot(P.vx, P.vz) < 18 || threatOf(car.size, P.level) === 'smash') return;
    for (const c of P.circles()) {
      if (circleOBB(c.x, c.z, c.r + 1.7, car.x, car.z, car.h, car.hl, car.hw)) {
        car.nearMissAt = G.time; G.score += NEAR_MISS_PTS; G.pending += NEAR_MISS_PTS;
        UI.float(car.x, 3, car.z, `NEAR MISS +${NEAR_MISS_PTS}`, 'miss'); Sound.nearMiss(); Missions.event('near');
        return;
      }
    }
  }

  // Crazy moves: dash launches, power slides, ramp air
  function onTrick(type, v, fromRamp) {
    const P = Player;
    if (type === 'dash') {
      Missions.event('dash');
      Sound.dash(); G.shake = Math.max(G.shake, .12);
      UI.float(P.x + P.fx * 4, 2.2, P.z + P.fz * 4, 'CRAZY DASH!', 'dash');
      emit(P.x - P.fx * P.half, .4, P.z - P.fz * P.half, 18, [0x9aa0b5, 0xcfd3e0, paintColor()], { speed: 4, up: 3, size: .3, life: .6, grav: 2 });
    } else if (type === 'drift') {
      Missions.event('drift', { time: v });
      const pts = Math.round(v * 45) * (v > 2 ? 2 : 1);
      Sound.combo(4);
      addScore(pts, P.x, 3, P.z, `DRIFT ${v.toFixed(1)}s +${pts}`, 'drift');
    } else if (type === 'hop') {
      Sound.hop();
      emit(P.x, .2, P.z, 8, [0x9aa0b5, 0xcfd3e0], { speed: 3, up: 1.5, size: .25, life: .4, grav: 2 });
    } else if (type === 'launch') {
      Sound.nearMiss();
    } else if (type === 'land') {
      Sound.land(v); G.shake = Math.max(G.shake, .2 + Math.min(.4, v * .2));
      emit(P.x, .3, P.z, 20, [0x9aa0b5, 0xcfd3e0], { speed: 7, up: 3, size: .35, life: .7, grav: 4 });
      if (fromRamp) Missions.event('air', { time: v });
      if (fromRamp && v > .45) { const pts = Math.round(v * 90); addScore(pts, P.x, 3.5, P.z, `AIR ${v.toFixed(1)}s +${pts}`, 'air'); }
    }
  }

  function collide() {
    const P = Player;
    for (const it of hashQuery(P.x, P.z, P.half + 6)) {
      if (it.alive && testHit(it, 'prop', it.kind, it.x, it.z, it.rot, it.hl, it.hw)) if (!P.alive) return;
    }
    for (const p of Peds.list) {
      if (!p.alive || Math.abs(p.x - P.x) > P.half + 3 || Math.abs(p.z - P.z) > P.half + 3) continue;
      testHit(p, 'ped', 'ped', p.x, p.z, 0, PED_HIT, PED_HIT); if (!P.alive) return;
    }
    for (const c of [...G.traffic, ...G.police]) {   // sailing over a vehicle counts as a hop-over
      if (!c.alive || P.y <= KINDS[c.kind].ht || G.time - (c.hopAt || -9) < 2) continue;
      if (Math.abs(c.x - P.x) > 12 || Math.abs(c.z - P.z) > 12) continue;
      if (P.circles().some(q => circleOBB(q.x, q.z, q.r, c.x, c.z, c.h, c.hl, c.hw))) {
        c.hopAt = G.time; addScore(30, c.x, 4, c.z, 'HOP OVER +30', 'air'); Missions.event('hopover');
      }
    }
    for (const c of G.traffic) {
      if (!c.alive || Math.abs(c.x - P.x) > 16 || Math.abs(c.z - P.z) > 16) continue;
      if (!testHit(c, 'car', c.kind, c.x, c.z, c.h, c.hl, c.hw, c)) nearMissCheck(c);
      if (!P.alive) return;
    }
    for (const c of G.police) {
      if (!c.alive || Math.abs(c.x - P.x) > 16 || Math.abs(c.z - P.z) > 16) continue;
      testHit(c, 'car', c.kind, c.x, c.z, c.h, c.hl, c.hw, c); if (!P.alive) return;
    }
    for (const f of G.food) {
      if (!f.alive) continue;
      for (const c of P.circles()) if (circleOBB(c.x, c.z, c.r, f.x, f.z, f.rot, f.hl, f.hw)) {
        f.alive = false; f.mesh.visible = false; f.respawnAt = G.time + 25;
        P.fuel = Math.min(P.fuelMax, P.fuel + 60);
        Sound.pickup(); UI.flash('green'); UI.toast('Food truck: tank topped up'); Missions.event('food');
        emit(f.x, 2, f.z, 30, [0x3dff8f, 0xff4fa3, 0xffffff], { speed: 9, up: 10, size: .3 });
        break;
      }
    }
  }

  // ---------- police heat ----------
  function updateHeat(dt) {
    if (G.time - G.lastSmash > 5) G.heat = Math.max(0, G.heat - HEAT_DECAY * dt * (1 + G.heat / 600));
    const stars = HEAT_STARS.filter(h => G.heat >= h).length;
    if (stars > G.stars) { Sound.star(); UI.toast(stars === 1 ? 'Police are on to you' : 'More police incoming'); }
    G.stars = stars;
    const want = [0, 1, 2, 3][stars];
    G.police = G.police.filter(p => {
      if (!p.alive) return false;
      const d = Math.hypot(p.x - Player.x, p.z - Player.z);
      if (p.mode === 'block') { if (p.age > 25 || d > 150) { p.remove(); return false; } return true; }
      const chasers = G.police.filter(q => q.mode === 'chase' && q.alive).length;
      if ((chasers > want && d > 110) || (p.stuck > 2.5 && d > 60)) { p.remove(); return false; }
      return true;
    });
    const chasing = G.police.filter(p => p.mode === 'chase').length;
    if (chasing < want && Math.random() < dt * .6) spawnPolice();
    let near = 999; for (const p of G.police) near = Math.min(near, Math.hypot(p.x - Player.x, p.z - Player.z));
    Sound.siren(G.police.length ? clamp(1 - near / 140, .15, 1) : 0);
  }

  // ---------- camera ----------
  const camPos = new THREE.Vector3(), look = new THREE.Vector3();
  let camD = TIERS[0].camD, camH = TIERS[0].camH, titleA = 0, camYaw = 0;
  function updateCamera(dt) {
    if (Game.state === 'title' && Player.mesh) {
      // slow showcase sweep behind the parked car, looking down the street
      titleA += dt * .22;
      const P = Player, a = P.h + Math.PI + Math.sin(titleA) * .9, r = 8.5;
      camera.position.set(P.x + Math.sin(a) * r, 3.1 + Math.sin(titleA * .7) * .4, P.z + Math.cos(a) * r);
      camera.lookAt(P.x + P.fx * 3, .6, P.z + P.fz * 3);
      const base = innerWidth < innerHeight ? 74 : 60;
      camera.fov += (base - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
      return;
    }
    if (Game.state === 'title' || Game.state === 'over') {
      titleA += dt * .05;
      const r = SIZE * .42, cx = SIZE / 2, cz = SIZE / 2;
      camera.position.set(cx + Math.cos(titleA) * r, 105, cz + Math.sin(titleA) * r);
      camera.lookAt(cx, 0, cz); return;
    }
    const P = Player, T = TIERS[P.tier];
    camD += (T.camD - camD) * Math.min(1, dt * 1.5); camH += (T.camH - camH) * Math.min(1, dt * 1.5);
    const sp = Math.hypot(P.vx, P.vz);
    // the camera trails the car's heading, so it swings wide in a slide
    camYaw += wrapAng(P.h - camYaw) * Math.min(1, dt * (P.drifting ? 2.4 : 5));
    const over = clamp((sp - T.cruise) / (T.boost - T.cruise), 0, 1);       // 0 at cruise, 1 flat-out on boost
    const back = camD * (1 + over * .3);                                       // boost pulls the camera back
    const want = new THREE.Vector3(P.x - Math.sin(camYaw) * back, camH * (1 - over * .12) + P.y * .7, P.z - Math.cos(camYaw) * back);
    camPos.lerp(want, Math.min(1, dt * 9));
    const wall = pushOutOfBuildings(camPos.x, camPos.z, .6);                    // never end up inside a tower
    if (wall) { camPos.x = wall.x; camPos.z = wall.z; }
    camera.position.copy(camPos);
    // rumble that grows with speed, plus impact shake
    const rumble = .015 * clamp(sp / T.cruise, 0, 1.2) + over * .05;
    const s = rumble + G.shake * .6;
    camera.position.x += rand(-s, s); camera.position.y += rand(-s, s) * .6; camera.position.z += rand(-s, s);
    G.shake = Math.max(0, G.shake - dt * 2.2);
    look.set(P.x + P.fx * 7, 1.1 + T.camH * .15 + P.y * .8, P.z + P.fz * 7);
    camera.lookAt(look);
    camera.rotateZ(clamp(P.yawRate * .035, -.1, .1));                         // lean into turns
    const base = innerWidth < innerHeight ? 74 : 60;
    const fov = base + clamp(sp / T.cruise, 0, 1) * 7 + over * 18 + P.dashT * 20;
    $('speedlines').style.opacity = clamp((sp - T.cruise * .85) / 12, 0, .55) + over * .4 + P.dashT * .9;
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 5); camera.updateProjectionMatrix();
    Sound.musicLift(over);
  }

  // ---------- main loop ----------
  const dummy = { x: SIZE / 2, z: SIZE / 2, fx: 0, fz: 1, speed: 0, alive: false, half: 2, level: 1 };
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(.05, (now - last) / 1000); last = now;
    if (Game.state === 'paused') { renderer.render(scene, camera); return; }
    if (G.hitPause > 0) { G.hitPause -= dt; renderer.render(scene, camera); return; }
    if (G.slow > 0) { G.slow -= dt; dt *= .35; }
    const playing = Game.state === 'play', dying = Game.state === 'dying';
    const who = playing || dying ? Player : dummy;
    if (playing || dying) { const s0 = Math.floor(G.time); G.time += dt; if (playing && Math.floor(G.time) !== s0) Missions.event('time', { time: G.time }); }
    const t = G.time || now / 1000;

    if (playing) {
      readInput(dt);
      Player.update(dt, onWall, onTrick);
      if (Player.boosting && !G.wasBoost && Player.dashT <= 0 && G.time - (G.lastRev || -9) > 1.5) { Sound.boostRev(); G.lastRev = G.time; }
      G.wasBoost = Player.boosting;
      // Power Ram: boosting at speed breaks through amber objects. Ring colours never change; amber rings pulse instead.
      const ramNow = Player.boosting && Player.speed >= TIERS[Player.tier].cruise * RAM_AT;
      if (ramNow !== Ram.on) { Ram.on = ramNow; if (ramNow) Sound.star(); else setThreatAll(Player.level); }
      if (Ram.on) {
        const o = .45 + .4 * Math.abs(Math.sin(G.time * 9));
        RING_MATS.bounce.opacity = o;
        for (const k in World.batches) if (World.batches[k].threat === 'bounce') World.batches[k].ringMat.opacity = o;
      }
      collide();
      if (playing && Player.alive && Player.fuel <= 0 && Player.speed < 1.5) die('Tank ran dry');
      if (G.comboTimer > 0) { G.comboTimer -= dt; if (G.comboTimer <= 0) { G.combo = 0; G.pending = 0; } }
      updateHeat(dt);
      // respawn smashed props and cars away from the player
      for (const it of World.props) if (!it.alive && !it.locked && t > it.respawnAt && Math.hypot(it.x - Player.x, it.z - Player.z) > 70) { it.alive = true; it.batch.show(it, true); }
      G.respawnQueue = (G.respawnQueue || []).filter(at => { if (t > at) { spawnTraffic(90); return false; } return true; });
    }
    if (dying) { G.dyingT -= dt; if (G.dyingT <= 0) gameOver(); }

    G.traffic = G.traffic.filter(c => c.alive);
    for (const c of G.traffic) c.update(dt, G.traffic, who);
    for (const p of G.police) p.update(dt, G.traffic, who, t);
    for (const f of G.food) f.update(dt, t, who.x, who.z);
    updatePeds(dt, who, t);
    updateDebris(dt);
    for (let i = emitters.length - 1; i >= 0; i--) {
      const e = emitters[i]; if (t > e.until) { emitters.splice(i, 1); continue; }
      emit(e.x, .8, e.z, 3, [0x6cc6ff, 0xbfe9ff, 0xffffff], { speed: 1.5, up: 13, size: .22, life: 1 });
    }
    updateParticles(dt);
    updateCamera(dt);
    if (playing || dying) {
      Sound.engine(Math.hypot(Player.vx, Player.vz), Player.tier, Player.boosting, playing);
      Sound.screech(playing && Player.y < .05 ? clamp((Math.abs(Player.lateral) - 3) / 10, 0, 1) : 0);
      if (Player.y < .05 && Math.abs(Player.lateral) > 4 && Math.random() < .9)
        emit(Player.x - Player.fx * Player.half * .7, .3, Player.z - Player.fz * Player.half * .7, 1, [0x555a66, 0x777c88], { speed: 1, up: 1.5, size: .5, life: .7, grav: -1 });
      if (Player.boosting && Math.random() < .8)
        emit(Player.x - Player.fx * Player.half, .6, Player.z - Player.fz * Player.half, 1, [0x6ad5ff, 0xffffff, paintColor()], { speed: 1, up: .5, size: .2, life: .3, grav: 0 });
      UI.hud(G, Player); UI.minimap(G, Player); UI.foodArrow(G, Player);
    } else { Sound.engine(0, 0, false, false); Sound.screech(0); $('speedlines').style.opacity = 0; $('foodArrow').classList.remove('on'); }
    UI.updateFloats(dt, camera);
    renderer.render(scene, camera);
  }

  // ---------- buttons ----------
  $('playBtn').addEventListener('click', startRun);
  $('againBtn').addEventListener('click', startRun);
  $('menuBtn').addEventListener('click', toTitle);
  $('resumeBtn').addEventListener('click', () => { Game.state = 'play'; UI.show(null); Sound.duck(false); });
  $('quitBtn').addEventListener('click', () => { Sound.siren(0); Sound.duck(false); toTitle(); });
  $('pauseBtn').addEventListener('click', () => Game.onPauseKey());
  $('muteBtn').addEventListener('click', () => { Sound.setMuted(!Sound.muted); UI.title(save.best, save.coins, save.paint, save.owned); });
  $('paints').addEventListener('click', e => {
    const b = e.target.closest('.paint'); if (!b) return;
    const p = PAINTS.find(p => p.id === b.dataset.id);
    if (!save.owned.includes(p.id)) {
      if (save.coins < p.cost) { UI.toast(`Need ${fmt(p.cost - save.coins)} more coins`); return; }
      save.coins -= p.cost; save.owned.push(p.id); store.set('coins', save.coins); store.set('owned', save.owned);
    }
    save.paint = p.id; store.set('paint', p.id);
    if (Game.state === 'title') parkCar();
    UI.title(save.best, save.coins, save.paint, save.owned);
  });
  Game.debugUpgrade = upgrade;
  // ---------- missions + garage ----------
  const addCoins = n => { save.coins += n; store.set('coins', save.coins); };
  Missions.onComplete = (m, reward) => {
    addCoins(reward); Sound.pickup(); UI.missionPop(Missions.label(m), reward);
  };
  Missions.onSetComplete = (level, bonus) => addCoins(bonus);
  $('timeBtn').addEventListener('click', () => {
    save.time = save.time === 'day' ? 'night' : 'day'; store.set('time', save.time);
    applyPalette(World.map);
  });
  $('mapBtn').addEventListener('click', () => UI.openMaps(save.map, id => {
    // picking a map rebuilds the city, then drives straight off from the new start
    if (id !== save.map) loadMap(id);
    UI.closeMaps(); startRun();
  }));
  document.querySelectorAll('.nav-btn[data-sheet]').forEach(b => b.addEventListener('click', () => UI.openSheet(b.dataset.sheet)));
  $('sheetClose').addEventListener('click', () => UI.closeSheet());
  $('sheetWrap').addEventListener('click', e => { if (e.target === $('sheetWrap')) UI.closeSheet(); });
  addEventListener('keydown', e => {
    if (Game.state !== 'title' || !$('mapPicker').hidden) return;
    if (e.code === 'Escape' && UI.sheet) UI.closeSheet();
    else if (e.code === 'Enter' && !UI.sheet && document.activeElement === document.body) startRun();
  });
  $('garageList').addEventListener('click', e => {
    const b = e.target.closest('.buy'); if (!b || b.disabled) return;
    const cost = Garage.cost(b.dataset.up); if (cost == null || save.coins < cost) return;
    save.coins -= cost; store.set('coins', save.coins); Garage.buy(b.dataset.up); Sound.init(); Sound.upgrade();
    UI.title(save.best, save.coins, save.paint, save.owned);
  });
  // Paused: effects go silent and the music drops quieter. Resuming brings both back.
  Game.onPauseKey = () => {
    if (Game.state === 'play') { Game.state = 'paused'; UI.show('pauseScreen'); Sound.siren(0); Sound.engine(0, 0, false, false); Sound.screech(0); Sound.duck(true); }
    else if (Game.state === 'paused') { Game.state = 'play'; UI.show(null); Sound.duck(false); }
  };
  // Tab hidden / app in the background / phone locked: pause the run and stop all sound until you're back.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (Game.state === 'play') Game.onPauseKey(); Sound.suspend(); }
    else Sound.wake();
  });
  // Clicked into another window but the game is still visible: pause the run, keep the (ducked) music.
  addEventListener('blur', () => { if (Game.state === 'play') Game.onPauseKey(); });

  // attract mode: city traffic running behind the title screen
  Player.x = START.x; Player.z = START.z; Player.level = 1;
  G.food = [];
  loadMap(save.map);
  toTitle();
  requestAnimationFrame(frame);
})();
