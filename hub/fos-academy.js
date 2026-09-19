/* ══════════════════════════════════════════════════════════════
   OLATOYE ACADEMY — TV World. Built on FOSFocus + FOSNav, same
   grammar as Emma/Elsie. Four areas: Today, Learning, Progress,
   Our Academy. Our Academy + Progress use real Supabase data.
   Native-text hero items (quote / creed / pillar). No image
   conversion, does not touch Elsie's Featured system.
   ══════════════════════════════════════════════════════════════ */

const ACAD_API = 'https://fypwabbhxnnwcpfjwrda.supabase.co/rest/v1';
const ACAD_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ5cHdhYmJoeG5ud2NwZmp3cmRhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1NDg3ODUsImV4cCI6MjEwNDEyNDc4NX0.BwzgTd8_-lxENXnTu9ukxnHsgh3diguZbJPnzzC7XD4';
const ACAD_GOLD = '#C9A84C';

var acadState = {
  pillars: [], quotes: [], creed: [], children: [],
  focus: null, nav: null, sparkTimer: null,
  quoteTimer: null, quoteIdx: 0,
};

async function acadFetch(path){
  var hdr = { apikey: ACAD_KEY, Authorization: 'Bearer ' + ACAD_KEY };
  try { var r = await fetch(ACAD_API + path, { headers: hdr, cache:'no-store' });
    if (!r.ok) return []; var j = await r.json(); return Array.isArray(j) ? j : []; }
  catch(e){ return []; }
}

async function openAcademyWorld(opts){
  var el = document.getElementById('view-academy');
  if(!el){ el=document.createElement('div'); el.id='view-academy'; document.body.appendChild(el); }
  el.style.cssText='position:fixed;inset:0;z-index:500;background:#0a0a0f;overflow:hidden;';
  el.style.display='block';
  _inDestination=true;

  // Load real data
  var res = await Promise.all([
    acadFetch('/academy_pillars?select=number,name,icon,purpose,elsie_current,elsie_target,emma_current,emma_target&order=number'),
    acadFetch('/academy_quotes?select=text,author,pillar&active=eq.true'),
    acadFetch('/inspiration_creed?select=line,sort_order&order=sort_order'),
    acadFetch('/academy_children?select=name,year_group,key_stage,age_approx,colour&order=age_approx.desc'),
    acadFetch('/academy_config?select=background_url,logo_url&id=eq.1'),
  ]);
  acadState.pillars=res[0]; acadState.quotes=res[1]; acadState.creed=res[2]; acadState.children=res[3];
  acadState.config=(res[4] && res[4][0]) ? res[4][0] : {};

  acadInjectStyles();
  acadState.nav = new FOSNav();
  acadState.nav.onEmpty = function(){ acadExit(); };
  acadState.nav.push('acad-home', null, null, null);
  renderAcademyHome(el);
}

function acadExit(){
  acadCleanup();
  var el=document.getElementById('view-academy'); if(el) el.style.display='none';
  _inDestination=false;
  if(typeof onEmmaExit==='function'){} // no-op; use generic return
  if(typeof onAcademyExit==='function') onAcademyExit();
}
function acadCleanup(){
  if(acadState.quoteTimer){clearInterval(acadState.quoteTimer);acadState.quoteTimer=null;}
  if(acadState.sparkTimer){clearInterval(acadState.sparkTimer);acadState.sparkTimer=null;}
}

