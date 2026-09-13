/* ══════════════════════════════════════════════════════════════
   ELSIE'S WORLD — widget/expand grammar on FOSFocus on FOSNav
   Views: elsie-main -> elsie-gallery | elsie-cheer | elsie-playlist
   Grammar: FOCUS -> OK opens -> interact -> BACK collapses.

   Product note: the full-bleed photo backdrop (elsie_photos) IS
   "My Story" — a fourth widget was deliberately not built for this;
   it mirrors how Emma's backdrop carries her day without a caption
   widget of its own. Gallery and Cheer are kept as two separate
   widgets/data sources per the product brief (Cheer is not folded
   into Story). Feed is out of scope for this build.
   ══════════════════════════════════════════════════════════════ */

// _inDestination is declared once (in fos-emma.js) and shared as a
// plain global across every fos-*.js destination module — safe,
// because these are classic scripts sharing one global scope, not
// modules. Do not redeclare it here.

const ELSIE_API = 'https://fypwabbhxnnwcpfjwrda.supabase.co/rest/v1';
const ELSIE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cHdhYmJoeG5ud2NwZmp3cmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDg3ODUsImV4cCI6MjEwNDEyNDc4NX0.BwzgTd8_-lxENXnTu9ukxnHsgh3diguZbJPnzzC7XD4';

// No fallback image assets exist yet for Elsie (unlike Emma's
// EMMA_FALLBACK_PHOTOS). Empty state degrades to a CSS gradient
// backdrop instead of a broken <img>, see elsieBuildHTML().
var ELSIE_FALLBACK_PHOTOS = [];

var elsieState = {
  photos: [], artwork: [], cheer: [], music: [], highlights: [],
  slideIdx: 0, slideTimer: null,
  musicIdx: 0, audio: null, playing: false,
  clockTimer: null, pollTimer: null,
  focus: null, nav: null,
  gallerySel: 0, cheerSel: 0, playlistSel: 0,
};

async function elsieLoadContent() {
  var hdr = { 'apikey': ELSIE_KEY, 'Authorization': 'Bearer ' + ELSIE_KEY };
  try {
    var res = await Promise.all([
      fetch(ELSIE_API + '/elsie_photos?select=url&order=sort_order', { headers: hdr }).then(function (r) { return r.json(); }),
      fetch(ELSIE_API + '/elsie_artwork?select=url,title,caption&order=sort_order', { headers: hdr }).then(function (r) { return r.json(); }),
      fetch(ELSIE_API + '/elsie_cheer?select=url,caption&order=sort_order', { headers: hdr }).then(function (r) { return r.json(); }),
      fetch(ELSIE_API + '/elsie_music?select=url,title&order=sort_order', { headers: hdr }).then(function (r) { return r.json(); }),
      fetch(ELSIE_API + '/elsie_highlights?select=time_label,activity&order=sort_order', { headers: hdr }).then(function (r) { return r.json(); }),
    ]);
    return {
      photos: (res[0] && res[0].length) ? res[0].map(function (p) { return p.url; }) : ELSIE_FALLBACK_PHOTOS,
      artwork: (res[1] && res[1].length) ? res[1] : [],
      cheer: (res[2] && res[2].length) ? res[2] : [],
      music: (res[3] && res[3].length) ? res[3] : [],
      highlights: (res[4] && res[4].length) ? res[4] : [],
    };
  } catch (e) {
    return { photos: ELSIE_FALLBACK_PHOTOS, artwork: [], cheer: [], music: [], highlights: [] };
  }
}

