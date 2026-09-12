/* ══════════════════════════════════════════════════════════════
   EMMA'S WORLD — product/UX pass
   Built on FOSFocus. Spatial focus, left utility stack,
   sparkly clock bottom-right, atmospheric sparkle layer.
   ══════════════════════════════════════════════════════════════ */

// Shared destination flag (read by surface.js keydown handler)
var _inDestination = false;

const EMMA_API = 'https://fypwabbhxnnwcpfjwrda.supabase.co/rest/v1';
const EMMA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cHdhYmJoeG5ud2NwZmp3cmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDg3ODUsImV4cCI6MjEwNDEyNDc4NX0.BwzgTd8_-lxENXnTu9ukxnHsgh3diguZbJPnzzC7XD4';

const EMMA_FALLBACK_PHOTOS = [
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

// State
var emmaState = {
  photos: [], music: [], itinerary: [],
  slideIdx: 0, slideTimer: null,
  musicIdx: 0, audio: null, playing: false,
  clockTimer: null, pollTimer: null,
  playlistOpen: false,
  focus: null,   // FOSFocus instance
};

async function emmaLoadContent() {
  var hdr = { 'apikey': EMMA_KEY, 'Authorization': 'Bearer ' + EMMA_KEY };
  try {
    var res = await Promise.all([
      fetch(EMMA_API + '/emma_photos?select=url&order=sort_order', { headers: hdr }).then(function (r) { return r.json(); }),
      fetch(EMMA_API + '/emma_music?select=url,title&order=sort_order', { headers: hdr }).then(function (r) { return r.json(); }),
      fetch(EMMA_API + '/emma_itinerary?select=time_label,activity&order=sort_order', { headers: hdr }).then(function (r) { return r.json(); }),
    ]);
    return {
      photos: (res[0] && res[0].length) ? res[0].map(function (p) { return p.url; }) : EMMA_FALLBACK_PHOTOS,
      music: (res[1] && res[1].length) ? res[1] : [],
      itinerary: (res[2] && res[2].length) ? res[2] : [],
    };
  } catch (e) {
    return { photos: EMMA_FALLBACK_PHOTOS, music: [], itinerary: [] };
  }
}

async function openEmmaWorld() {
  var el = document.getElementById('view-emma');
  if (!el) {
    el = document.createElement('div');
    el.id = 'view-emma';
    document.body.appendChild(el);
  }
  el.style.cssText = 'position:fixed;inset:0;z-index:500;background:#1a0011;overflow:hidden;';
  el.style.display = 'block';
  _inDestination = true;

  var content = await emmaLoadContent();
  emmaState.photos = content.photos;
  emmaState.music = content.music;
  emmaState.itinerary = content.itinerary;

  el.innerHTML = emmaBuildHTML();
  emmaInjectStyles();
  emmaStartSparkles();
  emmaStartSlideshow(el);
  emmaStartClock();
  emmaInitAudio();
  emmaBuildFocus(el);
  emmaStartPoll();
}

function emmaBuildHTML() {
  var slides = emmaState.photos.map(function (src, i) {
    return '<div class="emma-slide" style="background-image:url(' + src + ');opacity:' + (i === 0 ? '1' : '0') + ';"></div>';
  }).join('');

  return '' +
    '<div class="emma-slides">' + slides + '</div>' +
    '<div class="emma-sparkles" id="emma-sparkles"></div>' +
    '<div class="emma-vignette"></div>' +

    // Left utility stack: itinerary card + music player card
    '<div class="emma-stack">' +
      '<div class="emma-card emma-itin-card" id="emma-itin-card">' +
        '<div class="emma-card-head">Today</div>' +
        '<div class="emma-itin-rows" id="emma-itin-rows"></div>' +
      '</div>' +
      '<div class="emma-card emma-player-card">' +
        '<div class="emma-np">' +
          '<div class="emma-np-art" id="emma-np-art">\u266a</div>' +
          '<div class="emma-np-meta">' +
            '<div class="emma-np-title" id="emma-np-title">Music</div>' +
            '<div class="emma-np-sub" id="emma-np-sub">Now Playing</div>' +
            '<div class="emma-np-bar"><div class="emma-np-prog" id="emma-np-prog"></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="emma-controls">' +
          '<div class="emma-ctrl" id="ctrl-prev" tabindex="-1">\u23ee</div>' +
          '<div class="emma-ctrl emma-ctrl-play" id="ctrl-play" tabindex="-1">\u25b6</div>' +
          '<div class="emma-ctrl" id="ctrl-next" tabindex="-1">\u23ed</div>' +
          '<div class="emma-ctrl" id="ctrl-list" tabindex="-1">\u2261</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    // Playlist secondary panel (hidden by default)
    '<div class="emma-playlist" id="emma-playlist" style="display:none;">' +
      '<div class="emma-card-head">Playlist</div>' +
      '<div id="emma-playlist-rows"></div>' +
      '<div class="emma-panel-hint">OK play \u00b7 Back close</div>' +
    '</div>' +

    // Sparkly clock bottom-right
    '<div class="emma-clock" id="emma-clock">' +
      '<span class="emma-clock-time" id="emma-clock-time"></span>' +
    '</div>' +

    // Contextual hint (bottom-centre, minimal)
    '<div class="emma-hint" id="emma-hint"></div>';
}

function emmaInjectStyles() {
  if (document.getElementById('emma-styles')) return;
  var s = document.createElement('style');
  s.id = 'emma-styles';
  s.textContent =
    '.emma-slides{position:absolute;inset:0;}' +
    '.emma-slide{position:absolute;inset:0;background-size:cover;background-position:center;transition:opacity 1.6s ease-in-out;}' +
    '.emma-vignette{position:absolute;inset:0;pointer-events:none;' +
      'background:linear-gradient(to right,rgba(20,0,13,0.75) 0%,rgba(20,0,13,0.2) 30%,transparent 55%),' +
      'linear-gradient(to top,rgba(20,0,13,0.6) 0%,transparent 40%);}' +

    /* Left utility stack */
    '.emma-stack{position:absolute;left:clamp(20px,3.5vw,60px);bottom:clamp(20px,5vh,70px);' +
      'display:flex;flex-direction:column;gap:clamp(10px,1.6vh,20px);width:clamp(300px,30vw,460px);z-index:4;}' +
    '.emma-card{background:rgba(20,0,13,0.62);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);' +
      'border:1px solid rgba(255,110,199,0.28);border-radius:18px;padding:clamp(12px,1.3vw,20px);}' +
    '.emma-card-head{color:#ff6ec7;font-size:clamp(11px,0.85vw,15px);font-weight:800;letter-spacing:0.16em;' +
      'text-transform:uppercase;margin-bottom:0.7em;}' +

    /* Itinerary */
    '.emma-itin-card{max-height:38vh;overflow:hidden;display:flex;flex-direction:column;}' +
    '.emma-itin-rows{display:flex;flex-direction:column;gap:0.45em;overflow:hidden;}' +
    '.emma-itin-row{display:flex;gap:0.8em;align-items:baseline;transition:opacity 0.3s;}' +
    '.emma-itin-row .t{color:#ff9ed8;font-size:clamp(10px,0.72vw,13px);font-weight:700;flex:0 0 auto;min-width:3.6em;}' +
    '.emma-itin-row .a{color:#fff;font-size:clamp(10px,0.72vw,13px);opacity:0.92;}' +
    '.emma-itin-row.past{opacity:0.38;}' +
    '.emma-itin-row.now{background:rgba(255,110,199,0.22);border-radius:8px;padding:0.3em 0.5em;margin:0 -0.5em;}' +
    '.emma-itin-row.now .t{color:#ffd6ee;}' +
    '.emma-itin-more{color:rgba(255,255,255,0.4);font-size:clamp(9px,0.6vw,11px);margin-top:0.4em;}' +

    /* Player */
    '.emma-np{display:flex;gap:0.8em;align-items:center;margin-bottom:0.8em;}' +
    '.emma-np-art{width:clamp(38px,3vw,54px);height:clamp(38px,3vw,54px);border-radius:12px;flex:0 0 auto;' +
      'background:linear-gradient(135deg,#ff6ec7,#c9457f);display:flex;align-items:center;justify-content:center;' +
      'font-size:clamp(18px,1.4vw,26px);color:#fff;}' +
    '.emma-np-meta{flex:1;min-width:0;}' +
    '.emma-np-title{color:#fff;font-size:clamp(12px,0.9vw,16px);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.emma-np-sub{color:#ff9ed8;font-size:clamp(9px,0.6vw,11px);letter-spacing:0.1em;text-transform:uppercase;margin-top:0.2em;}' +
    '.emma-np-bar{height:3px;background:rgba(255,255,255,0.16);border-radius:2px;margin-top:0.6em;overflow:hidden;}' +
    '.emma-np-prog{height:100%;width:0%;background:#ff6ec7;}' +
    '.emma-controls{display:flex;justify-content:space-around;align-items:center;gap:0.5em;}' +
    '.emma-ctrl{width:clamp(38px,3vw,52px);height:clamp(38px,3vw,52px);border-radius:50%;' +
      'display:flex;align-items:center;justify-content:center;font-size:clamp(15px,1.15vw,22px);' +
      'color:rgba(255,255,255,0.75);background:rgba(255,255,255,0.06);transition:all 0.18s;cursor:pointer;}' +
    '.emma-ctrl-play{background:rgba(255,110,199,0.9);color:#fff;}' +

    /* Focus treatment — the whole point */
    '.fos-focused{outline:none;}' +
    '.emma-ctrl.fos-focused{transform:scale(1.18);color:#fff;background:#ff6ec7;' +
      'box-shadow:0 0 0 3px rgba(255,214,238,0.7),0 0 24px rgba(255,110,199,0.7);}' +
    '.emma-itin-card.fos-focused{border-color:#ff6ec7;box-shadow:0 0 30px rgba(255,110,199,0.35);}' +
    '.emma-pl-row.fos-focused{background:rgba(255,110,199,0.35);outline:2px solid #ff6ec7;}' +

    /* Playlist panel */
    '.emma-playlist{position:absolute;left:clamp(20px,3.5vw,60px);bottom:clamp(20px,5vh,70px);' +
      'width:clamp(300px,30vw,460px);background:rgba(20,0,13,0.9);backdrop-filter:blur(16px);' +
      'border:1px solid rgba(255,110,199,0.45);border-radius:18px;padding:clamp(14px,1.4vw,22px);z-index:7;}' +
    '.emma-pl-row{display:flex;gap:0.7em;align-items:center;padding:0.5em 0.6em;border-radius:10px;transition:all 0.15s;}' +
    '.emma-pl-row .n{color:rgba(255,255,255,0.4);font-size:clamp(10px,0.7vw,13px);min-width:1.5em;}' +
    '.emma-pl-row.playing .n{color:#ff6ec7;}' +
    '.emma-pl-row .tt{color:#fff;font-size:clamp(11px,0.8vw,14px);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.emma-panel-hint{color:rgba(255,255,255,0.4);font-size:clamp(9px,0.6vw,11px);text-align:center;margin-top:0.8em;letter-spacing:0.05em;}' +

    /* Sparkly clock — bottom right */
    '.emma-clock{position:absolute;right:clamp(24px,3vw,56px);bottom:clamp(20px,4.5vh,64px);z-index:6;' +
      'color:#fff;font-size:clamp(38px,4vw,72px);font-weight:200;letter-spacing:0.02em;font-variant-numeric:tabular-nums;' +
      'text-shadow:0 0 30px rgba(255,110,199,0.55),0 2px 16px rgba(0,0,0,0.7);' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}' +

    /* Hint */
    '.emma-hint{position:absolute;bottom:clamp(8px,1.6vh,18px);left:50%;transform:translateX(-50%);z-index:6;' +
      'color:rgba(255,255,255,0.5);font-size:clamp(9px,0.62vw,12px);letter-spacing:0.08em;text-align:center;' +
      'text-shadow:0 1px 6px rgba(0,0,0,0.9);}' +

    /* Sparkle layer */
    '.emma-sparkles{position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden;}' +
    '.emma-spark{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,0.95) 0%,rgba(255,214,238,0.6) 40%,transparent 70%);' +
      'animation:emmaTwinkle var(--dur,3s) ease-in-out infinite;opacity:0;}' +
    '.emma-spark.star{background:none;}' +
    '.emma-spark.star::before,.emma-spark.star::after{content:"";position:absolute;left:50%;top:50%;' +
      'background:linear-gradient(to bottom,transparent,rgba(255,240,250,0.95),transparent);transform:translate(-50%,-50%);}' +
    '.emma-spark.star::before{width:1.5px;height:100%;}' +
    '.emma-spark.star::after{width:100%;height:1.5px;}' +
    '@keyframes emmaTwinkle{0%,100%{opacity:0;transform:scale(0.5);}50%{opacity:var(--peak,0.9);transform:scale(1);}}' +
    '@media(prefers-reduced-motion:reduce){.emma-spark{animation:none;opacity:0.4;}}';
  document.head.appendChild(s);
}

