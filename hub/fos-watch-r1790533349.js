/* ══════════════════════════════════════════════════════════════
   WATCH — the household's own video platform   (Watch 2.0)
   Views: watch-main (shelves) -> watch-player

   Source of truth is the watch_catalog view in Supabase. Any
   content_item with a playable video URL that is not a draft,
   hidden or archived appears here automatically, plus Elsie's
   cheer videos. Nothing is curated by hand in this file.

   Remote grammar in the player (the same for every video):
     ▲ / ▼   previous / next video
     ◀ / ▶   back / forward 10 seconds
     OK      pause / play (first OK turns sound on if it started muted)
     BACK    close the player, back to the shelves (never leaves Watch)
   On the shelves BACK goes Home. Any key brings the controls back;
   they fade after a few seconds while playing and stay while paused.

   Opening Watch plays the first reel straight away. The playlist is
   every shelf in order: reels loop among themselves, the other
   shelves run on into the next shelf and return to the shelves at
   the very end.
   ══════════════════════════════════════════════════════════════ */

const WATCH_API = 'https://fypwabbhxnnwcpfjwrda.supabase.co/rest/v1';
const WATCH_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cHdhYmJoeG5ud2NwZmp3cmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDg3ODUsImV4cCI6MjEwNDEyNDc4NX0.BwzgTd8_-lxENXnTu9ukxnHsgh3diguZbJPnzzC7XD4';
const WATCH_SHELF_ORDER = ['Reels & edits', 'Home videos', 'Cheer'];
const WATCH_REEL_SHELF = 'Reels & edits';
const WATCH_IDLE_RESUME_MS = 45000; // left on the shelves this long, reels roll again
const WATCH_OSD_MS = 3500;          // controls stay up this long after a key while playing
const WATCH_SEEK_S = 10;
const WATCH_CACHE_MS = 10 * 60 * 1000;

var watchState = {
  items: [], shelves: [],
  focus: null, nav: null,
  playingIdx: -1, video: null,
  osdTimer: null, seekTimer: null, flashTimer: null, idleTimer: null, stallTimer: null,
  seekAccum: 0,
  cache: null, cacheAt: 0, loading: null,
};

/* ── Catalogue cache: loaded at start-up and refreshed in the background, so
   opening Watch can start playback synchronously inside the key press (TV
   WebViews only allow sound when play() runs inside a user gesture). ── */
function watchRefreshCache() {
  if (watchState.loading) return watchState.loading;
  watchState.loading = watchLoadCatalog().then(function (rows) {
    if (rows.length || !watchState.cache) { watchState.cache = rows; watchState.cacheAt = Date.now(); }
    watchState.loading = null;
    return watchState.cache;
  });
  return watchState.loading;
}
watchRefreshCache();
setInterval(function () { if (!watchState.video) watchRefreshCache(); }, WATCH_CACHE_MS);

function watchReelShelf() { return watchState.shelves.find(function (s) { return s.name === WATCH_REEL_SHELF; }) || null; }
function watchIsReel(it) { return !!it && it.shelf === WATCH_REEL_SHELF; }

function watchArmIdle() {
  clearTimeout(watchState.idleTimer);
  watchState.idleTimer = setTimeout(function () {
    var shelf = watchReelShelf();
    if (!shelf || !shelf.items.length || !watchState.nav || watchState.nav.currentView() !== 'watch-main') return;
    var cur = watchState.focus && watchState.focus.currentId;
    var idx = cur ? parseInt(String(cur).replace('wcard-', ''), 10) : NaN;
    var start = watchIsReel(watchState.items[idx]) ? idx : shelf.items[0]._idx;
    watchPlay(start);
  }, WATCH_IDLE_RESUME_MS);
}
function watchDisarm() { clearTimeout(watchState.idleTimer); watchState.idleTimer = null; }

