// Jarvis service worker: works offline for the app itself; AI calls always go to the network.
const VERSION = '4cf879b686';
const CACHE = 'jarvis-' + VERSION;
const FILES = ["./", "./css/app.css", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg", "./icons/maskable-512.png", "./icons/og.png", "./index.html", "./js/app.js", "./js/chat.js", "./js/commands.js", "./js/connectors.js", "./js/exam-core.js", "./js/exam.js", "./js/github.js", "./js/greeting.js", "./js/intro.js", "./js/markdown.js", "./js/mock.js", "./js/pdftext.js", "./js/presets.js", "./js/preview.js", "./js/providers.js", "./js/settings.js", "./js/store.js", "./js/usage.js", "./js/util.js", "./js/video/aimaker.js", "./js/video/editor.js", "./js/video/engine.js", "./js/video/scenes.js", "./js/video/studio.js", "./js/video/timing.js", "./js/websearch.js", "./lib/hljs.js", "./lib/jszip.min.js", "./lib/marked.js", "./lib/mediabunny.js", "./lib/purify.js", "./manifest.webmanifest"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('jarvis-') && k !== CACHE && k !== 'jarvis-cdn').map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then((r) => { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      const r = await net; if (r) return r;
      if (req.mode === 'navigate') return (await c.match('./index.html')) || (await c.match('./'));
      return new Response('Offline', { status: 503 });
    }));
    return;
  }
  // Cache the few CDN libraries (math, PDF reader) after first use.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open('jarvis-cdn').then(async (c) => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
  }
});
