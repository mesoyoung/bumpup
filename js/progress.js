// ============================================================
// progress.js — what carries over between runs:
//   Missions: 3 at a time, scaled to your driver level. Finish all
//             3 to level up and draw a new set.
//   Garage:   coin upgrades that change how your car plays.
// Saved in this browser (localStorage).
// ============================================================

// ---------- Garage upgrades ----------
const UPGRADES = [
  { id: 'fuel',   name: 'Fuel tank',    desc: l => `Tank holds ${100 + l * 15}`,                        unit: 'more fuel' },
  { id: 'armour', name: 'Armour',       desc: l => `Bumps drain ${Math.round(100 - l * 10)}% as much tank`,    unit: 'less damage' },
  { id: 'nitro',  name: 'Nitro',        desc: l => l ? `Boost ${l * 4}% faster, burns ${l * 10}% less` : 'Standard boost',     unit: 'faster boost' },
  { id: 'spring', name: 'Springs',      desc: l => l ? `Hops ${Math.round(((1 + l * .06) ** 2 - 1) * 100)}% higher` : 'Standard hops', unit: 'higher hops' },
  { id: 'combo',  name: 'Combo timer',  desc: l => `Combos last ${(COMBO_WINDOW + l * .3).toFixed(1)}s`, unit: 'longer combos' },
];
const UPGRADE_COST = [150, 400, 800, 1400, 2200];   // cost of level 1..5
const UPGRADE_MAX = UPGRADE_COST.length;

const Garage = {
  levels: Object.assign({ fuel: 0, armour: 0, nitro: 0, spring: 0, combo: 0 }, store.get('upgrades', {})),
  level(id) { return this.levels[id] || 0; },
  cost(id) { const l = this.level(id); return l >= UPGRADE_MAX ? null : UPGRADE_COST[l]; },
  buy(id) { this.levels[id] = this.level(id) + 1; store.set('upgrades', this.levels); },
  // multipliers the game reads
  get fuelMax() { return 100 + this.level('fuel') * 15; },
  get damage() { return 1 - this.level('armour') * .1; },
  get boostSpeed() { return 1 + this.level('nitro') * .04; },
  get boostDrain() { return 1 - this.level('nitro') * .1; },
  get hop() { return 1 + this.level('spring') * .06; },
  get comboWindow() { return COMBO_WINDOW + this.level('combo') * .3; },
};

// ---------- Missions ----------
// scope: 'run'  = within one run (resets if you don't finish it that run)
//        'total' = adds up across runs
//        'best'  = reach a value once (single slide, single jump, a tier...)
// on: the game event it listens to; count(d) returns how much it adds (or the value, for 'best').
const MISSIONS = [
  { id: 'peds',    scope: 'run',   on: 'smash', count: d => d.kind === 'ped' ? 1 : 0,          target: L => 12 + L * 4,         text: n => `Smash ${n} pedestrians in one run` },
  { id: 'bins',    scope: 'total', on: 'smash', count: d => d.kind === 'bin' ? 1 : 0,          target: L => 25 + L * 10,        text: n => `Smash ${n} dustbins` },
  { id: 'lamps',   scope: 'total', on: 'smash', count: d => d.kind === 'lamp' ? 1 : 0,         target: L => 10 + L * 5,         text: n => `Knock down ${n} lamp posts` },
  { id: 'cars',    scope: 'total', on: 'smash', count: d => d.kind === 'sedan' || d.kind === 'suv' ? 1 : 0, target: L => 8 + L * 4, text: n => `Wreck ${n} cars or SUVs` },
  { id: 'trucks',  scope: 'total', on: 'smash', count: d => d.kind === 'truck' ? 1 : 0,        target: L => 2 + L * 2, min: 3,  text: n => `Flatten ${n} trucks` },
  { id: 'police',  scope: 'total', on: 'smash', count: d => d.police ? 1 : 0,                  target: L => 1 + L,              text: n => `Take out ${n} police vehicles` },
  { id: 'gold',    scope: 'total', on: 'smash', count: d => d.golden ? 1 : 0,                  target: L => 1 + Math.floor(L / 2), text: n => `Smash ${n} gold target${n > 1 ? 's' : ''}` },
  { id: 'ram',     scope: 'run',   on: 'smash', count: d => d.ram ? 1 : 0,                     target: L => 2 + L,              text: n => `Power Ram ${n} things in one run` },
  { id: 'boosted', scope: 'run',   on: 'smash', count: d => d.boost ? 1 : 0,                   target: L => 10 + L * 4,         text: n => `Smash ${n} things while boosting in one run` },
  { id: 'tier',    scope: 'best',  on: 'tier',  count: d => d.tier,                            target: L => Math.min(3, 1 + Math.floor(L / 2)), text: n => `Grow into ${n === 1 ? 'an' : 'a'} ${TIERS[n].name}` },
  { id: 'score',   scope: 'best',  on: 'score', count: d => d.score,                           target: L => 2500 * L * (L + 1) / 2 + 2500, text: n => `Score ${fmt(n)} in one run` },
  { id: 'combo',   scope: 'best',  on: 'combo', count: d => d.combo,                           target: L => Math.min(10, 3 + L),  text: n => `Reach a x${n} combo` },
  { id: 'drift',   scope: 'best',  on: 'drift', count: d => d.time,                            target: L => Math.min(5, 1.5 + L * .5), text: n => `Slide for ${n.toFixed(1)}s in one go` },
  { id: 'air',     scope: 'best',  on: 'air',   count: d => d.time,                            target: L => Math.min(2, .8 + L * .2),  text: n => `Get ${n.toFixed(1)}s of air off a ramp` },
  { id: 'hopover', scope: 'total', on: 'hopover', count: () => 1,                              target: L => 2 + L * 2,          text: n => `Hop over ${n} vehicles` },
  { id: 'dash',    scope: 'run',   on: 'dash',  count: () => 1,                                target: L => 3 + L * 2,          text: n => `Crazy Dash ${n} times in one run` },
  { id: 'near',    scope: 'run',   on: 'near',  count: () => 1,                                target: L => 4 + L * 2,          text: n => `Get ${n} near misses in one run` },
  { id: 'food',    scope: 'run',   on: 'food',  count: () => 1,                                target: L => Math.min(4, 1 + Math.floor(L / 2)), text: n => `Visit ${n} food truck${n > 1 ? 's' : ''} in one run` },
  { id: 'survive', scope: 'best',  on: 'time',  count: d => d.time,                            target: L => 90 + L * 30,        text: n => `Survive ${mmss(n)} in one run` },
];
const MISSION_REWARD = L => 100 + L * 50;          // coins per mission
const SET_BONUS = L => 250 * L;                    // coins for finishing all three

