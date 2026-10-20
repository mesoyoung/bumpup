// ============================================================
// config.js — game rules from the design draft. Tune numbers here.
// ============================================================

// ---- City grid (tight, so things rush past) ----
const CELL = 52;          // distance between road centre lines (m)
const N = 10;             // blocks per side
const SIZE = CELL * N;    // playable city size (m)
const RW = 6.5;           // road half-width (m): one 6.5 m lane each way
const SW = 9.5;           // road half-width + sidewalk (m)
const EXT = 80;           // ground beyond the outer roads (m)
const LANE = 3.25;        // lane centre offset from the road centre (m)
const PED_PATH = (RW + SW) / 2;
const START = { x: (N / 2) * CELL + CELL * .4, z: (N / 2) * CELL };   // on the centre line, clear of traffic lanes

// ---- Player tiers (design draft: 4 tiers, mid-run growth) ----
// smash level = tier index + 1. An object of size S is:
//   S <= level      -> smashable
//   S == level + 1  -> bounce off, lose health
//   S >= level + 2  -> instant wreck
const TIERS = [
  // cruise = auto-throttle speed, boost = nitro top speed (m/s), accel (m/s²), steer (rad/s), grip (lateral bite)
  // dgrip = grip while sliding (low = loose), slideAt = how hard you must steer before it slides, hopV = hop strength
  { key: 'sedan',  name: 'Sedan', at: 0,     cruise: 30, boost: 52, accel: 30, steer: 2.9, grip: 9,   dgrip: 1.9, slideAt: .55, hopV: 12.5,camD: 6.6,  camH: 2.5, circ: { r: 1.05, o: [-1.2, 1.2] } },
  { key: 'suv',    name: 'SUV',   at: 2000,  cruise: 29, boost: 50, accel: 27, steer: 2.7, grip: 8.5, dgrip: 2.5, slideAt: .6,  hopV: 13,  camD: 8.2,  camH: 3.3, circ: { r: 1.2,  o: [-1.4, 1.4] } },
  { key: 'pickup', name: 'Truck', at: 15000,  cruise: 28, boost: 47, accel: 24, steer: 2.4, grip: 8,   dgrip: 3.3, slideAt: .68, hopV: 15.5,camD: 10.5, camH: 4.6, circ: { r: 1.5,  o: [-2.2, 0, 2.2] } },
  { key: 'bus',    name: 'Bus',   at: 45000, cruise: 26, boost: 44, accel: 20, steer: 2.1, grip: 7.5, dgrip: 4.6, slideAt: .8,  hopV: 15.5,camD: 14,   camH: 6.4, circ: { r: 1.6,  o: [-4, -1.35, 1.35, 4] } },
];

// ---- Crazy driving ----
const DRIFT_STEER = 1.35;      // steering multiplier while sliding
const DRIFT_KEEP = .9;         // how much speed a slide keeps (1 = no loss)
const SLIDE_MIN_SPEED = 15;    // hard turns only slide above this speed (m/s)
const DASH_BELOW = 11;         // Crazy Dash works below this speed (m/s)
const DASH_KICK = 1.1;         // dash launches you to cruise x this
const REVERSE_SPEED = 9;       // holding brake at a standstill reverses (m/s)
const GRAVITY = 32;
const RAMP_COUNT = 22;

// ---- Touch gestures ----
const TAP_GAP = .26;           // max seconds between taps for a double-tap
const SWIPE_PX = 38;           // vertical movement that counts as a swipe
const SWIPE_TIME = .32;        // a swipe must happen this soon after touching (s)
const STEER_PX = 55;           // finger drag for full steering lock

// ---- Smashable objects catalogue ----
// size = smash level needed. hl/hw = half length/width of the hit box.
const KINDS = {
  ped:     { size: 1, ht: 1.9, pts: 20,  fuel: 3,  hl: .3,  hw: .3,  name: 'Pedestrian', group: 'People' },
  bin:     { size: 1, ht: 1, pts: 12,  fuel: 2,  hl: .4,  hw: .4,  name: 'Dustbin',    group: 'Bins' },
  cone:    { size: 1, ht: 0.6, pts: 8,   fuel: 1,  hl: .3,  hw: .3,  name: 'Cone',       group: 'Cones' },
  hydrant: { size: 1, ht: 0.8, pts: 25,  fuel: 3,  hl: .3,  hw: .3,  name: 'Hydrant',    group: 'Hydrants' },
  lamp:    { size: 2, ht: 6.5, pts: 40,  fuel: 4,  hl: .3,  hw: .3,  name: 'Lamp post',  group: 'Lamp posts' },
  busstop: { size: 2, ht: 2.6, pts: 60,  fuel: 5,  hl: .8,  hw: 2,   name: 'Bus stop',   group: 'Bus stops' },
  sedan:   { size: 2, ht: 1.5, pts: 70,  fuel: 6,  hl: 2.2, hw: 1,   name: 'Sedan',      group: 'Sedans' },
  police:  { size: 2, ht: 1.6, pts: 120, fuel: 8,  hl: 2.2, hw: 1,   name: 'Police car', group: 'Police' },
  suv:     { size: 3, ht: 2.2, pts: 100, fuel: 8,  hl: 2.5, hw: 1.15,name: 'SUV',        group: 'SUVs' },
  tree:    { size: 3, ht: 5, pts: 60,  fuel: 5,  hl: .5,  hw: .5,  name: 'Tree',       group: 'Trees' },
  truck:   { size: 4, ht: 3.7, pts: 250, fuel: 15, hl: 4.5, hw: 1.4, name: 'Truck',      group: 'Trucks' },
  psuv:    { size: 3, ht: 2.3, pts: 220, fuel: 10, hl: 2.5, hw: 1.15,name: 'Police SUV', group: 'Police' },
  swat:    { size: 4, ht: 3.3, pts: 400, fuel: 16, hl: 4.2, hw: 1.3, name: 'SWAT van',   group: 'Police' },
  armor:   { size: 5, ht: 3.3, pts: 500, fuel: 22, hl: 4.0, hw: 1.35,name: 'Armoured van', group: 'Armoured vans' },
  riot:    { size: 5, ht: 3.8, pts: 650, fuel: 24, hl: 5.0, hw: 1.5, name: 'Riot truck', group: 'Police' },
  tank:    { size: 6, ht: 3.0, pts: 900, fuel: 30, hl: 3.8, hw: 1.9, name: 'Tank',       group: 'Tanks' },
  bus:     { size: 5, ht: 3.3, pts: 400, fuel: 20, hl: 5.5, hw: 1.5, name: 'Bus',        group: 'Buses' },
};