async function openWatch(opts) {
  var el = document.getElementById('view-watch');
  if (!el) { el = document.createElement('div'); el.id = 'view-watch'; document.body.appendChild(el); }
  el.style.cssText = 'position:fixed;inset:0;z-index:500;background:#0b0714;overflow:hidden;';
  el.style.display = 'block';
  _inDestination = true;
  watchInjectStyles();

  // Use the cached catalogue if we have one (no await: keeps play() inside the key press).
  var rows = watchState.cache;
  if (!rows || !rows.length) {
    el.innerHTML = '<div class="watch-loading">Loading Watch\u2026</div>';
    rows = await watchRefreshCache();
  } else if (Date.now() - watchState.cacheAt > 60000) {
    watchRefreshCache(); // freshen for next time; does not re-render this visit
  }
  watchState.items = (rows || []).map(function (r) { return Object.assign({}, r); });
  watchState.shelves = watchGroup(watchState.items);
  el.innerHTML = watchBuildHTML();

  watchState.focus = new FOSFocus();
  watchState.nav = new FOSNav();
  watchState.nav.onEmpty = function () { watchExitToHome(); };
  watchState.nav.push('watch-main', null, null, null);
  watchFocusMain(null);

  // Sent from master control ("Play on TV"): start that video now, then roll on.
  var want = opts && opts.playId;
  var hit = want ? watchState.items.find(function (it) { return it.id === want; }) : null;
  if (hit) { watchFocusMain('wcard-' + hit._idx); watchPlay(hit._idx); return true; }
  // Otherwise Watch opens already playing: first reel, no countdown.
  var shelf = watchReelShelf();
  if (shelf && shelf.items.length) { watchFocusMain('wcard-' + shelf.items[0]._idx); watchPlay(shelf.items[0]._idx); }
  return false;
}

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
    '.watch-player{display:none;position:absolute;inset:0;z-index:5;background:#000;overflow:hidden;}' +
    '.watch-player-bg{position:absolute;inset:-6vw;background:center/cover no-repeat;filter:blur(48px) brightness(0.32) saturate(1.2);}' +
    '.watch-player video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;}' +
    // Portrait: a designed 9:16 stage in the centre with the story around it, not a strip in a black box.
    '.watch-player.is-portrait video{inset:auto;left:50%;top:3vh;height:94vh;width:calc(94vh * 9 / 16);transform:translateX(-50%);border-radius:1.2vw;box-shadow:0 2vw 6vw rgba(0,0,0,0.6);}' +
    '.watch-player.is-portrait .watch-player-bg{filter:blur(40px) brightness(0.42) saturate(1.3);}' +
    '.wp-osd{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 0.35s ease;}' +
    '.watch-player.osd-on .wp-osd{opacity:1;}' +
    '.wp-shade{position:absolute;left:0;right:0;bottom:0;height:34vh;background:linear-gradient(transparent,rgba(0,0,0,0.78));}' +
    '.wp-shade-top{position:absolute;left:0;right:0;top:0;height:22vh;background:linear-gradient(rgba(0,0,0,0.6),transparent);}' +
    '.wp-meta{position:absolute;left:4vw;top:4vh;max-width:40vw;}' +
    '.wp-kicker{color:#C9A84C;font-size:0.85vw;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;}' +
    '.wp-title{font-size:2.6vw;font-weight:800;line-height:1.15;margin-top:0.4vw;text-shadow:0 0.2vw 1.2vw rgba(0,0,0,0.8);}' +
    '.wp-sub{font-size:1.05vw;color:rgba(255,255,255,0.7);margin-top:0.5vw;}' +
    '.watch-player.is-portrait .wp-meta{top:auto;bottom:16vh;max-width:calc(50vw - (94vh * 9 / 32) - 7vw);}' +
    '.wp-next{position:absolute;right:4vw;bottom:16vh;display:flex;align-items:center;gap:1vw;max-width:26vw;}' +
    '.wp-next-thumb{width:5.2vw;height:9.2vw;border-radius:0.6vw;background:#1d1430 center/cover no-repeat;flex:0 0 auto;box-shadow:0 0.6vw 2vw rgba(0,0,0,0.5);}' +
    '.wp-next-thumb.is-landscape{width:10vw;height:5.6vw;}' +
    '.wp-next-k{font-size:0.75vw;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.55);}' +
    '.wp-next-t{font-size:1.05vw;font-weight:700;margin-top:0.25vw;}' +
    '.wp-bar-wrap{position:absolute;left:4vw;right:4vw;bottom:6.5vh;}' +
    '.wp-bar{position:relative;height:0.45vw;border-radius:0.3vw;background:rgba(255,255,255,0.22);overflow:hidden;}' +
    '.wp-bar-buf{position:absolute;left:0;top:0;bottom:0;background:rgba(255,255,255,0.28);width:0;}' +
    '.wp-bar-fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:#8b5cf6;transform-origin:left;transform:scaleX(0);}' +
    '.wp-times{display:flex;justify-content:space-between;margin-top:0.7vw;font-size:0.95vw;font-weight:600;color:rgba(255,255,255,0.85);font-variant-numeric:tabular-nums;}' +
    '.wp-hint{position:absolute;left:4vw;right:4vw;bottom:2.2vh;text-align:center;white-space:pre;font-size:0.8vw;letter-spacing:0.04em;color:rgba(255,255,255,0.5);}' +
    '.wp-mini{position:absolute;left:0;right:0;bottom:0;height:0.3vw;background:rgba(255,255,255,0.12);transition:opacity 0.35s;}' +
    '.wp-mini-fill{height:100%;width:100%;background:#8b5cf6;transform-origin:left;transform:scaleX(0);}' +
    '.watch-player.osd-on .wp-mini{opacity:0;}' +
    '.wp-flash{position:absolute;top:50%;transform:translateY(-50%);font-size:2.2vw;font-weight:800;padding:1vw 1.6vw;border-radius:5vw;background:rgba(0,0,0,0.55);opacity:0;transition:opacity 0.2s;}' +
    '.wp-flash.is-left{left:14vw;} .wp-flash.is-right{right:14vw;} .wp-flash.is-center{left:50%;transform:translate(-50%,-50%);font-size:3.4vw;padding:1.4vw 2.2vw;}' +
    '.wp-flash.on{opacity:1;}' +
    '.wp-spin{position:absolute;left:50%;top:50%;width:4vw;height:4vw;margin:-2vw 0 0 -2vw;border-radius:50%;border:0.35vw solid rgba(255,255,255,0.2);border-top-color:#fff;animation:wpSpin 0.9s linear infinite;display:none;}' +
    '.watch-player.is-waiting .wp-spin{display:block;}' +
    '@keyframes wpSpin{to{transform:rotate(360deg);}}';
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

