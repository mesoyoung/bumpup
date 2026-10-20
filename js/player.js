// ============================================================
// player.js — the player's vehicle: Crazy-Taxi-style arcade
// physics (dash launches, speed-keeping power slides, ramps and
// air), growing between tiers, and keyboard / touch input.
// ============================================================

const Input = { steer: 0, boost: false, brake: false, hop: false, keys: {}, kSteer: 0, touch: null, lastTap: null, pointers: new Set() };

// ---------- One-finger touch gestures ----------
//   drag left/right ............ steer (hard drag at speed = slide)
//   double-tap and hold ........ boost (release to stop)
//   swipe up ................... hop
//   two fingers ................ pause
function initInput(canvas) {
  const K = Input.keys;
  addEventListener('keydown', e => {
    if (!K[e.code] && (e.code === 'ArrowUp' || e.code === 'KeyW')) Input.hop = true;
    K[e.code] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
    if ((e.code === 'Escape' || e.code === 'KeyP') && Game.onPauseKey) Game.onPauseKey();
  });
  addEventListener('keyup', e => { K[e.code] = false; });
  addEventListener('blur', () => { for (const k in K) K[k] = false; endTouch(); });

  const now = () => performance.now() / 1000;
  const hint = $('steerHint'), knob = $('steerKnob');
  function endTouch() {
    Input.touch = null; Input.boost = false; Input.brake = false;
    hint.classList.remove('on', 'boost', 'brake'); knob.style.transform = '';
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    Input.pointers.add(e.pointerId);
    if (Input.pointers.size >= 2) { endTouch(); if (Game.onPauseKey) Game.onPauseKey(); return; }
    const t = now(), L = Input.lastTap;
    const dbl = L && t - L.t < TAP_GAP && Math.hypot(e.clientX - L.x, e.clientY - L.y) < 70;
    Input.touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ox: e.clientX, t0: t, mode: dbl ? 'boost' : 'steer', moved: 0, swiped: false };
    Input.lastTap = null;
    if (dbl) Input.boost = true;
    hint.classList.add('on'); hint.classList.toggle('boost', dbl);
    hint.style.left = e.clientX + 'px'; hint.style.top = e.clientY + 'px';
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  });
  canvas.addEventListener('pointermove', e => {
    const T = Input.touch; if (!T || e.pointerId !== T.id) return;
    const dx = e.clientX - T.x0, dy = e.clientY - T.y0, age = now() - T.t0;
    T.moved = Math.max(T.moved, Math.hypot(dx, dy));
    // a quick, mostly-vertical flick is a swipe; steering restarts from where the finger is
    if (!T.swiped && age < SWIPE_TIME && Math.abs(dy) > SWIPE_PX && Math.abs(dy) > Math.abs(dx) * 1.4) {
      T.swiped = true; T.ox = e.clientX;
      if (dy < 0) Input.hop = true;   // swipe up = hop (swipe down does nothing)
    }
    const sx = e.clientX - T.ox;
    knob.style.transform = `translateX(${clamp(sx / STEER_PX, -1, 1) * 34}px)`;
  });
  const up = e => {
    Input.pointers.delete(e.pointerId);
    const T = Input.touch; if (!T || e.pointerId !== T.id) return;
    const t = now();
    // a short, still touch is a tap: remember it so the next touch can become a double-tap
    if (t - T.t0 < .22 && T.moved < 14 && T.mode === 'steer') Input.lastTap = { t, x: e.clientX, y: e.clientY };
    endTouch();
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointermove', e => { if (Input.touch && e.pointerId === Input.touch.id) Input.touch.cx = e.clientX; });
}

function readInput(dt) {
  const K = Input.keys, T = Input.touch;
  // keyboard steering ramps in, so quick taps grip and a held key slides
  let ks = 0;
  if (K.ArrowLeft || K.KeyA) ks -= 1;
  if (K.ArrowRight || K.KeyD) ks += 1;
  Input.kSteer = ks ? clamp(Input.kSteer + ks * dt * 5, -1, 1) : 0;
  if (ks && Math.sign(Input.kSteer) !== ks) Input.kSteer = ks * .2;
  let ts = 0;
  if (T && T.cx != null) { const sx = T.cx - T.ox; ts = Math.abs(sx) < 6 ? 0 : clamp(sx / STEER_PX, -1, 1); }
  Input.steer = Input.kSteer || ts;
  const kb = !!(K.ShiftLeft || K.ShiftRight || K.Space);
  Input.boost = (T && T.mode === 'boost') || kb;
  Input.brake = false;   // no brake: Crazy Dash = boost from slow; getting stuck backs you off automatically
}