const Missions = {
  state: store.get('missions', null),
  onComplete: null,                                // (mission, reward) => {}
  onSetComplete: null,                             // (newLevel, bonus) => {}
  def(m) { return MISSIONS.find(d => d.id === m.id); },
  label(m) { return this.def(m).text(m.target); },
  init() {
    if (!this.state || !this.state.active || this.state.active.some(m => !this.def(m))) this.state = { level: 1, active: [] };
    if (!this.state.active.length) this.drawSet();
    this.save();
  },
  save() { store.set('missions', this.state); },
  drawSet() {
    const L = this.state.level, pool = this.pool(L);
    const picked = [];
    while (picked.length < 3) {
      const d = pick(pool);
      if (picked.some(p => p.id === d.id)) continue;
      // keep a mix: no more than one 'best' mission per set
      if (d.scope === 'best' && picked.some(p => this.def(p).scope === 'best')) continue;
      picked.push({ id: d.id, target: d.target(L), progress: 0, done: false });
    }
    this.state.active = picked;
  },
  // Easy steering never slides, so slide missions are left out of the draw
  pool(L) { return MISSIONS.filter(d => (!d.min || L >= d.min - 1) && !(d.id === 'drift' && Settings.steer !== 'drift')); },
  // ...and an unfinished one is swapped for something else when you play on Easy
  swapDrift() {
    const A = this.state.active, i = A.findIndex(m => m.id === 'drift' && !m.done);
    if (i < 0 || Settings.steer === 'drift') return;
    const L = this.state.level, others = A.filter((_, k) => k !== i);
    const opts = this.pool(L).filter(d => !others.some(o => o.id === d.id) && !(d.scope === 'best' && others.some(o => this.def(o).scope === 'best')));
    if (!opts.length) return;
    const d = pick(opts); A[i] = { id: d.id, target: d.target(L), progress: 0, done: false };
    this.save();
  },
  runStart() {
    this.swapDrift();
    this.completedThisRun = [];
    for (const m of this.state.active) if (!m.done && this.def(m).scope === 'run') m.progress = 0;
  },
  event(type, data) {
    let changed = false;
    for (const m of this.state.active) {
      if (m.done) continue;
      const d = this.def(m);
      if (d.on !== type) continue;
      const v = d.count(data || {});
      if (!v) continue;
      if (d.scope === 'best') m.progress = Math.max(m.progress, v); else m.progress += v;
      changed = true;
      if (m.progress >= m.target) {
        m.done = true; m.progress = m.target;
        const reward = MISSION_REWARD(this.state.level);
        this.completedThisRun.push({ text: this.label(m), reward });
        if (this.onComplete) this.onComplete(m, reward);
      }
    }
    if (changed) this.save();
  },
  // call between runs: if all three are done, level up and draw a new set
  settle() {
    if (!this.state.active.every(m => m.done)) return null;
    const bonus = SET_BONUS(this.state.level);
    this.state.level++;
    this.drawSet(); this.save();
    if (this.onSetComplete) this.onSetComplete(this.state.level, bonus);
    return { level: this.state.level, bonus };
  },
};
Missions.init();
