// Browser actions: "open youtube", "search youtube for lofi", "google cricket score"…
// A website can only open tabs/links. It cannot control other apps or files on your computer.
export const SITES = {
  youtube: 'https://www.youtube.com/', 'you tube': 'https://www.youtube.com/', yt: 'https://www.youtube.com/',
  gmail: 'https://mail.google.com/', mail: 'https://mail.google.com/', email: 'https://mail.google.com/',
  google: 'https://www.google.com/', drive: 'https://drive.google.com/', 'google drive': 'https://drive.google.com/',
  docs: 'https://docs.google.com/', 'google docs': 'https://docs.google.com/', sheets: 'https://sheets.google.com/', slides: 'https://slides.google.com/',
  calendar: 'https://calendar.google.com/', 'google calendar': 'https://calendar.google.com/', meet: 'https://meet.google.com/', 'google meet': 'https://meet.google.com/',
  maps: 'https://www.google.com/maps', 'google maps': 'https://www.google.com/maps', photos: 'https://photos.google.com/', translate: 'https://translate.google.com/', 'google translate': 'https://translate.google.com/',
  github: 'https://github.com/', 'git hub': 'https://github.com/', gitlab: 'https://gitlab.com/', stackoverflow: 'https://stackoverflow.com/', 'stack overflow': 'https://stackoverflow.com/',
  whatsapp: 'https://web.whatsapp.com/', 'whatsapp web': 'https://web.whatsapp.com/', instagram: 'https://www.instagram.com/', insta: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/', twitter: 'https://x.com/', x: 'https://x.com/', linkedin: 'https://www.linkedin.com/', reddit: 'https://www.reddit.com/', telegram: 'https://web.telegram.org/',
  spotify: 'https://open.spotify.com/', netflix: 'https://www.netflix.com/', 'prime video': 'https://www.primevideo.com/', hotstar: 'https://www.hotstar.com/', jiohotstar: 'https://www.hotstar.com/',
  chatgpt: 'https://chatgpt.com/', claude: 'https://claude.ai/', gemini: 'https://gemini.google.com/', 'ai studio': 'https://aistudio.google.com/', perplexity: 'https://www.perplexity.ai/',
  amazon: 'https://www.amazon.in/', flipkart: 'https://www.flipkart.com/', swiggy: 'https://www.swiggy.com/', zomato: 'https://www.zomato.com/',
  wikipedia: 'https://www.wikipedia.org/', 'w3schools': 'https://www.w3schools.com/', leetcode: 'https://leetcode.com/', codepen: 'https://codepen.io/', replit: 'https://replit.com/',
  'pi lab': 'https://pi-lab.sites.tab.bot/', canva: 'https://www.canva.com/', notion: 'https://www.notion.so/', outlook: 'https://outlook.live.com/', news: 'https://news.google.com/', 'google news': 'https://news.google.com/',
};
const NICE = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const yt = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const gg = (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
const SEARCH = {
  youtube: yt, 'you tube': yt, yt,
  google: gg, web: gg, internet: gg,
  amazon: (q) => `https://www.amazon.in/s?k=${encodeURIComponent(q)}`, flipkart: (q) => `https://www.flipkart.com/search?q=${encodeURIComponent(q)}`,
  github: (q) => `https://github.com/search?q=${encodeURIComponent(q)}`, wikipedia: (q) => `https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(q)}`,
  spotify: (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`, maps: (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`, 'google maps': (q) => `https://www.google.com/maps/search/${encodeURIComponent(q)}`,
  images: (q) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`, reddit: (q) => `https://www.reddit.com/search/?q=${encodeURIComponent(q)}`, gmail: (q) => `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`,
};
const clean = (s) => s.toLowerCase().replace(/[.!?,]+$/g, '').replace(/^(hey |ok |okay )?jarvis[,\s]*/i, '').replace(/^(please|pls|can you|could you|will you)\s+/i, '').replace(/\s+(please|pls|for me|now)$/i, '').trim();

/** Returns {url, label} or null. Only http(s) URLs are ever produced. */
export function parseCommand(input) {
  const raw = String(input || '').trim();
  if (!raw || raw.length > 160 || raw.includes('\n')) return null;
  const t = clean(raw);
  let m;
  // play X on youtube / play X (song)
  if ((m = /^play\s+(.+?)(?:\s+(?:on|in)\s+(youtube|you tube|yt|spotify))?$/.exec(t))) {
    const q = m[1].replace(/\s+(song|video)$/, ''); const where = m[2] || 'youtube';
    const f = SEARCH[where] || yt; return { url: f(q), label: `${where === 'spotify' ? 'Spotify' : 'YouTube'}: ${q}` };
  }
  // search youtube for X / search X on youtube / youtube search X
  if ((m = /^(?:search|find|look up|lookup)\s+(?:on\s+)?([a-z ]+?)\s+(?:for|about)\s+(.+)$/.exec(t)) && SEARCH[m[1].trim()]) return { url: SEARCH[m[1].trim()](m[2]), label: `${cap(m[1].trim())} search: ${m[2]}` };
  if ((m = /^(?:search|find|look up)\s+(.+?)\s+(?:on|in)\s+([a-z ]+)$/.exec(t)) && SEARCH[m[2].trim()]) return { url: SEARCH[m[2].trim()](m[1]), label: `${cap(m[2].trim())} search: ${m[1]}` };
  if ((m = /^(youtube|google|amazon|flipkart|github|wikipedia|spotify|maps|reddit)\s+(?:search\s+)?(?:for\s+)?(.+)$/.exec(t)) && !SITES[t]) return { url: SEARCH[m[1]](m[2]), label: `${cap(m[1])} search: ${m[2]}` };
  if ((m = /^(?:google|search for|search)\s+(.+)$/.exec(t))) return { url: gg(m[1]), label: `Google: ${m[1]}` };
  // open X / go to X / launch X
  if ((m = /^(?:open|launch|go to|goto|visit|show me|start|take me to)\s+(?:the\s+)?(.+?)(?:\s+(?:website|site|app|page|tab|in a new tab|in new tab))*$/.exec(t))) {
    const what = m[1].trim();
    if (SITES[what]) return { url: SITES[what], label: cap(what) };
    if (/^https?:\/\/\S+$/i.test(raw.split(/\s+/).pop())) { const u = raw.split(/\s+/).pop(); return { url: u, label: NICE(u) }; }
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(what)) return { url: 'https://' + what, label: what };
    const key = Object.keys(SITES).find((k) => what === k + ' com' || what === k + '.com');
    if (key) return { url: SITES[key], label: cap(key) };
  }
  if (SITES[t] && raw.split(/\s+/).length <= 2 && /^(youtube|gmail)$/i.test(t)) return { url: SITES[t], label: cap(t) };
  return null;
}
const cap = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase()).replace('Youtube', 'YouTube').replace('Github', 'GitHub').replace('Gmail', 'Gmail');

/** Extract [[open: URL]] actions the AI put in an answer. */
export function extractActions(text) {
  const out = []; const re = /\[\[open:\s*(https?:\/\/[^\s\]]+)\s*(?:\|\s*([^\]]+))?\]\]/gi; let m;
  while ((m = re.exec(text))) out.push({ url: m[1], label: (m[2] || NICE(m[1])).trim() });
  return out;
}
export const stripActions = (text) => text.replace(/\[\[open:[^\]]*\]\]/gi, '').trim();

/** Open a URL in a new tab. Returns true if the browser allowed it. */
export function openTab(url) {
  if (!/^https?:\/\//i.test(url)) return false;
  let w = null;
  try { w = window.open(url, '_blank'); } catch { w = null; }
  if (w) { try { w.opener = null; } catch {} return true; }
  return false;
}