const Player = {
  alive: false,
  build(scene, paint) {
    this.scene = scene; this.paint = paint;
    if (this.mesh) scene.remove(this.mesh);
    const T = TIERS[this.tier];
    this.mesh = new THREE.Group();
    // body sits in a pivot so it can pitch and roll on its "suspension"
    this.body = partsToGroup(VEHICLE_PARTS[T.key](paint, true));
    this.mesh.add(this.body);
    const len = T.circ.o[T.circ.o.length - 1] - T.circ.o[0] + T.circ.r * 2;
    this.half = len / 2;
    this.glow = new THREE.Mesh(GEO.disc, new THREE.MeshBasicMaterial({ color: paint, map: GLOW_TEX, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.glow.scale.set(T.circ.r * 2.4, 1, this.half * 1.5); this.glow.position.y = .07;
    this.beam = new THREE.Mesh(GEO.disc, new THREE.MeshBasicMaterial({ color: 0xfff1cc, map: GLOW_TEX, transparent: true, opacity: .35, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.beam.scale.set(T.circ.r * 3.2, 1, 14); this.beam.position.set(0, .08, this.half + 11);
    // exhaust flames (shown while boosting / dashing)
    this.flames = new THREE.Group();
    const fy = T.key === 'bus' ? 1 : T.key === 'pickup' ? 1.4 : T.key === 'suv' ? .7 : .5;
    for (const sx of [-.45, .45]) {
      const outer = new THREE.Mesh(GEO.cone, basic(0xff7b1c, { transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false }));
      outer.rotation.x = -Math.PI / 2; outer.scale.set(.42, 1.6, .42); outer.position.set(sx * T.circ.r, fy, -this.half - .75);
      const core = new THREE.Mesh(GEO.cone, basic(0x8fe3ff, { transparent: true, opacity: .9, blending: THREE.AdditiveBlending, depthWrite: false }));
      core.rotation.x = -Math.PI / 2; core.scale.set(.22, .9, .22); core.position.set(sx * T.circ.r, fy, -this.half - .4);
      this.flames.add(outer, core);
    }
    this.flames.visible = false; this.mesh.add(this.flames);
    scene.add(this.mesh, this.glow, this.beam); // ground glows stay on the ground when the car jumps
    this.sync();
  },
  reset(scene, paint) {
    if (this.glow) scene.remove(this.glow, this.beam);
    this.tier = 0; this.level = 1;
    this.x = START.x; this.z = START.z; this.h = Math.PI / 2;
    this.vx = 0; this.vz = 0; this.y = 0; this.vy = 0; this.yawRate = 0; this.speed = 0;
    this.fuelMax = Garage.fuelMax; this.fuel = this.fuelMax; this.invuln = 0; this.alive = true;
    this.grow = 1; this.roll = 0; this.pitch = 0; this.boosting = false; this.boostHold = 0; this.drifting = false;
    this.driftT = 0; this.brakeT = 0; this.reversing = false; this.stuckT = 0; this.unstuckT = 0; this.hopCD = 0; this.dashT = 0; this.dashCD = 0; this.air = 0;
    this.prevBrake = false; this.prevBoost = false; this.lastFwd = 0;
    this.fx = 1; this.fz = 0; this.lateral = 0;
    this.build(scene, paint);
  },
  setTier(t) {
    this.tier = t; this.level = t + 1; this.fuel = this.fuelMax;   // growing tops up the tank
    this.scene.remove(this.glow, this.beam);
    this.build(this.scene, this.paint);
    this.grow = 0; // play the growth animation
  },
  scaleSpeed(f) { this.vx *= f; this.vz *= f; },
  hop(v) { if (this.y < .05) this.vy = Math.max(this.vy, v); },
  circles() {
    const T = TIERS[this.tier], out = [];
    for (const o of T.circ.o) out.push({ x: this.x + this.fx * o, z: this.z + this.fz * o, r: T.circ.r });
    return out;
  },

  // onWall(impactSpeed), onTrick(type, value)
  update(dt, onWall, onTrick) {
    const T = TIERS[this.tier];
    const grounded = this.y <= .02;
    let fx = Math.sin(this.h), fz = Math.cos(this.h);
    // split velocity into forward and sideways parts
    let vF = this.vx * fx + this.vz * fz;
    let vL = this.vx * fz - this.vz * fx;
    const outOfFuel = this.fuel <= 0;

    // ---- Crazy Dash: boost from a near-stop ----
    this.dashCD = Math.max(0, this.dashCD - dt);
    const brakeReleased = this.prevBrake && !Input.brake;
    const boostPressed = Input.boost && !this.prevBoost;
    if (!outOfFuel && grounded && this.dashCD <= 0 && vF < DASH_BELOW && (brakeReleased && this.brakeT > .12 || boostPressed)) {
      vF = Math.max(vF, T.cruise * DASH_KICK); vL *= .3; this.dashT = .55; this.dashCD = .9;
      this.fuel = Math.max(0, this.fuel - 2); this.reversing = false;
      onTrick('dash');
    }
    this.brakeT = Input.brake ? this.brakeT + dt : 0;

    // ---- Hop: jump over things you can't smash yet ----
    this.hopCD = Math.max(0, (this.hopCD || 0) - dt);
    if (Input.hop && grounded && this.hopCD <= 0) { this.vy = T.hopV * Garage.hop; this.hopCD = .55; onTrick('hop'); }
    Input.hop = false;

    // ---- Unstuck: nose against a wall for a moment -> back off and swing round ----
    if (grounded && !Input.brake && !outOfFuel && Math.abs(vF) < 3 && this.unstuckT <= 0) this.stuckT = (this.stuckT || 0) + dt; else this.stuckT = 0;
    if (this.stuckT > .9) { this.unstuckT = .75; this.stuckT = 0; this.unstuckDir = Math.random() < .5 ? -1 : 1; }
    this.unstuckT = Math.max(0, (this.unstuckT || 0) - dt);
    const autoBack = this.unstuckT > 0;

    // ---- Every hard turn at speed slides; the slide ends when you ease off ----
    const steerAmt = Math.abs(Input.steer);
    if (!this.drifting && grounded && vF > SLIDE_MIN_SPEED && steerAmt > T.slideAt) { this.drifting = true; this.driftT = 0; }
    if (this.drifting) {
      this.driftT += dt;
      if (steerAmt < .3 || vF < 8 || Input.brake) {
        // exit: the longer the slide, the bigger the kick out of it
        if (this.driftT > .5 && !Input.brake) { vF += Math.min(12, this.driftT * 6); onTrick('drift', this.driftT); }
        this.drifting = false; this.driftT = 0;
      }
    }
    // boost carries on for a moment after you let go, so you can line up a ram and then steer
    if (Input.boost) this.boostHold = BOOST_LINGER;
    else this.boostHold = Math.max(0, (this.boostHold || 0) - dt);
    if (Input.brake || autoBack) this.boostHold = 0;
    this.boosting = (Input.boost || this.boostHold > 0) && !outOfFuel && !Input.brake && !autoBack;

    // ---- throttle (auto) / brake / reverse / nitro ----
    if (grounded) {
      // hold brake at a standstill to reverse
      if (Input.brake && vF < .8 && this.brakeT > .35) this.reversing = true;
      if (!Input.brake) this.reversing = false;
      const target = autoBack ? -REVERSE_SPEED : outOfFuel ? 0 : this.reversing ? -REVERSE_SPEED : Input.brake ? 0 : this.boosting ? T.boost * Garage.boostSpeed : T.cruise;
      const cur = this.drifting ? Math.hypot(vF, vL) : vF;   // in a slide, throttle works on total speed
      let next = cur;
      if (cur < target) {
        const pull = T.accel * (cur < 12 ? 1.5 : 1) * (this.boosting ? 1.4 : 1) * (1 - .5 * clamp(cur / (T.boost * Garage.boostSpeed + 4), 0, 1));
        next = Math.min(target, cur + pull * dt);
      } else {
        const drag = Input.brake || autoBack ? 46 : outOfFuel ? 7 : this.drifting ? 3 : 14;
        next = Math.max(target, cur - drag * dt);
      }
      if (this.drifting && cur > .1) { vF *= next / cur; vL *= next / cur; } else vF = next;
    }

    // ---- steering: snappy at low speed, slight understeer flat-out, wild in a slide ----
    const speedF = clamp(Math.abs(vF) / 7, 0, 1) * (1 - .3 * clamp((vF - 25) / 25, 0, 1));
    const steerIn = autoBack ? this.unstuckDir : Input.steer;
    let want = -steerIn * T.steer * speedF * (this.drifting ? DRIFT_STEER : 1) * (vF < -.5 ? -1 : 1);
    if (!grounded) want *= .35;
    this.yawRate += (want - this.yawRate) * Math.min(1, (this.drifting ? 6 : 12) * dt);
    this.h = wrapAng(this.h + this.yawRate * dt);
    // the car turned but momentum didn't: re-split velocity against the new heading
    const nfx = Math.sin(this.h), nfz = Math.cos(this.h);
    const wx = fx * vF + fz * vL, wz = fz * vF - fx * vL;
    vF = wx * nfx + wz * nfz; vL = wx * nfz - wz * nfx;
    fx = nfx; fz = nfz;

    // ---- grip: swing the momentum toward where the nose points, keeping most of the speed ----
    if (grounded && vF < .5) {
      vL *= Math.exp(-T.grip * dt);
    } else if (grounded) {
      const mag = Math.hypot(vF, vL);
      let a = Math.atan2(vL, Math.max(vF, .01));                        // slip angle
      a *= Math.exp(-(this.drifting ? T.dgrip : T.grip) * dt);
      if (this.drifting && Math.abs(a) > .8) {                          // don't spin out: cap the slide angle
        a = Math.sign(a) * .8;
        if (Math.sign(this.yawRate) === -Math.sign(a)) this.yawRate *= .8;
      }
      const keep = this.drifting ? 1 - (1 - DRIFT_KEEP) * Math.abs(a) * dt : 1 - .25 * Math.abs(a) * dt;
      vF = Math.cos(a) * mag * keep; vL = Math.sin(a) * mag * keep;
    }
    this.vx = fx * vF + fz * vL; this.vz = fz * vF - fx * vL;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.fx = fx; this.fz = fz; this.lateral = vL; this.speed = Math.hypot(this.vx, this.vz);

    // ---- ramps and air ----
    if (grounded && vF > 8) for (const r of World.ramps) {
      if (!circleOBB(this.x, this.z, .5, r.x, r.z, r.rot, r.hl, r.hw)) continue;
      const along = this.vx * Math.sin(r.rot) + this.vz * Math.cos(r.rot);
      if (along > 8) { this.vy = along * .42 + 4; this.air = 0; this.fromRamp = true; onTrick('launch'); }
      break;
    }
    if (this.y > 0 || this.vy > 0) {
      this.vy -= GRAVITY * dt; this.y += this.vy * dt; this.air += dt;
      if (this.y <= 0) {
        this.y = 0;
        if (this.vy < -9) { onTrick('land', this.air, this.fromRamp); this.pitch -= .12; }
        this.vy = 0; this.air = 0; this.fromRamp = false;
      }
    }

    // ---- buildings and city edge ----
    for (const c of this.circles()) {
      const hit = pushOutOfBuildings(c.x, c.z, c.r);
      if (!hit) continue;
      this.x += hit.x - c.x; this.z += hit.z - c.z;
      const into = -(this.vx * hit.nx + this.vz * hit.nz);
      if (into > 0) {
        this.vx += hit.nx * into * 1.25; this.vz += hit.nz * into * 1.25;
        if (into > 7) { onWall(into); this.scaleSpeed(.6); }
        if (this.drifting && into > 7) { this.drifting = false; this.driftT = 0; }
      }
    }

    this.fuel = Math.max(0, this.fuel - (FUEL_DRAIN * (1 + FUEL_TIER * this.tier) + (this.boosting ? BOOST_DRAIN * Garage.boostDrain : 0)) * dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.dashT = Math.max(0, this.dashT - dt);

    // ---- suspension feel: lean into turns, squat on launch, dive on brakes ----
    const accelF = (vF - this.lastFwd) / Math.max(dt, 1e-3); this.lastFwd = vF;
    const rollT = clamp(-vL * .025 - this.yawRate * vF * .006, -.2, .2);
    const pitchT = grounded ? clamp(-accelF * .004, -.12, .1) : clamp(-this.vy * .02, -.25, .25);
    this.roll += (rollT - this.roll) * Math.min(1, 9 * dt);
    this.pitch += (pitchT - this.pitch) * Math.min(1, 7 * dt);
    if (this.grow < 1) this.grow = Math.min(1, this.grow + dt * 1.6);
    this.prevBrake = Input.brake; this.prevBoost = Input.boost;
    this.sync();
  },
  sync() {
    if (!this.mesh) return;
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.set(0, this.h, 0);
    this.body.rotation.set(this.pitch, 0, this.roll);
    const g = this.grow, s = g >= 1 ? 1 : .55 + .45 * (1 - Math.pow(2, -10 * g) * Math.cos(g * 14));
    this.mesh.scale.setScalar(s);
    this.mesh.visible = this.invuln <= 0 || Math.floor(this.invuln * 14) % 2 === 0;
    if (this.flames) {
      const on = this.boosting || this.dashT > 0;
      this.flames.visible = on;
      if (on) this.flames.children.forEach((c, i) => { c.scale.y = (i % 2 ? .9 : 1.6) * (.7 + Math.random() * .6) * (this.dashT > 0 ? 1.5 : 1); });
    }
    if (this.glow) {
      this.glow.position.set(this.x, .07, this.z); this.glow.rotation.y = this.h;
      this.glow.material.opacity = .75 / (1 + this.y * .4);
      this.glow.material.color.setHex(Ram.on ? 0xffd23a : this.paint);
      this.beam.position.set(this.x + this.fx * (this.half + 11), .08, this.z + this.fz * (this.half + 11)); this.beam.rotation.y = this.h;
      this.beam.visible = this.y < 1;
    }
  },
};