/* ══ HOME of Academy: hero feed + four area tiles ══ */
function renderAcademyHome(el){
  var areas = [
    {id:'today',    label:'Today',       desc:"What we're doing today",        ready:false},
    {id:'learning', label:'Learning',    desc:"What we're learning",           ready:false},
    {id:'progress', label:'Progress',    desc:'How we are developing',         ready:true},
    {id:'our',      label:'Our Academy', desc:'Who we are and what we value',  ready:true},
  ];
  var tiles = areas.map(function(a){
    return '<div class="acad-tile'+(a.ready?'':' soon')+'" data-area="'+a.id+'" tabindex="-1">'+
      '<div class="acad-tile-label">'+a.label+'</div>'+
      '<div class="acad-tile-desc">'+a.desc+'</div>'+
      (a.ready?'':'<div class="acad-soon">Coming soon</div>')+
    '</div>';
  }).join('');

  var bgUrl = acadState.config.background_url || '';
  var logoUrl = acadState.config.logo_url || 'https://olatoyefamily.com/logo.jpg';
  el.innerHTML =
    '<div class="acad-bg" style="'+(bgUrl?'background-image:url('+bgUrl+');':'')+'"></div>'+
    '<div class="acad-bg-scrim"></div>'+
    '<div class="acad-sparkles" id="acad-sparkles"></div>'+
    '<div class="acad-head">'+
      '<img class="acad-logo" src="'+logoUrl+'" alt="Olatoye Academy" onerror="this.style.display=\'none\'">'+
    '</div>'+
    '<div class="acad-hero" id="acad-hero"></div>'+
    '<div class="acad-tiles">'+tiles+'</div>'+
    '<div class="acad-hint" id="acad-hint">◀ ▶ choose area · OK open · Back home</div>';

  acadStartSparkles();
  acadStartHeroFeed();

  // Focus the four tiles
  acadState.focus = new FOSFocus();
  var fm = acadState.focus; fm.reset();
  el.querySelectorAll('.acad-tile').forEach(function(t){
    var area=t.getAttribute('data-area');
    fm.register('area-'+area, t, function(){ openAcademyArea(area); });
  });
  fm.focus('area-our');
}

/* ══ HERO FEED: small controlled selection of real Academy content,
   rendered as NATIVE TEXT (quote / creed / pillar). Not all nine pillars,
   not images. ══ */
function acadStartHeroFeed(){
  var feed = [];
  // 1 pillar (first), 1 quote, 1 creed line — a controlled demonstration set
  if(acadState.pillars[0]) feed.push({type:'pillar', data:acadState.pillars[0]});
  if(acadState.quotes.length) feed.push({type:'quote', data:acadState.quotes[Math.floor(Math.random()*acadState.quotes.length)]});
  if(acadState.creed.length) feed.push({type:'creed', data:acadState.creed[0]});
  if(!feed.length) return;
  acadState.quoteIdx=0;
  function paint(){
    var it=feed[acadState.quoteIdx % feed.length];
    var h=document.getElementById('acad-hero'); if(!h) return;
    var html='';
    if(it.type==='quote'){
      html='<div class="acad-hero-eyebrow">'+(it.data.pillar||'Academy')+'</div>'+
           '<div class="acad-hero-quote">“'+it.data.text+'”</div>'+
           (it.data.author?'<div class="acad-hero-by">'+it.data.author+'</div>':'');
    } else if(it.type==='creed'){
      html='<div class="acad-hero-eyebrow">Our Creed</div>'+
           '<div class="acad-hero-quote">'+it.data.line+'</div>';
    } else if(it.type==='pillar'){
      html='<div class="acad-hero-eyebrow">Pillar '+it.data.number+'</div>'+
           '<div class="acad-hero-pillar">'+it.data.name+'</div>'+
           '<div class="acad-hero-by">'+(it.data.purpose||'')+'</div>';
    }
    h.style.opacity='0';
    setTimeout(function(){ h.innerHTML=html; h.style.opacity='1'; },300);
  }
  paint();
  acadState.quoteTimer=setInterval(function(){ acadState.quoteIdx++; paint(); }, 9000);
}

/* ══ AREA ROUTING ══ */
function openAcademyArea(area){
  if(area==='our') return openOurAcademy();
  if(area==='progress') return openProgress();
  // today / learning: shell
  openAcadShell(area==='today'?'Today':'Learning',
    area==='today'?"What we're doing today":"What we're learning",
    "This part of the Academy is coming soon. The daily schedule and learning plans will live here.");
}

