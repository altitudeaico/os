try{var _p=document.getElementById('fos-probe');if(_p)_p.textContent='v9';}catch(e){}
(function(){var p=document.getElementById('fos-probe');if(p)p.textContent='surface.js: LOADED';})();
/**
 * Family OS TV — Surface Identity & Application Bootstrap
 *
 * Responsibilities:
 * - Surface session restore (localStorage → Supabase setSession)
 * - Pairing flow (request_surface_pairing → approve → claim_surface_session)
 * - Authenticated Realtime connection (hub_state, surface-scoped RLS)
 * - Minimal post-pair Home placeholder (Phase 0B only)
 *
 * Does NOT contain product/content logic — that is Phase 1+.
 * Architecture invariant: Guardian, RLS, hook, pairing authority unchanged.
 */

/* ── Config ── */
const SUPABASE_URL      = 'https://fypwabbhxnnwcpfjwrda.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cHdhYmJoeG5ud2NwZmp3cmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDg3ODUsImV4cCI6MjEwNDEyNDc4NX0.BwzgTd8_-lxENXnTu9ukxnHsgh3diguZbJPnzzC7XD4';
const IDENTITY_URL      = 'https://fypwabbhxnnwcpfjwrda.supabase.co/functions/v1/family-os-identity';
const HOUSEHOLD_ID      = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

/* Surface session storage — survives page reload and app backgrounding.
   Android TV WebView persists localStorage across process restarts
   (tested in Phase 0B physical acceptance). */
const SESSION_KEY = 'family-os-surface-session';
const PAIRING_KEY = 'family-os-pairing-state';

/* ── State ── */
let _sb            = null;  // Supabase client
let _session       = null;  // Current Surface session
let _realtimeChan  = null;  // Realtime channel
let _pairingTimer  = null;  // Pairing poll interval
let _expiryTimer   = null;  // Pairing code countdown

/* ── Logging (console only — no on-screen output in production) ── */
function log(msg)  { console.log ('[FamilyOS]', msg); }
function warn(msg) { console.warn('[FamilyOS]', msg); }
function err(msg)  { console.error('[FamilyOS]', msg); }

/* ════════════════════════════════════════════════════════════════
   BOOTSTRAP
   ════════════════════════════════════════════════════════════════ */

window.addEventListener('load', async () => {
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='window.load: FIRED';})();
  log('Boot — initialising Supabase client');

  // Unconditional boot watchdog — fires 5s after page load regardless of
  // what initSurface does. Answers: "what is under the boot screen?"
  setTimeout(() => {
    const boot = document.getElementById('boot');
    if (!boot) return;
    const hidden = boot.style.display === 'none' || boot.classList.contains('fade-out');
    if (!hidden) {
      err('Boot watchdog (load): boot still visible after 12s — forcing removal');
      boot.style.display = 'none';
      const diag = document.createElement('div');
      diag.style.cssText = 'position:fixed;top:2%;left:50%;transform:translateX(-50%);' +
        'background:rgba(255,60,60,0.9);color:#fff;font-size:13px;padding:8px 16px;' +
        'border-radius:6px;z-index:99999;font-family:monospace;white-space:nowrap;';
      diag.textContent = 'STARTUP STALLED — ' + (document.getElementById('fos-probe')?.textContent || 'unknown');
      document.body.appendChild(diag);
      setTimeout(() => { if (diag.parentNode) diag.remove(); }, 10000);
    }
  }, 5000);

  if(typeof supabase==='undefined'){(function(){var p=document.getElementById('fos-probe');if(p)p.textContent='ERROR: SUPABASE CDN';})(); return;}
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='Supabase: READY';})();
  _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: SESSION_KEY,
      storage: window.localStorage,
      flowType: 'implicit',
    }
  });

  await initSurface();
});

function probe(msg){var p=document.getElementById('fos-probe');if(p)p.textContent=msg;}

async function initSurface() {
  probe('initSurface: START');
  log('initSurface: going straight to Home');
  await showHome();
  // Auth state listener disabled — no session in display-only mode
  // startPairing() must never fire during this phase
}


async function showHome() {
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='v9';})();
  try { showView('home'); } catch(e){}

  // Load editable cards from Control (home_cards table); falls back to code list.
  // Guarded by a short timeout so a slow network can't delay first paint much.
  try {
    const _wt = function(p,ms){ return Promise.race([p, new Promise(function(res){ setTimeout(res, ms); })]); };
    await _wt(applyHomeCardsFromDB(), 3000);
  } catch(e){}
  try {
    renderRail(HOME_CARDS);
  } catch(e) {
    (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='RAIL ERR: '+e.message;})();
  }
  try { renderHomeV2(); } catch (e) { err('renderHomeV2 error: ' + e.message); }

  // Network-dependent enrichment runs AFTER cards are up, each guarded by a
  // timeout so a hanging TV network connection cannot freeze the boot.
  const withTimeout = function(promise, ms){
    return Promise.race([ promise, new Promise(function(res){ setTimeout(res, ms); }) ]);
  };
  try { await withTimeout(applyFeaturedHeroImages(), 4000); } catch(e){}
  // Re-render rail so any override images/featured images now apply
  try { renderRail(HOME_CARDS); } catch(e){}

  // Spotlight LAST: at rest it owns the hero and rotates. The moment the user
  // steers the card rail, the cards take the hero back (see setCardFocus).
  try {
    const withTimeout2 = function(promise, ms){ return Promise.race([ promise, new Promise(function(res){ setTimeout(res, ms); }) ]); };
    await withTimeout2(applySpotlightOverrides(), 12000);
    if (isHomeFocused() && spotlightAvailable()) {
      spotlightOwnHero(false);
      startSpotRotate();
    }
  } catch (e) {
    (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='H4-SPOT-ERR: '+(e&&e.message?e.message:e);})();
  }

  // Boot visibility is UX state — hide immediately after render attempt.
  // Realtime, clock and auth listener initialise afterwards.
  hideBoot();
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='HOME: SHOWN';})();

  // Diagnostic watchdog: if boot is somehow still visible after 12s, force-remove it
  // and surface a minimal indicator so we can see what is underneath.
  setTimeout(() => {
    const boot = document.getElementById('boot');
    if (boot && boot.style.display !== 'none' && !boot.classList.contains('fade-out')) {
      err('Boot watchdog: boot still visible after 12s — forcing removal');
      boot.style.display = 'none';
      const diag = document.createElement('div');
      diag.id = 'home-init-diag';
      diag.style.cssText = 'position:fixed;top:2%;left:50%;transform:translateX(-50%);' +
        'background:rgba(255,80,80,0.85);color:#fff;font-size:12px;padding:6px 14px;' +
        'border-radius:6px;z-index:99999;font-family:monospace;';
      diag.textContent = 'HOME INIT DEGRADED — boot forced hidden';
      document.body.appendChild(diag);
      setTimeout(() => { if (diag.parentNode) diag.parentNode.removeChild(diag); }, 8000);
    }
  }, 5000);

  connectRealtime();
  connectCommandsChannel();

  // Clock tick
  updateClock();
  setInterval(updateClock, 30000);

  // Auth state listener disabled in display-only mode
  // startPairing() is recovery only — must not fire automatically
}

