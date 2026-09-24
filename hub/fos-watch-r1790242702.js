/* ══════════════════════════════════════════════════════════════
   WATCH — the household's own video platform
   Views: watch-main -> watch-player
   Grammar: FOCUS -> OK plays -> OK pauses -> BACK closes.

   Source of truth is the watch_catalog view in Supabase. Any
   content_item with a playable video URL that is not a draft,
   hidden or archived appears here automatically, plus Elsie's
   cheer videos. Nothing is curated by hand in this file.

   Children's finished edits enter as drafts and only reach Watch
   once the creator approves them in her control page.
   ══════════════════════════════════════════════════════════════ */

const WATCH_API = 'https://fypwabbhxnnwcpfjwrda.supabase.co/rest/v1';
const WATCH_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cHdhYmJoeG5ud2NwZmp3cmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDg3ODUsImV4cCI6MjEwNDEyNDc4NX0.BwzgTd8_-lxENXnTu9ukxnHsgh3diguZbJPnzzC7XD4';
const WATCH_SHELF_ORDER = ['Reels & edits', 'Home videos', 'Cheer'];

var watchState = {
  items: [], shelves: [],
  focus: null, nav: null,
  playingIdx: -1, video: null, hintTimer: null,
};

async function watchLoadCatalog() {
  try {
    var r = await fetch(WATCH_API + '/watch_catalog?select=*&order=dated_at.desc',
      { headers: { apikey: WATCH_KEY, Authorization: 'Bearer ' + WATCH_KEY } });
    var rows = await r.json();
    return Array.isArray(rows) ? rows : [];
  } catch (e) { return []; }
}

