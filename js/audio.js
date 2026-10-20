// ============================================================
// audio.js — every sound is synthesised with WebAudio, so the
// game ships with no audio files. Starts on the first click.
// ============================================================

const Sound = {
  ctx: null, muted: store.get('muted', false), started: false,

  init() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC(); this.started = true;
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : .8; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = .9; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = .22; this.music.connect(this.master);
    // white noise buffer
    const len = c.sampleRate * 1.5; this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // siren
    this.sirG = c.createGain(); this.sirG.gain.value = 0; this.sirG.connect(this.sfx);
    this.sir = c.createOscillator(); this.sir.type = 'triangle'; this.sir.frequency.value = 700;
    const lfo = c.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 1.6;
    const lfoG = c.createGain(); lfoG.gain.value = 160; lfo.connect(lfoG); lfoG.connect(this.sir.frequency);
    this.sir.connect(this.sirG); this.sir.start(); lfo.start();
    this.startMusic();
    this.loadSamples();
  },

  // ---- recorded sounds (sounds/ folder): engine loop, rev one-shots, tyre squeal ----
  // The files start downloading as soon as the page opens (prefetch), so they're ready by the time you press Drive.
  // There is no synthesised engine or squeal: if a file can't load, that sound is simply silent.
  prefetch() {
    const names = ['engine-loop.wav', 'engine-high.wav', 'engine-rev.wav', 'engine-boost.wav', 'drift-loop.wav'];
    this.files = names.map(n => fetch('sounds/' + n).then(r => { if (!r.ok) throw new Error(n); return r.arrayBuffer(); }));
  },
  loadSamples() {
    const c = this.ctx;
    if (!this.files) this.prefetch();
    const decode = p => p.then(b => new Promise((res, rej) => c.decodeAudioData(b.slice(0), res, rej)));
    Promise.all(this.files.map(decode)).then(([eng, high, rev, boost, drift]) => {
      this.buf = { rev, boost };
      // Recordings play exactly as recorded: no pitch change, no filters, only volume.
      const loopNode = buf => {
        const s = c.createBufferSource(), g = c.createGain();
        s.buffer = buf; s.loop = true; g.gain.value = 0; s.connect(g); g.connect(this.sfx); s.start();
        return g;
      };
      this.engLowG = loopNode(eng);     // steady cruising
      this.engHighG = loopNode(high);   // hard, high-revving pull: fades in as you go past cruise speed
      this.drSG = loopNode(drift);      // tyre squeal
      this.samples = true;
    }).catch(() => { this.samples = false; });
  },
  oneShot(buf, vol) {
    if (!this.ctx || !buf) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain();
    s.buffer = buf; g.gain.value = vol; s.connect(g); g.connect(this.sfx); s.start();
  },
  boostRev() { if (this.samples) this.oneShot(this.buf.boost, .5); },

  screech(v) {
    if (!this.ctx) return;
    if (this.samples) {
      const t = this.ctx.currentTime;
      this.drSG.gain.setTargetAtTime(v * .6, t, v > 0 ? .03 : .08);
    }
  },
  dash() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    if (this.samples) this.oneShot(this.buf.rev, .6);
    const f = this.noise(t, .5, 'bandpass', 400, 2, .45); f.frequency.exponentialRampToValueAtTime(2600, t + .4);
  },
  musicLift(v) { if (this.ctx && !this.ducked) this.music.gain.setTargetAtTime(.2 + v * .14, this.ctx.currentTime, .3); },
  duck(on) { this.ducked = on; if (this.ctx) this.music.gain.setTargetAtTime(on ? .08 : .2, this.ctx.currentTime, .15); },
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); },
  wake() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  hop() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(t, .22, 'square', 240, 520, .08); this.noise(t, .15, 'lowpass', 600, 1, .2); },
  land(air) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.tone(t, .3, 'sine', 110, 40, .4 + Math.min(.4, air * .2)); this.noise(t, .2, 'lowpass', 700, 1, .35);
  },
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
  setMuted(m) {
    this.muted = m; store.set('muted', m);
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : .8, this.ctx.currentTime, .05);
  },

  // ---- building blocks ----
  noise(t, dur, type, freq, q, vol, dest) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfx); s.start(t); s.stop(t + dur + .05);
    return f;
  },
  tone(t, dur, type, f0, f1, vol, dest) {
    const c = this.ctx, o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + .05);
  },

  // ---- game sounds ----
  smash(kind, size) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const big = size >= 2;
    this.tone(t, .25 + size * .06, 'sine', 140 - size * 12, 38, .5 + size * .12);
    this.noise(t, .12 + size * .05, 'lowpass', 900 + size * 300, 1, .35 + size * .08);
    if (kind === 'ped') { this.tone(t, .28, 'sine', 320, 760, .22); this.tone(t + .1, .25, 'sine', 700, 220, .18); }
    if (kind === 'bin') this.noise(t, .3, 'bandpass', 2400, 4, .25);
    if (kind === 'cone') this.tone(t, .12, 'square', 520, 300, .08);
    if (kind === 'lamp') { this.tone(t, .6, 'square', 880, 840, .07); this.noise(t, .5, 'highpass', 3000, 1, .15); }
    if (kind === 'busstop') for (let i = 0; i < 6; i++) this.noise(t + i * .035, .18, 'highpass', 4500 + i * 400, 2, .2);
    if (kind === 'hydrant') this.noise(t, 1.2, 'bandpass', 1200, .8, .25);
    if (big && kind !== 'lamp' && kind !== 'busstop') this.noise(t + .03, .45, 'bandpass', 600, 1.5, .4);
  },
  bonk() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.tone(t, .35, 'square', 180, 60, .25); this.noise(t, .25, 'lowpass', 500, 1, .5);
  },
  wreck() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.noise(t, 1.6, 'lowpass', 900, .7, .9); this.tone(t, 1.2, 'sine', 90, 25, .9);
    this.noise(t + .05, .6, 'highpass', 2500, 1, .35);
  },
  combo(n) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    this.tone(t, .08, 'square', 440 * Math.pow(2, Math.min(n, 12) / 12), 0, .05);
  },
  nearMiss() { if (!this.ctx) return; const t = this.ctx.currentTime; const f = this.noise(t, .4, 'bandpass', 800, 3, .3); f.frequency.exponentialRampToValueAtTime(3500, t + .35); },
  pickup() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [660, 880, 1320].forEach((f, i) => this.tone(t + i * .07, .25, 'triangle', f, 0, .18));
  },
  upgrade() {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    [261.6, 329.6, 392, 523.3, 659.3, 784].forEach((f, i) => this.tone(t + i * .07, .5, 'sawtooth', f, 0, .09));
    this.tone(t, 1.4, 'sine', 55, 110, .5);
  },
  star() { if (!this.ctx) return; const t = this.ctx.currentTime; this.tone(t, .3, 'square', 988, 0, .08); this.tone(t + .12, .3, 'square', 1318, 0, .08); },

  engine(speed, tier, boosting, playing) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.samples) {
      // speed is shown by blending two recorded sections, not by re-pitching them
      const T = TIERS[tier], s = Math.abs(speed);
      const low = clamp(s / T.cruise, 0, 1), high = clamp((s - T.cruise * .9) / (T.boost - T.cruise * .9), 0, 1);
      this.engLowG.gain.setTargetAtTime(playing ? (.25 + .4 * low) * (1 - high * .8) : 0, t, .12);
      this.engHighG.gain.setTargetAtTime(playing ? high * .75 : 0, t, .12);
    }
  },
  siren(vol) { if (this.ctx) this.sirG.gain.setTargetAtTime(vol * .05, this.ctx.currentTime, .2); },

  // ---- music: a looping night-drive synth groove ----
  startMusic() {
    const c = this.ctx, bpm = 112, step = 60 / bpm / 2; // eighth notes
    const roots = [45, 45, 41, 43]; // A, A, F, G (MIDI)
    const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
    let next = c.currentTime + .1, n = 0;
    const tick = () => {
      while (next < c.currentTime + .25) {
        const bar = Math.floor(n / 8) % 4, s = n % 8, root = roots[bar];
        // bass: octave pulse
        this.tone(next, step * .9, 'sawtooth', mtof(root + (s % 2 ? 12 : 0)), 0, .16, this.music);
        // kick on beats, hat on off-beats, snare on 2 & 4
        if (s % 2 === 0) this.tone(next, .2, 'sine', 120, 40, .55, this.music);
        else this.noise(next, .05, 'highpass', 7000, 1, .12, this.music);
        if (s === 2 || s === 6) this.noise(next, .16, 'bandpass', 1800, .9, .3, this.music);
        // arp
        const arp = [0, 7, 12, 15, 12, 7, 3, 7][s];
        if (bar % 2 === 1 || s % 2 === 0) this.tone(next, step * .8, 'square', mtof(root + 24 + arp), 0, .035, this.music);
        next += step; n++;
      }
    };
    this.musicTimer = setInterval(tick, 50);
  },
};
Sound.prefetch();   // start downloading the recordings while the landing screen is up