function updateClock() {
  const now = new Date();
  const hh = now.getHours().toString().padStart(2,'0');
  const mm = now.getMinutes().toString().padStart(2,'0');
  const small = document.getElementById('home-clock');
  if (small) small.textContent = hh + ':' + mm;
  // Large ambient clock + date
  const big = document.getElementById('home-bigclock-time');
  if (big) big.textContent = hh + ':' + mm;
  const dt = document.getElementById('home-bigclock-date');
  if (dt) {
    dt.textContent = now.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
  }
}

/* ── Spotlight manifest ──
   Featured content with an explicit call to action. Distinct from the
   home cards: a card takes you to a section, a spotlight takes you to a
   specific THING inside it (via `action`). Rows can be overridden from
   the Supabase `spotlight` table — see applySpotlightOverrides(). */
const SPOTLIGHT_ITEMS = [
  {
    // Safe fallback ONLY. If the Supabase Home Spotlight fetch fails, Home
    // degrades to this single Welcome slide - never to stale featured content.
    // The real Home Spotlight collection is editorial and lives in Supabase.
    welcome: true,
    eyebrow: null,           // filled from contextForTime() at paint time
    title: 'Welcome home.',
    meta: '',
    thumb: null,             // filled from heroForTime() at paint time
    cta: null,
    dest: null,
    action: null,
  },
];

/* ── TEMPORARY live runtime diagnostic. Shows the actual state of the Home
   Spotlight chain, updating as the timer fires. Remove after debugging. ── */
window._fosDiag = { items: 0, owner: '?', timer: 'off', idx: 0, src: '?', home: '?' };
function fosDiagPaint() {
  var p = document.getElementById('fos-probe');
  if (!p) return;
  var d = window._fosDiag;
  p.textContent = 'HOME|home:' + d.home + '|items:' + d.items + '|src:' + d.src +
                  '|owner:' + d.owner + '|timer:' + d.timer + '|idx:' + d.idx;
}


let _spotIdx = 0;
let _heroOwner = 'cards';   // 'cards' | 'spotlight' — who owns the Home hero
let _spotTimer = null;
const SPOT_ROTATE_MS = 11000;   // slower on a TV; tune on the 65"

/* ── Canonical card manifest ── */
const HOME_CARDS = [
  { label: 'Home',           img: 'https://olatoyefamily.com/hub/assets/heroes/hero-evening-family-B.png',           dest: 'home',
    hero: 'https://olatoyefamily.com/hub/assets/heroes/hero-evening-family-B.png', heading: 'Welcome home.', meta: 'Everything in one place' },
  { label: 'Academy',        img: 'https://olatoyefamily.com/hub/assets/cards/card-academy.png',        dest: 'academy',
    hero: 'https://olatoyefamily.com/hub/assets/heroes/hero-academy.png', heading: 'Olatoye Academy', meta: 'Learn, discover, grow together' },
  { label: "Elsie's World",  img: 'https://olatoyefamily.com/hub/assets/cards/card-elsie.png',          dest: 'elsie',
    hero: 'https://olatoyefamily.com/hub/assets/cards/card-elsie.png', heading: "Elsie's World", meta: 'Art, ideas and imagination' },
  { label: "Emma's World",   img: 'https://olatoyefamily.com/hub/assets/cards/card-emma.png',           dest: 'emma',
    hero: 'https://olatoyefamily.com/hub/assets/emma/emma-01.png', heading: "Emma's World", meta: 'Unicorns, mermaids and magic' },
  { label: 'Our Adventures', img: 'https://olatoyefamily.com/hub/assets/cards/card-adventures.png',     dest: 'adventures',
    hero: 'https://olatoyefamily.com/hub/assets/cards/card-adventures.png', heading: 'Our Adventures', meta: 'Days out and family trips' },
  { label: 'Family Time',    img: 'https://olatoyefamily.com/hub/assets/cards/card-family-time.png',    dest: 'family-time',
    hero: 'https://olatoyefamily.com/hub/assets/cards/card-family-time.png', heading: 'Family Time', meta: 'Together at home' },
  { label: 'Watch',          img: 'https://olatoyefamily.com/hub/assets/cards/card-watch-B.png',        dest: 'watch',
    hero: 'https://olatoyefamily.com/hub/assets/cards/card-watch-B.png', heading: 'Watch', meta: 'Films and shows for everyone' },
  { label: 'Coming Up',      img: 'https://olatoyefamily.com/hub/assets/cards/card-coming-up-A.png',    dest: 'coming-up',
    hero: 'https://olatoyefamily.com/hub/assets/cards/card-coming-up-A.png', heading: 'Coming Up', meta: "What's next for the family" },
];

/* ── Home is a SPECIAL card: it owns a rotating collection of editorial
   Spotlight items. Every other card shows its single hero. This helper
   answers "is the Home card currently focused?" so the carousel is scoped
   to Home focus, never to idle or to other cards. ── */
function homeCardIndex() {
  for (var i = 0; i < HOME_CARDS.length; i++) {
    if (HOME_CARDS[i].dest === 'home') return i;
  }
  return 0;
}
function isHomeFocused() { return _cardIdx === homeCardIndex(); }


