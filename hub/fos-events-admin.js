/* ══════════════════════════════════════════════════════════════
   FOS EVENTS (control rooms)
   One place per person to see an event, its days, and every photo,
   video and reel captured for each day. Upload straight into a day,
   move things between days, hide what doesn't belong.

   Data: events (person_id, parent_event_id) + content_items (event_id).
   Files: Supabase storage bucket "family-media".
   Mount: FOSEvents.mount(el, { sb, personId, personName })
   ══════════════════════════════════════════════════════════════ */
(function () {
  var BUCKET = 'family-media';
  var TYPE_LABEL = { raw_photo: 'Photo', raw_video: 'Video', edit: 'Reel', song: 'Song' };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function fmtDate(d) { if (!d) return ''; var x = new Date(d + (String(d).length === 10 ? 'T12:00:00' : '')); return x.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtDur(s) { if (!s) return ''; s = Math.round(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function kindOf(it) { return it.content_type === 'edit' ? 'reel' : it.content_type === 'raw_video' ? 'video' : it.content_type === 'raw_photo' ? 'photo' : 'other'; }
  function thumbOf(it) { return it.poster_url || (it.content_type === 'raw_photo' ? it.source_view_url : '') || ''; }

  var CSS =
    '.fev-top{display:flex;gap:8px;align-items:center;margin-bottom:10px;}' +
    '.fev-top select{flex:1;padding:10px;background:rgba(0,0,0,0.3);color:#fff;}' +
    '.fev-title{font-size:18px;font-weight:800;color:#fff;margin:2px 0;}' +
    '.fev-meta{font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:12px;}' +
    '.fev-days{display:flex;gap:8px;overflow-x:auto;padding-bottom:6px;margin-bottom:10px;scrollbar-width:none;}' +
    '.fev-days::-webkit-scrollbar{display:none;}' +
    '.fev-day{flex:0 0 auto;padding:9px 12px;border-radius:12px;background:rgba(255,255,255,0.07);border:1px solid rgba(216,180,254,0.18);cursor:pointer;min-width:92px;}' +
    '.fev-day.on{background:#8b5cf6;border-color:#8b5cf6;}' +
    '.fev-day .n{font-size:13px;font-weight:700;color:#fff;white-space:nowrap;}' +
    '.fev-day .d{font-size:11px;color:rgba(255,255,255,0.6);margin-top:2px;white-space:nowrap;}' +
    '.fev-day.add{display:flex;align-items:center;justify-content:center;min-width:56px;font-size:20px;color:#d8b4fe;}' +
    '.fev-filters{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;}' +
    '.fev-f{padding:6px 11px;border-radius:16px;background:rgba(255,255,255,0.08);font-size:12px;cursor:pointer;color:#fff;}' +
    '.fev-f.on{background:rgba(139,92,246,0.85);}' +
    '.fev-up{display:flex;flex-direction:column;align-items:center;gap:3px;padding:14px;border:1.5px dashed rgba(139,92,246,0.55);border-radius:14px;cursor:pointer;margin-bottom:12px;text-align:center;}' +
    '.fev-up b{font-size:14px;color:#fff;}.fev-up span{font-size:11px;color:rgba(255,255,255,0.5);}' +
    '.fev-prog{font-size:12px;color:rgba(255,255,255,0.7);margin:-4px 0 10px;}' +
    '.fev-prog div{padding:3px 0;}' +
    '.fev-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;}' +
    '.fev-tile{position:relative;aspect-ratio:1/1;border-radius:10px;overflow:hidden;background:#1f1233 center/cover no-repeat;cursor:pointer;}' +
    '.fev-tile .b{position:absolute;left:5px;top:5px;font-size:10px;font-weight:800;padding:2px 6px;border-radius:8px;background:rgba(0,0,0,0.6);color:#fff;letter-spacing:0.03em;}' +
    '.fev-tile .b.reel{background:#8b5cf6;}' +
    '.fev-tile .t{position:absolute;right:5px;bottom:5px;font-size:10px;font-weight:700;padding:2px 5px;border-radius:6px;background:rgba(0,0,0,0.6);color:#fff;}' +
    '.fev-tile .s{position:absolute;right:5px;top:5px;width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 2px rgba(0,0,0,0.4);}' +
    '.fev-tile .s.draft{background:#ffd27a;}.fev-tile .s.approved{background:#5fe08a;}' +
    '.fev-tile .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;color:rgba(255,255,255,0.35);}' +
    '.fev-empty{padding:26px 10px;text-align:center;color:rgba(255,255,255,0.45);font-size:13px;}' +
    '.fev-sub{font-size:12px;color:rgba(255,255,255,0.55);margin:14px 0 6px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;}' +
    '.fev-modal{position:fixed;inset:0;z-index:1000;background:rgba(10,4,20,0.96);display:flex;flex-direction:column;}' +
    '.fev-modal .mv{flex:1;display:flex;align-items:center;justify-content:center;min-height:0;padding:12px;}' +
    '.fev-modal img,.fev-modal video{max-width:100%;max-height:100%;border-radius:10px;}' +
    '.fev-modal .mb{padding:12px 14px 22px;display:flex;flex-direction:column;gap:8px;max-width:640px;width:100%;margin:0 auto;}' +
    '.fev-modal .mt{font-weight:700;font-size:14px;}.fev-modal .ms{font-size:12px;color:rgba(255,255,255,0.55);}' +
    '.fev-modal .mr{display:flex;gap:8px;align-items:center;}' +
    '.fev-modal select{flex:1;padding:10px;background:rgba(255,255,255,0.1);color:#fff;}' +
    '.fev-modal .none{color:rgba(255,255,255,0.5);font-size:13px;text-align:center;padding:0 20px;}' +
    '.fev-addday{display:flex;gap:6px;margin:-2px 0 12px;}.fev-addday input{flex:1;padding:10px;background:rgba(0,0,0,0.3);color:#fff;border-radius:10px;}' +
    '.fev-addday input[type=date]{flex:0 0 150px;}';

  function injectCss() {
    if (document.getElementById('fev-css')) return;
    var s = document.createElement('style'); s.id = 'fev-css'; s.textContent = CSS; document.head.appendChild(s);
  }


  /* iPhone fix: Safari on iOS can hand supabase-js a File that goes out as an
     EMPTY multipart body (logs showed content-length 0 from every iPhone upload,
     real sizes from Android). Reading the bytes ourselves and uploading the raw
     ArrayBuffer avoids that path. Patched once on the storage prototype so every
     uploader on the page (Events, Photos, Artwork, Cheer, Music) gets the fix. */
  function readBytes(blob) {
    var viaApi = (blob && typeof blob.arrayBuffer === 'function') ? blob.arrayBuffer().catch(function () { return null; }) : Promise.resolve(null);
    return viaApi.then(function (buf) {
      if (buf && buf.byteLength) return buf;
      return new Promise(function (res) {
        try {
          var fr = new FileReader();
          fr.onload = function () { res(fr.result); };
          fr.onerror = function () { res(null); };
          fr.readAsArrayBuffer(blob);
        } catch (e) { res(null); }
      });
    });
  }
  function guessType(name) {
    var ext = String(name || '').toLowerCase().split('.').pop();
    return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp', gif: 'image/gif',
             mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/x-m4v', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav' }[ext] || 'application/octet-stream';
  }
  function patchUploads(sb) {
    try {
      var proto = Object.getPrototypeOf(sb.storage.from('family-media'));
      if (!proto || proto.__fosBytesPatch) return;
      var orig = proto.upload;
      proto.upload = function (path, body, opts) {
        var self = this;
        if (typeof Blob === 'undefined' || !(body instanceof Blob)) return orig.call(self, path, body, opts);
        return readBytes(body).then(function (buf) {
          if (!buf || !buf.byteLength) {
            return { data: null, error: { message: 'The phone handed over an empty file. If it is stored in iCloud, open it in Photos so it downloads, then try again.' } };
          }
          var o = Object.assign({}, opts || {});
          if (!o.contentType) o.contentType = body.type || guessType(body.name);
          return orig.call(self, path, buf, o);
        });
      };
      proto.__fosBytesPatch = true;
    } catch (e) {}
  }
  window.FOSPatchUploads = patchUploads;

  function mount(root, opts) {
    injectCss();
    var sb = opts.sb, personId = opts.personId, personName = opts.personName || '';
    patchUploads(sb);
    var st = { roots: [], allEvents: [], rootId: null, days: [], items: [], day: 'all', filter: 'all', addingDay: false };

    function say(msg, ok) {
      if (typeof showStatus === 'function') { showStatus(msg, ok !== false); return; }
      if (!ok) alert(msg);
    }

    async function load() {
      root.innerHTML = '<div class="fev-empty">Loading events\u2026</div>';
      var r = await sb.from('events').select('id,title,event_date,parent_event_id,description').eq('person_id', personId).order('event_date', { ascending: true });
      if (r.error) { root.innerHTML = '<div class="fev-empty">Could not load events: ' + esc(r.error.message) + '</div>'; return; }
      st.allEvents = r.data || [];
      st.roots = st.allEvents.filter(function (e) { return !e.parent_event_id; });
      if (!st.roots.length) { root.innerHTML = '<div class="fev-empty">No events for ' + esc(personName) + ' yet.</div>'; return; }
      if (!st.rootId || !st.roots.some(function (e) { return e.id === st.rootId; })) {
        // Most recent event first: the one whose latest day is newest.
        st.rootId = st.roots.slice().sort(function (a, b) { return latestDate(b) < latestDate(a) ? -1 : 1; })[0].id;
      }
      await loadItems();
    }

    function latestDate(ev) {
      var ds = st.allEvents.filter(function (e) { return e.parent_event_id === ev.id; }).map(function (e) { return e.event_date || ''; });
      ds.push(ev.event_date || '');
      return ds.sort().pop();
    }

    async function loadItems() {
      st.days = st.allEvents.filter(function (e) { return e.parent_event_id === st.rootId; })
        .sort(function (a, b) { return (a.event_date || '').localeCompare(b.event_date || ''); });
      var ids = [st.rootId].concat(st.days.map(function (d) { return d.id; }));
      var r = await sb.from('content_items')
        .select('id,title,content_type,event_id,captured_at,created_at,source_view_url,poster_url,duration_seconds,lifecycle_status,orientation,people_notes')
        .in('event_id', ids).order('captured_at', { ascending: true, nullsFirst: false });
      if (r.error) { root.innerHTML = '<div class="fev-empty">Could not load photos and videos: ' + esc(r.error.message) + '</div>'; return; }
      st.items = (r.data || []).filter(function (it) { return it.lifecycle_status !== 'hidden' && it.content_type !== 'song'; });
      if (st.day !== 'all' && st.day !== 'unsorted' && !st.days.some(function (d) { return d.id === st.day; })) st.day = 'all';
      render();
    }

    function inDay(it) {
      if (st.day === 'all') return true;
      if (st.day === 'unsorted') return it.event_id === st.rootId;
      return it.event_id === st.day;
    }
    function count(eventId, kind) {
      return st.items.filter(function (it) { return (eventId == null || it.event_id === eventId) && (!kind || kindOf(it) === kind); }).length;
    }

    function render() {
      var rootEv = st.roots.find(function (e) { return e.id === st.rootId; });
      var dated = st.days.filter(function (d) { return d.event_date; }).map(function (d) { return d.event_date; });
      var range = dated.length ? fmtDate(dated[0]) + (dated.length > 1 ? ' \u2013 ' + fmtDate(dated[dated.length - 1]) : '') : fmtDate(rootEv.event_date);
      var inView = st.items.filter(inDay);
      var shown = inView.filter(function (it) { return st.filter === 'all' || kindOf(it) === st.filter; });
      var unsorted = count(st.rootId);

      var html = '';
      if (st.roots.length > 1) {
        html += '<div class="fev-top"><select id="fev-root">' + st.roots.map(function (e) {
          return '<option value="' + e.id + '"' + (e.id === st.rootId ? ' selected' : '') + '>' + esc(e.title) + '</option>';
        }).join('') + '</select></div>';
      }
      html += '<div class="fev-title">' + esc(rootEv.title) + '</div>';
      html += '<div class="fev-meta">' + (range ? esc(range) + ' \u00b7 ' : '') + count(null, 'photo') + ' photos \u00b7 ' + count(null, 'video') + ' videos \u00b7 ' + count(null, 'reel') + ' reels</div>';

      html += '<div class="fev-days">';
      html += dayChip('all', 'Everything', st.items.length + ' items');
      st.days.forEach(function (d) { html += dayChip(d.id, d.title, (d.event_date ? fmtDate(d.event_date) + ' \u00b7 ' : '') + count(d.id) + ' items'); });
      if (unsorted) html += dayChip('unsorted', 'Not sorted', unsorted + ' items');
      html += '<div class="fev-day add" id="fev-add-day" title="Add a day">+</div>';
      html += '</div>';
      if (st.addingDay) {
        html += '<div class="fev-addday"><input type="text" id="fev-new-title" placeholder="Day name, e.g. Cinema trip"><input type="date" id="fev-new-date"><button class="small" id="fev-new-save">Add</button></div>';
      }

      html += '<div class="fev-filters">' + ['all', 'photo', 'video', 'reel'].map(function (f) {
        var n = inView.filter(function (it) { return f === 'all' || kindOf(it) === f; }).length;
        var label = { all: 'All', photo: 'Photos', video: 'Videos', reel: 'Reels' }[f];
        return '<div class="fev-f' + (st.filter === f ? ' on' : '') + '" data-f="' + f + '">' + label + ' ' + n + '</div>';
      }).join('') + '</div>';

      var target = uploadTarget();
      html += '<label class="fev-up"><input type="file" id="fev-file" accept="image/*,video/*" multiple style="display:none"><b>+ Add photos &amp; videos</b><span>to ' + esc(target.title) + '</span></label>';
      html += '<div class="fev-prog" id="fev-prog"></div>';

      if (!shown.length) {
        html += '<div class="fev-empty">Nothing here yet.' + (st.day !== 'all' ? ' Add photos and videos for this day above.' : '') + '</div>';
      } else if (st.day === 'all' && st.days.length) {
        // Grouped by day so the whole event reads in order.
        var groups = st.days.map(function (d) { return { id: d.id, title: d.title, date: d.event_date }; });
        if (unsorted) groups.push({ id: st.rootId, title: 'Not sorted', date: null });
        groups.forEach(function (g) {
          var gi = shown.filter(function (it) { return it.event_id === g.id; });
          if (!gi.length) return;
          html += '<div class="fev-sub">' + esc(g.title) + (g.date ? ' \u00b7 ' + esc(fmtDate(g.date)) : '') + '</div>';
          html += '<div class="fev-grid">' + gi.map(tile).join('') + '</div>';
        });
      } else {
        html += '<div class="fev-grid">' + shown.map(tile).join('') + '</div>';
      }
      root.innerHTML = html;
      wire();
    }

    function dayChip(id, title, sub) {
      return '<div class="fev-day' + (st.day === id ? ' on' : '') + '" data-day="' + id + '"><div class="n">' + esc(title) + '</div><div class="d">' + esc(sub) + '</div></div>';
    }
    function tile(it) {
      var k = kindOf(it), th = thumbOf(it);
      return '<div class="fev-tile" data-id="' + it.id + '" style="' + (th ? 'background-image:url(\'' + th.replace(/'/g, '%27') + '\')' : '') + '">' +
        (th ? '' : '<div class="ph">' + (k === 'photo' ? '\u25a3' : '\u25b6') + '</div>') +
        (k !== 'photo' ? '<div class="b' + (k === 'reel' ? ' reel' : '') + '">' + (k === 'reel' ? 'REEL' : '\u25b6') + '</div>' : '') +
        (k === 'reel' ? '<div class="s ' + (it.lifecycle_status === 'approved' ? 'approved' : 'draft') + '"></div>' : '') +
        (it.duration_seconds ? '<div class="t">' + fmtDur(it.duration_seconds) + '</div>' : '') +
        '</div>';
    }
    function uploadTarget() {
      if (st.day !== 'all' && st.day !== 'unsorted') { var d = st.days.find(function (x) { return x.id === st.day; }); if (d) return d; }
      // From "Everything", uploads go to today's day if there is one, else the event itself.
      var today = new Date().toISOString().slice(0, 10);
      var td = st.days.find(function (x) { return x.event_date === today; });
      return td || st.roots.find(function (e) { return e.id === st.rootId; });
    }

    function wire() {
      var sel = root.querySelector('#fev-root');
      if (sel) sel.onchange = function () { st.rootId = sel.value; st.day = 'all'; loadItems(); };
      root.querySelectorAll('.fev-day[data-day]').forEach(function (c) { c.onclick = function () { st.day = c.getAttribute('data-day'); st.filter = 'all'; render(); }; });
      var add = root.querySelector('#fev-add-day');
      if (add) add.onclick = function () { st.addingDay = !st.addingDay; render(); var t = root.querySelector('#fev-new-title'); if (t) t.focus(); };
      var save = root.querySelector('#fev-new-save');
      if (save) save.onclick = addDay;
      root.querySelectorAll('.fev-f').forEach(function (c) { c.onclick = function () { st.filter = c.getAttribute('data-f'); render(); }; });
      var file = root.querySelector('#fev-file');
      if (file) file.onchange = function () { upload(Array.prototype.slice.call(file.files || [])); };
      root.querySelectorAll('.fev-tile').forEach(function (t) { t.onclick = function () { openItem(t.getAttribute('data-id')); }; });
    }

    async function addDay() {
      var t = (root.querySelector('#fev-new-title').value || '').trim();
      var d = root.querySelector('#fev-new-date').value || null;
      if (!t) { say('Give the day a name first.', false); return; }
      var r = await sb.from('events').insert({ title: t, event_date: d, parent_event_id: st.rootId, person_id: personId }).select('id').single();
      if (r.error) { say('Could not add the day: ' + r.error.message, false); return; }
      st.addingDay = false; st.day = r.data.id;
      say('Added ' + t + '.');
      await load();
    }

    /* ── Upload: files go to family-media/<person>/<event>/, one catalogue row each ── */
    function probeImage(file) {
      return new Promise(function (res) {
        var i = new Image(); var u = URL.createObjectURL(file);
        i.onload = function () { res({ w: i.naturalWidth, h: i.naturalHeight }); URL.revokeObjectURL(u); };
        i.onerror = function () { res(null); };
        i.src = u;
      });
    }
    function probeVideo(file) {
      return new Promise(function (res) {
        var done = false, v = document.createElement('video'), u = URL.createObjectURL(file);
        function finish(x) { if (done) return; done = true; try { URL.revokeObjectURL(u); } catch (e) {} res(x); }
        v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.preload = 'auto'; v.src = u;
        v.onloadedmetadata = function () { try { v.currentTime = Math.min(1.5, (v.duration || 3) / 3); } catch (e) { finish({ dur: v.duration, w: v.videoWidth, h: v.videoHeight }); } };
        v.onseeked = function () {
          try {
            var w = v.videoWidth, h = v.videoHeight, sc = 720 / Math.max(w, h);
            var c = document.createElement('canvas'); c.width = Math.round(w * sc); c.height = Math.round(h * sc);
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            c.toBlob(function (b) { finish({ dur: v.duration, w: w, h: h, poster: b }); }, 'image/jpeg', 0.8);
          } catch (e) { finish({ dur: v.duration, w: v.videoWidth, h: v.videoHeight }); }
        };
        v.onerror = function () { finish(null); };
        setTimeout(function () { finish(v.duration ? { dur: v.duration, w: v.videoWidth, h: v.videoHeight } : null); }, 9000);
      });
    }
    function safeName(n) { return (n || 'file').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(-60); }

    async function upload(files) {
      if (!files.length) return;
      var target = uploadTarget();
      var prog = root.querySelector('#fev-prog');
      var lines = files.map(function (f, i) { return '<div id="fev-p' + i + '">\u2022 ' + esc(f.name) + ' \u2026 waiting</div>'; });
      prog.innerHTML = lines.join('');
      var ok = 0;
      for (var i = 0; i < files.length; i++) {
        var f = files[i], line = root.querySelector('#fev-p' + i);
        var isVid = /^video\//.test(f.type) || /\.(mov|mp4|m4v|webm)$/i.test(f.name);
        try {
          line.textContent = '\u2022 ' + f.name + ' \u2026 uploading';
          var base = safeName(personName || 'family') + '/' + target.id + '/' + Date.now() + '-' + safeName(f.name);
          var up = await sb.storage.from(BUCKET).upload(base, f, { contentType: f.type || guessType(f.name), upsert: false });
          if (up.error) throw up.error;
          var url = sb.storage.from(BUCKET).getPublicUrl(base).data.publicUrl;
          var meta = isVid ? await probeVideo(f) : await probeImage(f);
          var poster = isVid ? null : url;
          if (isVid && meta && meta.poster) {
            var pp = base.replace(/\.[a-z0-9]+$/, '') + '-poster.jpg';
            var pu = await sb.storage.from(BUCKET).upload(pp, meta.poster, { contentType: 'image/jpeg' });
            if (!pu.error) poster = sb.storage.from(BUCKET).getPublicUrl(pp).data.publicUrl;
          }
          var row = {
            title: f.name, content_type: isVid ? 'raw_video' : 'raw_photo', event_id: target.id, primary_person_id: personId,
            storage_path: BUCKET + '/' + base, source_provider: 'upload', source_ref: f.name, source_view_url: url, poster_url: poster,
            file_size_bytes: f.size, duration_seconds: isVid && meta && meta.dur ? Math.round(meta.dur * 10) / 10 : null,
            orientation: meta && meta.w ? (meta.h > meta.w ? 'portrait' : 'landscape') : null,
            captured_at: f.lastModified ? new Date(f.lastModified).toISOString() : null,
            visibility: 'household', lifecycle_status: 'captured', reveal_trigger: 'immediate', inspection_status: 'pending'
          };
          var ins = await sb.from('content_items').insert(row).select('id').single();
          if (ins.error) throw ins.error;
          await sb.from('content_people').insert({ content_item_id: ins.data.id, person_id: personId });
          line.textContent = '\u2713 ' + f.name;
          ok++;
        } catch (e) {
          line.textContent = '\u2717 ' + f.name + ' \u2014 ' + (e && e.message ? e.message : 'upload failed') + (f.size > 50e6 ? ' (file is ' + Math.round(f.size / 1e6) + ' MB; the upload limit is 50 MB)' : '');
        }
      }
      say(ok + ' of ' + files.length + ' added to ' + target.title + '.', ok === files.length);
      await loadItems();
    }

    /* ── Viewer: see it, move it to another day, or hide it ── */
    function openItem(id) {
      var it = st.items.find(function (x) { return x.id === id; });
      if (!it) return;
      var k = kindOf(it), th = thumbOf(it), src = it.source_view_url;
      var playable = src && /\.(mp4|m4v|mov|webm)(\?|$)/i.test(src);
      var body;
      if (k === 'photo' && (src || th)) body = '<img src="' + esc(src || th) + '" alt="">';
      else if (playable) body = '<video src="' + esc(src) + '"' + (th ? ' poster="' + esc(th) + '"' : '') + ' controls playsinline autoplay></video>';
      else if (th) body = '<div style="display:flex;flex-direction:column;align-items:center;gap:10px;max-height:100%"><img src="' + esc(th) + '" alt="" style="max-height:70vh"><div class="none">Preview only. The full video isn\'t uploaded yet.</div></div>';
      else body = '<div class="none">No preview yet.</div>';
      var opts = [{ id: st.rootId, title: 'Not sorted' }].concat(st.days).map(function (d) {
        return '<option value="' + d.id + '"' + (d.id === it.event_id ? ' selected' : '') + '>' + esc(d.title) + (d.event_date ? ' \u00b7 ' + esc(fmtDate(d.event_date)) : '') + '</option>';
      }).join('');
      var when = it.captured_at ? new Date(it.captured_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      var m = document.createElement('div');
      m.className = 'fev-modal';
      m.innerHTML = '<div class="mv">' + body + '</div><div class="mb">' +
        '<div class="mt">' + esc(it.title || TYPE_LABEL[it.content_type] || 'Item') + '</div>' +
        '<div class="ms">' + esc(TYPE_LABEL[it.content_type] || '') + (when ? ' \u00b7 ' + esc(when) : '') + (it.duration_seconds ? ' \u00b7 ' + fmtDur(it.duration_seconds) : '') + '</div>' +
        (it.people_notes ? '<div class="ms">\u26a0 ' + esc(it.people_notes) + '</div>' : '') +
        '<div class="mr"><select id="fev-move">' + opts + '</select><button class="small" id="fev-move-btn">Move</button></div>' +
        '<div class="mr">' + (k === 'reel' ? '' : '<button class="small" id="fev-hide" style="flex:1">Hide from event</button>') + '<button id="fev-close" style="flex:1">Close</button></div>' +
        '</div>';
      document.body.appendChild(m);
      function close() { var v = m.querySelector('video'); if (v) try { v.pause(); } catch (e) {} m.remove(); }
      m.querySelector('#fev-close').onclick = close;
      m.querySelector('#fev-move-btn').onclick = async function () {
        var to = m.querySelector('#fev-move').value;
        if (to === it.event_id) { close(); return; }
        var r = await sb.from('content_items').update({ event_id: to }).eq('id', it.id);
        if (r.error) { say('Could not move it: ' + r.error.message, false); return; }
        say('Moved.'); close(); loadItems();
      };
      var hide = m.querySelector('#fev-hide');
      if (hide) hide.onclick = async function () {
        var r = await sb.from('content_items').update({ lifecycle_status: 'hidden' }).eq('id', it.id);
        if (r.error) { say('Could not hide it: ' + r.error.message, false); return; }
        say('Hidden from the event.'); close(); loadItems();
      };
    }

    load();
    return { reload: load };
  }

  window.FOSEvents = { mount: mount };
})();
