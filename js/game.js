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
    best: store.get('best', 0), bestRampage: store.get('bestRampage', 0), coins: store.get('coins', 0),
    paint: store.get('paint', 'blue'), owned: store.get('owned', ['blue']), map: store.get('map', 'flats'), time: store.get('time', 'night'),
  };
  const rampage = () => Settings.mode === 'rampage';
  const curBest = () => rampage() ? save.bestRampage : save.best;
  const paintDesign = () => PAINTS.find(p => p.id === save.paint) || PAINTS[0];
  const paintColor = () => underglowOf(paintDesign());
  const emitters = [];

  // ---------- spawning ----------
  function spawnTraffic(minDist) {
    const car = new Car(scene, pickTrafficKind(Player.level || 1));
    const spot = laneSpotRing(Player, minDist, TRAFFIC_RADIUS) || randomLaneSpot(Player.x, Player.z, minDist);
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
  // Traffic stays around you: cars that wander more than TRAFFIC_RADIUS away are moved back into
  // a ring around you (out past the near streets), so the roads near you stay busy wherever you go.
  function recycleTraffic(t) {
    if (t - (G.recycleAt || 0) < .5) return; G.recycleAt = t;
    const P = Player;
    for (const c of G.traffic) {
      if (c.parked || !c.alive || Math.hypot(c.x - P.x, c.z - P.z) < TRAFFIC_RADIUS) continue;
      const spot = (Math.random() < .6 && laneSpotAhead(P, 95, TRAFFIC_RADIUS - 10)) || laneSpotRing(P, 95, TRAFFIC_RADIUS - 10);
      if (spot) c.place(spot);
    }
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
    for (const it of World.props) { if (it.cleared) continue; it.locked = false; if (!it.alive) { it.alive = true; it.batch.show(it, true); } }
    applyPropTier(0);
    for (const p of Peds.list) spawnPed(p, Player.x, Player.z, 20);
    for (const d of Debris.list) d.scene.remove(d.obj);
    Debris.list = []; emitters.length = 0;
    for (const s of Shocks.list) s.scene.remove(s.m); Shocks.list = [];
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
  // ---------- parking lots: fill up when you come near, empty (and later refill) when you leave ----------
  function lotKind(level) {
    let s = clamp(level + weighted([[0, 55], [-1, 25], [1, 20]]), 1, 6);   // mostly things you can eat, some one size up
    while (!TRAFFIC_BY_SIZE[s] && s > 1) s--;
    return pick(TRAFFIC_BY_SIZE[s]);
  }
  function fillLot(L) {
    const fill = rand(LOT_FILL[0], LOT_FILL[1]), lv = Player.level || 1;
    for (const s of L.bays) if (Math.random() < fill) {
      const c = new Car(scene, lotKind(lv)); c.parked = true; c.lot = L;
      c.x = s.x; c.z = s.z; c.h = s.rot; c.v = 0; c.sync(); c.setThreat(lv);
      G.traffic.push(c); L.cars.push(c);
    }
    L.active = true;
  }
  function emptyLot(L) { for (const c of L.cars) if (c.alive) { c.remove(); c.alive = false; } L.cars = []; L.active = false; }
  let lotAt = 0;
  function updateLots(who, force) {
    const now = performance.now() / 1000; if (!force && now - lotAt < .5) return; lotAt = now;
    for (const L of World.lots) {
      const d = Math.hypot(L.x - who.x, L.z - who.z);
      if (!L.active && d < LOT_NEAR) fillLot(L); else if (L.active && d > LOT_FAR) emptyLot(L);
    }
  }
  function spawnParked() {
    for (const L of World.lots) { L.active = false; L.cars = []; }   // their cars were cleared with the rest of the traffic
    updateLots(Game.state === 'play' ? Player : dummy, true);
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
    const tb = $('timeBtn'); tb.innerHTML = ICONS[day ? 'sun' : 'moon']; tb.classList.toggle('day', day);
    tb.setAttribute('aria-label', day ? 'Day: switch to night' : 'Night: switch to day'); tb.title = day ? 'Day' : 'Night';
  }
  function loadMap(id) {
    const map = mapById(id);
    for (const c of G.traffic) c.remove();
    for (const p of G.police) p.remove();
    G.traffic = []; G.police = [];
    for (const d of Debris.list) d.scene.remove(d.obj);
    Debris.list = []; emitters.length = 0;
    for (const s of Shocks.list) s.scene.remove(s.m); Shocks.list = [];
    clearWorld(scene); buildWorld(scene, map); applyPalette(map);
    Player.placeOnPad(); Player.intro = null;
    for (let i = 0; i < TRAFFIC_COUNT; i++) spawnTraffic(0);
    spawnParked();
    for (const p of Peds.list) spawnPed(p, START.x, START.z, 20);
    placeFoodTrucks();
    setThreatAll(1); applyPropTier(0);
    save.map = map.id; store.set('map', map.id);
    UI.mapLabel(map);
  }
  Game.loadMap = loadMap;

  function removeBoss() { if (G.boss) { G.boss.remove(); G.boss = null; } }
  function startRun() {
    Sound.init(); Sound.resume();
    removeBoss();
    Player.reset(scene, paintDesign());
    Player.placeOnPad();                                  // every run starts on the launch deck
    Object.assign(G, {
      score: 0, combo: 0, comboTimer: 0, pending: 0, bestCombo: 0, biggest: null, biggestSize: 0,
      counts: {}, upgrades: [{ tier: 0, time: 0 }], time: 0, heat: 0, stars: 0, lastSmash: 0,
      shake: 0, kick: 0, fovKick: 0, hitPause: 0, slow: 0, deathReason: '', dyingT: 0, respawnQueue: [], lastBlock: 0,
      mode: Settings.mode, bites: 0, timeLeft: RAMPAGE.time, bonusCoins: 0, evolve: null, boss: null, bossAngry: false, won: null,
    });
    Player.hunger = G.mode === 'rampage' ? 0 : 1;   // Rampage: a few seconds' grace, then hungry
    Ram.on = false; G.tutor = null; Player.noDrain = false; $('tutor').hidden = true; $('wheel').classList.remove('teach'); $('stick').classList.remove('teach'); $('stL').classList.remove('teach'); $('stR').classList.remove('teach'); UI.wheel();
    scene.remove(evolveOrb);
    resetWorld();
    Missions.runStart();
    setThreatAll(1);
    camPos.copy(camera.position); camYaw = Player.h;   // glide from the landing view into the chase cam
    // launch camera: start exactly where the landing screen's sweep is, and pan round to straight behind
    G.introCam = { t: 0, off: Math.sin(titleA) * .9, bob: Math.sin(titleA * .7) * .4 };
    UI.clearFloats(); UI.resetTank();
    UI.show(null);
    Game.state = 'play';
    G.coachUntil = G.mode === 'rampage' ? 25 : 4; G.redTips = 0; G.coachScan = 0; G.ramTold = false; G.lastBoostAt = 0;
    // the tutorial / intro banner wait until you've landed in the city
    G.afterLanding = !store.get('tutorDone', false) ? tutorStart : runIntro;
  }
  function runIntro() {
    const touchUI = matchMedia('(pointer: coarse)').matches;
    if (G.mode === 'rampage') UI.banner('BOUNTY', `Take down the Iron Hauler. Boost into it to smash through. The bigger you are, the harder you hit!`, 'tier');
    else UI.banner('Sedan', `Green: smash it. Amber: ${touchUI ? 'tap Boost' : 'hold Shift'} to boost through. Red: steer clear.`, 'tier');
    G.coachUntil = G.time + (G.mode === 'rampage' ? 25 : 4);
  }

  // ---------- first-run tutorial: turn left, turn right, then off you go ----------
  // The run is already going underneath; while it's up your tank doesn't drain and nothing can wreck you.
  const TUTOR_HOLD = .4;   // seconds of turning each step needs
  function tutorStart() {
    G.tutor = { step: 'left', held: 0, wait: true, pause: 0 }; Player.noDrain = true;
    tutorShow();
  }
  function tutorShow() {
    const touchUI = matchMedia('(pointer: coarse)').matches, s = G.tutor.step, el = $('tutor');
    const simple = Settings.steer === 'simple', wheel = touchUI && Settings.steer === 'wheel', btns = touchUI && Settings.steer === 'buttons';
    const stk = touchUI && Settings.steer === 'stick';
    $('wheel').classList.toggle('teach', wheel); $('stick').classList.toggle('teach', stk);
    $('stL').classList.toggle('teach', btns && s === 'left'); $('stR').classList.toggle('teach', btns && s === 'right');
    const how = stk ? { left: 'Push the <b>joystick left</b>', right: 'Now push it <b>right</b>' }[s] : wheel ? { left: 'Slide your thumb to the <b>left of the wheel</b>', right: 'Now slide it to the <b>right</b>' }[s]
      : btns ? { left: 'Press and hold <b>◀</b>', right: 'Now hold <b>▶</b>' }[s] : {
      left: touchUI ? (simple ? 'Press and hold the <b>left side</b> of the screen' : 'Touch and <b>drag left</b>') : 'Press and hold <kbd>←</kbd>',
      right: touchUI ? (simple ? 'Press and hold the <b>right side</b>' : 'Touch and <b>drag right</b>') : 'Press and hold <kbd>→</kbd>',
    }[s];
    el.hidden = false; el.className = 'tutor waiting ' + s + (touchUI && simple ? ' zones' : '');
    $('tutorBig').textContent = s === 'left' ? 'Turn left' : 'Turn right';
    $('tutorStep').textContent = s === 'left' ? 'Step 1 of 2' : 'Step 2 of 2';
    $('tutorFill').style.transform = 'scaleX(0)';
    $('tutorSmall').innerHTML = how;
  }
  function tutorUpdate(dt) {
    const T = G.tutor; if (!T || T.step === 'done') return;
    if (T.pause > 0) { T.pause -= dt; return; }                 // the "Nice!" beat between steps
    const want = T.step === 'left' ? -1 : 1, doing = Input.steer * want > 0;
    if (doing !== !T.wait) { T.wait = !doing; $('tutor').classList.toggle('waiting', T.wait); }
    if (Input.steer * want > .3) T.held += dt; else T.held = Math.max(0, T.held - dt * .5);
    $('tutorFill').style.transform = `scaleX(${clamp(T.held / TUTOR_HOLD, 0, 1)})`;
    if (T.held < TUTOR_HOLD) return;
    Sound.star(); T.held = 0; UI.flash('green');
    $('tutor').classList.add('nice'); $('tutorBig').textContent = 'Nice!'; $('tutorSmall').innerHTML = T.step === 'left' ? 'Now the other way' : 'You\'ve got it';
    if (T.step === 'left') {
      T.step = 'right'; T.pause = .9;
      setTimeout(() => { if (G.tutor) { $('tutor').classList.remove('nice'); G.tutor.wait = true; tutorShow(); } }, 900);
      return;
    }
    T.step = 'done'; T.wait = false; Player.noDrain = false; store.set('tutorDone', true);
    setTimeout(() => {
      $('tutor').hidden = true; $('tutor').classList.remove('nice'); $('wheel').classList.remove('teach'); $('stick').classList.remove('teach'); $('stL').classList.remove('teach'); $('stR').classList.remove('teach'); G.tutor = null;
      if (Game.state !== 'play') return;
      Sound.upgrade(); UI.banner('GO!', 'Smash anything with a green ring.', 'tier go');
      setTimeout(() => { if (Game.state === 'play') runIntro(); }, 2200);
    }, 900);
  }
  // The landing screen is the live city: your car waits on the centre line while traffic drives past.
  function parkCar() {
    Player.reset(scene, paintDesign()); Player.alive = false; Player.speed = 0;
    Player.placeOnPad(); Player.intro = null;            // parked on the launch deck, ready to go
    dummy.x = Player.x; dummy.z = Player.z;
  }
  function toTitle() {
    Full.onMenu();
    Game.state = 'title'; Ram.on = false; removeBoss();
    parkCar();
    UI.title(curBest(), save.coins, save.paint, save.owned);
    UI.show('titleScreen');
  }
  function gameOver() {
    Game.state = 'over';
    const earned = Math.floor(G.score / COINS_PER * (mapById(save.map).coins || 1)) + (G.bonusCoins || 0);
    save.coins += earned; store.set('coins', save.coins);
    const missionCoins = Missions.completedThisRun.reduce((s, m) => s + m.reward, 0);
    const setDone = Missions.settle();
    const key = G.mode === 'rampage' ? 'bestRampage' : 'best';
    const isBest = G.score > save[key];
    if (isBest) { save[key] = G.score; store.set(key, save[key]); }
    $('overReason').classList.toggle('win', !!G.won);
    UI.over(G, Player, earned, save[key], isBest, Missions.completedThisRun, missionCoins, setDone);
    UI.show('overScreen');
    Sound.siren(0);
  }
  // Rampage: the clock ran out. No crash, just a slow-motion finish.
  function timeUp() {
    if (!Player.alive) return;
    Player.alive = false; Ram.on = false; Game.state = 'dying'; G.dyingT = 1.4; G.slow = 1.4;
    G.deathReason = G.boss && G.boss.alive ? "Time's up! The Iron Hauler got away" : `Time's up! You became ${/^[AEIOU]/.test(TIERS[Player.tier].name) ? 'an' : 'a'} ${TIERS[Player.tier].name}`;
    UI.banner('TIME!', `You became ${/^[AEIOU]/.test(TIERS[Player.tier].name) ? 'an' : 'a'} ${TIERS[Player.tier].name}`, 'tier go'); Sound.upgrade();
  }
  function die(reason) {
    if (G.evolve) return;   // can't be hurt while evolving
    if (G.mode === 'rampage' && reason === 'Tank ran dry') reason = `Starved as ${/^[AEIOU]/.test(TIERS[Player.tier].name) ? 'an' : 'a'} ${TIERS[Player.tier].name}`;
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
    if (next && G.mode !== 'rampage' && G.score >= next.at) upgrade();   // Rampage grows by bites instead
  }
  // ---------- growing up: an evolution ----------
  // A white orb swells inside the car and pulses (slow motion, you can't be hurt), then bursts outward:
  // you're the next size, and every vehicle nearby is blown away. No points for those, but coins.
  const evolveMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .5, depthWrite: false });
  const evolveOrb = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), evolveMat);
  function upgrade() {
    if (G.evolve || !Player.alive) return;
    G.evolve = { t: 0, blown: false }; Player.noDrain = true;
    evolveMat.blending = Lighting.bright ? THREE.NormalBlending : THREE.AdditiveBlending; evolveMat.needsUpdate = true;
    evolveOrb.scale.setScalar(.3); scene.add(evolveOrb);
    Sound.star(); G.shake = Math.max(G.shake, .25);
  }
  function updateEvolve(rdt) {
    const e = G.evolve, P = Player; if (!e) return;
    e.t += rdt;
    if (!e.blown) {
      const k = Math.min(1, e.t / EVOLVE_BUILD), size = P.half * .95 + .5;   // just big enough to wrap the car
      const pulse = 1 + .1 * Math.sin(e.t * (8 + e.t * 16));                // pulses faster and faster
      evolveOrb.scale.setScalar((.4 + Math.min(1, k * 1.6) * size) * pulse);
      evolveOrb.position.set(P.x, 1 + P.y, P.z);
      evolveMat.opacity = .45 + .45 * k;
      if (P.body) P.body.visible = k < .25 || Math.floor(e.t * (5 + k * 18)) % 2 === 0;   // flickers like it's changing
      if (Math.random() < .5) emit(P.x + rand(-2, 2), rand(.5, 3), P.z + rand(-2, 2), 1, [0xffffff, 0xfff6c8], { speed: 2, up: 3, size: .15, life: .5, grav: -2 });
      if (e.t >= EVOLVE_BUILD) { e.blown = true; e.bt = 0; evolveBurst(); }
    } else {
      e.bt += rdt;
      const q = Math.min(1, e.bt / EVOLVE_BLAST);
      evolveOrb.position.set(P.x, 1, P.z);
      evolveOrb.scale.setScalar(3 + (1 - (1 - q) * (1 - q)) * EVOLVE_RADIUS);
      evolveMat.opacity = .85 * (1 - q);
      if (q >= 1) { scene.remove(evolveOrb); G.evolve = null; P.noDrain = !!G.tutor; }
    }
  }
  function evolveBurst() {
    const P = Player;
    grow();                                                   // the new, bigger car
    if (P.body) P.body.visible = true;
    // blow every vehicle nearby away, whatever its colour: no points, but coins
    let n = 0;
    for (const c of [...G.traffic, ...G.police]) {
      if (!c.alive) continue;
      const dx = c.x - P.x, dz = c.z - P.z, d = Math.hypot(dx, dz);
      if (d > EVOLVE_RADIUS) continue;
      const f = 34 * (1 - d / EVOLVE_RADIUS * .6), ux = dx / (d || 1), uz = dz / (d || 1);
      c.alive = false; if (c.ring) c.mesh.remove(c.ring);
      shedWheels(scene, c.mesh, c.x, c.z, c.h, ux * f, uz * f, 10);
      launchDebris(scene, c.mesh, c.x, c.z, c.h, ux * f, uz * f, 9 + rand(0, 6), 4.5, { spin: 1.8, flash: .1 });
      if (!(c instanceof Police) && !c.parked) G.respawnQueue.push(G.time + rand(2, 5));
      n++;
    }
    G.police = G.police.filter(c => c.alive);
    if (n) { G.bonusCoins = (G.bonusCoins || 0) + n * EVOLVE_COIN; UI.float(P.x, 3, P.z, `+${n * EVOLVE_COIN} coins`, 'gold'); }
    shockwave(scene, P.x, P.z, EVOLVE_RADIUS, 0xffffff); shockwave(scene, P.x, P.z, EVOLVE_RADIUS * .6, 0xffd23a);
    emit(P.x, 1.5, P.z, 90, [0xffffff, 0xffd23a, paintColor()], { speed: 26, up: 16, size: .3, life: 1.3 });
    G.shake = Math.max(G.shake, 1); G.fovKick = 12; G.kick = 1.6; UI.flash('white'); Sound.upgrade(); Sound.wreck();
  }
  function grow() {
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
    if (G.boss && G.boss.alive) G.boss.setThreat(Player.level);
    applyPropTier(t);
    const what = { 1: 'Sedans, lamp posts and bus stops are prey. Police send SUVs now.', 2: 'SUVs and trees go down. SWAT vans are coming for you.', 3: 'Trucks are prey. Buses and armoured vans match you, and the tanks are out.' }[t];
    if (G.mode === 'rampage') {
      const eat = { 1: 'Cars are food now!', 2: 'SUVs and trees are food now!', 3: 'Trucks are food now! Go wild.' }[t];
      const nxt = RAMPAGE.grow[t];
      UI.banner('YOU GREW!', `${TIERS[t].name}. ${eat}${nxt ? ` Smash ${nxt} more to grow again.` : ''}`, 'tier grew');
    } else UI.banner(TIERS[t].name + '!', what, 'tier');
  }

  // ---------- the boss ----------
  // It makes an entrance: it drives across the road just ahead of where you land, so you see it straight away.
  function spawnBoss() {
    removeBoss();
    const B = new Boss(scene), P = Player;
    if (World.map.arena) {
      // open ground: cross your path about 90 m ahead, left to right
      const sx = P.fz, sz = -P.fx;
      B.x = P.x + P.fx * 95 - sx * 40; B.z = P.z + P.fz * 95 - sz * 40; B.h = Math.atan2(sx, sz); B.v = B.cruise; B.sync();
    } else {
      // the road you land on runs east along j = SPAWN.z / CELL: cross it at the third junction ahead
      const j = Math.round(SPAWN.z / CELL), i = 3, d = { dx: 0, dz: 1 }, o = laneOff(d);
      const spot = { x: i * CELL + o.x, z: (j - 1) * CELL + CELL - 24 + o.z, d, next: { i, j } };
      B.place(spot);
    }
    B.setThreat(P.level); G.boss = B; G.bossSeen = false;
  }
  // the first time it's on screen: a beat of slow motion and a callout
  function bossReveal() {
    G.bossSeen = true; G.slow = Math.max(G.slow, .9);
    UI.banner('THERE IT IS!', 'The Iron Hauler. Boost into it to smash right through!', 'tier grew');
    Sound.star();
  }
  function hitBoss(B, res) {
    const P = Player;
    if (B.hurt > 0) return;                                    // still blinking from the last hit: you pass straight through
    if (!Ram.on) { bounce(B, 'hauler', res, B); return; }      // not boosting at speed: it's amber, so you bounce off
    // Power Ram: smash right through it. You keep your speed; it takes damage by your size, and blinks.
    const dmg = BOSS.dmg[P.tier] || BOSS.dmg[0];
    B.hp = Math.max(0, B.hp - dmg); B.hurt = BOSS.hurt;
    const side = Math.sign((B.x - P.x) * P.fz - (B.z - P.z) * P.fx) || 1;   // knock it aside, out of your path
    B.x += P.fz * side * 2.5; B.z -= P.fx * side * 2.5; B.v *= .3;
    G.shake = Math.max(G.shake, 1); G.hitPause = Math.max(G.hitPause, .12); G.kick = 1.6; G.fovKick = 10;
    UI.flash('gold'); Sound.wreck(); Sound.star();
    shockwave(scene, B.x, B.z, 14, 0xffd23a);
    emit(B.x, 2, B.z, 60, [0xffd23a, 0xff2e4d, 0x1a1c22, 0xffffff], { speed: 18, up: 12, size: .3, life: 1.1, vx: P.vx * .4, vz: P.vz * .4 });
    if (B.hp <= 0) { bossDown(B); return; }
    UI.float(B.x, 5, B.z, `SMASHED THROUGH! -${dmg}`, 'ram');
    if (!G.bossAngry) {                                       // it's angry now: it comes for you, and the police join in
      G.bossAngry = true; B.mode = 'chase';
      G.heat = Math.max(G.heat, HEAT_STARS[1]);
      UI.banner('IT\'S ANGRY!', 'The Iron Hauler is coming for you. Police are joining in.', 'tier');
    }
  }
  function bossDown(B) {
    const P = Player;
    B.alive = false; B.mesh.remove(B.ring);
    shedWheels(scene, B.mesh, B.x, B.z, B.h, P.vx * .5, P.vz * .5, 18);
    launchDebris(scene, B.mesh, B.x, B.z, B.h, P.vx * .6, P.vz * .6, 20, 6, { spin: 1.2, flash: .15 });
    for (const r of [10, 22, 36]) shockwave(scene, B.x, B.z, r, r > 20 ? 0xffffff : 0xffd23a);
    emit(B.x, 2, B.z, 160, [0xffd23a, 0xff7b00, 0xff2e4d, 0xffffff, 0x1a1c22], { speed: 30, up: 22, size: .5, life: 1.8 });
    G.slow = 2.2; G.shake = 1.6; UI.flash('white'); Sound.upgrade(); Sound.wreck();
    const used = RAMPAGE.time - G.timeLeft, stars = used <= BOSS.stars[0] ? 3 : used <= BOSS.stars[1] ? 2 : 1;
    const bonus = Math.round(G.timeLeft) * BOSS.timeBonus;
    G.score += BOSS.pts + bonus; G.pending += BOSS.pts + bonus;
    G.bonusCoins = (G.bonusCoins || 0) + stars * BOSS.coins;
    G.won = { stars, bonus };
    UI.banner('RAMPAGE COMPLETE!', `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}  ·  +${fmt(BOSS.pts)} + ${fmt(bonus)} time bonus`, 'tier grew');
    // the run ends in a slow-motion victory
    P.alive = false; Ram.on = false; Game.state = 'dying'; G.dyingT = 3.2;
    G.deathReason = `Rampage complete! ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)} The Iron Hauler is scrap`;
    G.police.forEach(p => p.remove()); G.police = []; Sound.siren(0);
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
    // wrecking a vehicle charges Boost (half as much if you're already boosting)
    if (type === 'car') P.addCharge((CHARGE_CAR + k.size * CHARGE_CAR_SIZE) * (P.boosting ? .5 : 1));
    // Rampage: every real smash is a bite; enough bites and you grow
    if (G.mode === 'rampage' && !tiny && P.alive) {
      G.bites += (type === 'car' ? RAMPAGE.biteCar : 1) * (obj.golden ? 3 : 1);
      if (TIERS[P.tier + 1] && G.bites >= RAMPAGE.grow[P.tier]) { G.bites = 0; G.growNext = true; }
    }
    if (ram) { coachSeen.rammed++; store.set('coach', coachSeen); }
    if (ram) { P.fuel -= RAM_DAMAGE * Garage.damage; G.shake = Math.max(G.shake, .5); UI.flash('gold'); }
    G.heat += k.pts * (obj instanceof Police ? 3 : 1) * (tiny ? TINY_PTS : 1) / HEAT_TIER[P.tier]; G.lastSmash = G.time;
    // launch it: punted off faster than you're going, flung to the side you clipped, spinning hard
    const sp = Math.hypot(P.vx, P.vz) || 1, fx = P.vx / sp, fz = P.vz / sp;
    const side = Math.sign((x - P.x) * fz - (z - P.z) * fx) || (Math.random() < .5 ? -1 : 1);   // which side of your nose it was on
    const gap = P.level - k.size;
    const push = 1.55 + gap * .3, lat = sp * (.3 + gap * .08) * side;
    const vx = P.vx * push + fz * lat, vz = P.vz * push - fx * lat;
    const up = kind === 'ped' ? rand(11, 15) : 7 + gap * 3.5 + rand(0, 3);
    const chain = tiny ? 0 : Math.min(G.combo, 10);           // every hit in a chain lands a little harder
    if (type === 'prop') {
      obj.alive = false; obj.respawnAt = G.time + 30; obj.batch.show(obj, false);
      launchDebris(scene, partsToGroup(obj.batch.parts), obj.x, obj.z, obj.rot, vx, vz, up, 4, { spin: 1.8, flash: .07 });
      if (kind === 'hydrant') emitters.push({ x: obj.x, z: obj.z, until: G.time + 2.5 });
    } else if (type === 'ped') {
      obj.alive = false; obj.respawnAt = G.time + 8;
      launchDebris(scene, pedGroup(obj.shirt, obj.skin), obj.x, obj.z, obj.h, vx, vz, up, 3.5, { spin: 2.2, flash: .06 });
    } else { // car or police: the body flies, the wheels come off
      obj.alive = false; obj.mesh.remove(obj.ring);
      shedWheels(scene, obj.mesh, obj.x, obj.z, obj.h, vx * .85, vz * .85, up);
      launchDebris(scene, obj.mesh, obj.x, obj.z, obj.h, vx * .85, vz * .85, up, 5, { spin: 1.6, flash: .08 });
      if (!(obj instanceof Police) && !obj.parked) G.respawnQueue.push(G.time + 3);
    }
    // plough on: a small surge with every real hit, so a chain speeds you up
    if (!tiny) {
      const T = TIERS[P.tier], cap = P.boosting ? T.boost * 1.05 : T.cruise + (T.boost - T.cruise) * .45, kick = 1.05 + k.size * .01;
      if (sp < cap) { const f = Math.min(kick, cap / sp); P.vx *= f; P.vz *= f; }
    }
    // juice
    const col = { ped: [obj.shirt || 0xffffff, 0xffffff], bin: [0x2f6b3c, 0xb5a17a, 0xdddddd], cone: [0xff6a00, 0xffffff], hydrant: [0x3aa0ff, 0xd62828],
      lamp: [0xffc46b, 0xffffff, 0x3a3f4a], busstop: [0x9fe0ff, 0xffffff], tree: [0x2a7a49, 0x5a3d2b] }[kind] || [obj.color || 0xcccccc, 0x333333, 0xffd23a];
    emit(x, 1, z, 14 + k.size * 10 + chain * 2, col, { speed: 8 + k.size * 2.5, up: 8 + k.size * 2, size: .16 + k.size * .08, vx: vx * .35, vz: vz * .35 });
    if (type === 'car') emit(x, 1, z, 18 + k.size * 6, [0xfff3b0, 0xffd23a, 0xffffff], { speed: 16, up: 9, size: .09, vx: P.vx * .5, vz: P.vz * .5, life: .45 });   // sparks
    if (!tiny) shockwave(scene, x, z, 3 + k.size * 1.6 + chain * .25, obj.golden ? 0xffd23a : Lighting.bright ? 0xffffff : 0xfff0d0);
    if (!tiny) {
      const boom = 1 + chain * .08;
      G.shake = Math.max(G.shake, (.14 + k.size * .1) * boom);
      G.hitPause = Math.max(G.hitPause, Math.min(.11, .028 + k.size * .014 + chain * .004));   // a beat of freeze on every real hit
      G.kick = Math.min(1.6, G.kick + (.35 + k.size * .2) * boom);                             // camera lurches into the hit
      G.fovKick = Math.min(9, G.fovKick + (2 + k.size * 1.2) * boom);
    }
    Sound.smash(kind, k.size); if (!tiny && G.combo > 1) Sound.combo(G.combo);
    const label = (ram ? 'POWER RAM ' : '') + `+${fmt(pts)}` + (gold > 1 ? ' GOLD' : '') + (!tiny && G.combo > 1 ? `  x${G.combo}` : '');
    addScore(pts, x, 2.5 + k.size * .6, z, label, tiny ? 'tiny' : gold > 1 ? 'gold' : ram ? 'ram' : boost > 1 ? 'boosted' : k.size === P.level ? 'big' : '');
    if (ram && P.fuel <= 0) die(`Rammed one ${KINDS[kind].name.toLowerCase()} too many`);
    if (G.growNext) { G.growNext = false; upgrade(); }
  }

  // ---------- coaching: the first few times, point out amber (boost through it) and red (steer clear) ----------
  const coachSeen = Object.assign({ amber: 0, red: 0, ram: 0, rammed: 0 }, store.get('coach', {}));
  function coach() {
    const P = Player, touchUI = matchMedia('(pointer: coarse)').matches;
    if (Ram.on) {
      if (!G.ramTold && coachSeen.ram < 6) { G.ramTold = true; coachSeen.ram++; store.set('coach', coachSeen); UI.coach('<span><b>Power Ram!</b></span>', 'ram', 1.6); }
      return;
    }
    G.ramTold = false;
    if (P.boosting) G.lastBoostAt = G.time;
    if (G.time < G.coachUntil || G.time - G.coachScan < .25) return;
    G.coachScan = G.time;
    // amber: whenever you haven't boosted for 10 s; red: once a run for your first few runs
    const wantAmber = G.time - G.lastBoostAt >= 10, wantRed = coachSeen.red < 6 && G.redTips < 1;
    if (!wantAmber && !wantRed) return;
    let best = null, bd = 34;
    const look = (x, z, th) => {
      if (th === 'smash') return;
      const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 6 || (dx * P.fx + dz * P.fz) / d < .8) return;   // only things right ahead of you
      if ((th === 'bounce' && wantAmber) || (th === 'wreck' && wantRed)) { best = th; bd = d; }
    };
    for (const c of G.traffic) if (c.alive) look(c.x, c.z, threatOf(c.size, P.level));
    for (const c of G.police) if (c.alive) look(c.x, c.z, threatOf(c.size, P.level));
    for (const it of World.props) if (it.alive && Math.abs(it.x - P.x) < 34 && Math.abs(it.z - P.z) < 34) look(it.x, it.z, it.batch.threat === 'wreck' ? 'bounce' : it.batch.threat);
    if (best === 'bounce' && P.charge < .25) {
      UI.coach(`<i class="cr amber"></i><span><b>Amber:</b> wreck cars to charge Boost</span>`, 'amber', 2.5);
      coachSeen.amber++; G.coachUntil = G.time + 10;
    } else if (best === 'bounce') {
      UI.coach(`<i class="cr amber"></i><span><b>Amber:</b> boost through it${touchUI ? '' : ' (Shift)'}</span>`, 'amber', 2.5);
      coachSeen.amber++; G.coachUntil = G.time + 10;
    } else if (best === 'wreck') {
      UI.coach(`<i class="cr red"></i><span><b>Red:</b> avoid it</span>`, 'red', 2.5);
      coachSeen.red++; G.redTips++; G.coachUntil = G.time + 9;
    }
    if (best) store.set('coach', coachSeen);
  }

  function bounce(obj, kind, res, mover) {
    const P = Player;
    P.x += res.nx * res.depth; P.z += res.nz * res.depth;
    const into = -(P.vx * res.nx + P.vz * res.nz);
    if (into > 0) { P.vx += res.nx * into * 1.5; P.vz += res.nz * into * 1.5; }
    if (mover) { mover.x -= res.nx * .4; mover.z -= res.nz * .4; mover.v *= .3; }
    if (P.invuln > 0) return;
    P.scaleSpeed(.45); P.drifting = false; if (!G.tutor) P.fuel -= BOUNCE_DAMAGE * Garage.damage; P.invuln = .9;
    G.shake = Math.max(G.shake, .5); Sound.bonk(); UI.flash('red');
    emit(P.x + res.nx * -1, 1.2, P.z - res.nz, 14, [0xffd23a, 0xffffff, 0xff7b00], { speed: 8, up: 6, size: .18 });
    const need = TIERS.find(t => TIERS.indexOf(t) + 1 >= KINDS[kind].size);
    if (P.fuel <= 0) die(`Wrecked by a ${KINDS[kind].name.toLowerCase()}`);
    else UI.toast(kind === 'hauler' ? 'Boost into it!' : `Too big! Grow to a ${need ? need.name : 'bigger ride'}`);
  }
  function onWall(into) {
    const P = Player;
    if (P.invuln > 0 || into < 12) { G.shake = Math.max(G.shake, .15); Sound.bonk(); return; }
    if (!G.tutor) P.fuel -= Math.min(BOUNCE_DAMAGE, into * 1.1) * Garage.damage; P.invuln = .7;
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
      if (th === 'wreck' && G.tutor) th = 'bounce';          // nothing wrecks you during the tutorial
      if (th === 'wreck' && G.time < (G.safeUntil || 0)) th = 'bounce';   // ...or just after you land from the launch
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

    } else if (type === 'loopIn') {
      if (!P.boosting) UI.coach(`<i class="cr amber"></i><span><b>Boost</b> round it!</span>`, 'amber', 1.5);
    } else if (type === 'loop') {
      const pts = LOOP_PTS * P.level;
      Sound.star(); Sound.combo(6); G.shake = Math.max(G.shake, .3); UI.flash('green');
      addScore(pts, P.x, 3, P.z, `LOOP! +${fmt(pts)}`, 'air');
      emit(P.x, 1, P.z, 30, [0xffd23a, 0xff7b00, 0xffffff], { speed: 10, up: 8, size: .2, life: .8 });
    } else if (type === 'loopfail') {
      if (v === 'roll') { Sound.bonk(); UI.coach(`<i class="cr amber"></i><span>Too slow. <b>Boost!</b></span>`, 'amber', 1.8); }
      else {
        Sound.wreck(); G.shake = Math.max(G.shake, .6); G.hitPause = Math.max(G.hitPause, .08);
        emit(P.x, .5, P.z, 30, [0x9aa0b5, 0xcfd3e0, paintColor()], { speed: 8, up: 5, size: .35, life: .8, grav: 4 });
        UI.coach(`<i class="cr red"></i><span><b>Fell off!</b> Keep boosting</span>`, 'red', 1.8);
      }
    } else if (type === 'loopreset') {
      UI.toast('Back to the loop');
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
    if (P.loop || G.evolve) return;   // up on a loop, or mid-evolution: nothing can touch you
    const B = G.boss;
    if (B && B.alive && P.y <= KINDS.hauler.ht) for (const c of P.circles()) {
      const res = circleOBB(c.x, c.z, c.r, B.x, B.z, B.h, B.hl, B.hw);
      if (res) { hitBoss(B, res); if (!P.alive) return; break; }
    }
    for (const it of hashQuery(P.x, P.z, P.half + 6)) {
      if (it.alive && testHit(it, 'prop', it.kind, it.x, it.z, it.rot, it.hl, it.hw)) if (!P.alive) return;
    }
    for (const p of Peds.list) {
      if (!p.alive || Math.abs(p.x - P.x) > P.half + 3 || Math.abs(p.z - P.z) > P.half + 3) continue;
      testHit(p, 'ped', 'ped', p.x, p.z, 0, PED_HIT, PED_HIT); if (!P.alive) return;
    }
    for (const c of [...G.traffic, ...G.police]) {   // sailing over a vehicle counts as a hop-over
      if (!c.alive || P.loop || P.y <= KINDS[c.kind].ht || G.time - (c.hopAt || -9) < 2) continue;
      if (Math.abs(c.x - P.x) > 12 || Math.abs(c.z - P.z) > 12) continue;
      if (P.circles().some(q => circleOBB(q.x, q.z, q.r, c.x, c.z, c.h, c.hl, c.hw))) {
        c.hopAt = G.time; addScore(30, c.x, 4, c.z, 'JUMPED IT +30', 'air');
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
        Sound.pickup(); UI.flash('green'); UI.toast('Tank refilled'); Missions.event('food');
        emit(f.x, 2, f.z, 30, [0x3dff8f, 0xff4fa3, 0xffffff], { speed: 9, up: 10, size: .3 });
        break;
      }
    }
  }

  // ---------- police heat ----------
  function updateHeat(dt) {
    if (G.time - G.lastSmash > 5) G.heat = Math.max(0, G.heat - HEAT_DECAY * dt * (1 + G.heat / 600));
    const stars = HEAT_STARS.filter(h => G.heat >= h).length;
    if (stars > G.stars) { Sound.star(); UI.toast(stars === 1 ? 'Police!' : 'More police!'); }
    G.stars = stars;
    const want = G.mode === 'rampage' && !G.bossAngry ? 0 : [0, 1, 1, 2][stars];   // a couple of chasers at most; in Rampage they wait for the boss fight
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
      camera.position.set(P.x + Math.sin(a) * r, P.y + 3.1 + Math.sin(titleA * .7) * .4, P.z + Math.cos(a) * r);   // same angle, up on the deck
      camera.lookAt(P.x + P.fx * 3, P.y + .6, P.z + P.fz * 3);
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
    if (G.introCam && Game.state === 'play') {
      const c = G.introCam; c.t += dt;
      const k = Math.min(1, c.t / 2.6), e = k * k * (3 - 2 * k);           // ease in and out
      const a = P.h + Math.PI + c.off * (1 - e), r = 8.5 + (T.camD - 8.5) * e;
      camera.position.set(P.x + Math.sin(a) * r, P.y + 3.1 + c.bob * (1 - e) + (T.camH - 3.1) * e, P.z + Math.cos(a) * r);
      look.set(P.x + P.fx * (3 + 4 * e), P.y + .6 + (.5 + T.camH * .15) * e, P.z + P.fz * (3 + 4 * e));
      camera.lookAt(look);
      const base = innerWidth < innerHeight ? 74 : 60;
      camera.fov += (base - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
      if (k >= 1 && !P.intro && P.y <= .02) { G.introCam = null; camPos.copy(camera.position); camYaw = P.h; }   // hand over to the chase cam
      return;
    }
    camD += (T.camD - camD) * Math.min(1, dt * 1.5); camH += (T.camH - camH) * Math.min(1, dt * 1.5);
    const sp = Math.hypot(P.vx, P.vz);
    // the camera trails the car's heading, so it swings wide in a slide
    camYaw += wrapAng(P.h - camYaw) * Math.min(1, dt * (P.drifting ? 2.4 : 5));
    const over = clamp((sp - T.cruise) / (T.boost - T.cruise), 0, 1);       // 0 at cruise, 1 flat-out on boost
    const back = camD * (1 + over * .3);                                       // boost pulls the camera back
    const want = new THREE.Vector3(P.x - Math.sin(camYaw) * back, camH * (1 - over * .12) + P.y * .7, P.z - Math.cos(camYaw) * back);
    // on a loop: pull up and back so you can watch the car go round (the track is see-through)
    if (P.loop) { const S = P.loop.S, R = S.R || LOOP_R, lat = -LOOP_SHIFT / 2 - 5; want.set(S.x + S.sx * lat - S.fx * (R * 2 + 2), R * 2 + 3, S.z + S.sz * lat - S.fz * (R * 2 + 2)); }
    camPos.lerp(want, Math.min(1, dt * (P.loop ? 3 : 9)));
    const wall = P.outside || P.intro ? null : pushOutOfBuildings(camPos.x, camPos.z, .6);   // never end up inside a tower
    if (wall) { camPos.x = wall.x; camPos.z = wall.z; }
    camera.position.copy(camPos);
    // rumble that grows with speed, plus impact shake
    const rumble = .015 * clamp(sp / T.cruise, 0, 1.2) + over * .05;
    const s = rumble + G.shake * .6;
    camera.position.x += rand(-s, s); camera.position.y += rand(-s, s) * .6; camera.position.z += rand(-s, s);
    G.shake = Math.max(0, G.shake - dt * 2.2);
    camera.position.x += P.fx * G.kick; camera.position.z += P.fz * G.kick; camera.position.y -= G.kick * .25;   // lurch into a hit
    G.kick *= Math.exp(-dt * 11); G.fovKick *= Math.exp(-dt * 7);
    look.set(P.x + P.fx * 7, 1.1 + T.camH * .15 + P.y * .8, P.z + P.fz * 7);
    if (P.loop) { const S = P.loop.S; look.set(S.x, (S.R || LOOP_R) * .9, S.z); }
    camera.lookAt(look);
    camera.rotateZ(clamp(P.yawRate * .035, -.1, .1));                         // lean into turns
    const base = innerWidth < innerHeight ? 74 : 60;
    const fov = base + clamp(sp / T.cruise, 0, 1) * 7 + over * 18 + P.dashT * 20 + G.fovKick;
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
    const rdt = dt;
    if (Game.state === 'paused') { renderer.render(scene, camera); return; }
    if (G.hitPause > 0) { G.hitPause -= dt; renderer.render(scene, camera); return; }
    if (G.slow > 0) { G.slow -= dt; dt *= .35; }
    if (G.tutor && G.tutor.wait) dt *= .1;   // tutorial: the world crawls until you do what it asks
    if (G.evolve && !G.evolve.blown) dt *= .25;   // evolving: everything slows while the orb swells
    if (G.evolve && Game.state === 'play') updateEvolve(rdt);
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
      if (G.afterLanding && !Player.intro && Player.y <= .02) {   // touchdown: a moment's grace, the intro, and (in Rampage) the bounty
        const f = G.afterLanding; G.afterLanding = null; G.safeUntil = G.time + 2.5; f();
        if (G.mode === 'rampage') spawnBoss();
      }
      tutorUpdate(dt);
      if (!G.tutor) coach();
      if (playing && Player.alive && Player.fuel <= 0 && Player.speed < 1.5) die('Tank ran dry');
      if (G.mode === 'rampage' && playing && Player.alive && !G.tutor && !G.afterLanding) {   // the clock starts once you've landed
        if (G.time > RAMPAGE.grace) Player.hunger = RAMPAGE.hunger;
        G.timeLeft -= dt; if (G.timeLeft <= 0) { G.timeLeft = 0; timeUp(); }
      }
      if (G.comboTimer > 0) { G.comboTimer -= dt; if (G.comboTimer <= 0) { G.combo = 0; G.pending = 0; } }
      updateHeat(dt);
      // respawn smashed props and cars away from the player
      for (const it of World.props) if (!it.alive && !it.locked && t > it.respawnAt && Math.hypot(it.x - Player.x, it.z - Player.z) > 70) { it.alive = true; it.batch.show(it, true); }
      recycleTraffic(t);
      G.respawnQueue = (G.respawnQueue || []).filter(at => { if (t > at) { spawnTraffic(90); return false; } return true; });
    }
    if (dying) { G.dyingT -= dt; if (G.dyingT <= 0) gameOver(); }

    updateLots(who);
    G.traffic = G.traffic.filter(c => c.alive);
    for (const c of G.traffic) c.update(dt, G.traffic, who);
    for (const p of G.police) p.update(dt, G.traffic, who, t);
    if (G.boss && G.boss.alive) G.boss.update(dt, G.traffic, who, t);
    for (const f of G.food) f.update(dt, t, who.x, who.z);
    updatePeds(dt, who, t);
    updateDebris(dt); updateShocks(dt);
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
      if (UI.boss(G, Player, camera) && playing && !G.bossSeen) bossReveal();
    } else { Sound.engine(0, 0, false, false); Sound.screech(0); $('speedlines').style.opacity = 0; $('foodArrow').classList.remove('on'); $('bossArrow').classList.remove('on'); }
    UI.updateFloats(dt);
    renderer.render(scene, camera);
  }

  // ---------- buttons ----------
  $('playBtn').addEventListener('click', () => { Full.onDrive(); startRun(); });
  $('againBtn').addEventListener('click', () => { Full.onDrive(); startRun(); });
  Full.init();
  $('menuBtn').addEventListener('click', toTitle);
  $('resumeBtn').addEventListener('click', () => { Game.state = 'play'; UI.show(null); Sound.duck(false); });
  $('quitBtn').addEventListener('click', () => { Sound.siren(0); Sound.duck(false); toTitle(); });
  $('pauseBtn').addEventListener('click', () => Game.onPauseKey());
  document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => {
    Settings.mode = b.dataset.mode; store.set('mode', Settings.mode);
    UI.title(curBest(), save.coins, save.paint, save.owned);
  }));
  $('settingsBtn').addEventListener('click', () => UI.openSheet('settings'));
  document.querySelectorAll('.set-row[data-open]').forEach(b => b.addEventListener('click', () => UI.openSheet(b.dataset.open)));
  document.querySelectorAll('[data-steer]').forEach(b => b.addEventListener('click', () => {
    Settings.steer = b.dataset.steer; store.set('steer4', Settings.steer); UI.wheel();
    Missions.swapDrift();
    UI.title(curBest(), save.coins, save.paint, save.owned);
    UI.toast({ stick: 'Joystick: push it left or right to turn', wheel: 'Wheel: slide your left thumb across the wheel to turn', buttons: 'Buttons: hold or slide across ◀ ▶', simple: 'Simple: hold left or right of the screen to turn', easy: 'Drag: drag from where you touch to turn', drift: 'Drift: drag to turn; hard turns at speed slide' }[Settings.steer]);
  }));
  $('muteBtn').addEventListener('click', () => { Sound.setMuted(!Sound.muted); UI.title(curBest(), save.coins, save.paint, save.owned); });
  $('paints').addEventListener('click', e => {
    const b = e.target.closest('.paint'); if (!b) return;
    const p = PAINTS.find(p => p.id === b.dataset.id);
    if (!save.owned.includes(p.id)) {
      if (save.coins < p.cost) { UI.toast(`Need ${fmt(p.cost - save.coins)} more coins`); return; }
      save.coins -= p.cost; save.owned.push(p.id); store.set('coins', save.coins); store.set('owned', save.owned);
    }
    save.paint = p.id; store.set('paint', p.id);
    if (Game.state === 'title') parkCar();
    UI.title(curBest(), save.coins, save.paint, save.owned);
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
  $('tutorAgain').addEventListener('click', () => { store.set('tutorDone', false); UI.closeSheet(); UI.toast('The tutorial will play on your next drive'); });
  document.querySelectorAll('.nav-btn[data-sheet]').forEach(b => b.addEventListener('click', () => UI.openSheet(b.dataset.sheet)));
  document.querySelectorAll('.st-tab').forEach(t => t.addEventListener('click', () => { UI.shopTab = t.dataset.tab; UI.openSheet('shop'); }));
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
    UI.title(curBest(), save.coins, save.paint, save.owned);
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