function heroForTime() {
  const h = new Date().getHours();
  if (h >= 5 && h < 17) return 'https://olatoyefamily.com/hub/assets/heroes/hero-morning-academy.png';
  return 'https://olatoyefamily.com/hub/assets/heroes/hero-evening-family-B.png';
}

function contextForTime() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Good morning, Olatoye Family';
  if (h >= 12 && h < 17) return 'Good afternoon, Olatoye Family';
  return 'Good evening, Olatoye Family';
}

async function applyHomeCardsFromDB() {
  // Cards are editable from Control via the home_cards table. If the fetch
  // succeeds and returns rows, they replace the built-in HOME_CARDS list.
  // On any failure we keep the code list (safe fallback).
  try {
    const hdr = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
    const url = SUPABASE_URL + '/rest/v1/home_cards?select=dest,label,img,hero,heading,meta,active,sort_order&active=eq.true&order=sort_order';
    const r = await fetch(url, { headers: hdr, cache: 'no-store' });
    if (!r.ok) return;
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length) {
      HOME_CARDS.length = 0;
      rows.forEach(function (x) {
        HOME_CARDS.push({ label:x.label, img:x.img, dest:x.dest, hero:x.hero, heading:x.heading, meta:x.meta });
      });
    }
  } catch (e) { /* keep built-in HOME_CARDS */ }
}


// Which tables can feed a card's rotating Home hero, keyed by dest. A card
// not listed here just uses its static `hero` field, unchanged — this is
// additive and doesn't touch cards (e.g. Emma's) that aren't opted in.
const HERO_FEED_TABLES = {
  elsie: ['elsie_artwork', 'elsie_photos', 'elsie_cheer'],
};

async function applyFeaturedHeroImages() {
  const API = 'https://fypwabbhxnnwcpfjwrda.supabase.co/rest/v1';
  const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cHdhYmJoeG5ud2NwZmp3cmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDg3ODUsImV4cCI6MjEwNDEyNDc4NX0.BwzgTd8_-lxENXnTu9ukxnHsgh3diguZbJPnzzC7XD4';
  const hdr = { apikey: KEY, Authorization: 'Bearer ' + KEY };
  for (const dest in HERO_FEED_TABLES) {
    const card = HOME_CARDS.find(function(c) { return c.dest === dest; });
    if (!card) continue;
    try {
      const results = await Promise.all(HERO_FEED_TABLES[dest].map(function(table) {
        return fetch(API + '/' + table + '?select=url,sort_order&featured=eq.true&order=sort_order', { headers: hdr })
          .then(function(r) { return r.json(); })
          .catch(function() { return []; });
      }));
      const images = [];
      results.forEach(function(rows) {
        if (Array.isArray(rows)) rows.forEach(function(row) { if (row.url) images.push(row.url); });
      });
      card._heroImages = images; // empty array = fall back to card.hero
    } catch (e) { card._heroImages = []; }
  }
}


function renderHomeV2() {
  try {
  // Hero background — time-of-day aware
  const heroBg = document.getElementById('home-hero-bg');
  if (heroBg) {
    heroBg.style.backgroundImage = 'url(' + heroForTime() + ')';
  }

  // Hero text — defaults, overridden by hub_state when Realtime delivers
  setHeroText({ context: contextForTime(), heading: 'Welcome home.', meta: '' });

  // Rail already rendered in showHome

  // Nav label
  const navLabel = document.getElementById('home-nav-label');
  if (navLabel) {
    const h = new Date().getHours();
    navLabel.textContent = h < 12 ? 'Home · Morning' :
                           h < 17 ? 'Home · Afternoon' : 'Home · Evening';
  }

  // Clock
  updateClock();
  } catch(e) { err('renderHomeV2 inner error: ' + e.message); }
}

function setHeroText({ context, heading, meta }) {
  const set = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.textContent = val || ''; };
  set('hero-context', context);
  set('hero-heading', heading);
  set('hero-meta', meta);
}

// ── Navigation state ──────────────────────────────────────────
let _navZone = 'cards';  // 'cards' or 'nav'
let _cardIdx  = 0;
let _navIdx   = 0;
const NAV_ITEMS_COUNT = 5;


// ══════════════════════════════════════════════════════
//  EMMA'S WORLD — implemented in fos-emma.js (loaded separately)
//  surface.js just routes to it. openEmmaWorld/emmaCleanup/
//  emmaHandleKey are globals from fos-emma.js.
// ══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════
//  DESTINATIONS — what opens when a card is clicked
// ══════════════════════════════════════════════════════

// Registry of open "World" destinations: viewId = the element that's
// visible while that World is open, handlerFn = its global key-entry
// function name (from its own fos-*.js). Add one line per new World —
// no other change needed to the keydown handler above.
const WORLD_KEY_HANDLERS = [
  { viewId: 'view-emma',  handlerFn: 'emmaHandleKey' },
  { viewId: 'view-elsie', handlerFn: 'elsieHandleKey' },
  { viewId: 'view-academy', handlerFn: 'acadHandleKey' },
];

