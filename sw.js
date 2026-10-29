// Jarvis service worker. Online: always loads the newest files (network first), so updates arrive cleanly
// and files from different versions are never mixed. Offline: falls back to the saved copy. AI calls always go to the network.
const VERSION = '5737b49237';
const CACHE = 'jarvis-' + VERSION;
const FILES = ["./", "./css/app.css", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg", "./icons/maskable-512.png", "./icons/og.png", "./js/app.js", "./js/chat.js", "./js/commands.js", "./js/connectors.js", "./js/exam-core.js", "./js/exam.js", "./js/github.js", "./js/greeting.js", "./js/intro.js", "./js/markdown.js", "./js/mock.js", "./js/pdftext.js", "./js/presets.js", "./js/preview.js", "./js/providers.js", "./js/settings.js", "./js/store.js", "./js/usage.js", "./js/util.js", "./js/video/aimaker.js", "./js/video/editor.js", "./js/video/engine.js", "./js/video/scenes.js", "./js/video/studio.js", "./js/video/timing.js", "./js/websearch.js", "./lib/hljs.js", "./lib/jszip.min.js", "./lib/marked.js", "./lib/mediabunny.js", "./lib/purify.js", "./manifest.webmanifest"];
const NET_TIMEOUT_MS = 6000;
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(FILES.map((f) =>
    fetch(new Request(f, { cache: 'reload' })).then((r) => { if (r.ok && !r.redirected) return c.put(f, r); }).catch(() => {})
  ))).then(() => self.skipWaiting()));
});
// Versions before 30 Oct 2026 served saved files first, so an open page may still run old code: reload those pages once.
const LEGACY = ['jarvis-4b03528d5b', 'jarvis-4cf879b686'];
self.addEventListener('activate', (e) => {
  let fromLegacy = false;
  const done = caches.keys().then(async (ks) => {
    fromLegacy = ks.some((k) => LEGACY.includes(k));
    await Promise.all(ks.filter((k) => k.startsWith('jarvis-') && k !== CACHE && k !== 'jarvis-cdn').map((k) => caches.delete(k)));
    await self.clients.claim();
  });
  e.waitUntil(done);
  // Reload outside waitUntil: a reload needs this worker to be fully active first (awaiting it inside would deadlock).
  done.then(() => {
    if (!fromLegacy) return;
    setTimeout(() => self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.navigate(c.url).catch(() => {}))), 50);
  });
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
function fromNetwork(req, c) {
  // cache: 'no-cache' asks the server whether the file changed (cheap), instead of trusting the browser's 10-minute cache.
  // (A navigation request can't be copied with new options, so it is fetched by URL.)
  const p = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(new Request(req, { cache: 'no-cache' }));
  return p.then((r) => {
    if (r && r.redirected) return req.mode === 'navigate' ? fetch(req) : r; // let the browser follow redirects itself
    if (r && r.ok && r.type === 'basic') c.put(req, r.clone()).catch(() => {});
    return r;
  });
}
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.endsWith('/sw.js')) return;
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const net = fromNetwork(req, c);
      const timeout = new Promise((res) => setTimeout(() => res(null), NET_TIMEOUT_MS));
      try {
        const r = await Promise.race([net.catch(() => null), timeout]);
        if (r) return r;
      } catch {}
      const hit = (await c.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? await c.match('./') : null);
      if (hit) return hit;
      try { return await net; } catch { return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } }); }
    }));
    return;
  }
  // Cache the few CDN libraries (math, PDF reader) after first use.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.open('jarvis-cdn').then(async (c) => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
  }
});
