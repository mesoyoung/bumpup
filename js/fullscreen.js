// ============================================================
// fullscreen.js — hide the browser bars while you drive.
// Android Chrome (and desktop) can go fullscreen after a tap: we do it on Drive (touch devices only)
// and drop back out when you return to the menu. Players can also leave with the back gesture, or the
// buttons on the landing screen, in Pause and in Settings. iPhones can't do this for web pages, so they
// get a one-time hint to add the game to the home screen, where it opens like an app with no bars.
// ============================================================
const Full = {
  el: document.documentElement,
  // already running as a home-screen app: nothing to do
  standalone: matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.standalone === true,
  touch: matchMedia('(pointer: coarse)').matches,
  auto: false,   // true when Drive turned it on (so returning to the menu turns it off again)

  get can() {
    const req = this.el.requestFullscreen || this.el.webkitRequestFullscreen;
    return !this.standalone && !!req && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  },
  get on() { return !!(document.fullscreenElement || document.webkitFullscreenElement); },

  enter(auto) {
    if (!this.can || this.on) return;
    try {
      const req = this.el.requestFullscreen || this.el.webkitRequestFullscreen;
      const r = req.call(this.el, { navigationUI: 'hide' });
      if (r && r.catch) r.catch(() => {});
      this.auto = !!auto;
    } catch (e) {}
  },
  exit() {
    if (!this.on) return;
    try {
      const ex = document.exitFullscreen || document.webkitExitFullscreen;
      const r = ex.call(document);
      if (r && r.catch) r.catch(() => {});
    } catch (e) {}
  },
  toggle() { this.on ? this.exit() : this.enter(false); },

  // Drive: touch devices go fullscreen automatically
  onDrive() { if (this.touch) this.enter(true); },
  // back to the menu: undo what Drive did (leave it alone if the player turned it on themselves)
  onMenu() { if (this.auto) this.exit(); },

  sync() {
    const can = this.can, on = this.on;
    if (!on) this.auto = false;
    const b = $('fsBtn');
    if (b) {
      b.hidden = !can;
      b.innerHTML = ICONS[on ? 'fsExit' : 'fsEnter'];
      b.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
      b.title = on ? 'Exit full screen' : 'Full screen';
    }
    const p = $('fsPauseBtn'); if (p) p.hidden = !on;
    const r = $('fsRow');
    if (r) { r.hidden = !can; r.querySelector('b').textContent = on ? 'On' : 'Off'; }
  },

  // iPhone / iPod in Safari, not yet on the home screen, and not inside another page
  wantsIosHint() {
    let top = true; try { top = window.top === window; } catch (e) { top = false; }
    return /iP(hone|od)/.test(navigator.userAgent) && !this.standalone && top && !store.get('iosHintDone', false);
  },

  init() {
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => this.sync()));
    const b = $('fsBtn'); if (b) b.addEventListener('click', () => this.toggle());
    const p = $('fsPauseBtn'); if (p) p.addEventListener('click', () => this.exit());
    const r = $('fsRow'); if (r) r.addEventListener('click', () => this.toggle());
    // phones held upright: suggest turning sideways (hidden by CSS once they do)
    const rot = $('rotHint');
    if (rot) {
      rot.hidden = !this.touch || store.get('rotHintDone', false);
      $('rotHintClose').addEventListener('click', () => { rot.hidden = true; store.set('rotHintDone', true); });
    }
    const hint = $('iosHint');
    if (hint) {
      hint.hidden = !this.wantsIosHint();
      $('iosHintClose').addEventListener('click', () => { hint.hidden = true; store.set('iosHintDone', true); });
    }
    this.sync();
  },
};