// Hide every World view so a fresh destination always starts from a clean
// slate — needed because each World only hides ITSELF on its own normal
// exit; nothing hides the others. Without this, jumping straight from one
// World to another (as a pushed navigate command does, bypassing Home)
// leaves the previous World's screen visible underneath the new one.
function closeAllWorlds() {
  ['view-emma', 'view-elsie', 'view-academy', 'view-destination'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  if (typeof emmaCleanup === 'function') { try { emmaCleanup(); } catch (e) {} }
  _inDestination = false;
}

// Per-destination intro video, played once before the World itself opens.
// Add a line here for any other section that gets its own intro clip —
// nothing else needs to change (openDestination() picks this up generically).
const WORLD_INTROS = {
  elsie: 'https://olatoyefamily.com/hub/assets/world-intros/elsie-intro.mp4',
  emma: 'https://olatoyefamily.com/hub/assets/world-intros/emma-intro.mp4'
};

let _introVideoEl = null;
let _introActive  = false;
let _introFinish  = null;

// Plays url fullscreen, then calls onDone — on natural end, on GoBack/OK
// (skip), or on any playback error (fail open: never block navigation on a
// bad or slow video).
function playWorldIntro(url, onDone) {
  _introActive = true;
  let done = false;
  function finish() {
    if (done) return;
    done = true;
    _introActive = false;
    _introFinish = null;
    document.removeEventListener('keydown', onKey);
    onDone(); // open the destination now, underneath the still-visible video
    // Crossfade: let the World render behind the video, then fade the video
    // away rather than cutting straight to it.
    if (_introVideoEl) {
      var v = _introVideoEl;
      v.style.opacity = '0';
      setTimeout(function () {
        v.pause();
        v.style.display = 'none';
        v.style.opacity = '1'; // reset for next time
      }, 520);
    }
  }
  _introFinish = finish;
  function onKey(e) {
    var k = e.key, c = e.keyCode;
    if (k === 'Enter' || k === 'OK' || c === 13 || c === 23 || c === 66 ||
        k === 'Escape' || k === 'GoBack' || c === 4 || c === 27) {
      finish();
    }
  }
  if (!_introVideoEl) {
    _introVideoEl = document.createElement('video');
    _introVideoEl.id = 'fos-world-intro';
    _introVideoEl.style.cssText = 'position:fixed;inset:0;z-index:980;width:100%;height:100%;object-fit:cover;background:#000;opacity:1;transition:opacity 0.5s ease;';
    _introVideoEl.setAttribute('playsinline', '');
    document.body.appendChild(_introVideoEl);
  }
  _introVideoEl.style.opacity = '1';
  _introVideoEl.src = url;
  _introVideoEl.style.display = 'block';
  _introVideoEl.currentTime = 0;
  _introVideoEl.onended = finish;
  _introVideoEl.onerror = finish;
  var p = _introVideoEl.play();
  if (p && typeof p.catch === 'function') p.catch(function () { finish(); });
  document.addEventListener('keydown', onKey);
}

function openDestination(dest, label, opts) {
  probe('OPEN: ' + dest);
  closeAllWorlds();
  const introUrl = WORLD_INTROS[dest];
  if (introUrl) {
    playWorldIntro(introUrl, function () { openDestinationNow(dest, label, opts); });
    return;
  }
  openDestinationNow(dest, label, opts);
}

function openDestinationNow(dest, label, opts) {
  if (dest === 'home') { resetToHome(); return; }
  window._returnCardIdx = _cardIdx;  // remember which card to refocus on return
  stopHeroCycle();
  if (dest === 'emma') { openEmmaWorld(opts); return; }
  if (dest === 'elsie') { openElsieWorld(opts); return; }
  if (dest === 'academy') { openAcademyWorld(opts); return; }
  // Other destinations — placeholder for now
  showDestinationPlaceholder(label);
}

// Called by fos-emma when Emma's World exits back to Home
function onAcademyExit(){ _inDestination=false; _navZone="cards"; const i=(typeof window._returnCardIdx==="number")?window._returnCardIdx:0; setCardFocus(i, true); }

function onEmmaExit() {
  _inDestination = false;
  if (window._returnToSpotlight) {
    window._returnToSpotlight = false;
    _navZone = 'spotlight';
    spotlightOwnHero(false);
    setSpotFocus(true);
    startSpotRotate();
    return;
  }
  _navZone = 'cards';
  const idx = (typeof window._returnCardIdx === 'number') ? window._returnCardIdx : 0;
  // Restore focus to the card, and its hero (user has already been navigating)
  setCardFocus(idx, true);
}

// Called by fos-elsie when Elsie's World exits back to Home
function onElsieExit() {
  _inDestination = false;
  _navZone = 'cards';
  const idx = (typeof window._returnCardIdx === 'number') ? window._returnCardIdx : 0;
  setCardFocus(idx, true);
}

function showDestinationPlaceholder(label) {
  let el = document.getElementById('view-destination');
  if (!el) {
    el = document.createElement('div');
    el.id = 'view-destination';
    el.style.cssText = 'position:fixed;inset:0;z-index:500;background:#060a06;' +
      'display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1em;';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div style="color:#C9A84C;font-size:0.7em;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;">' + label + '</div>' +
    '<div style="color:#fff;font-size:2em;font-weight:800;">Coming soon</div>' +
    '<div style="color:rgba(255,255,255,0.4);font-size:0.8em;">Press Back to return home</div>';
  el.style.display = 'flex';
  _inDestination = true;
}

function closeDestination() {
  closeAllWorlds();
}

// Called by Android Back button. Returns true if handled (in a destination),
// false if at Home (Android should exit).
window.fosHandleBack = function() {
  // Intro video owns the remote while it's playing — skip it rather than
  // falling through to World/Home handling (or, at Home, exiting the app).
  if (_introActive) {
    if (_introFinish) _introFinish();
    return true;
  }
  // If a World is open, give it first refusal: its own nav stack should pop
  // ONE level (e.g. film -> Emma's World) rather than closing the whole
  // destination. Only fall through to closeDestination() if no World claims it.
  for (var i = 0; i < WORLD_KEY_HANDLERS.length; i++) {
    var w = WORLD_KEY_HANDLERS[i];
    var el = document.getElementById(w.viewId);
    var fn = window[w.handlerFn];
    if (el && el.style.display !== 'none' && typeof fn === 'function') {
      try { if (fn('GoBack', 4)) return true; } catch (e) { /* fall through */ }
    }
  }
  if (_inDestination) {
    closeDestination();
    return true;
  }
  return false;
};


/* ══════════════════════════════════════════════════════
   SPOTLIGHT — a STATE of the Home hero, not a widget.

   Home has ONE hero renderer with two possible sources:
     cards      -> focused destination card owns the hero
     spotlight  -> featured editorial story owns the hero
   Whichever interaction plane holds focus owns the hero.
   There is never a state where a card owns the hero while a
   different spotlight is the active selection.
══════════════════════════════════════════════════════ */
async function applySpotlightOverrides() {
  const hdr = { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
  const url = SUPABASE_URL + '/rest/v1/spotlight?select=welcome,eyebrow,title,meta,thumb,cta,dest,action,sort_order&active=eq.true&order=sort_order';
  // Retry up to 3 times - a TV's wifi to Supabase can be slow/cold on first hit.
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: hdr, cache: 'no-store' });
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) {
          SPOTLIGHT_ITEMS.length = 0;
          rows.forEach(function (x) { SPOTLIGHT_ITEMS.push(x); });
          return; // success
        }
      }
    } catch (e) { /* fetch failed; keep fallback */ }
    // brief backoff before retry
    await new Promise(function(res){ setTimeout(res, 800); });
  }
  // All attempts failed - keep Welcome-only fallback.
}

