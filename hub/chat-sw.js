/* Family Chat service worker - network-first, minimal. Makes the chat installable. */
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k!=='family-chat-v3';}).map(function(k){return caches.delete(k);}));})])); });
self.addEventListener('fetch', function(e){
  e.respondWith(fetch(e.request).catch(function(){
    if (e.request.mode === 'navigate') return caches.match('/hub/chat.html');
    return Response.error();
  }));
});
self.addEventListener('install', function(e){
  e.waitUntil(caches.open('family-chat-v3').then(function(c){ return c.addAll(['/hub/chat.html']).catch(function(){}); }));
});
