// Startup greeting: picks the words, fills {name}/{time}/{greeting}/{day}, and speaks them
// with a cached Gemini voice clip (one API call per distinct text) or the browser's own voice.
import { settings, blobs } from './store.js';
import { geminiTTS } from './providers.js';

const STYLE = 'Say in a deep, calm, confident, warm voice, like a refined AI butler';
export const state = { last: null }; // for tests: { text, method }
window.__greet = state;

function partOfDay(d = new Date()) { const h = d.getHours(); return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'; }
export function fill(tpl, s = settings(), d = new Date()) {
  const pod = partOfDay(d);
  return String(tpl || '')
    .replace(/\{name\}/gi, s.greetName || '')
    .replace(/\{time\}/gi, d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    .replace(/\{greeting\}/gi, 'Good ' + pod)
    .replace(/\{day\}/gi, d.toLocaleDateString([], { weekday: 'long' }))
    .replace(/\s+([,.!?])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
export function templates(s = settings()) {
  const main = s.greetText || 'Hello {name}, I am Jarvis.';
  if (s.greetMode === 'random') return [main, ...(s.greetList || [])].filter((t) => t && t.trim());
  if (s.greetMode === 'time') return [s.greetMorning, s.greetAfternoon, s.greetEvening].map((t) => t || main);
  return [main];
}
export function pickTemplate(s = settings(), d = new Date()) {
  const main = s.greetText || 'Hello {name}, I am Jarvis.';
  if (s.greetMode === 'random') { const l = templates(s); return l[Math.floor(Math.random() * l.length)] || main; }
  if (s.greetMode === 'time') { const pod = partOfDay(d); return (pod === 'morning' ? s.greetMorning : pod === 'afternoon' ? s.greetAfternoon : s.greetEvening) || main; }
  return main;
}
export function pickGreeting(s = settings()) { return fill(pickTemplate(s), s); }

const isHindi = (t) => /[\u0900-\u097F]/.test(t);
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function voiceSpec(s = settings()) { const v = s.greetVoice || 'gemini:Charon'; const [kind, ...rest] = v.split(':'); return { kind, name: rest.join(':') }; }
const clipKey = (text, voice) => 'greet2_' + hash(voice + '|' + text);
const canGemini = (s = settings()) => !!(s.geminiKey || s.geminiBase || sessionStorage.getItem('jarvis.mock') === '1');

export async function cachedClip(text, s = settings()) {
  const v = voiceSpec(s); if (v.kind !== 'gemini') return null;
  return (await blobs.get(clipKey(text, v.name)).catch(() => null)) || null;
}
// Make (or reuse) the Gemini clip for this text. One call per distinct text+voice.
export async function makeClip(text, s = settings()) {
  const v = voiceSpec(s); if (v.kind !== 'gemini' || !canGemini(s)) return null;
  const key = clipKey(text, v.name);
  const have = await blobs.get(key).catch(() => null); if (have) return have;
  const ab = await geminiTTS(text, { voice: v.name || 'Charon', style: STYLE });
  const blob = new Blob([ab], { type: 'audio/wav' }); await blobs.put(key, blob); return blob;
}
// Pre-generate clips for the current greeting set (texts with {time} change every minute, so they use the system voice).
export async function precache(s = settings()) {
  const out = { made: 0, failed: null };
  if (!s.greetVoiceOn || voiceSpec(s).kind !== 'gemini' || !canGemini(s)) return out;
  for (const tpl of templates(s)) {
    if (/\{time\}/i.test(tpl)) continue;
    try { const had = await cachedClip(fill(tpl, s), s); if (!had) { await makeClip(fill(tpl, s), s); out.made++; } }
    catch (e) { out.failed = e; break; }
  }
  return out;
}

let audioEl = null;
export function stopSpeaking() { try { audioEl && audioEl.pause(); } catch {} audioEl = null; try { speechSynthesis.cancel(); } catch {} }

function systemVoice(text, s) {
  const v = voiceSpec(s); const voices = (window.speechSynthesis && speechSynthesis.getVoices()) || [];
  if (v.kind === 'system' && v.name) { const m = voices.find((x) => x.voiceURI === v.name || x.name === v.name); if (m) return m; }
  if (isHindi(text)) return voices.find((x) => /^hi/i.test(x.lang)) || null;
  return voices.find((x) => /en-(GB|IN)/i.test(x.lang) && /male|daniel|rishi|google uk english male/i.test(x.name)) || voices.find((x) => /^en/i.test(x.lang)) || null;
}
function speakSystem(text, s) {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) return reject(new Error('no speech'));
    const u = new SpeechSynthesisUtterance(text);
    const voice = systemVoice(text, s); if (voice) u.voice = voice;
    u.lang = voice?.lang || (isHindi(text) ? 'hi-IN' : 'en-IN');
    u.rate = 0.95; u.pitch = 0.8;
    let done = false; const fin = () => { if (!done) { done = true; resolve(); } };
    u.onend = fin; u.onerror = (e) => (e.error === 'not-allowed' ? reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })) : fin());
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    setTimeout(fin, 4000 + text.length * 120); // never hang
  });
}
function playBlob(blob) {
  return new Promise((resolve, reject) => {
    stopSpeaking();
    const a = new Audio(URL.createObjectURL(blob)); audioEl = a;
    a.onended = () => resolve(); a.onerror = () => reject(new Error('audio failed'));
    a.play().catch(reject);
  });
}
/**
 * Speak `text`. allowNetwork=true (Preview button) waits for a fresh Gemini clip;
 * at launch we never wait on the network: use a cached clip or the system voice, and cache in the background.
 * Returns { method, done } where done resolves when speech ends. Throws NotAllowedError if the browser blocks audio.
 */
export async function speak(text, { allowNetwork = false, s = settings() } = {}) {
  const v = voiceSpec(s);
  let clip = null;
  if (v.kind === 'gemini') {
    clip = await cachedClip(text, s);
    if (!clip && allowNetwork) { try { clip = await makeClip(text, s); } catch (e) { state.ttsError = e; } }
  }
  if (clip) { state.last = { text, method: 'gemini-voice' }; const p = playBlob(clip); await Promise.race([p, new Promise((r) => setTimeout(r, 30))]); return { method: 'gemini-voice', done: p }; }
  state.last = { text, method: 'system-voice' };
  const p = speakSystem(text, s);
  if (v.kind === 'gemini' && !allowNetwork && canGemini(s) && !/\d{1,2}:\d{2}/.test(text)) makeClip(text, s).catch(() => {}); // cache for next launch
  return { method: 'system-voice', done: p };
}
