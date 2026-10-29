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
// ---------- understanding "open youtube" in the many ways people type it ----------
// Extra spellings people actually type.
const ALIAS = {
  utube: 'youtube', youtub: 'youtube', 'you tub': 'youtube', youtubr: 'youtube', 'youtube.com': 'youtube', 'www.youtube.com': 'youtube',
  'yt music': 'youtube music', 'whats app': 'whatsapp', 'whatsapp.com': 'whatsapp', wa: 'whatsapp', 'whats app web': 'whatsapp web', 'watsapp': 'whatsapp', 'whatsap': 'whatsapp',
  ig: 'instagram', 'insta gram': 'instagram', 'instagram.com': 'instagram', 'g mail': 'gmail', 'gmail.com': 'gmail', 'google map': 'maps', 'google.com': 'google',
  map: 'maps', 'spotify.com': 'spotify', 'chat gpt': 'chatgpt',
};
Object.assign(SITES, { 'youtube music': 'https://music.youtube.com/', 'youtube shorts': 'https://www.youtube.com/shorts', shorts: 'https://www.youtube.com/shorts' });
const siteKey = (w) => { w = (w || '').trim().replace(/^the\s+/, '').replace(/\s+(website|web site|site|app|application|page|tab|homepage|home page)$/, '').replace(/\s+(website|site|app|page|tab)$/, '').trim(); w = ALIAS[w] || w; return SITES[w] ? w : null; };
const searchFor = (w) => { w = ALIAS[(w || '').trim()] || (w || '').trim(); if (w === 'youtube music') return null; return SEARCH[w] ? w : null; };
const BARE_OK = new Set(['youtube', 'yt', 'gmail', 'google', 'instagram', 'insta', 'whatsapp', 'whatsapp web', 'spotify', 'maps', 'google maps', 'github', 'netflix', 'facebook', 'linkedin', 'chatgpt', 'amazon', 'flipkart', 'youtube music', 'reddit', 'hotstar', 'leetcode', 'canva', 'telegram', 'twitter', 'drive', 'google drive', 'calendar', 'outlook']);
const LEAD = /^(hey|hi|hello|hii+|yo|ok|okay|oye|arre|arey|bro|bhai|dude|buddy|jarvis|jervis|javis|sir|please|pls|plz|plss|kindly|just|now|quickly|so|and|also|then|can you|can u|could you|could u|would you|would u|will you|will u|can|could|i want you to|i want to|i wanna|i need you to|i need to|go ahead and|lets|let us|help me|try to|try and|you)\s+/;
const TRAIL = /\s+(please|pls|plz|plss|for me|now|right now|jarvis|bro|bhai|sir|quickly|fast|asap|yaar|na|ji|again|thanks|thank you|thx|ok|okay)$/;
// Hindi/Hinglish verbs: "youtube kholo", "youtube open karo", "lofi chalao"
const HI_OPEN = /\s+(kholo|khol do|kholdo|khol|open karo|open kar do|open kardo|open kar|open|chalu karo|start karo|chalao|chala do|kholna|khulo)$/;
const HI_PLAY = /\s+(chalao|chala do|chaladu|bajao|baja do|lagao|laga do|play karo|play kar do|sunao)$/;