function spotlightAvailable() { return SPOTLIGHT_ITEMS.length > 0; }

/* Paint the hero from the current spotlight item. Crossfades artwork and
   copy together so it reads as one editorial story changing, not a row of
   widgets animating independently. */
function paintSpotlightHero(animate) {
  const it = SPOTLIGHT_ITEMS[_spotIdx];
  if (!it) return;
  const copy = document.querySelector('.home-hero-text');
  const eyebrow = it.welcome ? contextForTime() : (it.eyebrow || '');
  const art     = it.welcome ? (it.thumb || heroForTime()) : it.thumb;
  const apply = function () {
    setHeroText({ context: eyebrow, heading: it.title || '', meta: it.meta || '' });
    const cta = document.getElementById('hero-cta');
    if (cta) cta.style.display = it.cta ? 'inline-flex' : 'none';
    const lbl = document.getElementById('hero-cta-label');
    if (lbl) lbl.textContent = it.cta || 'Open';
    const dots = document.getElementById('spot-dots');
    if (dots) {
      dots.style.display = SPOTLIGHT_ITEMS.length > 1 ? 'flex' : 'none';
      dots.innerHTML = SPOTLIGHT_ITEMS.map(function (_, i) {
        return '<div class="spot-dot' + (i === _spotIdx ? ' on' : '') + '"></div>';
      }).join('');
    }
    if (art) crossfadeHeroTo(art);
  };
  if (animate && copy) {
    copy.classList.add('spot-fading');
    setTimeout(function () { apply(); copy.classList.remove('spot-fading'); }, 420);
  } else {
    apply();
  }
}

/* Hand the hero to the spotlight. Cards stay visible but stop being the
   active plane and lose their focus treatment. */
function spotlightOwnHero(animate) {
  if (!spotlightAvailable()) return false;
  _heroOwner = 'spotlight';
  stopHeroCycle();                       // card hero image cycling must not fight us
  if (_heroCardTimer) { clearTimeout(_heroCardTimer); _heroCardTimer = null; }  // cancel any pending debounced card-hero paint that would overwrite the spotlight
  const actions = document.getElementById('hero-spot-actions');
  if (actions) actions.style.display = 'flex';
  const rail = document.getElementById('rail-cards');
  if (rail) rail.classList.add('plane-inactive');
  paintSpotlightHero(!!animate);
  return true;
}

/* The Home card: put Family OS back to its resting state - welcome spotlight
   owning the hero, rotation running, nothing mid-journey. */
function resetToHome() {
  _spotIdx = 0;
  _navZone = 'cards';
  setSpotFocus(false);
  if (spotlightAvailable()) {
    spotlightOwnHero(true);
    startSpotRotate();
  }
}

/* Give the hero back to the card plane. */
function cardsOwnHero() {
  _heroOwner = 'cards';
  const actions = document.getElementById('hero-spot-actions');
  if (actions) actions.style.display = 'none';
  const cta = document.getElementById('hero-cta');
  if (cta) cta.classList.remove('focused');
  const rail = document.getElementById('rail-cards');
  if (rail) rail.classList.remove('plane-inactive');
}

function setSpotIdx(idx) {
  if (!spotlightAvailable()) return;
  _spotIdx = (idx + SPOTLIGHT_ITEMS.length) % SPOTLIGHT_ITEMS.length;
  if (_heroOwner === 'spotlight') paintSpotlightHero(true);
}

function startSpotRotate() {
  stopSpotRotate();
  if (SPOTLIGHT_ITEMS.length < 2) return;
  // Same advancement lifecycle Elsie's Featured cycle uses: a plain interval
  // that steps the index and calls the renderer. The renderer for Home is
  // paintSpotlightHero (via setSpotIdx) - rich image/title/meta/CTA/dots.
  _spotTimer = setInterval(function () {
    // Only pause if the user has manually grabbed the spotlight CTA.
    if (_navZone === 'spotlight') return;
    _spotIdx = (_spotIdx + 1) % SPOTLIGHT_ITEMS.length;
    paintSpotlightHero(true);
  }, SPOT_ROTATE_MS);
}
function stopSpotRotate() {
  if (_spotTimer) { clearInterval(_spotTimer); _spotTimer = null; window._fosDiag.timer = 'stopped'; fosDiagPaint(); }
}

function setSpotFocus(on) {
  const cta = document.getElementById('hero-cta');
  if (cta) cta.classList.toggle('focused', !!on);
}

/* UP from the cards: spotlight takes the whole hero and the CTA takes focus. */
function enterSpotlight() {
  if (!spotlightAvailable()) return false;
  _navZone = 'spotlight';
  document.querySelectorAll('.rail-card').forEach(function (c) { c.classList.remove('focused'); });
  spotlightOwnHero(true);
  setSpotFocus(true);
  return true;
}

/* DOWN: hand the hero back to the card the user was last on. */
function exitSpotlightToCards() {
  _navZone = 'cards';
  setSpotFocus(false);
  cardsOwnHero();
  setCardFocus(_cardIdx, true);   // restores focus treatment AND that card's hero
  // Rotation belongs to Home only. setCardFocus already restarts it when the
  // landing card is Home; do not start it here for a non-Home card.
  if (!isHomeFocused()) stopSpotRotate();
}

function activateSpotlight() {
  const it = SPOTLIGHT_ITEMS[_spotIdx];
  if (!it || !it.dest) return;   // resting/welcome item has nothing to open
  window._returnToSpotlight = true;
  openDestination(it.dest, it.title, { action: it.action });
}

