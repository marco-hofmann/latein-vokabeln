/* Vokabeln pauken — service worker.
   Goal: the installed app opens and drills with no network at all.
   - shell (page, icons, manifest): cache-first from the precache, refreshed in the background
   - decks (data/*.json): stale-while-revalidate, so a corrected word arrives on the next start
   - navigation: network-first, falls back to the cached page when offline
   Bump CACHE_VERSION on deploys that change index.html — the browser only re-fetches the page
   when the cache name changes (or when the network answers first, which it usually does). */
const CACHE_VERSION = "vokabeln-v15";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];
const DECKS = [
  "./data/subjects.json",
  "./data/latin.json",
  "./data/french.json",
  "./data/english.json",
  "./data/grammar-latin.json",
  "./data/grammar-french.json",
  "./data/grammar-english.json"
];

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // one failed asset must not abort the whole install
    await Promise.all([...SHELL, ...DECKS].map(url =>
      cache.add(new Request(url, {cache: "reload"})).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  // the page itself: network first, cache as the offline fallback
  if(req.mode === "navigate"){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try{
        const fresh = await fetch(req);
        cache.put("./index.html", fresh.clone());
        return fresh;
      }catch(e){
        return (await cache.match("./index.html")) || (await cache.match("./")) ||
               new Response("offline", {status: 503, headers: {"Content-Type": "text/plain"}});
      }
    })());
    return;
  }

  // vocabulary decks: serve the cached copy, refresh it for next time
  if(url.pathname.endsWith(".json")){
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req, {ignoreSearch: true});
      const network = fetch(req).then(res => {
        if(res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) ||
             new Response("[]", {status: 503, headers: {"Content-Type": "application/json"}});
    })());
    return;
  }

  // icons, manifest, anything else same-origin: cache first
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req, {ignoreSearch: true});
    if(cached) return cached;
    try{
      const fresh = await fetch(req);
      if(fresh && fresh.ok) cache.put(req, fresh.clone());
      return fresh;
    }catch(e){
      return new Response("offline", {status: 503, headers: {"Content-Type": "text/plain"}});
    }
  })());
});