function openAcadShell(title, sub, body){
  var el=document.getElementById('view-academy');
  var ov=acadOverlay();
  ov.innerHTML='<div class="acad-ov-inner">'+
    '<div class="acad-ov-head">'+title+'</div>'+
    '<div class="acad-ov-sub">'+sub+'</div>'+
    '<div class="acad-ov-body">'+body+'</div>'+
    '<div class="acad-ov-foot">Back  Return</div></div>';
  ov.style.display='block';
  acadState.nav.push('acad-shell','area-'+title.toLowerCase(), null, function(){ ov.style.display='none'; });
  acadState.focus.reset(); // nothing focusable; Back returns
}

/* ══ OUR ACADEMY: pillars centerpiece + creed + quotes ══ */
function openOurAcademy(){
  var ov=acadOverlay();
  var pills = acadState.pillars.map(function(p){
    return '<div class="acad-pill" data-n="'+p.number+'" tabindex="-1">'+
      '<div class="acad-pill-num">'+p.number+'</div>'+
      '<div class="acad-pill-name">'+p.name+'</div></div>';
  }).join('');
  ov.innerHTML='<div class="acad-ov-inner">'+
    '<div class="acad-ov-head">Our Academy</div>'+
    '<div class="acad-ov-sub">Christ at the Centre · Excellence in All</div>'+
    '<div class="acad-section-label">The Nine Pillars</div>'+
    '<div class="acad-pills">'+pills+'</div>'+
    '<div class="acad-ourrow">'+
      '<div class="acad-chip" id="acad-chip-creed" tabindex="-1">The Creed</div>'+
      '<div class="acad-chip" id="acad-chip-quotes" tabindex="-1">Quotes</div>'+
    '</div>'+
    '<div class="acad-ov-foot">▲▼◀▶ move · OK open · Back return</div></div>';
  ov.style.display='block';
  acadState.nav.push('acad-our','area-our', null, function(){ ov.style.display='none'; });

  var fm=acadState.focus; fm.reset();
  ov.querySelectorAll('.acad-pill').forEach(function(t){
    var n=parseInt(t.getAttribute('data-n'),10);
    fm.register('pill-'+n, t, function(){ openPillar(n); });
  });
  fm.register('chip-creed', document.getElementById('acad-chip-creed'), function(){ openCreed(); });
  fm.register('chip-quotes', document.getElementById('acad-chip-quotes'), function(){ openQuotes(); });
  fm.focus('pill-1');
}

function openPillar(n){
  var p=acadState.pillars.find(function(x){return x.number===n;}); if(!p) return;
  var ov=acadOverlay2();
  ov.innerHTML='<div class="acad-ov-inner">'+
    '<div class="acad-ov-eyebrow">Pillar '+p.number+'</div>'+
    '<div class="acad-ov-head">'+p.name+'</div>'+
    '<div class="acad-ov-purpose">'+(p.purpose||'')+'</div>'+
    '<div class="acad-two">'+
      '<div class="acad-col acad-col-elsie"><div class="acad-col-name">Elsie</div>'+
        '<div class="acad-col-l">Now</div><div class="acad-col-v">'+(p.elsie_current||'—')+'</div>'+
        '<div class="acad-col-l">Working towards</div><div class="acad-col-v">'+(p.elsie_target||'—')+'</div></div>'+
      '<div class="acad-col acad-col-emma"><div class="acad-col-name">Emma</div>'+
        '<div class="acad-col-l">Now</div><div class="acad-col-v">'+(p.emma_current||'—')+'</div>'+
        '<div class="acad-col-l">Working towards</div><div class="acad-col-v">'+(p.emma_target||'—')+'</div></div>'+
    '</div>'+
    '<div class="acad-ov-foot">Back  Return to pillars</div></div>';
  ov.style.display='block';
  acadState.nav.push('acad-pillar','pill-'+n, null, function(){ ov.style.display='none'; });
  acadState.focus.reset();
}

