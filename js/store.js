// Settings live in localStorage (small, sync). Chats, sources and media blobs live in IndexedDB.
const SKEY = 'jarvis.settings.v1';

export const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', note: 'Smartest free model · ~20 requests/day' },
  { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', note: 'Free · ~20 requests/day' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (preview)', note: 'Free · ~20 requests/day' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', note: 'Fast · ~500 requests/day' },
  { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', note: 'Fast · ~500 requests/day' },
  { id: 'gemma-4-31b-it', label: 'Gemma 4 31B', note: 'Open model · free' },
  { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B', note: 'Open model · free' },
];
// Free models tried in order when one hits its daily limit (always the current list, not a copy saved in old settings).
export const FALLBACK_CHAIN = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemma-4-26b-a4b-it', 'gemma-4-31b-it'];
export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts', 'gemini-3.1-flash-tts-preview'];
export const GEMINI_VOICES = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Aoede', 'Leda', 'Orus', 'Zephyr', 'Callirrhoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Achernar', 'Gacrux', 'Sadachbia', 'Sulafat'];
export const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];

export const DEFAULTS = {
  provider: 'gemini',              // gemini | groq | openrouter | custom
  geminiKey: '', groqKey: '', openrouterKey: '', customKey: '',
  model: 'gemini-3.8-flash',
  autoFallback: true,              // on daily-limit errors, try the next free Gemini model
  fallbackChain: FALLBACK_CHAIN,
  groqModel: 'openai/gpt-oss-120b',
  webSearch: false,                // 🌐 search the web before answering (Tavily, free)
  tavilyKey: '', serperKey: '',
  googleGrounding: false,          // paid Gemini keys only
  openrouterModel: 'google/gemma-4-31b-it:free',
  customBase: '', customModel: '',
  temperature: 1,
  thinking: 'default',             // default | low | high
  showThinking: true,
  systemPrompt: '',
  memory: [],                      // [{id,text}]
  memoryOn: true,
  theme: 'dark',                   // dark | light | system
  sendOnEnter: true,
  ttsEngine: 'browser',            // browser | gemini
  ttsVoice: '',
  geminiVoice: 'Kore',
  ttsModel: 'gemini-3.8-flash-lite-tts',
  geminiBase: '',                  // advanced: custom endpoint (proxy) for Gemini
  githubToken: '',
  githubUser: '',
  onboarded: false,
  // startup intro + greeting
  introOn: true,                   // show the boot animation on launch
  greetVoiceOn: true,              // speak the greeting
  greetName: 'sir',
  greetMode: 'one',                // one | random | time
  greetText: 'Hello {name}, I am Jarvis.',
  greetList: ['Namaste {name}, Jarvis online.', 'Welcome back, {name}. All systems ready.'],
  greetMorning: 'Good morning, {name}. Jarvis online.',
  greetAfternoon: 'Good afternoon, {name}. Ready when you are.',
  greetEvening: 'Good evening, {name}. Jarvis at your service.',
  greetVoice: 'gemini:Charon',     // gemini:<voice> | system:<voiceURI> | system:
};

let cache = null;
const listeners = new Set();
export function settings() {
  if (!cache) {
    try { cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch { cache = { ...DEFAULTS }; }
  }
  return cache;
}
export function saveSettings(patch) {
  cache = { ...settings(), ...patch };
  try { localStorage.setItem(SKEY, JSON.stringify(cache)); } catch (e) { console.warn('settings not saved', e); }
  listeners.forEach((f) => { try { f(cache, patch); } catch (e) { console.error(e); } });
  return cache;
}
export function onSettings(f) { listeners.add(f); return () => listeners.delete(f); }
export function resetSettings() { localStorage.removeItem(SKEY); cache = null; return settings(); }

// ---------- IndexedDB ----------
const DB_NAME = 'jarvis-db';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('convs')) d.createObjectStore('convs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function tx(store, mode, fn) {
  return db().then((d) => new Promise((res, rej) => {
    const t = d.transaction(store, mode); const s = t.objectStore(store);
    let out; const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
}
export const convs = {
  all: () => tx('convs', 'readonly', (s) => s.getAll()).then((a) => (a || []).sort((x, y) => (y.pinned - x.pinned) || (y.updated - x.updated))),
  get: (id) => tx('convs', 'readonly', (s) => s.get(id)),
  put: (c) => tx('convs', 'readwrite', (s) => s.put(c)),
  del: (id) => tx('convs', 'readwrite', (s) => s.delete(id)),
  clear: () => tx('convs', 'readwrite', (s) => s.clear()),
};
export const blobs = {
  get: (id) => tx('blobs', 'readonly', (s) => s.get(id)),
  put: (id, b) => tx('blobs', 'readwrite', (s) => s.put(b, id)),
  del: (id) => tx('blobs', 'readwrite', (s) => s.delete(id)),
  clear: () => tx('blobs', 'readwrite', (s) => s.clear()),
  keys: () => tx('blobs', 'readonly', (s) => s.getAllKeys()),
};
export const kv = {
  get: (k) => tx('kv', 'readonly', (s) => s.get(k)),
  put: (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k)),
  del: (k) => tx('kv', 'readwrite', (s) => s.delete(k)),
};

// Ask the browser to keep our data (chats, media) even under storage pressure.
export async function persist() { try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {} }
export async function usage() { try { return await navigator.storage.estimate(); } catch { return null; } }
