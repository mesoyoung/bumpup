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
//   S == level + 1  -> bounce off, costs tank
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
const REVERSE_SPEED = 9;       // backing-off speed when you get stuck against a wall (m/s)
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
  mini:    { size: 1, ht: 1.4, pts: 45,  fuel: 4,  hl: 1.55,hw: .78, name: 'Mini car',   group: 'Mini cars' },
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
  { band: 'green', w: 60, sizes: [[0, 60], [-1, 40]] },    // size offset from your level, weight
  { band: 'amber', w: 28, sizes: [[1, 100]] },
  { band: 'red',   w: 12, sizes: [[2, 75], [3, 25]] },
];
const TRAFFIC_BY_SIZE = { 1: ['mini'], 2: ['sedan'], 3: ['suv'], 4: ['truck'], 5: ['bus', 'bus', 'armor'], 6: ['tank'] };
const TRAFFIC_SPEED = { mini: 13, sedan: 14, suv: 13, truck: 11, bus: 9, armor: 11, tank: 7 };
const TRAFFIC_COUNT = 75;           // was 42
const PED_COUNT = 110;
const PED_NOTICE = 16;        // how close you get before a pedestrian notices you (m)
const PED_FREEZE = .4;        // seconds they freeze in panic before running
const PED_RUN = 3.6;          // how fast they scramble away (m/s)
const PED_HIT = .65;          // pedestrian hit box half-size (m): generous so glancing hits count
const FOOD_GRID = 3;           // food trucks: one per zone of a 3 x 3 grid (9 in all), evenly spread
const GOLDEN_CHANCE = 0.04;   // golden targets are worth 5x

// ---- Survival ----
// One Tank bar: it drains over time and when you bump things, refills when you smash. Empty = run over.
const FUEL_DRAIN = 1.8;       // tank per second, for the sedan
const FUEL_TIER = .2;         // each tier up burns this much more (bigger = thirstier)
const BOOST_DRAIN = 3.5;      // extra per second while boosting
const BOUNCE_DAMAGE = 22;     // tank lost hitting something one size up (or a wall at speed)
const COMBO_WINDOW = 2.5;     // seconds between smashes to keep the combo
const COMBO_MAX = 10;
const NEAR_MISS_PTS = 20;

// ---- Boost rewards ----
const BOOST_LINGER = 1;       // seconds boost keeps going after you let go
const BOOST_TAP = 2.5;        // one tap of the Boost button boosts for this long
const BOOST_SCORE = 2;        // points multiplier for smashes while boosting
const BOOST_FUEL = 1.5;       // smashes refuel this much more while boosting
const RAM_AT = 1;             // while boosting above this share of cruise speed you Power Ram...
const RAM_DAMAGE = 6;         // ...through amber objects (one size up), for a little tank
const Ram = { on: false };
const Lighting = { day: false, bright: false };   // bright = light ground (day, or the salt flats): rings switch to solid colours

// ---- Tiny prey (2+ sizes below you) ----
const TINY_PTS = .25;         // points share; no fuel and no combo either

// ---- Wanted level (police) ----
const HEAT_STARS = [250, 700, 1500];
const HEAT_DECAY = 6;
const HEAT_TIER = [1, 1.6, 2.6, 4];           // bigger smashes are expected later, so heat builds proportionally
const POLICE_BY_TIER = ['police', 'psuv', 'swat', 'riot'];   // always one size up from you
const POLICE_SPEED = .45;     // police top speed sits this far between your cruise (0) and boost (1) speed

// ---- Coins ----
const COINS_PER = 100;         // score points per coin at the end of a run

// ---- Paint jobs (bought with coins between runs) ----
// look:   stripes (twin racing stripes) | twotone (accent lower half) | side (side stripe) | checker (taxi band)
// finish: glow (body glows) | chrome (shiny)     accentGlow: the accent colour glows too
// Every design applies to all four vehicles, and the underglow follows it.
const PAINTS = [
  { id: 'blue',        name: 'Midnight',      color: 0x3a6bff, cost: 0 },
  { id: 'pink',        name: 'Hot Pink',      color: 0xff3d8b, cost: 150 },
  { id: 'taxi',        name: 'Taxi',          color: 0xffc72c, accent: 0x111111, look: 'checker', cost: 300 },
  { id: 'lime',        name: 'Toxic',         color: 0x8cff3a, cost: 400 },
  { id: 'lemans',      name: 'Le Mans',       color: 0x1f4fd8, accent: 0xffffff, look: 'stripes', cost: 500 },
  { id: 'mint',        name: 'Retro Mint',    color: 0x7fe3c0, accent: 0xffffff, look: 'side', cost: 500 },
  { id: 'interceptor', name: 'Interceptor',   color: 0xf2f2f2, accent: 0x111111, look: 'twotone', cost: 700 },
  { id: 'sunset',      name: 'Sunset',        color: 0xff8a3d, accent: 0x6a2c91, look: 'twotone', cost: 800 },
  { id: 'lava',        name: 'Lava',          color: 0x1a1a1a, accent: 0xff4a1a, look: 'stripes', accentGlow: true, cost: 900 },
  { id: 'gold',        name: 'Chrome Gold',   color: 0xffcf5a, finish: 'chrome', under: 0xffc23a, cost: 1000 },
  { id: 'cyber',       name: 'Cyber Neon',    color: 0x14d9ff, finish: 'glow', cost: 1200 },
  { id: 'venom',       name: 'Venom',         color: 0x37ff6b, accent: 0x111111, look: 'stripes', finish: 'glow', cost: 1500 },
  { id: 'chrome',      name: 'Liquid Chrome', color: 0xc8d0dc, finish: 'chrome', under: 0x9fd8ff, cost: 1800 },
  { id: 'galaxy',      name: 'Galaxy',        color: 0x5a2bd6, accent: 0xff4fd8, look: 'side', finish: 'chrome', accentGlow: true, cost: 2500 },
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
// Player settings. steer: 'simple' (touch: hold left or right of centre to turn; no slides),
//   'easy' (shown as Drag: drag from where you touch; no slides), 'drift' (drag; hard turns at speed slide)
const Settings = { steer: 'simple' };
const store = {
  get(k, d) { try { const v = localStorage.getItem('bumpup.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('bumpup.' + k, JSON.stringify(v)); } catch (e) {} },
};
Settings.steer = store.get('steer', 'simple');