function openCreed(){
  var ov=acadOverlay2();
  var lines=acadState.creed.map(function(c){ return '<div class="acad-creed-line">'+c.line+'</div>'; }).join('');
  ov.innerHTML='<div class="acad-ov-inner acad-scroll">'+
    '<div class="acad-ov-head">Our Academy Creed</div>'+
    '<div class="acad-creed">'+lines+'</div>'+
    '<div class="acad-ov-foot">Back  Return</div></div>';
  ov.style.display='block';
  acadState.nav.push('acad-creed','chip-creed', null, function(){ ov.style.display='none'; });
  acadState.focus.reset();
}

function openQuotes(){
  var ov=acadOverlay2();
  // Show quotes as a focusable scrolling list
  var rows=acadState.quotes.map(function(q,i){
    return '<div class="acad-quote-row" tabindex="-1" data-i="'+i+'">'+
      '<div class="acad-quote-t">“'+q.text+'”</div>'+
      '<div class="acad-quote-m">'+(q.author?q.author:'')+(q.pillar?' · '+q.pillar:'')+'</div></div>';
  }).join('');
  ov.innerHTML='<div class="acad-ov-inner acad-scroll">'+
    '<div class="acad-ov-head">Quotes</div>'+
    '<div class="acad-ov-sub">'+acadState.quotes.length+' from across the pillars</div>'+
    '<div class="acad-quotes" id="acad-quotes">'+rows+'</div>'+
    '<div class="acad-ov-foot">▲▼ browse · Back return</div></div>';
  ov.style.display='block';
  acadState.nav.push('acad-quotes','chip-quotes', null, function(){ ov.style.display='none'; });
  var fm=acadState.focus; fm.reset();
  ov.querySelectorAll('.acad-quote-row').forEach(function(t){
    fm.register('q-'+t.getAttribute('data-i'), t, null);
  });
  if(acadState.quotes.length) fm.focus('q-0');
}

/* ══ PROGRESS: per child, their pillars now → target ══ */
function openProgress(){
  var ov=acadOverlay();
  var kids=acadState.children.map(function(c){
    return '<div class="acad-kid" data-name="'+c.name+'" tabindex="-1" style="--kid:'+(c.colour||ACAD_GOLD)+';">'+
      '<div class="acad-kid-name">'+c.name+'</div>'+
      '<div class="acad-kid-yr">'+(c.year_group||'')+'</div></div>';
  }).join('');
  ov.innerHTML='<div class="acad-ov-inner">'+
    '<div class="acad-ov-head">Progress</div>'+
    '<div class="acad-ov-sub">How we are developing across the nine pillars</div>'+
    '<div class="acad-kids">'+kids+'</div>'+
    '<div class="acad-ov-foot">OK open · Back return</div></div>';
  ov.style.display='block';
  acadState.nav.push('acad-progress','area-progress', null, function(){ ov.style.display='none'; });
  var fm=acadState.focus; fm.reset();
  ov.querySelectorAll('.acad-kid').forEach(function(t){
    var nm=t.getAttribute('data-name');
    fm.register('kid-'+nm, t, function(){ openChildProgress(nm); });
  });
  if(acadState.children.length) fm.focus('kid-'+acadState.children[0].name);
}