function watchGroup(items) {
  var by = {};
  items.forEach(function (it, i) { it._idx = i; (by[it.shelf] = by[it.shelf] || []).push(it); });
  var names = Object.keys(by).sort(function (a, b) {
    var ia = WATCH_SHELF_ORDER.indexOf(a), ib = WATCH_SHELF_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return names.map(function (n) { return { name: n, items: by[n] }; });
}

async function openWatch() {
  var el = document.getElementById('view-watch');
  if (!el) { el = document.createElement('div'); el.id = 'view-watch'; document.body.appendChild(el); }
  el.style.cssText = 'position:fixed;inset:0;z-index:500;background:#0b0714;overflow:hidden;';
  el.style.display = 'block';
  _inDestination = true;

  watchInjectStyles();
  el.innerHTML = '<div class="watch-loading">Loading Watch\u2026</div>';
  watchState.items = await watchLoadCatalog();
  watchState.shelves = watchGroup(watchState.items);
  el.innerHTML = watchBuildHTML();

  watchState.focus = new FOSFocus();
  watchState.nav = new FOSNav();
  watchState.nav.onEmpty = function () { watchExitToHome(); };
  watchState.nav.push('watch-main', null, null, null);
  watchFocusMain(null);
}

function watchEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function watchBuildHTML() {
  if (!watchState.items.length) {
    return '<div class="watch-head"><div class="watch-kicker">Family OS</div><div class="watch-title">Watch</div></div>' +
      '<div class="watch-empty">Nothing to watch yet.<br><span>Approved reels and family videos appear here automatically.</span></div>' +
      '<div class="watch-hint" id="watch-hint">Back  Return home</div>';
  }
  var shelvesHtml = watchState.shelves.map(function (s, si) {
    var cards = s.items.map(function (it) {
      var portrait = (it.orientation || 'portrait') === 'portrait';
      var bg = it.poster_url ? 'background-image:url(' + watchEsc(it.poster_url) + ');' : '';
      var sub = [it.person, it.event_title].filter(Boolean).join(' \u00b7 ');
      var dur = it.duration_seconds ? Math.round(it.duration_seconds) + 's' : '';
      return '<div class="watch-card ' + (portrait ? 'is-portrait' : 'is-landscape') + '" data-idx="' + it._idx + '">' +
        '<div class="watch-thumb" style="' + bg + '">' +
          (it.poster_url ? '' : '<div class="watch-thumb-fallback">\u25b6</div>') +
          (dur ? '<div class="watch-dur">' + dur + '</div>' : '') +
        '</div>' +
        '<div class="watch-card-t">' + watchEsc(it.title) + '</div>' +
        (sub ? '<div class="watch-card-s">' + watchEsc(sub) + '</div>' : '') +
      '</div>';
    }).join('');
    return '<div class="watch-shelf"><div class="watch-shelf-name">' + watchEsc(s.name) + '</div>' +
      '<div class="watch-row" data-shelf="' + si + '">' + cards + '</div></div>';
  }).join('');
  return '<div class="watch-head"><div class="watch-kicker">Family OS</div><div class="watch-title">Watch</div></div>' +
    '<div class="watch-shelves" id="watch-shelves">' + shelvesHtml + '</div>' +
    '<div class="watch-player" id="watch-player"></div>' +
    '<div class="watch-hint" id="watch-hint">\u25c0\u25b6\u25b2\u25bc  Browse    OK  Play    Back  Home</div>';
}

function watchInjectStyles() {
  if (document.getElementById('watch-styles')) return;
  var s = document.createElement('style');
  s.id = 'watch-styles';
  s.textContent =
    '#view-watch{color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +
    '.watch-loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);font-size:1.4vw;}' +
    '.watch-head{position:absolute;left:4vw;top:3.2vw;}' +
    '.watch-kicker{color:#C9A84C;font-size:0.8vw;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;}' +
    '.watch-title{font-size:3vw;font-weight:800;margin-top:0.2vw;}' +
    '.watch-shelves{position:absolute;left:0;right:0;top:9.5vw;bottom:3.5vw;overflow:hidden;padding:0 4vw;}' +
    '.watch-shelf{margin-bottom:1.6vw;}' +
    '.watch-shelf-name{font-size:1.2vw;font-weight:700;color:rgba(255,255,255,0.8);margin-bottom:0.8vw;}' +
    '.watch-row{display:flex;gap:1.2vw;overflow-x:auto;overflow-y:visible;padding:0.6vw 0.4vw 0.8vw;scrollbar-width:none;}' +
    '.watch-row::-webkit-scrollbar{display:none;}' +
    '.watch-card{flex:0 0 auto;transition:transform 0.18s ease;}' +
    '.watch-card.is-portrait .watch-thumb{width:10.5vw;height:18.7vw;}' +
    '.watch-card.is-landscape .watch-thumb{width:24vw;height:13.5vw;}' +
    '.watch-thumb{position:relative;border-radius:0.8vw;background:#1d1430 center/cover no-repeat;border:0.18vw solid transparent;}' +
    '.watch-thumb-fallback{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:3vw;color:rgba(255,255,255,0.35);}' +
    '.watch-dur{position:absolute;right:0.5vw;bottom:0.5vw;background:rgba(0,0,0,0.6);border-radius:0.4vw;padding:0.15vw 0.45vw;font-size:0.75vw;font-weight:600;}' +
    '.watch-card-t{margin-top:0.6vw;font-size:0.95vw;font-weight:700;max-width:10.5vw;}' +
    '.watch-card.is-landscape .watch-card-t,.watch-card.is-landscape .watch-card-s{max-width:24vw;}' +
    '.watch-card-s{font-size:0.75vw;color:rgba(255,255,255,0.5);margin-top:0.15vw;max-width:10.5vw;}' +
    '.watch-card.fos-focused{transform:scale(1.06);}' +
    '.watch-card.fos-focused .watch-thumb{border-color:#8b5cf6;box-shadow:0 0 0 0.1vw rgba(139,92,246,0.5),0 0 2vw rgba(139,92,246,0.35);}' +
    '.watch-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font-size:2vw;font-weight:700;text-align:center;}' +
    '.watch-empty span{font-size:1vw;font-weight:400;color:rgba(255,255,255,0.5);}' +
    '.watch-hint{position:absolute;left:4vw;bottom:1.4vw;font-size:0.8vw;color:rgba(255,255,255,0.45);letter-spacing:0.04em;}' +
    '.watch-player{display:none;position:absolute;inset:0;z-index:5;background:#000;}' +
    '.watch-player-bg{position:absolute;inset:-4vw;background:center/cover no-repeat;filter:blur(40px) brightness(0.35);}' +
    '.watch-player video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}' +
    '.watch-player-title{position:absolute;left:4vw;bottom:3vw;font-size:1.3vw;font-weight:700;text-shadow:0 0.2vw 1vw rgba(0,0,0,0.8);transition:opacity 0.4s;}' +
    '.watch-player-state{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:4vw;opacity:0;transition:opacity 0.25s;text-shadow:0 0 2vw rgba(0,0,0,0.6);}';
  document.head.appendChild(s);
}

function watchFocusMain(focusId) {
  var fm = watchState.focus;
  fm.reset();
  var cards = document.querySelectorAll('#view-watch .watch-card');
  cards.forEach(function (c) {
    var idx = parseInt(c.getAttribute('data-idx'), 10);
    // Play must start synchronously inside the key handler (TV WebView
    // autoplay rule, same fix as the Riri video): no await before play().
    fm.register('wcard-' + idx, c, function () { watchPlay(idx); });
  });
  if (!cards.length) return;
  if (!(focusId && fm.focus(focusId))) fm.focus('wcard-' + cards[0].getAttribute('data-idx'));
}

function watchPlay(idx) {
  var it = watchState.items[idx];
  var pl = document.getElementById('watch-player');
  if (!it || !pl) return;
  if (watchState.video) { try { watchState.video.pause(); } catch (e) {} }
  pl.innerHTML =
    '<div class="watch-player-bg" style="' + (it.poster_url ? 'background-image:url(' + watchEsc(it.poster_url) + ');' : '') + '"></div>' +
    '<div class="watch-player-title" id="watch-ptitle">' + watchEsc(it.title) + '</div>' +
    '<div class="watch-player-state" id="watch-pstate">\u275a\u275a</div>';
  var v = document.createElement('video');
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  if (it.poster_url) v.poster = it.poster_url;
  v.src = it.video_url;
  v.onended = function () { watchNext(); };
  pl.appendChild(v);
  pl.style.display = 'block';
  watchState.video = v;
  watchState.playingIdx = idx;
  var p = v.play();
  if (p && typeof p.catch === 'function') p.catch(function () {});

  if (watchState.nav.currentView() !== 'watch-player') {
    watchState.nav.push('watch-player', 'wcard-' + idx, null, function () { watchStopPlayer(); });
  }
  watchSetHint('OK  Pause    \u25c0\u25b6  \u00b110s    Back  Close');
  clearTimeout(watchState.hintTimer);
  watchState.hintTimer = setTimeout(function () {
    var t = document.getElementById('watch-ptitle'); if (t) t.style.opacity = '0';
  }, 3500);
}

// Auto-advance within the same shelf, then return to the grid.
function watchNext() {
  var cur = watchState.items[watchState.playingIdx];
  if (!cur) return;
  var shelf = watchState.shelves.find(function (s) { return s.name === cur.shelf; });
  var pos = shelf ? shelf.items.indexOf(cur) : -1;
  if (shelf && pos >= 0 && pos < shelf.items.length - 1) { watchPlay(shelf.items[pos + 1]._idx); return; }
  var restored = watchState.nav.back();
  if (restored) watchFocusMain('wcard-' + cur._idx);
}

function watchStopPlayer() {
  var pl = document.getElementById('watch-player');
  if (watchState.video) { try { watchState.video.pause(); watchState.video.removeAttribute('src'); watchState.video.load(); } catch (e) {} }
  watchState.video = null;
  if (pl) { pl.style.display = 'none'; pl.innerHTML = ''; }
  watchSetHint('\u25c0\u25b6\u25b2\u25bc  Browse    OK  Play    Back  Home');
}

function watchTogglePause() {
  var v = watchState.video; if (!v) return;
  var st = document.getElementById('watch-pstate');
  if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); if (st) { st.textContent = '\u25b6'; st.style.opacity = '1'; setTimeout(function () { st.style.opacity = '0'; }, 600); } }
  else { v.pause(); if (st) { st.textContent = '\u275a\u275a'; st.style.opacity = '1'; } }
}