function renderRail(cards) {
  const rail = document.getElementById('rail-cards');
  if (!rail) return;
  rail.innerHTML = '';

  cards.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'rail-card' + (i === 0 ? ' focused' : '');
    el.tabIndex = -1;  // JS manages focus, not browser tab order
    el.dataset.idx = i;
    el.dataset.dest = card.dest || '';
    el.dataset.label = card.label || '';

    if (card.img) {
      el.innerHTML = '<img class="rail-card-img" src="' + card.img + '" alt="" loading="lazy">' +
        '<div class="rail-card-gradient"></div>' +
        '<div class="rail-card-label">' + card.label + '</div>';
    } else {
      el.innerHTML = '<div style="position:absolute;inset:0;background:' + (card.bg||'rgba(255,255,255,0.06)') + '"></div>' +
        '<div class="rail-card-label">' + card.label + '</div>';
    }

    el.addEventListener('click', () => openDestination(card.dest, card.label));
    rail.appendChild(el);
  });

  // Set initial card focus WITHOUT changing the hero — keep the Welcome home screen
  setCardFocus(0, false);
  probe('CARDS: ' + document.querySelectorAll('.rail-card').length);
}

let _heroEngaged = false;  // becomes true once the user moves onto a card
function setCardFocus(idx, updateHero) {
  const cards = document.querySelectorAll('.rail-card');
  if (!cards.length) return;
  _cardIdx = Math.max(0, Math.min(idx, cards.length - 1));
  cards.forEach((c, i) => c.classList.toggle('focused', i === _cardIdx));
  // Scroll focused card into view
  const focused = cards[_cardIdx];
  if (focused) {
    const rail = document.getElementById('rail-cards');
    const cardLeft = focused.offsetLeft;
    const cardWidth = focused.offsetWidth;
    const railWidth = rail.offsetWidth;
    const offset = cardLeft - (railWidth / 2) + (cardWidth / 2);
    rail.scrollTo({ left: Math.max(0, offset), behavior: 'smooth' });
  }
  // Only change the hero once the user has actively engaged (not on first load)
  if (updateHero !== false) {
    _heroEngaged = true;
    // INVARIANT: the focused card owns the hero region and cycles its own
    // collection. Home presents the rich Spotlight Gallery from the spotlight
    // table; every other card presents its Featured collection via
    // updateHeroForCard (which cycles _heroImages, or shows a single hero, or
    // falls back to the card's static hero). Only ONE cycle timer runs at a time.
    if (isHomeFocused()) {
      stopHeroCycle();                 // stop any World Featured cycle
      if (spotlightAvailable()) { spotlightOwnHero(true); startSpotRotate(); }
      else { cardsOwnHero(); updateHeroForCard(_cardIdx); }  // safe fallback
    } else {
      stopSpotRotate();                // stop Home Spotlight Gallery
      if (_heroOwner === 'spotlight') cardsOwnHero();   // cards reclaim the hero
      updateHeroForCard(_cardIdx);     // Featured cycle OR single/static hero
    }
  }
}

let _heroCardTimer = null;
let _heroCycleTimer = null;
let _heroCycleImages = [];
let _heroCycleIdx = 0;
let _heroTopLayer = 'a';  // which of the two stacked layers is currently visible

function stopHeroCycle() {
  if (_heroCycleTimer) { clearInterval(_heroCycleTimer); _heroCycleTimer = null; }
  _heroCycleImages = [];
}

// Crossfade the hidden layer in over the visible one, then swap which is "top".
function crossfadeHeroTo(url) {
  const a = document.getElementById('home-hero-bg');
  const b = document.getElementById('home-hero-bg-b');
  if (!a || !b) return;
  const showing = (_heroTopLayer === 'a') ? a : b;
  const hidden  = (_heroTopLayer === 'a') ? b : a;
  const img = new Image();
  img.onload = () => {
    hidden.style.backgroundImage = 'url(' + url + ')';
    hidden.style.opacity = '1';
    showing.style.opacity = '0';
    _heroTopLayer = (_heroTopLayer === 'a') ? 'b' : 'a';
  };
  img.src = url;
}

function updateHeroForCard(idx) {
  const card = HOME_CARDS[idx];
  if (!card) return;
  stopHeroCycle();
  const heroBg = document.getElementById('home-hero-bg');
  const heroBgB = document.getElementById('home-hero-bg-b');
  // Multiple featured images (e.g. Elsie's Gallery/Photos/Cheer) beat the
  // card's single static hero. Falls back to card.hero when none are featured.
  const images = (card._heroImages && card._heroImages.length) ? card._heroImages : (card.hero ? [card.hero] : []);
  // Debounce slightly so fast scrolling does not thrash image loads
  if (_heroCardTimer) clearTimeout(_heroCardTimer);
  _heroCardTimer = setTimeout(() => {
    if (_heroOwner === 'spotlight') return;   // spotlight took over; do not overwrite it
    if (heroBg && images.length) {
      // Reset both layers to a clean single-image state, then fade the
      // first image in exactly like before — same feel for the common
      // one-image case, and the correct starting frame for a cycle.
      heroBgB.style.opacity = '0';
      _heroTopLayer = 'a';
      heroBg.style.opacity = '0.55';
      const img = new Image();
      img.onload = () => {
        heroBg.style.backgroundImage = 'url(' + images[0] + ')';
        heroBg.style.opacity = '1';
        if (images.length > 1) {
          _heroCycleImages = images;
          _heroCycleIdx = 0;
          _heroCycleTimer = setInterval(() => {
            _heroCycleIdx = (_heroCycleIdx + 1) % _heroCycleImages.length;
            crossfadeHeroTo(_heroCycleImages[_heroCycleIdx]);
          }, 6000);
        }
      };
      img.onerror = () => { heroBg.style.opacity = '1'; };
      img.src = images[0];
    }
    setHeroText({ context: contextForTime(), heading: card.heading || '', meta: card.meta || '' });
  }, 120);
}

function setNavFocus(idx) {
  const items = document.querySelectorAll('.nav-item');
  if (!items.length) return;
  _navIdx = Math.max(0, Math.min(idx, items.length - 1));
  items.forEach((n, i) => n.classList.toggle('focused', i === _navIdx));
}


// ── Hard refresh — bypass cache, pull latest changes ──
function fosHardRefresh() {
  probe('REFRESHING...');
  // Force reload bypassing cache
  const bust = 'r=' + Date.now();
  const url = location.origin + location.pathname + '?' + bust;
  location.replace(url);
}