async function openElsieWorld() {
  var el = document.getElementById('view-elsie');
  if (!el) { el = document.createElement('div'); el.id = 'view-elsie'; document.body.appendChild(el); }
  el.style.cssText = 'position:fixed;inset:0;z-index:500;background:#150a24;overflow:hidden;';
  el.style.display = 'block';
  _inDestination = true;

  var content = await elsieLoadContent();
  elsieState.photos = content.photos;
  elsieState.artwork = content.artwork;
  elsieState.cheer = content.cheer;
  elsieState.music = content.music;
  elsieState.highlights = content.highlights;

  el.innerHTML = elsieBuildHTML();
  elsieInjectStyles();
  elsieStartSparkles();
  elsieStartSlideshow(el);
  elsieStartClock();
  elsieInitAudio();
  elsieRenderLatest();

  elsieState.focus = new FOSFocus();
  elsieState.nav = new FOSNav();
  elsieState.nav.onEmpty = function () { elsieExitToHome(); };
  elsieState.nav.push('elsie-main', null, null, null);
  elsieFocusMain('widget-gallery');

  elsieStartPoll();
}

function elsieExitToHome() {
  elsieCleanup();
  var el = document.getElementById('view-elsie');
  if (el) el.style.display = 'none';
  _inDestination = false;
  if (typeof onElsieExit === 'function') onElsieExit(); // surface.js restores Home + Elsie card focus
}

/* ══ MAIN SCREEN HTML ══ */
function elsieBuildHTML() {
  var hasPhotos = elsieState.photos.length > 0;
  var slides = hasPhotos
    ? elsieState.photos.map(function (src, i) {
        return '<div class="elsie-slide" style="background-image:url(' + src + ');opacity:' + (i === 0 ? '1' : '0') + ';"></div>';
      }).join('')
    : '';

  var galleryCount = elsieState.artwork.length;
  var galleryThumb = galleryCount ? elsieState.artwork[0].url : '';
  var cheerCount = elsieState.cheer.length;
  var cheerThumb = cheerCount ? elsieState.cheer[0].url : '';

  return '' +
    '<div class="elsie-slides' + (hasPhotos ? '' : ' elsie-slides-empty') + '">' + slides + '</div>' +
    '<div class="elsie-sparkles" id="elsie-sparkles"></div>' +
    '<div class="elsie-vignette"></div>' +
    '<div class="elsie-photo-aff elsie-photo-left" id="elsie-photo-left">\u2039</div>' +
    '<div class="elsie-photo-aff elsie-photo-right" id="elsie-photo-right">\u203a</div>' +
    '<div class="elsie-photo-focus" id="elsie-photo-focus"></div>' +

    '<div class="elsie-latest" id="elsie-latest" style="display:none;"></div>' +

    '<div class="elsie-stack">' +
      '<div class="elsie-card elsie-gallery-card" id="widget-gallery">' +
        '<div class="elsie-card-head">My Gallery <span class="elsie-card-open">OK</span></div>' +
        (galleryCount
          ? '<div class="elsie-widget-row"><div class="elsie-widget-thumb" style="background-image:url(' + galleryThumb + ');"></div><div class="elsie-widget-meta">' + galleryCount + ' piece' + (galleryCount === 1 ? '' : 's') + '</div></div>'
          : '<div class="elsie-widget-empty">Coming soon</div>') +
      '</div>' +
      '<div class="elsie-card elsie-cheer-card" id="widget-cheer">' +
        '<div class="elsie-card-head">Cheer <span class="elsie-card-open">OK</span></div>' +
        (cheerCount
          ? '<div class="elsie-widget-row"><div class="elsie-widget-thumb" style="background-image:url(' + cheerThumb + ');"></div><div class="elsie-widget-meta">Chili</div></div>'
          : '<div class="elsie-widget-empty">Coming soon</div>') +
      '</div>' +
      '<div class="elsie-card elsie-player-card">' +
        '<div class="elsie-np">' +
          '<div class="elsie-np-art">\u266a</div>' +
          '<div class="elsie-np-meta">' +
            '<div class="elsie-np-title" id="elsie-np-title">Music</div>' +
            '<div class="elsie-np-sub" id="elsie-np-sub">Now Playing</div>' +
            '<div class="elsie-np-bar"><div class="elsie-np-prog" id="elsie-np-prog"></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="elsie-controls">' +
          '<div class="elsie-ctrl" id="ectrl-prev">\u23ee</div>' +
          '<div class="elsie-ctrl elsie-ctrl-play" id="ectrl-play">\u25b6</div>' +
          '<div class="elsie-ctrl" id="ectrl-next">\u23ed</div>' +
          '<div class="elsie-ctrl" id="ectrl-list">\u2261</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="elsie-overlay" id="elsie-overlay" style="display:none;"></div>' +

    '<div class="elsie-clock" id="elsie-clock"><span id="elsie-clock-time"></span></div>' +
    '<div class="elsie-hint" id="elsie-hint"></div>';
}

