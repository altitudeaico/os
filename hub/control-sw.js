/* Family OS Control service worker.
   Deliberately minimal: network-first for everything, no asset precaching.
   This exists ONLY to make Central Control installable as a PWA. It must never
   serve stale content - the TV hub relies on always-fresh network loads. */
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e){
  // Pass through to network. Only if the network fails entirely on a control
  // navigation do we fall back to a cached copy of the control shell.
  e.respondWith(
    fetch(e.request).catch(function(){
      // Offline fallback only for control pages
      if (e.request.mode === 'navigate') return caches.match('/hub/control.html');
      return Response.error();
    })
  );
});
/* Cache only the control shell for offline open, nothing else. */
self.addEventListener('install', function(e){
  e.waitUntil(caches.open('os-control-v1').then(function(c){
    return c.addAll(['/hub/control.html']).catch(function(){});
  }));
});