/* ── Sparkle layer: ~28 lightweight nodes, GPU-friendly ── */
function emmaStartSparkles() {
  var host = document.getElementById('emma-sparkles');
  if (!host) return;
  host.innerHTML = '';
  var N = 26;
  for (var i = 0; i < N; i++) {
    var sp = document.createElement('div');
    var isStar = Math.random() < 0.35;
    sp.className = 'emma-spark' + (isStar ? ' star' : '');
    var size = isStar ? (6 + Math.random() * 10) : (2 + Math.random() * 4);
    // Bias toward edges / negative space (avoid dead-centre where Emma is)
    var edge = Math.random();
    var x, y;
    if (edge < 0.5) { x = Math.random() * 100; y = (Math.random() < 0.5) ? Math.random() * 28 : 72 + Math.random() * 28; }
    else { x = (Math.random() < 0.5) ? Math.random() * 30 : 70 + Math.random() * 30; y = Math.random() * 100; }
    sp.style.left = x + '%';
    sp.style.top = y + '%';
    sp.style.width = size + 'px';
    sp.style.height = size + 'px';
    sp.style.setProperty('--dur', (2.4 + Math.random() * 3.5) + 's');
    sp.style.setProperty('--peak', (0.5 + Math.random() * 0.5).toFixed(2));
    sp.style.animationDelay = (Math.random() * 4) + 's';
    // gold tint on some
    if (Math.random() < 0.3 && !isStar) {
      sp.style.background = 'radial-gradient(circle,rgba(255,232,180,0.95) 0%,rgba(255,200,120,0.5) 40%,transparent 70%)';
    }
    host.appendChild(sp);
  }
}