function elsieInjectStyles() {
  if (document.getElementById('elsie-styles')) return;
  var s = document.createElement('style');
  s.id = 'elsie-styles';
  s.textContent =
    '.elsie-slides{position:absolute;inset:0;}' +
    '.elsie-slides-empty{background:radial-gradient(circle at 30% 20%,#3a1f5c 0%,#150a24 60%),linear-gradient(160deg,#1c0e33,#0d0518);}' +
    '.elsie-slide{position:absolute;inset:0;background-size:cover;background-position:center;transition:opacity 1.6s ease-in-out;}' +
    '.elsie-vignette{position:absolute;inset:0;pointer-events:none;background:linear-gradient(to right,rgba(21,10,36,0.78) 0%,rgba(21,10,36,0.22) 30%,transparent 55%),linear-gradient(to top,rgba(21,10,36,0.65) 0%,transparent 40%);}' +

    '.elsie-photo-aff{position:absolute;top:50%;transform:translateY(-50%);color:rgba(255,255,255,0.0);font-size:clamp(28px,3vw,48px);z-index:3;pointer-events:none;transition:color 0.2s;}' +
    '.elsie-photo-left{left:2%;} .elsie-photo-right{right:2%;}' +
    '.elsie-photo-focus.fos-focused ~ .elsie-photo-left,.elsie-photo-focus.fos-focused ~ .elsie-photo-right{color:rgba(216,180,254,0.55);}' +
    '.elsie-photo-focus{position:absolute;inset:0;z-index:1;}' +

    '.elsie-latest{position:absolute;top:6vh;right:3.5%;max-width:26vw;background:rgba(21,10,36,0.62);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(216,180,254,0.28);border-radius:16px;padding:1em 1.3em;z-index:4;}' +
    '.elsie-latest-head{color:#d8b4fe;font-size:clamp(10px,0.7vw,13px);font-weight:800;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:0.5em;}' +
    '.elsie-latest-body{color:#fff;font-size:clamp(11px,0.85vw,15px);opacity:0.92;}' +

    '.elsie-stack{position:absolute;left:clamp(20px,3.5vw,60px);bottom:clamp(20px,5vh,70px);display:flex;flex-direction:column;gap:clamp(10px,1.6vh,20px);width:clamp(300px,30vw,460px);z-index:4;}' +
    '.elsie-card{background:rgba(21,10,36,0.64);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(216,180,254,0.28);border-radius:18px;padding:clamp(12px,1.3vw,20px);transition:all 0.18s;}' +
    '.elsie-card-head{color:#d8b4fe;font-size:clamp(11px,0.85vw,15px);font-weight:800;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:0.7em;display:flex;justify-content:space-between;align-items:center;}' +
    '.elsie-card-open{font-size:0.7em;opacity:0;border:1px solid rgba(216,180,254,0.5);border-radius:6px;padding:0.15em 0.5em;letter-spacing:0.1em;transition:opacity 0.2s;}' +

    '.elsie-widget-row{display:flex;align-items:center;gap:0.8em;}' +
    '.elsie-widget-thumb{width:clamp(40px,3.2vw,58px);height:clamp(40px,3.2vw,58px);border-radius:10px;background-size:cover;background-position:center;flex:0 0 auto;box-shadow:0 0 0 1px rgba(216,180,254,0.25);}' +
    '.elsie-widget-meta{color:#fff;font-size:clamp(11px,0.85vw,15px);opacity:0.9;}' +
    '.elsie-widget-empty{color:rgba(255,255,255,0.4);font-size:clamp(10px,0.75vw,13px);font-style:italic;}' +

    '.elsie-np{display:flex;gap:0.8em;align-items:center;margin-bottom:0.8em;}' +
    '.elsie-np-art{width:clamp(38px,3vw,54px);height:clamp(38px,3vw,54px);border-radius:12px;flex:0 0 auto;background:linear-gradient(135deg,#8b5cf6,#5b21b6);display:flex;align-items:center;justify-content:center;font-size:clamp(18px,1.4vw,26px);color:#fff;}' +
    '.elsie-np-meta{flex:1;min-width:0;}' +
    '.elsie-np-title{color:#fff;font-size:clamp(12px,0.9vw,16px);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
    '.elsie-np-sub{color:#d8b4fe;font-size:clamp(9px,0.6vw,11px);letter-spacing:0.1em;text-transform:uppercase;margin-top:0.2em;}' +
    '.elsie-np-bar{height:3px;background:rgba(255,255,255,0.16);border-radius:2px;margin-top:0.6em;overflow:hidden;}' +
    '.elsie-np-prog{height:100%;width:0%;background:#8b5cf6;}' +
    '.elsie-controls{display:flex;justify-content:space-around;align-items:center;gap:0.5em;}' +
    '.elsie-ctrl{width:clamp(38px,3vw,52px);height:clamp(38px,3vw,52px);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:clamp(15px,1.15vw,22px);color:rgba(255,255,255,0.75);background:rgba(255,255,255,0.06);transition:all 0.18s;}' +

    '.fos-focused.elsie-card{border-color:#8b5cf6;box-shadow:0 0 0 1px rgba(139,92,246,0.4),0 0 24px rgba(139,92,246,0.25);}' +
    '.fos-focused .elsie-card-open{opacity:1;}' +
    '.fos-focused.elsie-ctrl{background:#8b5cf6;color:#fff;}' +

    '.elsie-overlay{position:fixed;inset:0;z-index:10;background:rgba(13,5,24,0.94);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6vh 6vw;}' +
    '.elsie-ov-head{color:#d8b4fe;font-size:clamp(12px,0.9vw,16px);font-weight:800;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:0.3em;}' +
    '.elsie-ov-sub{color:rgba(255,255,255,0.5);font-size:clamp(10px,0.75vw,13px);margin-bottom:2em;}' +

    '.elsie-gallery-grid{display:flex;gap:2vw;overflow-x:auto;padding:1vh 0 2vh;max-width:88vw;scrollbar-width:none;}' +
    '.elsie-gallery-grid::-webkit-scrollbar{display:none;}' +
    '.elsie-gallery-piece{flex:0 0 auto;width:24vw;max-width:340px;display:flex;flex-direction:column;gap:0.8em;outline:none;}' +
    '.elsie-gallery-frame{width:100%;aspect-ratio:4/5;border-radius:12px;background-size:cover;background-position:center;background-color:#1c0e33;border:2px solid transparent;transition:all 0.18s;box-shadow:0 12px 30px rgba(0,0,0,0.5);}' +
    '.elsie-gallery-piece.fos-focused .elsie-gallery-frame{border-color:#8b5cf6;transform:scale(1.03);box-shadow:0 16px 40px rgba(0,0,0,0.6),0 0 24px rgba(139,92,246,0.3);}' +
    '.elsie-gallery-title{color:#fff;font-size:clamp(12px,0.95vw,17px);font-weight:700;}' +
    '.elsie-gallery-caption{color:rgba(255,255,255,0.55);font-size:clamp(10px,0.78vw,14px);}' +

    '.elsie-ov-foot{color:rgba(255,255,255,0.4);font-size:clamp(9px,0.65vw,11px);margin-top:2em;letter-spacing:0.08em;}' +

    '.elsie-clock{position:absolute;bottom:clamp(16px,3vh,32px);right:clamp(20px,3.5vw,50px);color:rgba(255,255,255,0.5);font-size:clamp(13px,1vw,18px);font-variant-numeric:tabular-nums;z-index:4;}' +
    '.elsie-hint{position:absolute;bottom:clamp(16px,3vh,32px);left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.35);font-size:clamp(9px,0.7vw,12px);letter-spacing:0.08em;z-index:4;white-space:nowrap;}' +

    '.elsie-sparkle{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(216,180,254,0.9) 0%,rgba(216,180,254,0) 70%);pointer-events:none;animation:elsie-drift linear infinite;}' +
    '@keyframes elsie-drift{0%{transform:translateY(0) translateX(0);opacity:0;}10%{opacity:0.8;}90%{opacity:0.5;}100%{transform:translateY(-40vh) translateX(2vw);opacity:0;}}';
  document.head.appendChild(s);
}

