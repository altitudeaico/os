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

// Destination state — declared early to avoid temporal dead zone
var _inDestination = false;
var _emmaTimer = null;

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

var _emmaSlideIdx = 0;

async function loadEmmaContent() {
  // Load photos, music, itinerary from Supabase (public read)
  const EMMA_API = 'https://fypwabbhxnnwcpfjwrda.supabase.co/rest/v1';
  const EMMA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cHdhYmJoeG5ud2NwZmp3cmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDg3ODUsImV4cCI6MjEwNDEyNDc4NX0.BwzgTd8_-lxENXnTu9ukxnHsgh3diguZbJPnzzC7XD4';
  const hdr = { 'apikey': EMMA_KEY, 'Authorization': 'Bearer ' + EMMA_KEY };
  try {
    const [ph, mu, it] = await Promise.all([
      fetch(EMMA_API + '/emma_photos?select=url&order=sort_order', { headers: hdr }).then(r => r.json()),
      fetch(EMMA_API + '/emma_music?select=url,title&order=sort_order', { headers: hdr }).then(r => r.json()),
      fetch(EMMA_API + '/emma_itinerary?select=time_label,activity&order=sort_order', { headers: hdr }).then(r => r.json()),
    ]);
    return {
      photos: (ph && ph.length) ? ph.map(p => p.url) : EMMA_PHOTOS,
      music:  (mu && mu.length) ? mu : [],
      itinerary: (it && it.length) ? it : [],
    };
  } catch (e) {
    return { photos: EMMA_PHOTOS, music: [], itinerary: [] };
  }
}


// Refresh Emma's World content (photos, music, itinerary) without leaving
async function refreshEmmaContent() {
  probe('EMMA: refreshing...');
  // Stop current audio cleanly
  if (window._emmaAudio) { try { window._emmaAudio.pause(); } catch(e){} }
  window._emmaAudio = null;
  window._emmaMusicIdx = 0;
  // Re-open Emma's World — reloads everything from Supabase
  await openEmmaWorld();
}