// ---- Traffic ----
// Traffic is spawned relative to the player's size so every tier feels like the SUV:
// about half prey (green), a third your size + 1 (amber), the rest bigger still (red).
const TRAFFIC_BANDS = [
  { band: 'green', w: 50, sizes: [[0, 60], [-1, 40]] },    // size offset from your level, weight
  { band: 'amber', w: 35, sizes: [[1, 100]] },
  { band: 'red',   w: 15, sizes: [[2, 75], [3, 25]] },
];
const TRAFFIC_BY_SIZE = { 2: ['sedan'], 3: ['suv'], 4: ['truck'], 5: ['bus', 'bus', 'armor'], 6: ['tank'] };
const TRAFFIC_SPEED = { sedan: 14, suv: 13, truck: 11, bus: 9, armor: 11, tank: 7 };
const TRAFFIC_COUNT = 42;
const PED_COUNT = 110;
const FOOD_TRUCKS = 4;
const GOLDEN_CHANCE = 0.04;   // golden targets are worth 5x

// ---- Survival ----
const FUEL_DRAIN = 1.8;       // per second, for the sedan
const FUEL_TIER = .2;         // each tier up burns this much more (bigger = thirstier)
const BOOST_DRAIN = 3.5;      // extra per second while boosting
const BOUNCE_DAMAGE = 34;     // hitting something one tier above you
const COMBO_WINDOW = 2.5;     // seconds between smashes to keep the combo
const COMBO_MAX = 10;
const NEAR_MISS_PTS = 20;

// ---- Boost rewards ----
const BOOST_LINGER = 1;       // seconds boost keeps going after you let go (brake cancels it)
const BOOST_SCORE = 2;        // points multiplier for smashes while boosting
const BOOST_FUEL = 1.5;       // smashes refuel this much more while boosting
const RAM_AT = 1;             // while boosting above this share of cruise speed you Power Ram...
const RAM_DAMAGE = 8;         // ...through amber objects (one size up), for a little health
const Ram = { on: false };

// ---- Tiny prey (2+ sizes below you) ----
const TINY_PTS = .25;         // points share; no fuel and no combo either

// ---- Wanted level (police) ----
const HEAT_STARS = [250, 700, 1500];
const HEAT_DECAY = 6;
const HEAT_TIER = [1, 1.6, 2.6, 4];           // bigger smashes are expected later, so heat builds proportionally
const POLICE_BY_TIER = ['police', 'psuv', 'swat', 'riot'];   // always one size up from you
const POLICE_SPEED = .45;     // police top speed sits this far between your cruise (0) and boost (1) speed
const ROADBLOCK_EVERY = 11;   // seconds between roadblocks at 2+ stars

// ---- Coins ----
const COINS_PER = 100;         // score points per coin at the end of a run

// ---- Paint jobs (bought with coins between runs) ----
const PAINTS = [
  { id: 'blue', name: 'Midnight', color: 0x3a6bff, cost: 0 },
  { id: 'pink', name: 'Hot Pink', color: 0xff3d8b, cost: 150 },
  { id: 'lime', name: 'Toxic',    color: 0x8cff3a, cost: 400 },
  { id: 'gold', name: 'Chrome Gold', color: 0xffc23a, cost: 1000 },
];

// ---- Helpers ----
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAng = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const fmt = n => Math.round(n).toLocaleString('en-US');
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function weighted(list) {
  const total = list.reduce((s, x) => s + x[1], 0);
  let r = Math.random() * total;
  for (const [k, w] of list) { if ((r -= w) <= 0) return k; }
  return list[0][0];
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('bumpup.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bumpup.' + k, JSON.stringify(v)); } catch (e) {} },
};