export function normalize(input) {
  let t = String(input || '').toLowerCase().replace(/[\u2018\u2019\u201c\u201d"]/g, '').replace(/[!?;:¿¡]+/g, ' ').replace(/,/g, ' ').replace(/\s+\.\s*/g, ' ').replace(/\.+\s*$/g, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 8; i++) { const b = t; t = t.replace(LEAD, '').replace(TRAIL, '').trim(); if (b === t) break; }
  return t;
}
const isGame = (q) => /\b(game|games|quiz|with me|chess|tic.?tac|riddle|antakshari|rock paper|20 questions|twenty questions|word chain|pretend|role ?play)\b/.test(q);
const cleanQ = (q) => q.replace(/^(some|a few|the|me|for|about)\s+/, '').replace(/\s+(song|songs|video|videos)$/, (m) => (/(song|songs)$/.test(m) ? m : '')).trim();

function playAction(q, where) {
  q = cleanQ(q); if (!q || isGame(q)) return null;
  where = where ? (ALIAS[where] || where) : 'youtube';
  if (where === 'spotify') return { url: SEARCH.spotify(q), label: `Spotify: ${q}` };
  if (where === 'youtube music') return { url: `https://music.youtube.com/search?q=${encodeURIComponent(q)}`, label: `YouTube Music: ${q}` };
  return { url: yt(q), label: `YouTube: ${q}` };
}
function siteSearch(site, q) {
  q = cleanQ(q.replace(/^(for|about)\s+/, '')); if (!q) return null;
  const s = searchFor(site); if (!s) return null;
  return { url: SEARCH[s](q), label: `${cap(s === 'yt' ? 'youtube' : s)}: ${q}` };
}
const OPEN_VERB = '(?:open up|open|launch|go to|goto|go on|visit|show me|show|start|take me to|bring up|pull up|load|run|navigate to|switch to|get me|give me|khol|kholo)';

/** One clause → {url,label} or null. */
function parseOne(t) {
  let m;
  if (!t) return null;
  // Hinglish: "lofi music chalao", "youtube pe lofi chalao", "youtube kholo"
  if (HI_PLAY.test(t) && !/^(youtube|yt|you tube)$/.test(t.replace(HI_PLAY, ''))) {
    const rest = t.replace(HI_PLAY, '').trim();
    if ((m = /^(youtube|yt|you tube|spotify|youtube music)\s+(?:pe|par|pr|me|mein|on)\s+(.+)$/.exec(rest))) return playAction(m[2], m[1]);
    if (!siteKey(rest)) return playAction(rest);
  }
  if (HI_OPEN.test(t)) { const k = siteKey(t.replace(HI_OPEN, '')); if (k) return { url: SITES[k], label: cap(k) }; }
  // play X on youtube / play X
  if ((m = /^(?:play|put on|stream|listen to|watch)\s+(.+?)(?:\s+(?:on|in|from|using)\s+(youtube|you tube|yt|utube|spotify|youtube music|yt music))?$/.exec(t))) return playAction(m[1], m[2]);
  // search youtube for X / search X on youtube / youtube search X
  if ((m = /^(?:search|find|look up|lookup|look for|search up)\s+(?:on\s+|in\s+)?([a-z ]+?)\s+(?:for|about)\s+(.+)$/.exec(t)) && searchFor(m[1])) return siteSearch(m[1], m[2]);
  if ((m = /^(?:search|find|look up|lookup|look for|search up)\s+(?:for\s+)?(.+?)\s+(?:on|in|using)\s+([a-z ]+)$/.exec(t)) && searchFor(m[2])) return siteSearch(m[2], m[1]);
  if ((m = /^(youtube|yt|google|amazon|flipkart|github|wikipedia|spotify|maps|google maps|reddit|images)\s+(?:search|par search|pe search|me search)\s+(?:for\s+)?(.+)$/.exec(t))) return siteSearch(m[1], m[2]);
  if ((m = /^(youtube|yt|google|amazon|flipkart|github|wikipedia|spotify|maps|reddit)\s+(?:for\s+)?(.+)$/.exec(t)) && !siteKey(t) && !/^(search|pe|par|me|kholo|khol|open)\b/.test(m[2]) && !/(^|\s)(and|then|aur|phir|fir|&)\s/.test(m[2])) return siteSearch(m[1], m[2]);
  if ((m = /^(?:google|search for|search)\s+(.+)$/.exec(t)) && !siteKey(m[1])) return { url: gg(m[1]), label: `Google: ${m[1]}` };
  // open X / go to X / launch X
  if ((m = new RegExp('^' + OPEN_VERB + '\\s+(?:up\\s+)?(?:the\\s+|my\\s+)?(.+?)(?:\\s+(?:website|site|app|page|tab|in a new tab|in new tab|in browser|in the browser|for me|homepage))*$').exec(t))) {
    const what = m[1].trim();
    const k = siteKey(what); if (k) return { url: SITES[k], label: cap(k) };
    const lastTok = what.split(/\s+/).pop();
    if (/^https?:\/\/\S+$/i.test(lastTok) && what.split(/\s+/).length === 1) return { url: lastTok, label: NICE(lastTok) };
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(what)) return { url: 'https://' + what, label: what };
    const key = Object.keys(SITES).find((kk) => what === kk + ' com' || what === kk + '.com' || what === kk + ' dot com');
    if (key) return { url: SITES[key], label: cap(key) };
    // "open youtube lofi" → search
    if (!/\s(and|then|aur|phir|fir|&)\s/.test(what) && (m = /^(youtube|yt|spotify|google|amazon|flipkart)\s+(?:search\s+|play\s+)?(?:for\s+)?(.+)$/.exec(what))) return m[1] === 'spotify' || m[1] === 'youtube' || m[1] === 'yt' ? (/^search/.test(what.split(' ')[1] || '') ? siteSearch(m[1], m[2]) : playAction(m[2], m[1])) : siteSearch(m[1], m[2]);
  }
  // bare site name: "youtube", "gmail"
  const k = siteKey(t); if (k && BARE_OK.has(k) && t.split(/\s+/).length <= 3) return { url: SITES[k], label: cap(k) };
  return null;
}

/** Returns {url, label, more?:[{url,label}]} or null. Only http(s) URLs are ever produced. */
export function parseCommand(input) {
  const raw = String(input || '').trim();
  if (!raw || raw.length > 200 || raw.includes('\n')) return null;
  const t = normalize(raw);
  if (!t) return null;
  if (/^(https?:\/\/\S+)$/i.test(raw)) return null; // a pasted link is something to read, not open
  const one = parseOne(t);
  if (one) return one;
  // Two steps: "open youtube and play lofi music", "open youtube then search java tutorial", "open youtube and gmail"
  const parts = t.split(/\s+(?:and then|and also|then|and|&|aur|phir|fir|after that)\s+/).map((x) => normalize(x)).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  const first = parseOne(parts[0]);
  if (!first) return null;
  const firstSite = Object.keys(SITES).find((k) => SITES[k] === first.url);
  const acts = [first];
  for (const p of parts.slice(1)) {
    let a = null, m;
    if (firstSite && searchFor(firstSite) && (m = /^(?:search|find|look up|look for|type)\s+(?:for\s+|about\s+)?(.+)$/.exec(p))) a = siteSearch(firstSite, m[1]);
    else if (firstSite && /^(youtube|yt|spotify|youtube music)$/.test(firstSite) && (m = /^(?:play|put on|watch|listen to|start)\s+(.+)$/.exec(p))) a = playAction(m[1], firstSite);
    else if (firstSite && /^(youtube|yt|spotify|youtube music)$/.test(firstSite) && HI_PLAY.test(p)) a = playAction(p.replace(HI_PLAY, ''), firstSite);
    else a = parseOne(p) || (siteKey(p) ? { url: SITES[siteKey(p)], label: cap(siteKey(p)) } : null);
    if (!a) return null; // something we don't understand → let the AI handle it
    if (firstSite && acts.length === 1 && acts[0] === first && a.url.startsWith(new URL(first.url).origin) && a.url !== first.url) acts[0] = a; // the search replaces the plain "open"
    else acts.push(a);
  }
  const [main, ...more] = acts;
  return more.length ? { ...main, more } : main;
}
function cap(s) { return s.replace(/\b\w/g, (c) => c.toUpperCase()).replace('Youtube', 'YouTube').replace('Github', 'GitHub').replace('Whatsapp', 'WhatsApp').replace('Linkedin', 'LinkedIn').replace('Chatgpt', 'ChatGPT').replace(/^Yt$/, 'YouTube').replace(/^Insta$/, 'Instagram'); }

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