async function openEmmaWorld() {
  probe('EMMA WORLD');
  let el = document.getElementById('view-emma');
  if (!el) {
    el = document.createElement('div');
    el.id = 'view-emma';
    el.style.cssText = 'position:fixed;inset:0;z-index:500;background:#1a0011;overflow:hidden;';
    document.body.appendChild(el);
  }

  el.style.display = 'block';
  _inDestination = true;

  // Load content from Supabase
  const content = await loadEmmaContent();
  const photos = content.photos;
  window._emmaMusic = content.music;
  window._emmaItinerary = content.itinerary;

  // Build slides
  let slidesHtml = '';
  photos.forEach((src, i) => {
    slidesHtml += '<div class="emma-slide" style="background-image:url(' + src + ');' +
      (i === 0 ? 'opacity:1;' : 'opacity:0;') + '"></div>';
  });

  // Itinerary panel HTML
  let itinHtml = '';
  if (window._emmaItinerary && window._emmaItinerary.length) {
    itinHtml = '<div class="emma-itin"><div class="emma-itin-title">Today</div>' +
      window._emmaItinerary.map(it =>
        '<div class="emma-itin-row"><span class="emma-itin-time">' + it.time_label + '</span>' +
        '<span class="emma-itin-act">' + it.activity + '</span></div>'
      ).join('') + '</div>';
  }

  el.innerHTML =
    '<style>' +
    '.emma-slide{position:absolute;inset:0;background-size:cover;background-position:center;' +
    'transition:opacity 1.6s ease-in-out;}' +
    '.emma-itin{position:absolute;top:6vh;right:4vw;z-index:4;' +
    'background:rgba(26,0,17,0.6);backdrop-filter:blur(8px);border:1px solid rgba(255,110,199,0.3);' +
    'border-radius:14px;padding:1.2em 1.5em;max-width:28vw;}' +
    '.emma-itin-title{color:#ff6ec7;font-size:0.7em;font-weight:700;letter-spacing:0.15em;' +
    'text-transform:uppercase;margin-bottom:0.8em;}' +
    '.emma-itin-row{display:flex;gap:0.8em;margin-bottom:0.5em;align-items:baseline;}' +
    '.emma-itin-time{color:#ff6ec7;font-size:0.6em;font-weight:700;flex:0 0 auto;min-width:4em;}' +
    '.emma-itin-act{color:#fff;font-size:0.6em;}' +
    '.emma-refresh{position:absolute;top:4vh;left:4vw;z-index:6;background:rgba(26,0,17,0.7);border:1px solid rgba(255,110,199,0.4);border-radius:20px;padding:0.5em 1.1em;color:#ff6ec7;font-size:0.5em;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;}' +
    '.emma-back{position:absolute;bottom:2vh;left:0;right:0;text-align:center;z-index:3;' +
    'color:rgba(255,255,255,0.35);font-size:0.55em;letter-spacing:0.1em;}' +
    '</style>' +
    slidesHtml +
    itinHtml +
    '<div class="emma-refresh">\u21bb Refresh</div>' +
    '<div class="emma-back">Press Back to return home  ·  Press UP to refresh</div>';

  // Slideshow — auto-advance + manual skip
  _emmaSlideIdx = 0;
  function showSlide(i) {
    const slides = el.querySelectorAll('.emma-slide');
    if (!slides.length) return;
    slides[_emmaSlideIdx].style.opacity = '0';
    _emmaSlideIdx = ((i % slides.length) + slides.length) % slides.length;
    slides[_emmaSlideIdx].style.opacity = '1';
  }
  window._emmaNextPhoto = () => { showSlide(_emmaSlideIdx + 1); restartSlideTimer(); };
  window._emmaPrevPhoto = () => { showSlide(_emmaSlideIdx - 1); restartSlideTimer(); };
  function restartSlideTimer() {
    if (_emmaTimer) clearInterval(_emmaTimer);
    _emmaTimer = setInterval(() => { showSlide(_emmaSlideIdx + 1); }, 5000);
  }
  restartSlideTimer();

  // Music player — Spotify-style now-playing card + auto-advance playlist
  startEmmaPlayer(el);

  // Auto-poll for new content added via admin page (every 25s) — no button needed
  if (window._emmaPoll) clearInterval(window._emmaPoll);
  window._emmaPoll = setInterval(async () => {
    // Only poll if still in Emma's World
    const stillOpen = document.getElementById('view-emma') &&
                      document.getElementById('view-emma').style.display !== 'none';
    if (!stillOpen) { clearInterval(window._emmaPoll); return; }
    const fresh = await loadEmmaContent();
    // If photo count changed, rebuild slides
    const curSlides = document.querySelectorAll('.emma-slide').length;
    if (fresh.photos.length !== curSlides) {
      refreshEmmaContent();
    }
  }, 25000);
}