/* ── Slideshow ── */
function emmaStartSlideshow(el) {
  emmaState.slideIdx = 0;
  function show(i) {
    var slides = el.querySelectorAll('.emma-slide');
    if (!slides.length) return;
    slides[emmaState.slideIdx].style.opacity = '0';
    emmaState.slideIdx = ((i % slides.length) + slides.length) % slides.length;
    slides[emmaState.slideIdx].style.opacity = '1';
  }
  emmaState._showSlide = show;
  if (emmaState.slideTimer) clearInterval(emmaState.slideTimer);
  emmaState.slideTimer = setInterval(function () { show(emmaState.slideIdx + 1); }, 6000);
  emmaRenderItinerary();
}

/* ── Itinerary with past/now/future ── */
function emmaParseTime(label) {
  // "1:30" or "10:00" or "9:15" — assume today, 24h if >12 else infer
  var m = String(label).match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  var h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  // Party runs 9am–4pm; treat 1–4 as PM
  if (h >= 1 && h <= 7) h += 12;
  var d = new Date();
  d.setHours(h, min, 0, 0);
  return d;
}
function emmaRenderItinerary() {
  var rows = document.getElementById('emma-itin-rows');
  var card = document.getElementById('emma-itin-card');
  if (!rows) return;
  var items = emmaState.itinerary;
  if (!items.length) { if (card) card.style.display = 'none'; return; }
  if (card) card.style.display = '';

  var now = new Date();
  // Find the current/next index
  var nowIdx = -1;
  for (var i = 0; i < items.length; i++) {
    var t = emmaParseTime(items[i].time_label);
    if (t && t > now) { nowIdx = i; break; }
  }
  if (nowIdx === -1) nowIdx = items.length; // all past

  // Show a window around "now" so the card never overflows: prev 1 .. next 4
  var start = Math.max(0, nowIdx - 1);
  var end = Math.min(items.length, start + 5);
  if (end - start < 5) start = Math.max(0, end - 5);

  var html = '';
  for (var j = start; j < end; j++) {
    var cls = j < nowIdx ? 'past' : (j === nowIdx ? 'now' : '');
    html += '<div class="emma-itin-row ' + cls + '"><span class="t">' + items[j].time_label + '</span><span class="a">' + items[j].activity + '</span></div>';
  }
  if (end < items.length) html += '<div class="emma-itin-more">+' + (items.length - end) + ' more later</div>';
  rows.innerHTML = html;
}

