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
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='initSurface: START';})();
  log('Checking for stored Surface session');

  // Try to restore session from localStorage
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='init: loadStoredSession BEFORE';})();
  const stored = loadStoredSession();
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='init: loadStoredSession AFTER ' + (stored?'found':'none');})();

  if (stored) {
    log('Stored session found — restoring');
    try {
      (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='init: setSession BEFORE';})();
      const { data, error } = await _sb.auth.setSession({
        access_token:  stored.access_token,
        refresh_token: stored.refresh_token,
      });
      (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='init: setSession AFTER';})();

      if (error || !data?.session) {
        warn('Session restore failed: ' + (error?.message ?? 'no session'));
        (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='init: session INVALID';})();
        clearSession();
        await startPairing();
        return;
      }

      _session = data.session;
      log('Session restored — identity_class: ' + (_session.user?.app_metadata?.identity_class ?? 'none'));
      (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='init: session VALID';})();
      storeSession(_session);
      await showHome();
      return;
    } catch (e) {
      err('Session restore exception: ' + e.message);
      (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='init: setSession EXCEPTION';})();
      clearSession();
    }
  }

  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='init: startPairing ENTER';})();
  log('No stored session — starting pairing');
  await startPairing();
}

/* ════════════════════════════════════════════════════════════════
   SESSION MANAGEMENT
   ════════════════════════════════════════════════════════════════ */

function loadStoredSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    // Basic validity check — token structure present
    if (s?.access_token && s?.refresh_token) return s;
    return null;
  } catch { return null; }
}

function storeSession(session) {
  _session = session;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      access_token:  session.access_token,
      refresh_token: session.refresh_token,
      expires_at:    session.expires_at,
    }));
  } catch (e) { err('Failed to store session: ' + e.message); }
}

function clearSession() {
  _session = null;
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(PAIRING_KEY);
  } catch {}
}

/* ════════════════════════════════════════════════════════════════
   PAIRING FLOW
   ════════════════════════════════════════════════════════════════ */

async function startPairing() {
  showView('pairing');
  renderPairingScreen('Connecting...');

  try {
    const r = await fetch(IDENTITY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'request_surface_pairing',
        payload: { household_id: HOUSEHOLD_ID, surface_type: 'tv' }
      })
    });
    const data = await r.json();

    if (!data.ok) {
      err('Pairing request failed: ' + data.error);
      renderPairingScreen('Unable to connect. Retrying...', null, null, true);
      setTimeout(startPairing, 30000);
      return;
    }

    // Store pairing state in memory + localStorage (claim_secret never shown on screen)
    const pairingState = {
      pairing_code: data.pairing_code,
      claim_secret: data.claim_secret,
      expires_at:   data.expires_at,
    };
    try { localStorage.setItem(PAIRING_KEY, JSON.stringify(pairingState)); } catch {}

    log('Pairing code generated: ' + data.pairing_code);
    renderPairingScreen(null, data.pairing_code, data.expires_at);

    // Poll for session claim every 3 seconds
    _pairingTimer = setInterval(() => pollForSession(pairingState), 3000);

  } catch (e) {
    err('Pairing network error: ' + e.message);
    renderPairingScreen('Network error. Retrying...', null, null, true);
    setTimeout(startPairing, 15000);
  }
}