function startEmmaPlayer(el) {
  const music = window._emmaMusic || [];
  if (!music.length) return;

  // Single persistent audio element — swapping src avoids autoplay re-block
  if (!window._emmaAudio) {
    window._emmaAudio = new Audio();
    window._emmaAudio.volume = 0.6;
  }
  const audio = window._emmaAudio;
  window._emmaMusicIdx = window._emmaMusicIdx || 0;
  window._emmaPlaying = true;

  // Build the player UI
  let player = document.getElementById('emma-player');
  if (!player) {
    player = document.createElement('div');
    player.id = 'emma-player';
    player.style.cssText =
      'position:absolute;bottom:4vh;left:4vw;z-index:6;' +
      'background:rgba(26,0,17,0.78);backdrop-filter:blur(12px);' +
      'border:1px solid rgba(255,110,199,0.35);border-radius:18px;' +
      'padding:1.1em 1.5em;min-width:26vw;max-width:34vw;';
    el.appendChild(player);
  }

  function fmt(s) {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s/60), sec = Math.floor(s%60);
    return m + ':' + (sec<10?'0':'') + sec;
  }

  function renderPlayer() {
    const t = music[window._emmaMusicIdx] || {};
    const playing = window._emmaPlaying;
    let listHtml = '';
    if (window._emmaShowList) {
      listHtml = '<div style="margin-top:0.9em;border-top:1px solid rgba(255,255,255,0.12);padding-top:0.7em;max-height:20vh;overflow:hidden;">' +
        '<div style="color:rgba(255,255,255,0.35);font-size:0.4em;text-align:center;margin-bottom:0.5em;letter-spacing:0.05em;">UP/DOWN choose \u00b7 OK play \u00b7 LEFT or BACK close</div>' +
        music.map((m, i) =>
          '<div style="display:flex;align-items:center;gap:0.6em;padding:0.35em 0.5em;border-radius:8px;' +
          (i === window._emmaMusicIdx ? 'background:rgba(255,110,199,0.25);' : '') +
          (i === window._emmaListSel ? 'outline:2px solid #ff6ec7;' : '') + '">' +
          '<span style="color:' + (i===window._emmaMusicIdx?'#ff6ec7':'rgba(255,255,255,0.4)') + ';font-size:0.5em;">' + (i===window._emmaMusicIdx?'▶':(i+1)) + '</span>' +
          '<span style="color:#fff;font-size:0.52em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (m.title||'Track') + '</span>' +
          '</div>'
        ).join('') + '</div>';
    }
    player.innerHTML =
      '<div style="display:flex;align-items:center;gap:1em;">' +
        '<div style="width:2.8em;height:2.8em;border-radius:10px;flex:0 0 auto;' +
        'background:linear-gradient(135deg,#ff6ec7,#c9457f);display:flex;align-items:center;justify-content:center;font-size:1.3em;">' + (playing?'🎵':'⏸') + '</div>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="color:#fff;font-size:0.62em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (t.title||'Music') + '</div>' +
          '<div style="color:#ff6ec7;font-size:0.44em;letter-spacing:0.1em;text-transform:uppercase;margin-top:0.15em;">' + (playing?'Now Playing':'Paused') + ' · ' + (window._emmaMusicIdx+1) + '/' + music.length + '</div>' +
          '<div style="display:flex;align-items:center;gap:0.5em;margin-top:0.5em;">' +
            '<span style="color:rgba(255,255,255,0.4);font-size:0.4em;">' + fmt(audio.currentTime) + '</span>' +
            '<div style="flex:1;height:3px;background:rgba(255,255,255,0.15);border-radius:2px;overflow:hidden;">' +
              '<div id="emma-prog" style="height:100%;width:' + (audio.duration?100*audio.currentTime/audio.duration:0) + '%;background:#ff6ec7;"></div>' +
            '</div>' +
            '<span style="color:rgba(255,255,255,0.4);font-size:0.4em;">' + fmt(audio.duration) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:center;gap:1.5em;margin-top:0.7em;color:rgba(255,255,255,0.7);font-size:0.7em;">' +
        '<span>⏮</span><span>' + (playing?'⏸':'▶') + '</span><span>⏭</span><span style="color:' + (window._emmaShowList?'#ff6ec7':'rgba(255,255,255,0.7)') + ';">☰</span>' +
      '</div>' +
      '<div style="text-align:center;color:rgba(255,255,255,0.3);font-size:0.4em;margin-top:0.5em;letter-spacing:0.05em;">' +
        '◀▶ photos · OK play/pause · DOWN playlist · UP refresh' +
      '</div>' +
      listHtml;
  }

  function loadAndPlay(i, autoplay) {
    window._emmaMusicIdx = ((i % music.length) + music.length) % music.length;
    audio.src = music[window._emmaMusicIdx].url;
    if (autoplay !== false) {
      audio.play().then(() => { window._emmaPlaying = true; renderPlayer(); }).catch(() => { window._emmaPlaying = false; renderPlayer(); });
    }
    renderPlayer();
  }

  audio.onended = () => { loadAndPlay(window._emmaMusicIdx + 1, true); };
  audio.ontimeupdate = () => {
    const bar = document.getElementById('emma-prog');
    if (bar && audio.duration) bar.style.width = (100*audio.currentTime/audio.duration) + '%';
  };

  // Expose controls for D-pad
  window._emmaPlayPause = () => {
    if (audio.paused) { audio.play().then(()=>{window._emmaPlaying=true;renderPlayer();}).catch(()=>{}); }
    else { audio.pause(); window._emmaPlaying=false; renderPlayer(); }
  };
  window._emmaNextSong = () => loadAndPlay(window._emmaMusicIdx + 1, true);
  window._emmaPrevSong = () => loadAndPlay(window._emmaMusicIdx - 1, true);
  window._emmaToggleList = () => { window._emmaShowList = !window._emmaShowList; window._emmaListSel = window._emmaMusicIdx; renderPlayer(); };
  window._emmaListMove = (dir) => {
    if (!window._emmaShowList) return;
    window._emmaListSel = ((window._emmaListSel + dir) % music.length + music.length) % music.length;
    renderPlayer();
  };
  window._emmaListSelect = () => {
    if (!window._emmaShowList) return;
    loadAndPlay(window._emmaListSel, true);
  };
  window._emmaListOpen = () => window._emmaShowList;

  window._emmaShowList = false;
  window._emmaListSel = 0;
  loadAndPlay(window._emmaMusicIdx, true);
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
  if (window._emmaAudio) { window._emmaAudio.pause(); window._emmaAudio = null; }
  if (window._emmaPoll) { clearInterval(window._emmaPoll); window._emmaPoll = null; }
}