/* ══ SPARKLE ATMOSPHERE (paint-fleck feel, not glyphs) ══ */
function elsieStartSparkles() {
  var host = document.getElementById('elsie-sparkles');
  if (!host) return;
  host.innerHTML = '';
  var n = 22;
  for (var i = 0; i < n; i++) {
    var d = document.createElement('div');
    var size = 2 + Math.random() * 4;
    d.className = 'elsie-sparkle';
    d.style.width = size + 'px';
    d.style.height = size + 'px';
    d.style.left = (Math.random() * 100) + '%';
    d.style.bottom = (-5 - Math.random() * 15) + '%';
    d.style.animationDuration = (10 + Math.random() * 14) + 's';
    d.style.animationDelay = (Math.random() * 10) + 's';
    host.appendChild(d);
  }
}

/* ══ BACKDROP SLIDESHOW (= My Story) ══ */
function elsieStartSlideshow(root) {
  if (elsieState.photos.length < 2) return;
  if (elsieState.slideTimer) clearInterval(elsieState.slideTimer);
  elsieState.slideTimer = setInterval(function () {
    elsieNextPhoto();
  }, 9000);
}
function elsieShowPhoto(idx) {
  var el = document.getElementById('view-elsie');
  if (!el) return;
  var slides = el.querySelectorAll('.elsie-slide');
  if (!slides.length) return;
  var n = slides.length;
  idx = ((idx % n) + n) % n;
  slides.forEach(function (s, i) { s.style.opacity = (i === idx) ? '1' : '0'; });
  elsieState.slideIdx = idx;
}
function elsieNextPhoto() { elsieShowPhoto(elsieState.slideIdx + 1); resetSlideTimer(); }
function elsiePrevPhoto() { elsieShowPhoto(elsieState.slideIdx - 1); resetSlideTimer(); }
function resetSlideTimer() {
  if (elsieState.slideTimer) clearInterval(elsieState.slideTimer);
  if (elsieState.photos.length > 1) {
    elsieState.slideTimer = setInterval(function () { elsieNextPhoto(); }, 9000);
  }
}