/* ── Playlist order: reels loop among themselves; everything else runs
   shelf by shelf. Returns the item index, or -1 at the very end/start. ── */
function watchSeq(fromIdx, dir) {
  var cur = watchState.items[fromIdx]; if (!cur) return -1;
  var shelf = watchState.shelves.find(function (s) { return s.name === cur.shelf; });
  var pos = shelf.items.indexOf(cur), n = shelf.items.length;
  if (watchIsReel(cur)) return n > 1 || dir === 0 ? shelf.items[((pos + dir) % n + n) % n]._idx : -1;
  if (pos + dir >= 0 && pos + dir < n) return shelf.items[pos + dir]._idx;
  var si = watchState.shelves.indexOf(shelf) + dir;
  while (si >= 0 && si < watchState.shelves.length) {
    var s = watchState.shelves[si];
    if (s.name !== WATCH_REEL_SHELF && s.items.length) return (dir > 0 ? s.items[0] : s.items[s.items.length - 1])._idx;
    si += dir;
  }
  return -1;
}

function watchFmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  t = Math.floor(t);
  var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
}

function watchPlay(idx) {
  var it = watchState.items[idx];
  var pl = document.getElementById('watch-player');
  if (!it || !pl) return;
  watchDisarm();
  if (watchState.video) { var old = watchState.video; try { old.onended = old.onerror = null; old.pause(); old.removeAttribute('src'); old.load(); } catch (e) {} }
  clearTimeout(watchState.stallTimer);

  var portrait = (it.orientation || 'portrait') === 'portrait';
  var shelf = watchState.shelves.find(function (s) { return s.name === it.shelf; });
  var pos = shelf ? shelf.items.indexOf(it) : 0;
  var kicker = watchEsc(it.shelf || 'Watch') + (shelf && shelf.items.length > 1 ? '  \u00b7  ' + (pos + 1) + ' of ' + shelf.items.length : '');
  var sub = [it.person, it.event_title].filter(Boolean).join(' \u00b7 ');
  var nextIdx = watchSeq(idx, 1), nx = nextIdx >= 0 && nextIdx !== idx ? watchState.items[nextIdx] : null;
  var nextHtml = nx ? '<div class="wp-next"><div class="wp-next-thumb ' + ((nx.orientation || 'portrait') === 'portrait' ? '' : 'is-landscape') + '" style="' +
      (nx.poster_url ? 'background-image:url(' + watchEsc(nx.poster_url) + ');' : '') + '"></div>' +
      '<div><div class="wp-next-k">\u25bc Up next</div><div class="wp-next-t">' + watchEsc(nx.title) + '</div></div></div>' : '';

  pl.className = 'watch-player ' + (portrait ? 'is-portrait' : 'is-landscape');
  pl.innerHTML =
    '<div class="watch-player-bg" style="' + (it.poster_url ? 'background-image:url(' + watchEsc(it.poster_url) + ');' : '') + '"></div>' +
    '<div class="wp-spin"></div>' +
    '<div class="wp-osd">' +
      '<div class="wp-shade-top"></div><div class="wp-shade"></div>' +
      '<div class="wp-meta"><div class="wp-kicker">' + kicker + '</div><div class="wp-title">' + watchEsc(it.title) + '</div>' +
        (sub ? '<div class="wp-sub">' + watchEsc(sub) + '</div>' : '') + '</div>' +
      nextHtml +
      '<div class="wp-bar-wrap"><div class="wp-bar"><div class="wp-bar-buf" id="wp-buf"></div><div class="wp-bar-fill" id="wp-fill"></div></div>' +
        '<div class="wp-times"><span id="wp-cur">0:00</span><span id="wp-dur">' + (it.duration_seconds ? watchFmt(it.duration_seconds) : '') + '</span></div></div>' +
      '<div class="wp-hint" id="wp-hint"></div>' +
    '</div>' +
    '<div class="wp-mini"><div class="wp-mini-fill" id="wp-mini"></div></div>' +
    '<div class="wp-flash" id="wp-flash"></div>';

  var v = document.createElement('video');
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  if (it.poster_url) v.poster = it.poster_url;
  v.src = it.video_url;
  v.onended = function () { if (watchState.video === v) watchAdvance(); };
  v.ontimeupdate = function () { if (watchState.video === v) watchUpdateProgress(); };
  v.onprogress = v.onloadedmetadata = function () { if (watchState.video === v) watchUpdateProgress(); };
  v.onwaiting = function () { pl.classList.add('is-waiting'); };
  v.onplaying = function () { pl.classList.remove('is-waiting'); watchHint(); };
  v.onpause = function () { if (watchState.video === v && !v.ended) { watchShowOSD(true); watchHint(); } };
  v.onerror = function () {
    if (watchState.video !== v) return;
    watchFlash('Can\u2019t play this one', 'center', 1800);
    watchState.stallTimer = setTimeout(function () { if (watchState.video === v) watchAdvance(); }, 1800);
  };
  pl.insertBefore(v, pl.querySelector('.wp-spin'));
  pl.style.display = 'block';
  watchState.video = v;
  watchState.playingIdx = idx;
  var p = v.play();
  if (p && typeof p.catch === 'function') p.catch(function () {
    // Started without a key press (idle timer, remote command, slow first load):
    // some TVs refuse sound, so play muted and let OK turn it on.
    if (watchState.video !== v) return;
    v.muted = true;
    var p2 = v.play(); if (p2 && p2.catch) p2.catch(function () {});
    watchHint();
  });

  if (watchState.nav.currentView() !== 'watch-player') {
    watchState.nav.push('watch-player', 'wcard-' + idx, null, function () { watchStopPlayer(); });
  }
  watchHint();
  watchShowOSD(false);
}