function openChildProgress(name){
  var ov=acadOverlay2();
  var key = name.toLowerCase();
  var rows=acadState.pillars.map(function(p){
    var cur = p[key+'_current']||'—';
    var tgt = p[key+'_target']||'—';
    return '<div class="acad-prog-row" tabindex="-1">'+
      '<div class="acad-prog-pill">'+p.number+'. '+p.name+'</div>'+
      '<div class="acad-prog-now"><span>Now</span> '+cur+'</div>'+
      '<div class="acad-prog-tgt"><span>Working towards</span> '+tgt+'</div></div>';
  }).join('');
  ov.innerHTML='<div class="acad-ov-inner acad-scroll">'+
    '<div class="acad-ov-head">'+name+'</div>'+
    '<div class="acad-ov-sub">Her journey across the nine pillars</div>'+
    '<div class="acad-prog">'+rows+'</div>'+
    '<div class="acad-ov-foot">▲▼ browse · Back return</div></div>';
  ov.style.display='block';
  acadState.nav.push('acad-child','kid-'+name, null, function(){ ov.style.display='none'; });
  var fm=acadState.focus; fm.reset();
  ov.querySelectorAll('.acad-prog-row').forEach(function(t,i){ fm.register('pr-'+i, t, null); });
  fm.focus('pr-0');
}

/* ══ Overlays: two layers so pillar/child detail sits over the area list ══ */
function acadOverlay(){
  var el=document.getElementById('view-academy');
  var o=document.getElementById('acad-ov'); if(!o){o=document.createElement('div');o.id='acad-ov';o.className='acad-overlay';el.appendChild(o);} return o;
}
function acadOverlay2(){
  var el=document.getElementById('view-academy');
  var o=document.getElementById('acad-ov2'); if(!o){o=document.createElement('div');o.id='acad-ov2';o.className='acad-overlay acad-overlay2';el.appendChild(o);} return o;
}

/* ══ Sparkles (subtle, gold) ══ */
function acadStartSparkles(){
  var host=document.getElementById('acad-sparkles'); if(!host) return; host.innerHTML='';
  for(var i=0;i<20;i++){
    var s=document.createElement('div'); s.className='acad-spark';
    var sz=2+Math.random()*3;
    s.style.left=(Math.random()*100)+'%'; s.style.top=(Math.random()*100)+'%';
    s.style.width=sz+'px'; s.style.height=sz+'px';
    s.style.animationDelay=(Math.random()*4)+'s';
    s.style.animationDuration=(3+Math.random()*3)+'s';
    host.appendChild(s);
  }
}

/* ══ Key handling ══ */
function acadHandleKey(key, code){
  if(!acadState.focus || !acadState.nav) return false;
  var isBack = code===4||code===27||key==='Escape'||key==='GoBack';
  if(isBack){
    var view=acadState.nav.currentView();
    if(view==='acad-home'){ acadState.nav.back(); return true; } // -> onEmpty -> exit
    var restored=acadState.nav.back();
    // Re-bind focus for the view we returned to
    if(restored){ acadRebind(restored.view, restored.focusId); }
    return true;
  }
  return acadState.focus.handleKey(key, code);
}
function acadRebind(view, focusId){
  // Rebuild focus targets for the view we returned to, and restore focus.
  var el=document.getElementById('view-academy');
  if(view==='acad-home'){
    var fm=acadState.focus; fm.reset();
    el.querySelectorAll('.acad-tile').forEach(function(t){
      var area=t.getAttribute('data-area');
      fm.register('area-'+area, t, function(){ openAcademyArea(area); });
    });
    fm.focus(focusId||'area-our');
  } else if(view==='acad-our'){
    var fm2=acadState.focus; fm2.reset();
    var ov=document.getElementById('acad-ov');
    ov.querySelectorAll('.acad-pill').forEach(function(t){ var n=parseInt(t.getAttribute('data-n'),10); fm2.register('pill-'+n, t, function(){ openPillar(n); }); });
    var cc=document.getElementById('acad-chip-creed'), cq=document.getElementById('acad-chip-quotes');
    if(cc) fm2.register('chip-creed', cc, function(){ openCreed(); });
    if(cq) fm2.register('chip-quotes', cq, function(){ openQuotes(); });
    fm2.focus(focusId||'pill-1');
  } else if(view==='acad-progress'){
    var fm3=acadState.focus; fm3.reset();
    var ovp=document.getElementById('acad-ov');
    ovp.querySelectorAll('.acad-kid').forEach(function(t){ var nm=t.getAttribute('data-name'); fm3.register('kid-'+nm, t, function(){ openChildProgress(nm); }); });
    fm3.focus(focusId||'kid-'+(acadState.children[0]&&acadState.children[0].name));
  }
}