/* ── Clock ── */
function emmaStartClock() {
  function tick() {
    var t = document.getElementById('emma-clock-time');
    if (!t) return;
    var now = new Date();
    var h = now.getHours(), m = now.getMinutes();
    var ampm = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    t.textContent = h12 + ':' + (m < 10 ? '0' : '') + m;
  }
  tick();
  if (emmaState.clockTimer) clearInterval(emmaState.clockTimer);
  emmaState.clockTimer = setInterval(tick, 10000);
}

/* ── Audio ── */
function emmaInitAudio() {
  if (!emmaState.music.length) return;
  if (!emmaState.audio) { emmaState.audio = new Audio(); emmaState.audio.volume = 0.6; }
  var audio = emmaState.audio;
  emmaState.musicIdx = emmaState.musicIdx || 0;

  audio.onended = function () { emmaPlayIdx(emmaState.musicIdx + 1); };
  audio.ontimeupdate = function () {
    var bar = document.getElementById('emma-np-prog');
    if (bar && audio.duration) bar.style.width = (100 * audio.currentTime / audio.duration) + '%';
  };
  emmaPlayIdx(emmaState.musicIdx);
}
function emmaPlayIdx(i) {
  var music = emmaState.music;
  if (!music.length) return;
  emmaState.musicIdx = ((i % music.length) + music.length) % music.length;
  var audio = emmaState.audio;
  audio.src = music[emmaState.musicIdx].url;
  audio.play().then(function () { emmaState.playing = true; emmaRenderPlayer(); }).catch(function () { emmaState.playing = false; emmaRenderPlayer(); });
  emmaRenderPlayer();
}
function emmaTogglePlay() {
  var audio = emmaState.audio;
  if (!audio) return;
  if (audio.paused) { audio.play().then(function () { emmaState.playing = true; emmaRenderPlayer(); }).catch(function () {}); }
  else { audio.pause(); emmaState.playing = false; emmaRenderPlayer(); }
}
function emmaRenderPlayer() {
  var music = emmaState.music;
  var t = music[emmaState.musicIdx] || {};
  var title = document.getElementById('emma-np-title');
  var sub = document.getElementById('emma-np-sub');
  var play = document.getElementById('ctrl-play');
  if (title) title.textContent = t.title || 'Music';
  if (sub) sub.textContent = (emmaState.playing ? 'Now Playing' : 'Paused') + (music.length ? ' \u00b7 ' + (emmaState.musicIdx + 1) + '/' + music.length : '');
  if (play) play.textContent = emmaState.playing ? '\u23f8' : '\u25b6';
}