function watchUpdateProgress() {
  var v = watchState.video; if (!v) return;
  var d = v.duration, t = v.currentTime;
  var f = isFinite(d) && d > 0 ? Math.min(1, t / d) : 0;
  var fill = document.getElementById('wp-fill'), mini = document.getElementById('wp-mini');
  if (fill) fill.style.transform = 'scaleX(' + f + ')';
  if (mini) mini.style.transform = 'scaleX(' + f + ')';
  var c = document.getElementById('wp-cur'), du = document.getElementById('wp-dur');
  if (c) c.textContent = watchFmt(t);
  if (du && isFinite(d) && d > 0) du.textContent = '-' + watchFmt(d - t);
  var buf = document.getElementById('wp-buf');
  if (buf && isFinite(d) && d > 0 && v.buffered && v.buffered.length) buf.style.width = Math.min(100, v.buffered.end(v.buffered.length - 1) / d * 100) + '%';
}

// Controls appear on load and on any key; they fade while playing, stay while paused.
function watchShowOSD(stay) {
  var pl = document.getElementById('watch-player'); if (!pl) return;
  pl.classList.add('osd-on');
  clearTimeout(watchState.osdTimer);
  var v = watchState.video;
  if (stay || (v && v.paused)) return;
  watchState.osdTimer = setTimeout(function () {
    var vv = watchState.video;
    if (vv && !vv.paused) pl.classList.remove('osd-on');
  }, WATCH_OSD_MS);
}