// Called by Android Back button. Returns true if handled (in a destination),
// false if at Home (Android should exit).
window.fosHandleBack = function() {
  if (_inDestination) {
    closeDestination();
    return true;
  }
  return false;
};

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

  // Back button (Android keyCode 4, or Escape) — close destination
  if (code === 4 || code === 27 || key === 'Escape' || key === 'GoBack') {
    if (_inDestination) { e.preventDefault(); closeDestination(); return; }
  }

  // If in a destination, handle destination-specific keys
  if (_inDestination) {
    const emmaOpen = document.getElementById('view-emma') &&
                     document.getElementById('view-emma').style.display !== 'none';
    if (emmaOpen) {
      const isL = (key === 'ArrowLeft'  || code === 37);
      const isR = (key === 'ArrowRight' || code === 39);
      const isU = (key === 'ArrowUp'    || code === 38);
      const isD = (key === 'ArrowDown'  || code === 40);
      const isOK = (key === 'Enter' || code === 13 || code === 23);

      // Playlist open: UP/DOWN navigates list, OK selects, LEFT or Back closes
      if (window._emmaListOpen && window._emmaListOpen()) {
        if (isU) { e.preventDefault(); window._emmaListMove(-1); return; }
        if (isD) { e.preventDefault(); window._emmaListMove(1); return; }
        if (isOK){ e.preventDefault(); window._emmaListSelect(); return; }
        if (isL) { e.preventDefault(); window._emmaToggleList(); return; }
        if (code === 4 || code === 27 || key === 'Escape') { e.preventDefault(); window._emmaToggleList(); return; }
        return;
      }
      // Normal controls: LEFT/RIGHT skips PHOTOS, OK play/pause music, DOWN playlist, UP refresh
      if (isU) { e.preventDefault(); refreshEmmaContent(); return; }
      if (isL) { e.preventDefault(); window._emmaPrevPhoto && window._emmaPrevPhoto(); return; }
      if (isR) { e.preventDefault(); window._emmaNextPhoto && window._emmaNextPhoto(); return; }
      if (isD) { e.preventDefault(); window._emmaToggleList && window._emmaToggleList(); return; }
      if (isOK){ e.preventDefault(); window._emmaPlayPause && window._emmaPlayPause(); return; }
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
    if (isUp)    trackUpForRefresh();
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