// Trigger: press UP 3 times quickly while focus is on the card row
let _upPresses = [];
function trackUpForRefresh() {
  const now = Date.now();
  _upPresses.push(now);
  _upPresses = _upPresses.filter(t => now - t < 1500);
  if (_upPresses.length >= 3) {
    _upPresses = [];
    showRefreshToast();
  }
}

function showRefreshToast() {
  let toast = document.getElementById('fos-refresh-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'fos-refresh-toast';
    toast.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;' +
      'background:rgba(26,0,17,0.95);border:1px solid rgba(255,110,199,0.5);border-radius:16px;' +
      'padding:1.5em 2.5em;text-align:center;';
    document.body.appendChild(toast);
  }
  toast.innerHTML =
    '<div style="color:#ff6ec7;font-size:0.9em;font-weight:700;margin-bottom:0.5em;">Refresh Family OS?</div>' +
    '<div style="color:rgba(255,255,255,0.6);font-size:0.6em;">Press OK to update · Back to cancel</div>';
  toast.style.display = 'block';
  window._refreshPending = true;
}


// ── D-pad keyboard handler ─────────────────────────────────────
document.addEventListener('keydown', function(e) {
  const key = e.key || '';
  const code = e.keyCode || 0;

  // If in a destination (a "World"), delegate keys to it. Each World owns
  // all its keys including Back (via its own nav stack). Registry keeps
  // this handler from growing a new hardcoded if-block per World.
  if (_inDestination) {
    for (let i = 0; i < WORLD_KEY_HANDLERS.length; i++) {
      const w = WORLD_KEY_HANDLERS[i];
      const el = document.getElementById(w.viewId);
      if (el && el.style.display !== 'none' && typeof window[w.handlerFn] === 'function') {
        window[w.handlerFn](key, code); // return value unused — swallow everything while a World is open
        e.preventDefault();
        return;
      }
    }
    // Placeholder destinations ("Coming soon"): Back returns Home
    if (code === 4 || code === 27 || key === 'Escape' || key === 'GoBack') {
      e.preventDefault(); closeDestination();
      _navZone = 'cards';
      const idx = (typeof window._returnCardIdx === 'number') ? window._returnCardIdx : 0;
      setCardFocus(idx);
      return;
    }
    return;
  }

  probe('KEY: ' + key + '/' + code + ' zone:' + _navZone);
  const isLeft  = key === 'ArrowLeft'  || code === 37;
  const isRight = key === 'ArrowRight' || code === 39;
  const isUp    = key === 'ArrowUp'    || code === 38;
  const isDown  = key === 'ArrowDown'  || code === 40;
  const isEnter = key === 'Enter'      || code === 13 || code === 23;

  if (!isLeft && !isRight && !isUp && !isDown && !isEnter) return;
  e.preventDefault();

  const cards = document.querySelectorAll('.rail-card');
  if (!cards.length) return;

  if (_navZone === 'cards') {
    // Refresh confirm dialog
    if (window._refreshPending) {
      if (isEnter) { e.preventDefault(); fosHardRefresh(); return; }
      const t = document.getElementById('fos-refresh-toast');
      if (t) t.style.display = 'none';
      window._refreshPending = false;
      return;
    }
    if (isLeft)  setCardFocus(_cardIdx - 1);
    if (isRight) setCardFocus(_cardIdx + 1);
    if (isUp) {
      trackUpForRefresh();               // keep the hidden 3x-UP refresh gesture
      if (enterSpotlight()) return;
    }
    if (isDown) {
      _navZone = 'nav';
      cards.forEach(c => c.classList.remove('focused'));
      setNavFocus(_navIdx);
    }
    if (isEnter) {
      const focused = cards[_cardIdx];
      if (focused) {
        probe('ENTER on ' + focused.dataset.dest);
        openDestination(focused.dataset.dest, focused.dataset.label);
      }
    }
  } else if (_navZone === 'spotlight') {
    if (window._refreshPending) {
      if (isEnter) { e.preventDefault(); fosHardRefresh(); return; }
      const t = document.getElementById('fos-refresh-toast');
      if (t) t.style.display = 'none';
      window._refreshPending = false;
      return;
    }
    if (isUp)    trackUpForRefresh();    // gesture still reachable from here
    if (isLeft)  setSpotIdx(_spotIdx - 1);
    if (isRight) setSpotIdx(_spotIdx + 1);
    if (isDown) exitSpotlightToCards();
    if (isEnter) { e.preventDefault(); activateSpotlight(); }
  } else {
    // navZone === 'nav'
    if (isLeft)  setNavFocus(_navIdx - 1);
    if (isRight) setNavFocus(_navIdx + 1);
    if (isUp) {
      _navZone = 'cards';
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('focused'));
      setCardFocus(_cardIdx);
    }
    if (isEnter) {
      const items = document.querySelectorAll('.nav-item');
      if (items[_navIdx]) items[_navIdx].click();
    }
  }
});

/* ════════════════════════════════════════════════════════════════
   REALTIME — authenticated surface-scoped connection
   RLS: surface can only receive hub_state for its own surface_id.
   ════════════════════════════════════════════════════════════════ */

function connectRealtime() {
  if (!_sb || !_session) {
    updateRealtimeStatus('Family OS');
    return;
  }
  if (!_session) { warn('No session — cannot connect Realtime'); return; }

  // Disconnect any existing channel
  if (_realtimeChan) {
    _sb.removeChannel(_realtimeChan);
    _realtimeChan = null;
  }

  log('Connecting Realtime (surface-scoped)');

  _realtimeChan = _sb
    .channel('hub_state_surface')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'hub_state' },
      (payload) => {
        log('hub_state update received: ' + JSON.stringify(payload.new));
        updateRealtimeStatus('✓ Realtime live — ' + new Date().toLocaleTimeString());
        applyHubState(payload.new);
      }
    )
    .subscribe((status) => {
      log('Realtime status: ' + status);
      if (status === 'SUBSCRIBED') {
        updateRealtimeStatus('✓ Realtime connected');
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        updateRealtimeStatus('⚠ Realtime disconnected — reconnecting...');
        setTimeout(connectRealtime, 5000);
      }
    });
}