/* ══ CLOCK ══ */
function elsieStartClock() {
  function tick() {
    var t = document.getElementById('elsie-clock-time');
    if (!t) return;
    var d = new Date();
    var h = d.getHours() % 12 || 12;
    var m = ('0' + d.getMinutes()).slice(-2);
    t.textContent = h + ':' + m + (d.getHours() < 12 ? ' AM' : ' PM');
  }
  tick();
  if (elsieState.clockTimer) clearInterval(elsieState.clockTimer);
  elsieState.clockTimer = setInterval(tick, 15000);
}

/* ══ LATEST FROM ELSIE (only shown if content exists) ══ */
function elsieRenderLatest() {
  var box = document.getElementById('elsie-latest');
  if (!box) return;
  if (!elsieState.highlights.length) { box.style.display = 'none'; return; }
  var top = elsieState.highlights[0];
  box.innerHTML =
    '<div class="elsie-latest-head">Latest from Elsie</div>' +
    '<div class="elsie-latest-body">' + top.activity + '</div>';
  box.style.display = 'block';
}

/* ══ MUSIC ══ */
function elsieInitAudio() {
  if (!elsieState.audio) elsieState.audio = new Audio();
  var a = elsieState.audio;
  a.onended = function () { elsiePlayIdx(elsieState.musicIdx + 1); };
  a.ontimeupdate = function () {
    var bar = document.getElementById('elsie-np-prog');
    if (bar && a.duration) bar.style.width = ((a.currentTime / a.duration) * 100) + '%';
  };
  if (elsieState.music.length) elsieLoadTrack(0, false);
}
function elsieLoadTrack(idx, autoplay) {
  var n = elsieState.music.length;
  if (!n) return;
  idx = ((idx % n) + n) % n;
  elsieState.musicIdx = idx;
  var track = elsieState.music[idx];
  var a = elsieState.audio;
  a.src = track.url; // single persistent element, src swap only — never new Audio() per track
  var title = document.getElementById('elsie-np-title');
  if (title) title.textContent = track.title || 'Track';
  if (autoplay) { a.play().catch(function () {}); elsieState.playing = true; elsieUpdatePlayIcon(); }
}
function elsiePlayIdx(idx) { elsieLoadTrack(idx, true); }
function elsieTogglePlay() {
  var a = elsieState.audio;
  if (!a || !elsieState.music.length) return;
  if (elsieState.playing) { a.pause(); elsieState.playing = false; }
  else { a.play().catch(function () {}); elsieState.playing = true; }
  elsieUpdatePlayIcon();
}
function elsieUpdatePlayIcon() {
  var b = document.getElementById('ectrl-play');
  if (b) b.textContent = elsieState.playing ? '\u23f8' : '\u25b6';
}

