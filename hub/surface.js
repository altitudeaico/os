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
      err('Boot watchdog (load): boot still visible after 5s — forcing removal');
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
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='showHome: START v9';})();
  showView('home');

  // Render cards FIRST — independent of hero setup, so a hero error can't block them
  try {
    renderRail(HOME_CARDS);
  } catch(e) {
    (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='RAIL ERR: '+e.message;})();
  }

  try {
    renderHomeV2();
  } catch (e) {
    err('renderHomeV2 error: ' + e.message);
  }

  // Boot visibility is UX state — hide immediately after render attempt.
  // Realtime, clock and auth listener initialise afterwards.
  hideBoot();
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='HOME: SHOWN';})();

  // Diagnostic watchdog: if boot is somehow still visible after 5s, force-remove it
  // and surface a minimal indicator so we can see what is underneath.
  setTimeout(() => {
    const boot = document.getElementById('boot');
    if (boot && boot.style.display !== 'none' && !boot.classList.contains('fade-out')) {
      err('Boot watchdog: boot still visible after 5s — forcing removal');
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

  // Clock tick
  updateClock();
  setInterval(updateClock, 30000);

  // Auth state listener disabled in display-only mode
  // startPairing() is recovery only — must not fire automatically
}

function updateClock() {
  const el = document.getElementById('home-clock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.getHours().toString().padStart(2,'0') + ':' +
                   now.getMinutes().toString().padStart(2,'0');
}

/* ── Canonical card manifest ── */
const HOME_CARDS = [
  { label: 'Academy',        img: 'https://olatoyefamily.com/hub/assets/cards/card-academy.png',        dest: 'academy' },
  { label: "Elsie's World",  img: 'https://olatoyefamily.com/hub/assets/cards/card-elsie.png',          dest: 'elsie' },
  { label: "Emma's World",   img: 'https://olatoyefamily.com/hub/assets/cards/card-emma.png',           dest: 'emma' },
  { label: 'Our Adventures', img: 'https://olatoyefamily.com/hub/assets/cards/card-adventures.png',     dest: 'adventures' },
  { label: 'Family Time',    img: 'https://olatoyefamily.com/hub/assets/cards/card-family-time.png',    dest: 'family-time' },
  { label: 'Watch',          img: 'https://olatoyefamily.com/hub/assets/cards/card-watch-B.png',        dest: 'watch' },
  { label: 'Coming Up',      img: 'https://olatoyefamily.com/hub/assets/cards/card-coming-up-A.png',    dest: 'coming-up' },
];

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
//  EMMA'S WORLD — birthday experience
// ══════════════════════════════════════════════════════

const EMMA_PHOTOS = [
  'https://olatoyefamily.com/hub/assets/emma/emma-01.png',
  'https://olatoyefamily.com/hub/assets/emma/emma-02.png',
  'https://olatoyefamily.com/hub/assets/emma/emma-03.png',
  'https://olatoyefamily.com/hub/assets/emma/emma-04.png',
  'https://olatoyefamily.com/hub/assets/emma/emma-05.png',
  'https://olatoyefamily.com/hub/assets/emma/emma-06.png',
  'https://olatoyefamily.com/hub/assets/emma/emma-07.png',
  'https://olatoyefamily.com/hub/assets/emma/emma-08.png',
  'https://olatoyefamily.com/hub/assets/emma/emma-09.png',
];

let _emmaSlideIdx = 0;

function openEmmaWorld() {
  probe('EMMA WORLD');
  let el = document.getElementById('view-emma');
  if (!el) {
    el = document.createElement('div');
    el.id = 'view-emma';
    el.style.cssText = 'position:fixed;inset:0;z-index:500;background:#1a0011;overflow:hidden;';
    document.body.appendChild(el);
  }

  // Build slides + overlay
  let slidesHtml = '';
  EMMA_PHOTOS.forEach((src, i) => {
    slidesHtml += '<div class="emma-slide" style="background-image:url(' + src + ');' +
      (i === 0 ? 'opacity:1;' : 'opacity:0;') + '"></div>';
  });

  el.innerHTML =
    '<style>' +
    '.emma-slide{position:absolute;inset:0;background-size:cover;background-position:center;' +
    'transition:opacity 1.6s ease-in-out;}' +
    '.emma-overlay{position:absolute;inset:0;z-index:2;' +
    'background:linear-gradient(to top,rgba(26,0,17,0.85) 0%,rgba(26,0,17,0.1) 35%,transparent 60%);}' +
    '.emma-banner{position:absolute;top:6vh;left:0;right:0;text-align:center;z-index:3;}' +
    '.emma-hbd{color:#fff;font-size:1.1em;font-weight:700;letter-spacing:0.3em;text-transform:uppercase;text-shadow:0 2px 20px rgba(0,0,0,0.6);}' +
    '.emma-name{font-family:Georgia,serif;color:#ff6ec7;font-size:5em;font-weight:800;' +
    'text-shadow:0 4px 30px rgba(255,110,199,0.5),0 2px 10px rgba(0,0,0,0.4);line-height:1;margin:0.1em 0;}' +
    '.emma-age{color:#fff;font-size:1.4em;font-weight:700;letter-spacing:0.1em;}' +
    '.emma-tagline{position:absolute;bottom:6vh;left:0;right:0;text-align:center;z-index:3;' +
    'color:rgba(255,255,255,0.85);font-size:0.85em;letter-spacing:0.15em;text-transform:uppercase;}' +
    '.emma-back{position:absolute;bottom:2vh;left:0;right:0;text-align:center;z-index:3;' +
    'color:rgba(255,255,255,0.4);font-size:0.6em;}' +
    '</style>' +
    slidesHtml +
    '<div class="emma-overlay"></div>' +
    '<div class="emma-banner">' +
      '<div class="emma-hbd">Happy Birthday</div>' +
      '<div class="emma-name">Emma</div>' +
      '<div class="emma-age">is 5 today</div>' +
    '</div>' +
    '<div class="emma-tagline">Magical today. Amazing always.</div>' +
    '<div class="emma-back">Press Back to return home</div>';

  el.style.display = 'block';
  _inDestination = true;

  // Start slideshow
  _emmaSlideIdx = 0;
  if (_emmaTimer) clearInterval(_emmaTimer);
  _emmaTimer = setInterval(() => {
    const slides = el.querySelectorAll('.emma-slide');
    if (!slides.length) return;
    slides[_emmaSlideIdx].style.opacity = '0';
    _emmaSlideIdx = (_emmaSlideIdx + 1) % slides.length;
    slides[_emmaSlideIdx].style.opacity = '1';
  }, 5000);
}

// ══════════════════════════════════════════════════════
//  DESTINATIONS — what opens when a card is clicked
// ══════════════════════════════════════════════════════

function openDestination(dest, label) {
  probe('OPEN: ' + dest);
  if (dest === 'emma') { openEmmaWorld(); return; }
  // Other destinations — placeholder for now
  showDestinationPlaceholder(label);
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
  const el = document.getElementById('view-destination');
  const emma = document.getElementById('view-emma');
  if (el) el.style.display = 'none';
  if (emma) emma.style.display = 'none';
  _inDestination = false;
  if (_emmaTimer) { clearInterval(_emmaTimer); _emmaTimer = null; }
}

let _inDestination = false;
let _emmaTimer = null;

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

  // Set initial card focus
  setCardFocus(0);
  probe('CARDS: ' + document.querySelectorAll('.rail-card').length);
}

function setCardFocus(idx) {
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
}

function setNavFocus(idx) {
  const items = document.querySelectorAll('.nav-item');
  if (!items.length) return;
  _navIdx = Math.max(0, Math.min(idx, items.length - 1));
  items.forEach((n, i) => n.classList.toggle('focused', i === _navIdx));
}

// ── D-pad keyboard handler ─────────────────────────────────────
document.addEventListener('keydown', function(e) {
  const key = e.key || '';
  const code = e.keyCode || 0;

  // Back button (Android keyCode 4, or Escape) — close destination
  if (code === 4 || code === 27 || key === 'Escape' || key === 'GoBack') {
    if (_inDestination) { e.preventDefault(); closeDestination(); return; }
  }

  // If in a destination, let it handle its own keys
  if (_inDestination) return;

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
    if (isLeft)  setCardFocus(_cardIdx - 1);
    if (isRight) setCardFocus(_cardIdx + 1);
    if (isDown) {
      _navZone = 'nav';
      // Remove focused from cards
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
  setTimeout(() => { if (boot) boot.style.display = 'none'; }, 700);
}

/* ════════════════════════════════════════════════════════════════
   UTILITIES
   ════════════════════════════════════════════════════════════════ */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
