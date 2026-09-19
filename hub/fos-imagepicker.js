/* ══════════════════════════════════════════════════════════════
   FOS Image Picker — reusable across all Control pages.
   Usage:
     FOSImagePicker.attach(inputElement, sbClient)
   Turns a text/url <input> into: a preview + [Upload] + [Library] buttons.
   The input's .value still holds the chosen URL, so existing save code
   keeps working unchanged.
   ══════════════════════════════════════════════════════════════ */
(function(global){
  'use strict';

  // Curated library sources: existing public buckets + known asset folders.
  // Each returns {name, url} items. Library is grouped by these.
  const LIBRARY_SOURCES = [
    { label: 'Uploaded assets', bucket: 'os-assets' },
    { label: 'Card art',        prefix: 'https://olatoyefamily.com/hub/assets/cards/', bucket: null,
      known: ['card-academy.png','card-elsie.png','card-emma.png','card-adventures.png',
              'card-family-time.png','card-watch-B.png','card-coming-up-A.png'] },
    { label: 'Heroes',          prefix: 'https://olatoyefamily.com/hub/assets/heroes/', bucket: null,
      known: ['hero-morning-academy.png','hero-evening-family-B.png','hero-academy.png'] },
    { label: "Emma's photos",   bucket: 'emma-photos' },
    { label: "Elsie's photos",  bucket: 'elsie-photos' },
    { label: "Elsie's artwork", bucket: 'elsie-artwork' },
  ];

  function el(tag, css, html){ var e=document.createElement(tag); if(css)e.style.cssText=css; if(html!=null)e.innerHTML=html; return e; }

  function attach(input, sb){
    if(!input || input._fosPicker) return;
    input._fosPicker = true;
    input.style.display='none'; // hide the raw URL box; we drive it

    var wrap = el('div','margin-bottom:9px;');
    var preview = el('div','display:flex;align-items:center;gap:10px;margin-bottom:6px;');
    var thumb = el('img','width:80px;height:50px;object-fit:cover;border-radius:8px;background:#222;flex:0 0 auto;');
    thumb.onerror=function(){ thumb.style.opacity='0.3'; };
    function refresh(){ thumb.src = input.value || ''; }
    refresh();
    var btns = el('div','display:flex;gap:8px;flex:1;');
    var upBtn = el('button','flex:1;padding:9px;font-size:13px;font-weight:700;border:none;border-radius:8px;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;', 'Upload');
    var libBtn = el('button','flex:1;padding:9px;font-size:13px;font-weight:700;border:none;border-radius:8px;background:rgba(255,255,255,0.15);color:#fff;cursor:pointer;', 'Library');
    upBtn.type='button'; libBtn.type='button';
    btns.appendChild(upBtn); btns.appendChild(libBtn);
    preview.appendChild(thumb); preview.appendChild(btns);
    wrap.appendChild(preview);

    var status = el('div','font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:4px;');
    wrap.appendChild(status);

    var libPanel = el('div','display:none;max-height:40vh;overflow-y:auto;background:rgba(0,0,0,0.4);border-radius:10px;padding:8px;margin-top:6px;');
    wrap.appendChild(libPanel);

    input.parentNode.insertBefore(wrap, input.nextSibling);

    // Hidden file input
    var file = el('input'); file.type='file'; file.accept='image/*'; file.style.display='none';
    wrap.appendChild(file);
    upBtn.onclick=function(){ file.click(); };
    file.onchange=async function(){
      var f=file.files[0]; if(!f) return;
      status.textContent='Uploading...';
      try{
        var name=Date.now()+'-'+f.name.replace(/[^a-zA-Z0-9.]/g,'_');
        var up=await sb.storage.from('os-assets').upload(name, f, {upsert:false});
        if(up.error){ status.textContent='Upload failed: '+up.error.message; return; }
        var pub=sb.storage.from('os-assets').getPublicUrl(name);
        input.value=pub.data.publicUrl;
        refresh(); status.textContent='Uploaded ✓';
        input.dispatchEvent(new Event('change'));
      }catch(e){ status.textContent='Upload error: '+e.message; }
    };

    // Library
    var libLoaded=false;
    libBtn.onclick=async function(){
      if(libPanel.style.display==='block'){ libPanel.style.display='none'; return; }
      libPanel.style.display='block';
      if(libLoaded) return;
      libLoaded=true;
      libPanel.innerHTML='<div style="color:rgba(255,255,255,0.5);font-size:12px;padding:8px;">Loading library...</div>';
      var html='';
      for(const src of LIBRARY_SOURCES){
        var items=[];
        if(src.bucket){
          try{
            var res=await sb.storage.from(src.bucket).list('',{limit:100,sortBy:{column:'created_at',order:'desc'}});
            if(!res.error && res.data){
              items=res.data.filter(function(o){return o.name && /\.(png|jpg|jpeg|webp|gif)$/i.test(o.name);})
                .map(function(o){ return sb.storage.from(src.bucket).getPublicUrl(o.name).data.publicUrl; });
            }
          }catch(e){}
        } else if(src.known){
          items=src.known.map(function(n){ return src.prefix+n; });
        }
        if(items.length){
          html+='<div style="color:#C9A84C;font-size:11px;text-transform:uppercase;letter-spacing:0.08em;margin:8px 4px 6px;">'+src.label+'</div>';
          html+='<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;">';
          items.forEach(function(u){
            html+='<img src="'+u+'" data-u="'+u+'" style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:6px;cursor:pointer;border:2px solid transparent;">';
          });
          html+='</div>';
        }
      }
      libPanel.innerHTML=html||'<div style="color:rgba(255,255,255,0.5);font-size:12px;padding:8px;">No images yet. Upload one above.</div>';
      libPanel.querySelectorAll('img[data-u]').forEach(function(im){
        im.onclick=function(){
          input.value=im.getAttribute('data-u');
          refresh(); status.textContent='Selected ✓';
          libPanel.style.display='none';
          input.dispatchEvent(new Event('change'));
        };
      });
    };

    // keep preview synced if code sets input.value
    input.addEventListener('fos-refresh', refresh);
  }

  // Attach to all inputs matching a selector within a container
  function attachAll(container, sb, selector){
    (container||document).querySelectorAll(selector||'input[type=url],input.fos-image').forEach(function(inp){
      attach(inp, sb);
    });
  }

  global.FOSImagePicker = { attach: attach, attachAll: attachAll };
})(window);