function watchHint() {
  var h = document.getElementById('wp-hint'), v = watchState.video; if (!h) return;
  var ok = v && v.muted ? 'OK  Sound on' : (v && v.paused ? 'OK  Play' : 'OK  Pause');
  h.textContent = ok + '      \u25b2\u25bc  Previous / next      \u25c0\u25b6  10 seconds      Back  All videos';
}

function watchFlash(txt, where, ms) {
  var f = document.getElementById('wp-flash'); if (!f) return;
  f.className = 'wp-flash is-' + (where || 'center') + ' on';
  f.textContent = txt;
  clearTimeout(watchState.flashTimer);
  watchState.flashTimer = setTimeout(function () { f.classList.remove('on'); }, ms || 700);
}

function watchSeek(dir) {
  var v = watchState.video; if (!v) return;
  var d = isFinite(v.duration) ? v.duration : 0;
  var to = Math.max(0, v.currentTime + dir * WATCH_SEEK_S);
  if (d) to = Math.min(to, Math.max(0, d - 0.25));
  v.currentTime = to;
  // Held or repeated presses add up: -10s, -20s, -30s...
  watchState.seekAccum = (watchState.seekAccum && (watchState.seekAccum > 0) === (dir > 0)) ? watchState.seekAccum + dir * WATCH_SEEK_S : dir * WATCH_SEEK_S;
  clearTimeout(watchState.seekTimer);
  watchState.seekTimer = setTimeout(function () { watchState.seekAccum = 0; }, 900);
  watchFlash((dir < 0 ? '\u25c0\u25c0  ' : '') + (watchState.seekAccum > 0 ? '+' : '\u2212') + Math.abs(watchState.seekAccum) + 's' + (dir > 0 ? '  \u25b6\u25b6' : ''), dir < 0 ? 'left' : 'right', 800);
  watchUpdateProgress();
  watchShowOSD(false);
}

// ▲▼: previous / next. At the very start or end, stay put and say so.
function watchStep(dir) {
  var nxt = watchSeq(watchState.playingIdx, dir);
  if (nxt < 0 || nxt === watchState.playingIdx) {
    watchFlash(dir > 0 ? 'That\u2019s the last one' : 'This is the first one', 'center', 1200);
    watchShowOSD(false);
    return;
  }
  watchPlay(nxt);
}

// End of a video: carry straight on. After the very last one, back to the shelves.
function watchAdvance() {
  var nxt = watchSeq(watchState.playingIdx, 1);
  if (nxt >= 0) { watchPlay(nxt); return; }
  var cur = watchState.items[watchState.playingIdx];
  var restored = watchState.nav.back();
  if (restored) { watchFocusMain(cur ? 'wcard-' + cur._idx : restored.focusId); watchArmIdle(); }
}

