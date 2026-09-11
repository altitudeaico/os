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

async function initSurface() {
  log('initSurface: going straight to Home');
  await showHome();
}


async function showHome() {
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='showHome: START';})();
  showView('home');

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

  // Session expiry listener
  _sb.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && session) {
      log('Token refreshed automatically');
      storeSession(session);
      _session = session;
    }
    if (event === 'SIGNED_OUT') {
      warn('Session signed out — returning to pairing');
      clearSession();
      startPairing();
    }
  });
}

function updateClock() {
  const el = document.getElementById('home-clock');
  if (!el) return;
  const now = new Date();
  el.textContent = now.getHours().toString().padStart(2,'0') + ':' +
                   now.getMinutes().toString().padStart(2,'0');
}

function renderHomeV2() {
  try {
  // Hero background — time-of-day aware
  const heroBg = document.getElementById('home-hero-bg');
  if (heroBg) heroBg.style.backgroundImage = 'url(' + heroForTime() + ')';

  // Hero text — defaults, overridden by hub_state when Realtime delivers
  setHeroText({ context: contextForTime(), heading: 'Welcome home.', meta: '' });

  // Rail — canonical card set
  renderRail(HOME_CARDS);

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

function renderRail(cards) {
  const rail = document.getElementById('rail-cards');
  if (!rail) return;
  rail.innerHTML = '';
  let focusIdx = 0;

  cards.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'rail-card' + (i === 0 ? ' focused' : '');
    el.tabIndex = 0;
    el.dataset.idx = i;

    if (card.img) {
      el.innerHTML = `<img class="rail-card-img" src="${card.img}" alt="" loading="lazy">
        <div class="rail-card-gradient"></div>
        <div class="rail-card-label">${card.label}</div>`;
    } else {
      el.innerHTML = `<div class="rail-card-bg" style="--card-bg:${card.bg || 'rgba(255,255,255,0.06)'}"></div>
        <div class="rail-card-label">${card.label}</div>`;
    }

    el.addEventListener('focus', () => {
      document.querySelectorAll('.rail-card').forEach(c => c.classList.remove('focused'));
      el.classList.add('focused');
    });

    rail.appendChild(el);
  });
}

/* ════════════════════════════════════════════════════════════════
   REALTIME — authenticated surface-scoped connection
   RLS: surface can only receive hub_state for its own surface_id.
   ════════════════════════════════════════════════════════════════ */

function connectRealtime() {
  // No session — skip Realtime, show static status
  if (!_sb) {
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