async function pollForSession(pairingState) {
  (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: poll';})();
  try {
    (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: claim BEFORE';})();
    const r = await fetch(IDENTITY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation: 'claim_surface_session',
        payload: {
          pairing_code: pairingState.pairing_code,
          claim_secret: pairingState.claim_secret,
        }
      })
    });
    (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: claim AFTER';})();

    if (r.status === 404) return; // Not approved yet — keep polling
    if (r.status === 410) {
      // Claim window expired — generate new code
      clearInterval(_pairingTimer);
      clearInterval(_expiryTimer);
      setTimeout(startPairing, 1000);
      return;
    }

    const data = await r.json();
    if (data.ok && data.session) {
      (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: approved';})();
      clearInterval(_pairingTimer);
      clearInterval(_expiryTimer);
      log('Surface session claimed — establishing authenticated client');

      (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: setSession BEFORE';})();
      const { data: authData, error } = await _sb.auth.setSession({
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: setSession AFTER';})();

      if (error || !authData?.session) {
        err('Failed to establish session after claim: ' + (error?.message ?? 'no session'));
        (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: setSession FAILED';})();
        await startPairing();
        return;
      }

      _session = authData.session;
      const identityClass = _session.user?.app_metadata?.identity_class;
      log('Session established — identity_class: ' + identityClass);

      if (identityClass !== 'surface') {
        err('Session does not have surface identity — rejecting');
        (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: identity INVALID';})();
        clearSession();
        await startPairing();
        return;
      }

      storeSession(_session);

      (function(){var p=document.getElementById('fos-probe');if(p)p.textContent='pairing: showHome ENTER';})();
      // Brief 'Screen connected' moment before transitioning to Home
      renderPairingConnected();
      await sleep(2500);
      await showHome();
    }
  } catch (e) {
    // Network error during poll — silent, keep polling
    warn('Poll error (will retry): ' + e.message);
  }
}

/* ════════════════════════════════════════════════════════════════
   PAIRING SCREEN RENDER
   Phase 0B: functional, polished, minimal.
   V2 visual treatment comes after visual design phase.
   ════════════════════════════════════════════════════════════════ */

function renderPairingScreen(statusMsg, pairingCode, expiresAt, isError) {
  const el = document.getElementById('view-pairing');

  el.innerHTML = `
    <div style="
      position:fixed;inset:0;
      background:#080d08;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;
      gap:0;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    ">
      <!-- Logo -->
      <img src="https://olatoyefamily.com/logo.jpg"
           style="width:80px;height:80px;border-radius:18px;object-fit:cover;
                  margin-bottom:28px;opacity:0.9;"
           onerror="this.style.display='none'" alt="Family OS">

      <!-- Wordmark -->
      <div style="color:#C9A84C;font-size:11px;font-weight:700;
                  letter-spacing:0.2em;text-transform:uppercase;margin-bottom:10px;">
        Olatoye Family OS
      </div>

      ${pairingCode ? `
        <!-- Heading -->
        <div style="color:#fff;font-size:32px;font-weight:700;
                    letter-spacing:-0.02em;margin-bottom:6px;">
          Set up this screen
        </div>
        <div style="color:rgba(255,255,255,0.4);font-size:15px;margin-bottom:40px;">
          Open Parent Control on your phone and tap Connect Screen.
        </div>

        <!-- Code box -->
        <div style="
          background:rgba(255,255,255,0.06);
          border:1px solid rgba(255,255,255,0.12);
          border-radius:20px;
          padding:28px 56px;
          text-align:center;
          margin-bottom:24px;
        ">
          <div style="color:rgba(255,255,255,0.45);font-size:12px;
                      letter-spacing:0.12em;text-transform:uppercase;margin-bottom:14px;">
            Pairing Code
          </div>
          <div id="pairing-code-display" style="
            color:#fff;font-size:56px;font-weight:800;
            letter-spacing:0.15em;font-variant-numeric:tabular-nums;
          ">${pairingCode}</div>
          <div id="pairing-expires" style="
            color:rgba(255,255,255,0.28);font-size:13px;margin-top:14px;
          ">Loading...</div>
        </div>
      ` : `
        <!-- Status only -->
        <div style="color:rgba(255,255,255,${isError ? '0.5' : '0.35'});
                    font-size:16px;margin-top:16px;">
          ${statusMsg ?? 'Please wait...'}
        </div>
      `}
    </div>
  `;

  // Start expiry countdown if we have an expires_at
  if (expiresAt) {
    clearInterval(_expiryTimer);
    const expiresDate = new Date(expiresAt);

    const updateExpiry = () => {
      const el = document.getElementById('pairing-expires');
      if (!el) { clearInterval(_expiryTimer); return; }
      const secsLeft = Math.max(0, Math.floor((expiresDate - Date.now()) / 1000));
      const mins = Math.floor(secsLeft / 60);
      const secs = (secsLeft % 60).toString().padStart(2, '0');
      el.textContent = secsLeft > 0
        ? `Code expires in ${mins}:${secs}`
        : 'Code expired — refreshing...';
      if (secsLeft === 0) {
        clearInterval(_expiryTimer);
        clearInterval(_pairingTimer);
        setTimeout(startPairing, 1500);
      }
    };

    updateExpiry();
    _expiryTimer = setInterval(updateExpiry, 1000);
  }
}

function renderPairingConnected() {
  const el = document.getElementById('view-pairing');
  el.innerHTML = `
    <div style="
      position:fixed;inset:0;background:#080d08;
      display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:16px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    ">
      <div style="color:#30d158;font-size:48px;">✓</div>
      <div style="color:#fff;font-size:28px;font-weight:700;">Screen connected.</div>
      <div style="color:rgba(255,255,255,0.5);font-size:18px;">Welcome home, Olatoyes.</div>
    </div>
  `;
}

/* ════════════════════════════════════════════════════════════════
   HOME — V2 Production
   Full-bleed hero · Large artwork cards · Real Supabase state
   ════════════════════════════════════════════════════════════════ */

/* ── Canonical card manifest ── */
const HOME_CARDS = [
  { label: 'Academy',       img: 'https://olatoyefamily.com/hub/assets/cards/card-academy.png' },
  { label: "Elsie's World", img: 'https://olatoyefamily.com/hub/assets/cards/card-elsie.png' },
  { label: "Emma's World",  img: 'https://olatoyefamily.com/hub/assets/cards/card-emma.png' },
  { label: 'Our Adventures',img: 'https://olatoyefamily.com/hub/assets/cards/card-adventures.png' },
  { label: 'Family Time',   img: 'https://olatoyefamily.com/hub/assets/cards/card-family-time.png' },
  { label: 'Watch',         img: 'https://olatoyefamily.com/hub/assets/cards/card-watch-B.png' },
  { label: 'Coming Up',     img: 'https://olatoyefamily.com/hub/assets/cards/card-coming-up-A.png' },
];

/* ── Hero images mapped to time-of-day ── */
function heroForTime() {
  const h = new Date().getHours();
  if (h >= 5 && h < 17) return 'https://olatoyefamily.com/hub/assets/heroes/hero-morning-academy.png';
  return 'https://olatoyefamily.com/hub/assets/heroes/hero-evening-family-B.png';
}

/* ── Context text mapped to time-of-day ── */
function contextForTime() {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Good morning, Olatoye Family';
  if (h >= 12 && h < 17) return 'Good afternoon, Olatoye Family';
  return 'Good evening, Olatoye Family';
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
  if (label) label.textContent = isConnected ? 'Family OS online' : msg;
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