/* ── Playlist panel ── */
function emmaOpenPlaylist() {
  var pl = document.getElementById('emma-playlist');
  var stack = document.querySelector('.emma-stack');
  if (!pl) return;
  var rows = emmaState.music.map(function (m, i) {
    return '<div class="emma-pl-row' + (i === emmaState.musicIdx ? ' playing' : '') + '" data-idx="' + i + '">' +
      '<span class="n">' + (i === emmaState.musicIdx ? '\u25b6' : (i + 1)) + '</span>' +
      '<span class="tt">' + (m.title || 'Track') + '</span></div>';
  }).join('');
  document.getElementById('emma-playlist-rows').innerHTML = rows;
  pl.style.display = 'block';
  if (stack) stack.style.opacity = '0.25';
  emmaState.playlistOpen = true;

  // Register playlist rows with focus manager, push panel to back stack
  var fm = emmaState.focus;
  fm.reset ? null : null; // keep items, add playlist ones
  rebuildFocusForPlaylist();
  fm.pushPanel(function () { emmaClosePlaylist(); });
  emmaSetHint('OK  Play    Back  Close');
}
function emmaClosePlaylist() {
  var pl = document.getElementById('emma-playlist');
  var stack = document.querySelector('.emma-stack');
  if (pl) pl.style.display = 'none';
  if (stack) stack.style.opacity = '1';
  emmaState.playlistOpen = false;
  emmaBuildFocus(document.getElementById('view-emma'));
  emmaState.focus.focus('ctrl-list');
  emmaSetHint('');
}