function watchStopPlayer() {
  var pl = document.getElementById('watch-player');
  clearTimeout(watchState.osdTimer); clearTimeout(watchState.flashTimer); clearTimeout(watchState.stallTimer);
  if (watchState.video) { var v = watchState.video; try { v.onended = v.onerror = v.onpause = null; v.pause(); v.removeAttribute('src'); v.load(); } catch (e) {} }
  watchState.video = null;
  if (pl) { pl.style.display = 'none'; pl.innerHTML = ''; pl.className = 'watch-player'; }
  watchSetHint('\u25c0\u25b6\u25b2\u25bc  Browse    OK  Play    Back  Home');
}

function watchTogglePause() {
  var v = watchState.video; if (!v) return;
  if (v.paused) {
    var p = v.play(); if (p && p.catch) p.catch(function () {});
    watchFlash('\u25b6', 'center', 600);
    watchShowOSD(false);
  } else {
    v.pause();
    watchFlash('\u275a\u275a', 'center', 600);
    watchShowOSD(true);
  }
  watchHint();
}

function watchSetHint(txt) {
  var h = document.getElementById('watch-hint'); if (h) h.textContent = txt;
}

function watchCleanup() {
  watchDisarm();
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
  var isBack = code === 4 || code === 27 || key === 'Escape' || key === 'GoBack' || key === 'Backspace' || code === 8;
  var isOK = key === 'Enter' || code === 13 || code === 23;
  var up = key === 'ArrowUp' || code === 38, down = key === 'ArrowDown' || code === 40;
  var left = key === 'ArrowLeft' || code === 37, right = key === 'ArrowRight' || code === 39;
  var isPlayPause = key === 'MediaPlayPause' || code === 179 || key === ' ';
  var isPlayOnly = key === 'MediaPlay', isPauseOnly = key === 'MediaPause';
  var isFF = key === 'MediaFastForward' || code === 228, isRW = key === 'MediaRewind' || code === 227;
  var isNextTrack = key === 'MediaTrackNext' || code === 176, isPrevTrack = key === 'MediaTrackPrevious' || code === 177;
  var view = watchState.nav.currentView();

  if (view === 'watch-player') {
    var v = watchState.video;
    // BACK has one meaning here: close the player, back to the shelves on the video you were watching.
    if (isBack) {
      var cur = watchState.items[watchState.playingIdx];
      var restored = watchState.nav.back();
      if (restored && restored.view === 'watch-main') { watchFocusMain(cur ? 'wcard-' + cur._idx : restored.focusId); watchArmIdle(); }
      return true;
    }
    if (isPlayOnly && v) { if (v.muted || v.paused) { v.muted = false; if (v.paused) watchTogglePause(); else { watchFlash('\u266a  Sound on', 'center', 900); watchHint(); } } watchShowOSD(false); return true; }
    if (isPauseOnly && v) { if (!v.paused) watchTogglePause(); else watchShowOSD(true); return true; }
    if (isOK || isPlayPause) {
      if (v && v.muted) { v.muted = false; if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } watchFlash('\u266a  Sound on', 'center', 900); watchHint(); watchShowOSD(false); return true; }
      watchTogglePause(); return true;
    }
    if (up || isPrevTrack)   { watchStep(-1); return true; }
    if (down || isNextTrack) { watchStep(1); return true; }
    if (left || isRW)  { watchSeek(-1); return true; }
    if (right || isFF) { watchSeek(1); return true; }
    watchShowOSD(false);
    return true; // swallow everything else while playing
  }

  // Shelves.
  if (isBack) { watchState.nav.back(); return true; }
  if (!watchState.focus) return false;
  watchArmIdle(); // any key means someone is browsing: push the idle roll back
  var handled = watchState.focus.handleKey(key, code);
  if (handled) watchState.nav.markFocus(watchState.focus.currentId);
  return handled;
}