/* ══ FOCUS: MAIN SCREEN ══ */
function elsieFocusMain(focusId) {
  var fm = elsieState.focus;
  fm.reset();
  var gallery = document.getElementById('widget-gallery');
  var cheer = document.getElementById('widget-cheer');
  var prev = document.getElementById('ectrl-prev');
  var play = document.getElementById('ectrl-play');
  var next = document.getElementById('ectrl-next');
  var list = document.getElementById('ectrl-list');
  var photo = document.getElementById('elsie-photo-focus');

  if (photo) fm.register('photo', photo, null);
  if (gallery && elsieState.artwork.length) fm.register('widget-gallery', gallery, function () { elsieOpenGallery(); });
  if (cheer && elsieState.cheer.length) fm.register('widget-cheer', cheer, function () { elsieOpenCheer(); });
  if (prev) fm.register('ectrl-prev', prev, function () { elsiePlayIdx(elsieState.musicIdx - 1); });
  if (play) fm.register('ectrl-play', play, function () { elsieTogglePlay(); });
  if (next) fm.register('ectrl-next', next, function () { elsiePlayIdx(elsieState.musicIdx + 1); });
  if (list) fm.register('ectrl-list', list, function () { elsieOpenPlaylist(); });

  var startId = focusId;
  if (startId === 'widget-gallery' && !elsieState.artwork.length) startId = 'ectrl-play';
  fm.focus(startId || 'ectrl-play');
  elsieState.nav.markFocus(fm.currentId);
  elsieUpdateHint();
}