/* ── Focus wiring ── */
function emmaBuildFocus(el) {
  if (!emmaState.focus) emmaState.focus = new FOSFocus();
  var fm = emmaState.focus;
  fm.reset();
  fm.onBack = function () { closeDestination(); };

  // Register music controls
  var prev = document.getElementById('ctrl-prev');
  var play = document.getElementById('ctrl-play');
  var next = document.getElementById('ctrl-next');
  var list = document.getElementById('ctrl-list');
  if (prev) fm.register('ctrl-prev', prev, function () { emmaPlayIdx(emmaState.musicIdx - 1); });
  if (play) fm.register('ctrl-play', play, function () { emmaTogglePlay(); });
  if (next) fm.register('ctrl-next', next, function () { emmaPlayIdx(emmaState.musicIdx + 1); });
  if (list) fm.register('ctrl-list', list, function () { emmaOpenPlaylist(); });

  // Itinerary card is focusable (glances / future: expand). No-op enter for now.
  var itin = document.getElementById('emma-itin-card');
  if (itin && emmaState.itinerary.length) fm.register('emma-itin', itin, null);

  fm.focus('ctrl-play');
  emmaSetHint('');
}
function rebuildFocusForPlaylist() {
  var fm = emmaState.focus;
  fm.reset();
  fm.onBack = function () { closeDestination(); };
  var rows = document.querySelectorAll('.emma-pl-row');
  rows.forEach(function (row) {
    var idx = parseInt(row.getAttribute('data-idx'), 10);
    fm.register('pl-' + idx, row, function () { emmaPlayIdx(idx); emmaClosePlaylist(); });
  });
  if (rows.length) fm.focus('pl-' + emmaState.musicIdx);
}

function emmaSetHint(txt) {
  var h = document.getElementById('emma-hint');
  if (h) h.textContent = txt || '';
}

/* ── Poll for new content ── */
function emmaStartPoll() {
  if (emmaState.pollTimer) clearInterval(emmaState.pollTimer);
  emmaState.pollTimer = setInterval(async function () {
    var open = document.getElementById('view-emma') && document.getElementById('view-emma').style.display !== 'none';
    if (!open) { clearInterval(emmaState.pollTimer); return; }
    var fresh = await emmaLoadContent();
    if (fresh.photos.length !== emmaState.photos.length ||
        fresh.itinerary.length !== emmaState.itinerary.length ||
        fresh.music.length !== emmaState.music.length) {
      // Reload cleanly
      if (emmaState.audio) { try { emmaState.audio.pause(); } catch (e) {} emmaState.audio = null; }
      openEmmaWorld();
    } else {
      emmaRenderItinerary();
    }
  }, 25000);
}

/* ── Cleanup on close (called by closeDestination in surface.js) ── */
function emmaCleanup() {
  if (emmaState.slideTimer) { clearInterval(emmaState.slideTimer); emmaState.slideTimer = null; }
  if (emmaState.clockTimer) { clearInterval(emmaState.clockTimer); emmaState.clockTimer = null; }
  if (emmaState.pollTimer) { clearInterval(emmaState.pollTimer); emmaState.pollTimer = null; }
  if (emmaState.audio) { try { emmaState.audio.pause(); } catch (e) {} emmaState.audio = null; }
  emmaState.playlistOpen = false;
}

/* ── Key handling entry point (called from surface.js keydown) ── */
function emmaHandleKey(key, code) {
  if (!emmaState.focus) return false;
  return emmaState.focus.handleKey(key, code);
}