function updateRealtimeStatus(msg) {
  // V2: update the header status badge
  const dot   = document.getElementById('realtime-dot');
  const label = document.getElementById('realtime-label');
  const isConnected = msg.startsWith('✓');
  if (dot) {
    dot.className = 'home-status-dot' + (isConnected ? '' : ' offline');
  }
  if (label) label.textContent = isConnected ? 'Family OS' : 'Family OS';
  // Phase 0B legacy element — gracefully absent in V2
  const legacy = document.getElementById('realtime-status');
  if (legacy) legacy.textContent = 'Realtime: ' + msg;
}

function applyHubState(state) {
  if (!state) return;
  log('Hub state: mode=' + state.mode);
  updateRealtimeStatus('✓ ' + (state.mode || 'idle') + ' · ' + new Date().toLocaleTimeString());

  // Update hero text from hub_state content if present
  let content = null;
  try {
    content = typeof state.content_json === 'string'
      ? JSON.parse(state.content_json)
      : state.content_json || null;
  } catch (e) {
    warn('Invalid hub_state content_json — ignoring: ' + e.message);
  }
  if (content) {
    setHeroText({
      context: content.context || contextForTime(),
      heading: content.heading || '',
      meta:    content.meta || '',
    });
  }
}

/* ════════════════════════════════════════════════════════════════
   COMMANDS — one-shot pushes from Control Room (hub_commands table).
   Independent of the surface pairing session on purpose: the TV runs
   in display-only mode (see initSurface) and the Surface Identity
   pairing flow was never completed for this device, so this channel
   uses the same anon-key, household-trust RLS as home_cards/spotlight
   rather than the surface-scoped auth hub_state's channel expects.
   ════════════════════════════════════════════════════════════════ */
let _commandsChan   = null;
let _announceTimer  = null;

function connectCommandsChannel() {
  if (!_sb) return;
  if (_commandsChan) { _sb.removeChannel(_commandsChan); _commandsChan = null; }
  log('Connecting hub_commands channel');
  _commandsChan = _sb
    .channel('hub_commands_living_room')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'hub_commands' },
      (payload) => { handleHubCommand(payload.new); }
    )
    .subscribe((status) => {
      log('Commands channel status: ' + status);
      if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        setTimeout(connectCommandsChannel, 5000);
      }
    });
}

async function handleHubCommand(cmd) {
  if (!cmd || cmd.status !== 'pending') return;
  log('hub_command received: ' + cmd.command_type + ' -> ' + (cmd.target_id || ''));
  let ok = true, errMsg = null;
  try {
    if (cmd.command_type === 'announcement') {
      showAnnouncement(cmd.payload || {});
    } else if (cmd.command_type === 'refresh') {
      await runRefreshCommand(cmd.target_id);
    } else if (cmd.command_type === 'navigate') {
      openDestination(cmd.target_id || 'home');
    } else {
      ok = false; errMsg = 'unknown command_type: ' + cmd.command_type;
    }
  } catch (e) {
    ok = false; errMsg = e && e.message ? e.message : String(e);
  }
  try {
    await _sb.from('hub_commands').update({
      status: ok ? 'completed' : 'failed',
      result: ok ? { ok: true } : { ok: false, error: errMsg },
      processed_at: new Date().toISOString()
    }).eq('id', cmd.id);
  } catch (e) { warn('command ack failed: ' + (e && e.message ? e.message : e)); }
}

async function runRefreshCommand(target) {
  const emmaEl  = document.getElementById('view-emma');
  const elsieEl = document.getElementById('view-elsie');
  const emmaOpen  = !!(emmaEl  && emmaEl.style.display  !== 'none');
  const elsieOpen = !!(elsieEl && elsieEl.style.display !== 'none');
  const wantsCurrent = !target || target === 'current';

  if (target === 'emma' || (wantsCurrent && emmaOpen)) {
    if (typeof openEmmaWorld === 'function') await openEmmaWorld({});
  } else if (target === 'elsie' || (wantsCurrent && elsieOpen)) {
    if (typeof openElsieWorld === 'function') await openElsieWorld({});
  }
  // Home cards can always refresh regardless of what else is open
  if (!target || target === 'home' || target === 'all') {
    try { await applyHomeCardsFromDB(); renderRail(HOME_CARDS); } catch (e) {}
  }
}

function showAnnouncement(payload) {
  payload = payload || {};
  let el = document.getElementById('fos-announcement');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fos-announcement';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:950;' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;' +
      'padding:2.2em 3em 1.7em;background:linear-gradient(180deg, rgba(6,10,6,0.96) 0%, rgba(6,10,6,0.86) 70%, rgba(6,10,6,0) 100%);' +
      'transform:translateY(-100%);transition:transform 0.45s cubic-bezier(.22,.9,.35,1);';
    document.body.appendChild(el);
  }
  const headline = (payload.headline || '').toString();
  const body = (payload.body || '').toString();
  el.innerHTML =
    '<div style="color:#C9A84C;font-size:0.7em;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:0.4em;">Announcement</div>' +
    '<div style="color:#fff;font-size:1.8em;font-weight:800;line-height:1.2;max-width:16em;">' + escHtml(headline) + '</div>' +
    (body ? '<div style="color:rgba(255,255,255,0.7);font-size:1em;margin-top:0.5em;max-width:26em;">' + escHtml(body) + '</div>' : '');
  requestAnimationFrame(function () { el.style.transform = 'translateY(0)'; });
  if (_announceTimer) clearTimeout(_announceTimer);
  const dur = Math.max(2000, Math.min(30000, Number(payload.duration_ms) || 8000));
  _announceTimer = setTimeout(function () { el.style.transform = 'translateY(-100%)'; }, dur);
}

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

/* ════════════════════════════════════════════════════════════════
   VIEW MANAGEMENT
   ════════════════════════════════════════════════════════════════ */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
  document.getElementById('app').classList.add('active');
}

function hideBoot() {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.classList.add('fade-out');
  setTimeout(function(){ boot.style.display = 'none'; }, 700);
}

/* ════════════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════════════ */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