function acadInjectStyles(){
  if(document.getElementById('acad-styles')) return;
  var s=document.createElement('style'); s.id='acad-styles';
  s.textContent=
   '.acad-bg{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 0%,#151528 0%,#0a0a0f 60%,#050507 100%);background-size:cover;background-position:center;}.acad-bg-scrim{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(8,8,14,0.55) 0%,rgba(8,8,14,0.35) 40%,rgba(8,8,14,0.8) 100%);}.acad-logo{height:clamp(96px,13vh,180px);width:clamp(96px,13vh,180px);object-fit:cover;border-radius:50%;border:3px solid rgba(201,168,76,0.55);background:rgba(0,0,0,0.35);margin-bottom:6px;filter:drop-shadow(0 6px 26px rgba(0,0,0,0.7));}'+
   '.acad-sparkles{position:absolute;inset:0;pointer-events:none;overflow:hidden;}'+
   '.acad-spark{position:absolute;border-radius:50%;background:radial-gradient(circle,rgba(201,168,76,0.9),transparent 70%);opacity:0;animation:acadTw 4s ease-in-out infinite;}'+
   '@keyframes acadTw{0%,100%{opacity:0;transform:scale(0.6);}50%{opacity:0.8;transform:scale(1);}}'+
   '.acad-head{position:absolute;top:6vh;left:0;right:0;text-align:center;z-index:3;}'+
   '.acad-crest{color:'+ACAD_GOLD+';font-size:clamp(22px,2.4vw,40px);margin-bottom:6px;}'+
   '.acad-title{color:#fff;font-size:clamp(26px,3vw,52px);font-weight:800;letter-spacing:-0.01em;}'+
   '.acad-motto{color:'+ACAD_GOLD+';font-size:clamp(11px,0.9vw,16px);letter-spacing:0.18em;text-transform:uppercase;margin-top:8px;}'+
   '.acad-motto-yo{color:rgba(255,255,255,0.5);font-size:clamp(10px,0.75vw,13px);letter-spacing:0.16em;text-transform:uppercase;margin-top:4px;font-style:italic;}'+
   '.acad-hero{position:absolute;top:27vh;left:4vw;right:4vw;text-align:center;z-index:3;transition:opacity 0.5s ease;min-height:34vh;display:flex;flex-direction:column;justify-content:center;}'+
   'X;font-size:clamp(11px,0.9vw,15px);letter-spacing:0.16em;text-transform:uppercase;margin-bottom:0.6em;}'+
   '.acad-hero-quote{color:#fff;font-size:clamp(40px,5.2vw,92px);font-weight:400;line-height:1.2;font-family:Georgia,serif;max-width:94%;margin:0 auto;text-shadow:0 2px 24px rgba(0,0,0,0.85);}'+
   '.acad-hero-pillar{color:#fff;font-size:clamp(42px,5.4vw,96px);font-weight:700;text-shadow:0 2px 24px rgba(0,0,0,0.85);}'+
   '.acad-hero-by{color:rgba(255,255,255,0.8);font-size:clamp(18px,1.7vw,32px);margin-top:1em;text-shadow:0 2px 14px rgba(0,0,0,0.85);}'+
   '.acad-tiles{position:absolute;bottom:6vh;left:0;right:0;display:flex;justify-content:center;gap:clamp(10px,1.4vw,20px);z-index:4;padding:0 4vw;}'+
   '.acad-tile{flex:0 0 auto;width:clamp(150px,17vw,240px);background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:14px;padding:clamp(12px,1.3vw,20px);transition:all 0.18s;}'+
   '.acad-tile.fos-focused{border-color:'+ACAD_GOLD+';background:rgba(201,168,76,0.14);transform:scale(1.05);box-shadow:0 0 26px rgba(201,168,76,0.3);}'+
   '.acad-tile-label{color:#fff;font-size:clamp(15px,1.2vw,22px);font-weight:700;}'+
   '.acad-tile-desc{color:rgba(255,255,255,0.55);font-size:clamp(11px,0.8vw,14px);margin-top:4px;}'+
   '.acad-tile.soon{opacity:0.55;}'+
   '.acad-soon{color:'+ACAD_GOLD+';font-size:clamp(9px,0.65vw,11px);text-transform:uppercase;letter-spacing:0.1em;margin-top:6px;}'+
   '.acad-hint{position:absolute;bottom:2vh;left:0;right:0;text-align:center;color:rgba(255,255,255,0.4);font-size:clamp(10px,0.7vw,13px);z-index:4;}'+
   /* overlays */
   '.acad-overlay{position:absolute;inset:0;z-index:20;background:rgba(8,8,14,0.9);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);}'+
   '.acad-overlay2{z-index:30;background:rgba(8,8,14,0.96);}'+
   '.acad-ov-inner{position:absolute;inset:clamp(30px,5vh,64px) clamp(40px,7vw,120px);display:flex;flex-direction:column;}'+
   '.acad-ov-inner.acad-scroll{overflow:hidden;}'+
   '.acad-ov-eyebrow{color:'+ACAD_GOLD+';font-size:clamp(11px,0.9vw,15px);letter-spacing:0.14em;text-transform:uppercase;margin-bottom:0.3em;}'+
   '.acad-ov-head{color:#fff;font-size:clamp(22px,2.6vw,44px);font-weight:800;}'+
   '.acad-ov-sub{color:rgba(255,255,255,0.6);font-size:clamp(12px,1vw,18px);margin-top:0.2em;margin-bottom:clamp(14px,2vh,28px);}'+
   '.acad-ov-purpose{color:rgba(255,255,255,0.85);font-size:clamp(14px,1.2vw,22px);line-height:1.5;margin-bottom:clamp(16px,2.5vh,32px);max-width:90%;}'+
   '.acad-ov-body{color:rgba(255,255,255,0.7);font-size:clamp(14px,1.1vw,20px);line-height:1.5;}'+
   '.acad-ov-foot{color:rgba(255,255,255,0.45);font-size:clamp(10px,0.75vw,13px);margin-top:auto;padding-top:16px;letter-spacing:0.06em;}'+
   '.acad-section-label{color:'+ACAD_GOLD+';font-size:clamp(11px,0.85vw,15px);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:10px;}'+
   /* pillars grid */
   '.acad-pills{display:grid;grid-template-columns:repeat(3,1fr);gap:clamp(8px,1vw,14px);}'+
   '.acad-pill{display:flex;align-items:center;gap:0.7em;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:12px;padding:clamp(10px,1vw,16px);transition:all 0.16s;}'+
   '.acad-pill.fos-focused{border-color:'+ACAD_GOLD+';background:rgba(201,168,76,0.16);transform:scale(1.04);box-shadow:0 0 22px rgba(201,168,76,0.3);}'+
   '.acad-pill-num{color:'+ACAD_GOLD+';font-size:clamp(16px,1.4vw,26px);font-weight:800;flex:0 0 auto;width:1.4em;}'+
   '.acad-pill-name{color:#fff;font-size:clamp(12px,0.95vw,17px);font-weight:600;line-height:1.2;}'+
   '.acad-ourrow{display:flex;gap:12px;margin-top:clamp(14px,2vh,24px);}'+
   '.acad-chip{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);border-radius:24px;padding:0.7em 1.6em;color:#fff;font-size:clamp(13px,1vw,18px);font-weight:600;transition:all 0.16s;}'+
   '.acad-chip.fos-focused{border-color:'+ACAD_GOLD+';background:rgba(201,168,76,0.18);transform:scale(1.05);}'+
   /* pillar detail two columns */
   '.acad-two{display:flex;gap:clamp(14px,2vw,32px);}'+
   '.acad-col{flex:1;background:rgba(255,255,255,0.04);border-radius:14px;padding:clamp(14px,1.4vw,22px);border-top:3px solid var(--c,#888);}'+
   '.acad-col-elsie{--c:#7A4FA0;}.acad-col-emma{--c:#C9A84C;}'+
   '.acad-col-name{color:#fff;font-size:clamp(16px,1.4vw,24px);font-weight:800;margin-bottom:0.8em;}'+
   '.acad-col-l{color:'+ACAD_GOLD+';font-size:clamp(10px,0.75vw,12px);text-transform:uppercase;letter-spacing:0.1em;margin-top:0.8em;}'+
   '.acad-col-v{color:rgba(255,255,255,0.9);font-size:clamp(13px,1.05vw,19px);line-height:1.4;margin-top:0.2em;}'+
   /* creed */
   '.acad-creed{display:flex;flex-direction:column;gap:clamp(8px,1.3vh,16px);overflow:hidden;}'+
   '.acad-creed-line{color:rgba(255,255,255,0.9);font-size:clamp(14px,1.3vw,24px);line-height:1.4;font-family:Georgia,serif;}'+
   /* quotes list */
   '.acad-quotes{display:flex;flex-direction:column;gap:8px;overflow:hidden;flex:1;}'+
   '.acad-quote-row{background:rgba(255,255,255,0.04);border-radius:10px;padding:clamp(10px,1vw,16px);border:2px solid transparent;transition:all 0.14s;}'+
   '.acad-quote-row.fos-focused{border-color:'+ACAD_GOLD+';background:rgba(201,168,76,0.14);}'+
   '.acad-quote-t{color:#fff;font-size:clamp(13px,1vw,18px);font-family:Georgia,serif;}'+
   '.acad-quote-m{color:rgba(255,255,255,0.5);font-size:clamp(11px,0.8vw,14px);margin-top:0.3em;}'+
   /* progress */
   '.acad-kids{display:flex;gap:clamp(14px,2vw,28px);}'+
   '.acad-kid{flex:0 0 auto;width:clamp(160px,20vw,280px);background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-left:5px solid var(--kid,#C9A84C);border-radius:14px;padding:clamp(16px,1.6vw,26px);transition:all 0.16s;}'+
   '.acad-kid.fos-focused{border-color:'+ACAD_GOLD+';background:rgba(201,168,76,0.14);transform:scale(1.04);box-shadow:0 0 22px rgba(201,168,76,0.28);}'+
   '.acad-kid-name{color:#fff;font-size:clamp(20px,1.8vw,32px);font-weight:800;}'+
   '.acad-kid-yr{color:rgba(255,255,255,0.6);font-size:clamp(12px,0.9vw,16px);margin-top:4px;}'+
   '.acad-prog{display:flex;flex-direction:column;gap:8px;overflow:hidden;flex:1;}'+
   '.acad-prog-row{background:rgba(255,255,255,0.04);border-radius:10px;padding:clamp(10px,1vw,16px);border:2px solid transparent;transition:all 0.14s;}'+
   '.acad-prog-row.fos-focused{border-color:'+ACAD_GOLD+';background:rgba(201,168,76,0.12);}'+
   '.acad-prog-pill{color:#fff;font-size:clamp(13px,1vw,18px);font-weight:700;}'+
   '.acad-prog-now{color:rgba(255,255,255,0.85);font-size:clamp(12px,0.9vw,16px);margin-top:0.3em;}'+
   '.acad-prog-tgt{color:rgba(255,255,255,0.7);font-size:clamp(12px,0.9vw,16px);margin-top:0.2em;}'+
   '.acad-prog-now span,.acad-prog-tgt span{color:'+ACAD_GOLD+';font-size:0.8em;text-transform:uppercase;letter-spacing:0.08em;margin-right:0.5em;}';
  document.head.appendChild(s);
}
