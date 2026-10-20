// ============================================================
// ui.js — HUD, minimap, floating score text, banners and the
// title / pause / game-over screens.
// ============================================================

const UI = {
  floats: [],
  init() {
    this.mini = $('minimap').getContext('2d');
    this.v = new THREE.Vector3();
    // tier track
    $('tierTrack').innerHTML = TIERS.map((t, i) => `<div class="pip" data-i="${i}"><span class="pip-dot"></span><span class="pip-name">${t.name}</span></div>`).join('');
  },

  show(screen) {
    for (const id of ['titleScreen', 'pauseScreen', 'overScreen']) $(id).hidden = id !== screen;
    if (screen !== 'titleScreen') this.closeSheet();
    $('hud').hidden = !(screen === null || screen === 'pauseScreen');
  },

  // ---------- HUD ----------
  hud(G, P) {
    $('score').textContent = fmt(G.score);
    const comboOn = G.combo > 1 && G.comboTimer > 0;
    $('combo').classList.toggle('on', comboOn);
    $('comboX').textContent = 'x' + G.combo;
    $('comboBar').style.transform = `scaleX(${clamp(G.comboTimer / Garage.comboWindow, 0, 1)})`;

    const cur = TIERS[P.tier], nxt = TIERS[P.tier + 1];
    const frac = nxt ? clamp((G.score - cur.at) / (nxt.at - cur.at), 0, 1) : 1;
    $('upFill').style.transform = `scaleX(${frac})`;
    $('upLabel').textContent = nxt ? `${nxt.name} at ${fmt(nxt.at)}` : 'Max size';
    document.querySelectorAll('.pip').forEach(p => {
      const i = +p.dataset.i; p.classList.toggle('done', i < P.tier); p.classList.toggle('cur', i === P.tier);
    });
    const pend = $('pending');
    if (G.pending > 0) { pend.textContent = '+' + fmt(G.pending); pend.classList.add('on'); } else pend.classList.remove('on');

    $('hpFill').style.transform = `scaleX(${P.health / 100})`;
    $('hpBar').classList.toggle('low', P.health <= 34);
    $('fuelFill').style.transform = `scaleX(${P.fuel / P.fuelMax})`;
    $('fuelBar').classList.toggle('low', P.fuel / P.fuelMax < .25);
    $('speed').textContent = Math.round(Math.hypot(P.vx, P.vz) * 3.6);
    $('boostTag').classList.toggle('on', P.boosting);
    $('ramTag').classList.toggle('on', Ram.on);
    document.body.classList.toggle('ramming', Ram.on);
    $('driftTag').classList.toggle('on', P.drifting);
    const stars = document.querySelectorAll('#stars i');
    stars.forEach((s, i) => s.classList.toggle('on', i < G.stars));
    $('stars').classList.toggle('hot', G.stars > 0);
  },

  // ---------- minimap (north up, centred on the player) ----------
  minimap(G, P) {
    const c = this.mini, W = 150, R = 130, sc = W / (R * 2);
    const X = x => W / 2 + (x - P.x) * sc, Y = z => W / 2 + (z - P.z) * sc;
    c.clearRect(0, 0, W, W);
    c.save(); c.beginPath(); c.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2); c.clip();
    c.fillStyle = 'rgba(8,11,22,.88)'; c.fillRect(0, 0, W, W);
    for (const b of World.blocks) {
      c.fillStyle = b.type === 'park' ? '#173322' : '#232838';
      c.fillRect(X(b.x0), Y(b.z0), (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
    }
    // food trucks: a green cross, pinned to the rim with a pulse when it's off the map
    for (const f of G.food) if (f.alive) {
      let mx = X(f.x), my = Y(f.z);
      const ox = mx - W / 2, oy = my - W / 2, d = Math.hypot(ox, oy), rim = W / 2 - 9;
      const off = d > rim;
      if (off) { mx = W / 2 + ox / d * rim; my = W / 2 + oy / d * rim; }
      if (off) { c.strokeStyle = 'rgba(61,255,143,' + (.4 + .4 * Math.abs(Math.sin(G.time * 4))) + ')'; c.lineWidth = 2; c.beginPath(); c.arc(mx, my, 7, 0, 7); c.stroke(); }
      c.fillStyle = '#3dff8f'; c.fillRect(mx - 4, my - 1.5, 8, 3); c.fillRect(mx - 1.5, my - 4, 3, 8);
    }
    for (const car of G.traffic) if (car.alive) {
      c.fillStyle = car.golden ? '#ffd23a' : '#' + THREAT[threatOf(car.size, P.level)].toString(16).padStart(6, '0');
      c.fillRect(X(car.x) - 2, Y(car.z) - 2, 4, 4);
    }
    for (const p of G.police) { c.fillStyle = Math.floor(G.time * 6) % 2 ? '#ff1a3c' : '#2a6bff'; c.beginPath(); c.arc(X(p.x), Y(p.z), 3.5, 0, 7); c.fill(); }
    c.translate(W / 2, W / 2); c.rotate(-P.h + Math.PI);
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(0, -7); c.lineTo(5, 6); c.lineTo(0, 3); c.lineTo(-5, 6); c.closePath(); c.fill();
    c.restore();
  },

  // ---------- arrow to the nearest food truck when you're low on fuel or health ----------
  foodArrow(G, P) {
    const el = $('foodArrow');
    const need = P.alive && (P.fuel / P.fuelMax < .35 || P.health <= 40);
    let best = null, bd = 1e9;
    if (need) for (const f of G.food) if (f.alive) { const d = Math.hypot(f.x - P.x, f.z - P.z); if (d < bd) { bd = d; best = f; } }
    if (!best || bd < 35) { el.classList.remove('on'); return; }
    const dx = best.x - P.x, dz = best.z - P.z;
    const lx = dx * -P.fz + dz * P.fx, ly = dx * P.fx + dz * P.fz;   // right / forward relative to the car
    const a = Math.atan2(lx, ly), W = innerWidth, H = innerHeight;
    // keep clear of the HUD: below the score/upgrade bar/minimap, above the gauges
    const y0 = W < 641 ? 230 : 140, y1 = H - 200, cy = (y0 + y1) / 2, ry = (y1 - y0) / 2, rx = W / 2 - 60;
    el.style.transform = `translate(${W / 2 + Math.sin(a) * rx}px, ${cy - Math.cos(a) * ry}px) translate(-50%, -50%)`;
    $('foodArrowIcon').style.transform = `rotate(${a}rad)`;
    $('foodArrowDist').textContent = Math.round(bd) + ' m';
    el.classList.add('on');
  },

  // ---------- floating "+50" at the impact point ----------
  float(x, y, z, text, cls) {
    const el = document.createElement('div');
    el.className = 'float ' + (cls || ''); el.textContent = text;
    $('floats').appendChild(el);
    this.floats.push({ el, x, y, z, t: 0 });
  },
  updateFloats(dt, camera) {
    const W = innerWidth, H = innerHeight;
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i]; f.t += dt;
      if (f.t > 1.1) { f.el.remove(); this.floats.splice(i, 1); continue; }
      this.v.set(f.x, f.y + f.t * 3, f.z).project(camera);
      if (this.v.z > 1) { f.el.style.opacity = 0; continue; }
      f.el.style.transform = `translate(${(this.v.x + 1) / 2 * W}px, ${(1 - this.v.y) / 2 * H}px) translate(-50%,-50%) scale(${1 + Math.max(0, .3 - f.t)})`;
      f.el.style.opacity = f.t > .75 ? (1.1 - f.t) / .35 : 1;
    }
  },
  clearFloats() { for (const f of this.floats) f.el.remove(); this.floats = []; },

  banner(big, small, cls) {
    const b = $('banner');
    b.className = 'banner ' + (cls || '');
    $('bannerBig').textContent = big; $('bannerSmall').textContent = small || '';
    void b.offsetWidth; b.classList.add('on');
    clearTimeout(this.bt); this.bt = setTimeout(() => b.classList.remove('on'), 2200);
  },
  toast(text) {
    const t = $('toast'); t.textContent = text; t.classList.add('on');
    clearTimeout(this.tt); this.tt = setTimeout(() => t.classList.remove('on'), 1800);
  },
  flash(cls) {
    const f = $('flash'); f.className = 'flash ' + cls; void f.offsetWidth; f.classList.add('on');
  },

  // ---------- title screen ----------
  title(best, coins, paintId, owned) {
    $('bestScore').textContent = fmt(best);
    $('coins').textContent = fmt(coins);
    $('driverLevel').textContent = Missions.state.level;
    $('paints').innerHTML = PAINTS.map(p => {
      const has = owned.includes(p.id), sel = p.id === paintId;
      const hex = '#' + p.color.toString(16).padStart(6, '0');
      return `<button class="paint${sel ? ' sel' : ''}${has ? '' : ' locked'}" data-id="${p.id}" style="--paint:${hex}" aria-pressed="${sel}">
        <span class="swatch"></span><span class="pname">${p.name}</span><span class="pcost">${has ? (sel ? 'Selected' : 'Owned') : '◉ ' + fmt(p.cost)}</span></button>`;
    }).join('');
    $('garageCoins').textContent = fmt(coins);
    const doneN = Missions.state.active.filter(m => m.done).length;
    $('missionBadge').textContent = `${doneN}/3`; $('missionBadge').classList.toggle('all', doneN === 3);
    $('missionList').innerHTML = this.missionCards(Missions.state.active);
    const L = Missions.state.level;
    $('setNote').textContent = `Finish all three to reach driver level ${L + 1} and earn ${fmt(SET_BONUS(L))} bonus coins. Each mission pays ${fmt(MISSION_REWARD(L))}.`;
    $('garageList').innerHTML = UPGRADES.map(up => {
      const l = Garage.level(up.id), cost = Garage.cost(up.id), max = cost == null;
      const pips = Array.from({ length: UPGRADE_MAX }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
      return `<div class="up-row-g"><div class="up-info"><b>${up.name}</b><span>${up.desc(l)}${max ? '' : ` <em>→ ${up.desc(l + 1)}</em>`}</span><span class="pips" aria-label="Level ${l} of ${UPGRADE_MAX}">${pips}</span></div>
        <button class="buy" data-up="${up.id}" ${max || coins < cost ? 'disabled' : ''}>${max ? 'Maxed' : '◉ ' + fmt(cost)}</button></div>`;
    }).join('');
    $('muteBtn').textContent = Sound.muted ? 'Sound off' : 'Sound on';
  },
  missionCards(list) {
    const scopeTag = { run: 'One run', total: 'Total', best: 'Once' };
    return list.map(m => {
      const d = Missions.def(m), pct = clamp(m.progress / m.target, 0, 1) * 100;
      const prog = d.id === 'drift' || d.id === 'air' ? `${m.progress.toFixed(1)} / ${m.target.toFixed(1)}s`
        : d.id === 'survive' ? `${mmss(m.progress)} / ${mmss(m.target)}`
        : d.id === 'tier' ? (m.done ? 'Done' : `${TIERS[m.progress].name} so far`)
        : `${fmt(m.progress)} / ${fmt(m.target)}`;
      return `<div class="mission${m.done ? ' done' : ''}"><div class="m-top"><span class="m-text">${Missions.label(m)}</span><span class="m-tag">${m.done ? 'Done' : scopeTag[d.scope]}</span></div>
        <div class="m-bar"><span style="width:${pct}%"></span></div><span class="m-prog">${prog}</span></div>`;
    }).join('');
  },
  openSheet(name) {
    const titles = { missions: 'Missions', garage: 'Garage', paint: 'Paint shop', howto: 'How to play' };
    $('sheetTitle').textContent = titles[name];
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.dataset.pane !== name; });
    $('sheetWrap').hidden = false; this.sheet = name;
    $('sheetClose').focus();
  },
  closeSheet() { $('sheetWrap').hidden = true; this.sheet = null; },
  missionPop(text, reward) {
    const el = $('missionPop');
    $('mpText').textContent = text; $('mpReward').textContent = `+${fmt(reward)} coins`;
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    clearTimeout(this.mt); this.mt = setTimeout(() => el.classList.remove('on'), 2800);
  },

  // ---------- game over ----------
  over(G, P, coinsEarned, best, isBest, done, missionCoins, setDone) {
    $('overReason').textContent = G.deathReason;
    $('overScore').textContent = fmt(G.score);
    $('overBest').textContent = isBest ? 'New best score' : `Best ${fmt(best)}`;
    $('overBest').classList.toggle('new', isBest);
    $('stCombo').textContent = 'x' + G.bestCombo;
    $('stBiggest').textContent = G.biggest ? G.biggest : 'Nothing yet';
    $('stTier').textContent = TIERS[P.tier].name;
    $('stTime').textContent = mmss(G.time);
    const bonus = setDone ? setDone.bonus : 0;
    $('stCoins').textContent = '+' + fmt(coinsEarned + missionCoins + bonus);
    $('stCoins').title = `${fmt(coinsEarned)} from score, ${fmt(missionCoins)} from missions${bonus ? `, ${fmt(bonus)} level bonus` : ''}`;
    const os = $('overSet');
    os.hidden = !setDone && !done.length;
    os.innerHTML = (done.length ? done.map(m => `<div>Mission complete: ${m.text} <b>+${fmt(m.reward)}</b></div>`).join('') : '')
      + (setDone ? `<div class="lvl">Driver level ${setDone.level}! All three done <b>+${fmt(bonus)}</b>. New missions are ready.</div>` : '');
    $('overMissions').innerHTML = this.missionCards(Missions.state.active);
    // upgrade growth: when each tier was reached
    const total = Math.max(G.time, 1);
    $('growth').innerHTML = TIERS.map((t, i) => {
      const u = G.upgrades.find(u => u.tier === i);
      const pct = u ? (u.time / total) * 100 : null;
      return `<div class="g-row${u ? '' : ' miss'}"><span class="g-name">${t.name}</span>
        <span class="g-track"><span class="g-mark" style="left:${pct == null ? 0 : pct}%"></span><span class="g-fill" style="width:${pct == null ? 0 : 100 - pct}%; left:${pct == null ? 0 : pct}%"></span></span>
        <span class="g-time">${u ? mmss(u.time) : '—'}</span></div>`;
    }).join('');
    const rows = Object.entries(G.counts).sort((a, b) => b[1] - a[1]);
    $('breakdown').innerHTML = rows.length ? rows.map(([k, n]) => `<span class="chip"><b>${n}</b> ${k}</span>`).join('') : '<span class="chip">No smashes this run</span>';
  },
};