/* ══ EXPANDED: GALLERY ══ */
function elsieOpenGallery() {
  var ov = document.getElementById('elsie-overlay');
  var pieces = elsieState.artwork;
  var itemsHtml = pieces.map(function (p, i) {
    return '<div class="elsie-gallery-piece" data-idx="' + i + '">' +
      '<div class="elsie-gallery-frame" style="background-image:url(' + p.url + ');"></div>' +
      '<div class="elsie-gallery-title">' + (p.title || 'Untitled') + '</div>' +
      (p.caption ? '<div class="elsie-gallery-caption">' + p.caption + '</div>' : '') +
      '</div>';
  }).join('');
  ov.innerHTML =
    '<div class="elsie-ov-head">My Gallery</div>' +
    '<div class="elsie-ov-sub">' + pieces.length + ' piece' + (pieces.length === 1 ? '' : 's') + '</div>' +
    '<div class="elsie-gallery-grid" id="elsie-gallery-grid">' + itemsHtml + '</div>' +
    '<div class="elsie-ov-foot">\u25c0\u25b6  Browse    Back  Return</div>';
  ov.style.display = 'flex';

  elsieState.nav.push('elsie-gallery', 'widget-gallery', null, function () { ov.style.display = 'none'; });

  var fm = elsieState.focus;
  fm.reset();
  var els = ov.querySelectorAll('.elsie-gallery-piece');
  els.forEach(function (el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    fm.register('gallery-' + idx, el, null);
  });
  fm.focus('gallery-' + elsieState.gallerySel);
  elsieSetHint('\u25c0\u25b6  Browse    Back  Return');
}

/* ══ EXPANDED: CHEER ══ */
function elsieOpenCheer() {
  var ov = document.getElementById('elsie-overlay');
  var pieces = elsieState.cheer;
  var itemsHtml = pieces.map(function (p, i) {
    return '<div class="elsie-gallery-piece" data-idx="' + i + '">' +
      '<div class="elsie-gallery-frame" style="background-image:url(' + p.url + ');"></div>' +
      (p.caption ? '<div class="elsie-gallery-caption">' + p.caption + '</div>' : '') +
      '</div>';
  }).join('');
  ov.innerHTML =
    '<div class="elsie-ov-head">Cheer</div>' +
    '<div class="elsie-ov-sub">Chili</div>' +
    '<div class="elsie-gallery-grid" id="elsie-cheer-grid">' + itemsHtml + '</div>' +
    '<div class="elsie-ov-foot">\u25c0\u25b6  Browse    Back  Return</div>';
  ov.style.display = 'flex';

  elsieState.nav.push('elsie-cheer', 'widget-cheer', null, function () { ov.style.display = 'none'; });

  var fm = elsieState.focus;
  fm.reset();
  var els = ov.querySelectorAll('.elsie-gallery-piece');
  els.forEach(function (el) {
    var idx = parseInt(el.getAttribute('data-idx'), 10);
    fm.register('cheer-' + idx, el, null);
  });
  fm.focus('cheer-' + elsieState.cheerSel);
  elsieSetHint('\u25c0\u25b6  Browse    Back  Return');
}

/* ══ EXPANDED: PLAYLIST ══ */
function elsieOpenPlaylist() {
  var ov = document.getElementById('elsie-overlay');
  var music = elsieState.music;
  var rowsHtml = music.map(function (m, i) {
    var playing = (i === elsieState.musicIdx) ? ' playing' : '';
    return '<div class="elsie-ov-row' + playing + '" data-idx="' + i + '"><span class="t">' + (i === elsieState.musicIdx ? '\u25b6' : (i + 1)) + '</span><span class="a">' + (m.title || 'Track') + '</span></div>';
  }).join('');
  ov.innerHTML =
    '<div class="elsie-ov-head">Playlist</div>' +
    '<div class="elsie-ov-sub">' + music.length + ' songs</div>' +
    '<div class="elsie-ov-list" id="elsie-ov-list">' + rowsHtml + '</div>' +
    '<div class="elsie-ov-foot">OK  Play     Back  Return</div>';
  ov.style.display = 'flex';

  elsieState.nav.push('elsie-playlist', 'ectrl-list', null, function () { ov.style.display = 'none'; });

  var fm = elsieState.focus;
  fm.reset();
  var rows = ov.querySelectorAll('.elsie-ov-row');
  rows.forEach(function (row) {
    var idx = parseInt(row.getAttribute('data-idx'), 10);
    fm.register('epl-' + idx, row, function () { elsiePlayIdx(idx); });
  });
  fm.focus('epl-' + elsieState.musicIdx);
  elsieSetHint('\u25b2\u25bc  Choose    OK  Play    Back  Return');
}