function watchSetHint(txt) {
  var h = document.getElementById('watch-hint'); if (h) h.textContent = txt;
}

function watchCleanup() {
  clearTimeout(watchState.hintTimer);
  watchStopPlayer();
}

function watchExitToHome() {
  watchCleanup();
  var el = document.getElementById('view-watch');
  if (el) el.style.display = 'none';
  _inDestination = false;
  if (typeof onWatchExit === 'function') onWatchExit();
}

/* ══ KEY ENTRY POINT (from surface.js) ══ */
function watchHandleKey(key, code) {
  if (!watchState.nav) return false;
  var isBack = code === 4 || code === 27 || key === 'Escape' || key === 'GoBack';
  var isOK = key === 'Enter' || code === 13 || code === 23;
  var view = watchState.nav.currentView();

  if (isBack) {
    if (view === 'watch-main') { watchState.nav.back(); return true; }
    var restored = watchState.nav.back();
    if (restored && restored.view === 'watch-main') watchFocusMain(restored.focusId);
    return true;
  }

  if (view === 'watch-player') {
    var v = watchState.video;
    if (isOK) { watchTogglePause(); return true; }
    if (v && (key === 'ArrowLeft' || code === 37)) { v.currentTime = Math.max(0, v.currentTime - 10); return true; }
    if (v && (key === 'ArrowRight' || code === 39)) { v.currentTime = Math.min(v.duration || 0, v.currentTime + 10); return true; }
    return true; // swallow other keys while playing
  }

  if (!watchState.focus) return false;
  var handled = watchState.focus.handleKey(key, code);
  if (handled) watchState.nav.markFocus(watchState.focus.currentId);
  return handled;
}