/* ══ HINTS ══ */
function elsieUpdateHint() {
  var id = elsieState.focus.currentId;
  if (id === 'widget-gallery') elsieSetHint('OK  Open gallery');
  else if (id === 'widget-cheer') elsieSetHint('OK  Open cheer');
  else if (id === 'ectrl-list') elsieSetHint('OK  Open playlist');
  else if (id === 'photo') elsieSetHint('\u25c0\u25b6  Change photo');
  else if (id && id.indexOf('ectrl-') === 0) elsieSetHint('OK  Play / pause    \u25c0\u25b6  Move');
  else elsieSetHint('');
}
function elsieSetHint(txt) {
  var h = document.getElementById('elsie-hint');
  if (h) h.textContent = txt || '';
}

/* ══ POLL (content refresh from Control Room, no restart needed) ══ */
function elsieStartPoll() {
  if (elsieState.pollTimer) clearInterval(elsieState.pollTimer);
  elsieState.pollTimer = setInterval(async function () {
    var open = document.getElementById('view-elsie') && document.getElementById('view-elsie').style.display !== 'none';
    if (!open) { clearInterval(elsieState.pollTimer); return; }
    if (elsieState.nav.currentView() === 'elsie-main') {
      var content = await elsieLoadContent();
      elsieState.highlights = content.highlights;
      elsieRenderLatest();
    }
  }, 25000);
}

function elsieCleanup() {
  if (elsieState.slideTimer) { clearInterval(elsieState.slideTimer); elsieState.slideTimer = null; }
  if (elsieState.clockTimer) { clearInterval(elsieState.clockTimer); elsieState.clockTimer = null; }
  if (elsieState.pollTimer) { clearInterval(elsieState.pollTimer); elsieState.pollTimer = null; }
  if (elsieState.audio) { try { elsieState.audio.pause(); } catch (e) {} elsieState.audio = null; }
}

/* ══ KEY ENTRY POINT (from surface.js) ══ */
function elsieHandleKey(key, code) {
  if (!elsieState.focus || !elsieState.nav) return false;
  var isBack = code === 4 || code === 27 || key === 'Escape' || key === 'GoBack';
  var view = elsieState.nav.currentView();

  if (isBack) {
    if (view === 'elsie-main') {
      elsieState.nav.back(); // triggers onEmpty -> elsieExitToHome
      return true;
    }
    var restored = elsieState.nav.back();
    if (restored && restored.view === 'elsie-main') {
      elsieFocusMain(restored.focusId || 'ectrl-play');
    }
    return true;
  }

  if (view === 'elsie-main' && elsieState.focus.currentId === 'photo') {
    if (key === 'ArrowLeft' || code === 37) { elsiePrevPhoto(); return true; }
    if (key === 'ArrowRight' || code === 39) { elsieNextPhoto(); return true; }
  }
  if (view === 'elsie-gallery' && (key === 'ArrowLeft' || code === 37 || key === 'ArrowRight' || code === 39)) {
    var handled = elsieState.focus.handleKey(key, code);
    if (handled) {
      var m = elsieState.focus.currentId.match(/^gallery-(\d+)$/);
      if (m) elsieState.gallerySel = parseInt(m[1], 10);
    }
    return handled;
  }
  if (view === 'elsie-cheer' && (key === 'ArrowLeft' || code === 37 || key === 'ArrowRight' || code === 39)) {
    var handled2 = elsieState.focus.handleKey(key, code);
    if (handled2) {
      var m2 = elsieState.focus.currentId.match(/^cheer-(\d+)$/);
      if (m2) elsieState.cheerSel = parseInt(m2[1], 10);
    }
    return handled2;
  }

  var handled3 = elsieState.focus.handleKey(key, code);
  if (handled3 && view === 'elsie-main') {
    elsieState.nav.markFocus(elsieState.focus.currentId);
    elsieUpdateHint();
  }
  return handled3;
}
