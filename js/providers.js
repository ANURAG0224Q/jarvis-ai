// AI providers. Everything runs in the browser with the user's own keys.
import { settings, GEMINI_MODELS, FALLBACK_CHAIN, cleanKey } from './store.js';
import { blobToBase64, sleep } from './util.js';
import { bumpUsage, markLimit, resetLabel } from './usage.js';

export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
export const INLINE_MAX = 14 * 1024 * 1024; // bigger files go through the Gemini Files API

export class AIError extends Error {
  constructor(message, { status = 0, kind = 'error', retryIn = null, raw = '', friendly = '' } = {}) { super(message); this.status = status; this.kind = kind; this.retryIn = retryIn; this.raw = raw; this.friendly = friendly; }
}

const isMock = () => !!(window.__JARVIS_MOCK || sessionStorage.getItem('jarvis.mock') === '1');
export function geminiBase() { const b = (settings().geminiBase || '').trim().replace(/\/+$/, ''); return b || GEMINI_ORIGIN; }
function isLocalBase() { const b = settings().geminiBase || ''; return /^https?:\/\/(127\.|localhost)/.test(b); }
export function providerReady(p) {
  if (isMock()) return true;
  const s = settings();
  if (p === undefined) return buildRoutes().length > 0;
  return !!({ gemini: s.geminiKey || s.geminiBase, groq: s.groqKey, openrouter: s.openrouterKey, custom: s.customBase && s.customModel }[p]);
}
export function activeModelLabel() {
  const s = settings();
  if (s.provider === 'gemini') return s.model;
  if (s.provider === 'groq') return s.groqModel;
  if (s.provider === 'openrouter') return s.openrouterModel;
  return s.customModel || 'custom';
}

function geminiHeaders(extra = {}) { return { 'content-type': 'application/json', 'x-goog-api-key': cleanKey(settings().geminiKey), ...extra }; }

async function parseError(res) {
  let raw = ''; try { raw = await res.text(); } catch {}
  let msg = raw, retryIn = null, kind = 'error';
  try { const j = JSON.parse(raw); const e = Array.isArray(j) ? j[0].error : j.error; if (e) msg = e.message || msg; } catch {}
  const m = /retry in ([\d.]+h)?([\d.]+m)?([\d.]+s)?/i.exec(msg) || /retry in ([\d.]+)s/i.exec(msg);
  if (m) retryIn = m[0].replace(/^retry in /i, '');
  if (res.status === 429) kind = /per day|daily|PerDay/i.test(msg) ? 'daily-limit' : 'rate-limit';
  else if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) kind = 'bad-key';
  else if (res.status === 401 || res.status === 403) kind = /key|auth|permission/i.test(msg) ? 'bad-key' : 'forbidden';
  else if (res.status === 404) kind = 'not-found';
  else if (res.status >= 500) kind = 'server';
  return new AIError(msg || `HTTP ${res.status}`, { status: res.status, kind, retryIn, raw });
}

export function friendlyError(e) {
  if (!e) return 'Something went wrong.';
  if (e.name === 'AbortError') return 'Stopped.';
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return 'Network error: check your internet connection (or the endpoint URL in Settings).';
  switch (e.kind) {
    case 'bad-key': return 'Your API key was rejected. Open Settings and paste a valid key.';
    case 'offline': return 'You’re offline. Check your internet connection, then tap Retry.';
    case 'all-limits': case 'all-busy': return e.friendly;
    case 'no-key': return e.message;
    case 'daily-limit': return `Daily free limit reached for this model. It resets at ${resetLabel()}. Turn on auto-switch in Settings, or add a free Groq key there for more.`;
    case 'timeout': return 'The AI took too long to answer. Tap Retry.';
    case 'rate-limit': return `Too many requests per minute on the free tier${e.retryIn ? `, retry in ${e.retryIn}` : ''}. Wait a moment and try again.`;
    case 'not-found': return 'That model isn’t available on your key. Pick another model in Settings.';
    case 'server': return 'The AI service had a hiccup. Try again in a moment.';
    case 'forbidden': return 'Your key isn’t allowed to use this model. Pick another model in Settings.';
    case 'blocked': return e.message;
  }
  if (e.status === 400) return 'The AI couldn’t handle this request (maybe a file type it can’t read). Try removing attachments or rephrasing.';
  if (e instanceof AIError && e.kind === 'error' && e.message && e.message.length < 140 && !/[{}]/.test(e.message)) return e.message;
  return 'Something went wrong getting an answer. Tap Retry.';
}

// ---------- SSE reader ----------
async function* sse(res, signal) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  try {
    while (true) {
      if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (data) yield data;
      }
    }
    if (buf.trim().startsWith('data:')) yield buf.trim().slice(5).trim();
  } finally { try { reader.releaseLock(); } catch {} }
}

// ---------- Gemini Files API (for files too big to send inline, e.g. videos) ----------
export async function geminiUpload(blob, name, mime, { onProgress, signal } = {}) {
  if (isMock()) { await sleep(200); return { uri: 'mock://file/' + encodeURIComponent(name), mimeType: mime, expires: Date.now() + 47 * 3600e3 }; }
  const base = geminiBase();
  const start = await fetch(`${base}/upload/v1beta/files`, {
    method: 'POST', signal,
    headers: geminiHeaders({ 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(blob.size), 'X-Goog-Upload-Header-Content-Type': mime }),
    body: JSON.stringify({ file: { display_name: name.slice(0, 120) } }),
  });
  if (!start.ok) throw await parseError(start);
  let url = start.headers.get('x-goog-upload-url');
  if (!url) throw new AIError('Upload did not start (no upload URL returned).');
  if (base !== GEMINI_ORIGIN) url = url.replace(GEMINI_ORIGIN, base);
  onProgress && onProgress(0.05);
  const up = await fetch(url, { method: 'POST', signal, headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' }, body: blob });
  if (!up.ok) throw await parseError(up);
  let file = (await up.json()).file;
  onProgress && onProgress(0.6);
  // Videos need processing before use.
  for (let i = 0; file.state === 'PROCESSING' && i < 120; i++) {
    await sleep(2000);
    const r = await fetch(`${base}/v1beta/${file.name}`, { headers: geminiHeaders(), signal });
    if (!r.ok) throw await parseError(r);
    file = await r.json();
    onProgress && onProgress(Math.min(0.95, 0.6 + i * 0.02));
  }
  if (file.state === 'FAILED') throw new AIError('Google could not process this file.');
  onProgress && onProgress(1);
  return { uri: file.uri, mimeType: file.mimeType || mime, expires: file.expirationTime ? Date.parse(file.expirationTime) : Date.now() + 47 * 3600e3 };
}

// Convert neutral parts -> Gemini parts.
// neutral part: {text} | {file:{blob,mime,name,kind,size,uri,uriExpires,ref}} | {youtube:url} | {link:url}
// Google rejects a request whose inline files add up to more than about 20 MB, and that would break every later
// message in the chat (old photos are sent again with each message). Past this budget, files go through the Files API.
const INLINE_BUDGET = 12 * 1024 * 1024;
async function toGeminiParts(parts, ctx) {
  const out = [];
  for (const p of parts) {
    if (p.text != null) { if (p.text) out.push({ text: p.text }); continue; }
    if (p.youtube) { out.push({ fileData: { fileUri: p.youtube, mimeType: 'video/*' } }); continue; }
    if (p.link) { out.push({ text: `Web page: ${p.link}` }); ctx.links.push(p.link); continue; }
    if (p.file) {
      const f = p.file;
      if (f.uri && f.uriExpires && f.uriExpires > Date.now() + 60e3) { out.push({ fileData: { fileUri: f.uri, mimeType: f.mime } }); continue; }
      if (!f.blob) { out.push({ text: `[File ${f.name} is no longer available]` }); continue; }
      ctx.inlineBytes = ctx.inlineBytes || 0;
      if (f.blob.size <= INLINE_MAX && ctx.inlineBytes + f.blob.size <= INLINE_BUDGET) { ctx.inlineBytes += f.blob.size; out.push({ inlineData: { mimeType: f.mime, data: await blobToBase64(f.blob) } }); }
      else {
        ctx.onStatus && ctx.onStatus(`Uploading ${f.name} to Gemini…`);
        const up = await geminiUpload(f.blob, f.name, f.mime, { signal: ctx.signal });
        f.uri = up.uri; f.uriExpires = up.expires;
        ctx.onUploaded && ctx.onUploaded(f);
        out.push({ fileData: { fileUri: up.uri, mimeType: up.mimeType } });
      }
    }
  }
  return out;
}

function geminiBody({ contents, system, tools, temperature, thinking, showThinking, json, schema, maxTokens }) {
  const body = { contents, generationConfig: {} };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools && tools.length) body.tools = tools;
  if (temperature != null) body.generationConfig.temperature = temperature;
  if (maxTokens) body.generationConfig.maxOutputTokens = maxTokens;
  const tc = {};
  tc.includeThoughts = true; // always stream thoughts: keeps slow models visibly alive (hidden when showThinking is off)
  if (thinking && thinking !== 'default') tc.thinkingLevel = thinking;
  if (Object.keys(tc).length) body.generationConfig.thinkingConfig = tc;
  if (json) { body.generationConfig.responseMimeType = 'application/json'; if (schema) body.generationConfig.responseSchema = schema; }
  return body;
}

async function geminiStreamOnce(model, body, { signal, onText, onThought, onChunk, showThinking = true }) {
  const res = await fetch(`${geminiBase()}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: geminiHeaders(), body: JSON.stringify(body), signal,
  });
  if (!res.ok) throw await parseError(res);
  let text = '', thoughts = '', finish = '', grounding = null, usage = null, block = '';
  for await (const data of sse(res, signal)) {
    onChunk && onChunk();
    let j; try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new AIError(j.error.message || 'Stream error', { status: j.error.code || 0, kind: (j.error.code || 0) >= 500 ? 'server' : j.error.code === 429 ? 'rate-limit' : 'error' });
    if (j.promptFeedback && j.promptFeedback.blockReason) block = j.promptFeedback.blockReason;
    if (j.usageMetadata) usage = j.usageMetadata;
    const c = j.candidates && j.candidates[0];
    if (!c) continue;
    if (c.finishReason) finish = c.finishReason;
    if (c.groundingMetadata) grounding = c.groundingMetadata;
    if (c.urlContextMetadata) grounding = { ...(grounding || {}), urlContext: c.urlContextMetadata };
    for (const part of (c.content && c.content.parts) || []) {
      if (typeof part.text !== 'string') continue;
      if (part.thought) { thoughts += part.text; if (showThinking) onThought && onThought(thoughts); else onChunk && onChunk(); }
      else { text += part.text; onText && onText(text); }
    }
  }
  if (!text && block) throw new AIError(`Google blocked this request (${block}). Try rephrasing.`, { kind: 'blocked' });
  if (!text && finish && !['STOP', 'MAX_TOKENS'].includes(finish)) throw new AIError(`The model stopped without an answer (${finish}).`, { kind: 'blocked' });
  return { text, thoughts: showThinking ? thoughts : '', finish, grounding, usage, model };
}

// ---------- OpenAI-compatible (Groq, OpenRouter, custom) ----------
function oaiConfig() {
  const s = settings();
  if (s.provider === 'groq') return { base: 'https://api.groq.com/openai/v1', key: cleanKey(s.groqKey), model: s.groqModel };
  if (s.provider === 'openrouter') return { base: 'https://openrouter.ai/api/v1', key: cleanKey(s.openrouterKey), model: s.openrouterModel, extra: { 'HTTP-Referer': location.origin, 'X-Title': 'Jarvis AI' } };
  return { base: (s.customBase || '').replace(/\/+$/, ''), key: s.customKey, model: s.customModel };
}
async function toOaiContent(parts) {
  const out = [];
  for (const p of parts) {
    if (p.text != null) { if (p.text) out.push({ type: 'text', text: p.text }); continue; }
    if (p.youtube) { out.push({ type: 'text', text: `[YouTube video: ${p.youtube} — this provider can't watch videos. Switch to Gemini in Settings to use video sources.]` }); continue; }
    if (p.link) { out.push({ type: 'text', text: `Web page: ${p.link}` }); continue; }
    if (p.file) {
      const f = p.file;
      if (f.kind === 'image' && f.blob) out.push({ type: 'image_url', image_url: { url: `data:${f.mime};base64,${await blobToBase64(f.blob)}` } });
      else if (f.kind === 'pdf' && f.blob) {
        try { const { pdfToText } = await import('./pdftext.js'); out.push({ type: 'text', text: `--- ${f.name} (text extracted from PDF) ---\n${await pdfToText(f.blob)}` }); }
        catch (e) { out.push({ type: 'text', text: `[PDF ${f.name}: could not read text (${e.message})]` }); }
      } else out.push({ type: 'text', text: `[Attached ${f.kind} "${f.name}" — this provider can't read ${f.kind} files. Switch to Gemini in Settings.]` });
    }
  }
  if (out.every((c) => c.type === 'text')) return out.map((c) => c.text).join('\n\n');
  return out;
}
async function oaiStream(turns, { system, signal, onText, onThought, onChunk, temperature, json, cfg: cfgIn }) {
  const cfg = cfgIn || oaiConfig();
  if (!cfg.base) throw new AIError('Set the endpoint URL for the custom provider in Settings.');
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  for (const t of turns) messages.push({ role: t.role === 'model' ? 'assistant' : 'user', content: await toOaiContent(t.parts) });
  const body = { model: cfg.model, messages, stream: true };
  if (temperature != null) body.temperature = Math.min(temperature, 2);
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(`${cfg.base}/chat/completions`, {
    method: 'POST', signal, body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.key}`, ...(cfg.extra || {}) },
  });
  if (!res.ok) throw await parseError(res);
  let text = '', thoughts = '', finish = '', usage = null;
  for await (const data of sse(res, signal)) {
    if (data === '[DONE]') break;
    onChunk && onChunk();
    let j; try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new AIError(j.error.message || 'Stream error');
    if (j.usage) usage = j.usage;
    const ch = j.choices && j.choices[0]; if (!ch) continue;
    if (ch.finish_reason) finish = ch.finish_reason;
    const d = ch.delta || {};
    const r = d.reasoning || d.reasoning_content;
    if (r) { thoughts += r; onThought && onThought(thoughts); }
    if (d.content) { text += d.content; onText && onText(text); }
  }
  // Some models inline their reasoning in <think> tags.
  const m = /^\s*<think>([\s\S]*?)<\/think>\s*/.exec(text);
  if (m) { thoughts += m[1]; text = text.slice(m[0].length); }
  return { text, thoughts, finish, usage, model: cfg.model };
}

// ---------- Mock provider (hidden, used by automated tests) ----------
import { mockReply } from './mock.js';

// ---------- Daily-limit memory ----------
const EXH_KEY = 'jarvis.exhausted';
function exhaustedMap() { try { return JSON.parse(localStorage.getItem(EXH_KEY) || '{}'); } catch { return {}; } }
function parseDur(s) { if (!s) return 0; let ms = 0; const re = /([\d.]+)\s*([hms])/g; let m; while ((m = re.exec(s))) ms += +m[1] * { h: 3600e3, m: 60e3, s: 1e3 }[m[2]]; return ms; }
function markExhausted(model, retryIn) { const x = exhaustedMap(); x[model] = Date.now() + Math.min(parseDur(retryIn) || 3600e3, 24 * 3600e3); try { localStorage.setItem(EXH_KEY, JSON.stringify(x)); } catch {} }
function clearExhausted(model) { const x = exhaustedMap(); if (x[model]) { delete x[model]; try { localStorage.setItem(EXH_KEY, JSON.stringify(x)); } catch {} } }

// ---------- Public: chat ----------
// Free-tier reliability: every request walks a chain of "routes" (provider + model). A daily limit, a per-minute
// limit, a 5xx or a model that stops responding moves on to the next route automatically, with a small note.
const GROQ_BACKUPS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
export const PROVIDER_NAMES = { gemini: 'Gemini', groq: 'Groq', openrouter: 'OpenRouter', custom: 'Custom' };
export function modelLabel(r) {
  if (!r) return '';
  if (r.p === 'gemini' || !r.p) { const m = GEMINI_MODELS.find((x) => x.id === r.model); return m ? m.label : r.model; }
  return `${r.model.replace(/:free$/, '')} (${PROVIDER_NAMES[r.p]})`;
}
const exKey = (r) => (r.p === 'gemini' ? r.model : `${r.p}:${r.model}`);
export function buildRoutes(o = {}) {
  const s = settings();
  if (o.model) return [{ p: 'gemini', model: o.model }];
  const lists = {
    gemini: (s.geminiKey || s.geminiBase) ? [s.model, ...(s.autoFallback ? FALLBACK_CHAIN : [])] : [],
    groq: s.groqKey ? [s.groqModel, ...(s.autoFallback ? GROQ_BACKUPS : [])] : [],
    openrouter: s.openrouterKey ? [s.openrouterModel] : [],
    custom: s.customBase && s.customModel ? [s.customModel] : [],
  };
  const order = [s.provider, ...(s.autoFallback ? ['gemini', 'groq', 'openrouter'] : [])];
  const routes = [];
  for (const p of order) for (const model of lists[p] || []) if (model && !routes.some((r) => r.p === p && r.model === model)) routes.push({ p, model });
  return routes;
}
function oaiCfgFor(r) {
  const s = settings();
  if (r.p === 'groq') return { base: 'https://api.groq.com/openai/v1', key: cleanKey(s.groqKey), model: r.model };
  if (r.p === 'openrouter') return { base: 'https://openrouter.ai/api/v1', key: cleanKey(s.openrouterKey), model: r.model, extra: { 'HTTP-Referer': location.origin, 'X-Title': 'Jarvis AI' } };
  return { base: (s.customBase || '').replace(/\/+$/, ''), key: s.customKey, model: r.model };
}
const hasMedia = (turns) => turns.some((t) => t.parts.some((p) => p.youtube || (p.file && !['image', 'pdf'].includes(p.file.kind))));

export function isLooping(t) {
  const tail = t.slice(-1500).toLowerCase().split(/[^a-z0-9\u0900-\u0dff]+/).filter(Boolean);
  if (tail.length < 120) return false;
  return new Set(tail).size / tail.length < 0.12;
}
// Runs one attempt with a watchdog: no first data within firstMs, or silence for idleMs, counts as a timeout.
async function guarded(fn, o, { firstMs, idleMs, maxMs = 300e3 }) {
  const ac = new AbortController(); let timedOut = false, timer = 0;
  const cap = setTimeout(() => { timedOut = true; ac.abort(); }, maxMs); // a model stuck in a loop can't hold the app forever
  const arm = (ms) => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ac.abort(); }, ms); };
  const outer = o.signal; const fwd = () => ac.abort();
  if (outer) { if (outer.aborted) ac.abort(); else outer.addEventListener('abort', fwd, { once: true }); }
  arm(firstMs);
  const kick = () => arm(idleMs);
  let partial = '', looped = false, checkedAt = 0;
  const onText = (t) => {
    partial = t; kick();
    // A model stuck repeating itself ("weight, weight, weight…") is stopped and the next one is tried.
    if (t.length - checkedAt > 1500) { checkedAt = t.length; if (isLooping(t)) { looped = true; ac.abort(); return; } }
    o.onText && o.onText(t);
  };
  try {
    return await fn({ ...o, signal: ac.signal, onChunk: kick, onText, onThought: (t) => { kick(); if (t.length - checkedAt > 1500) { checkedAt = t.length; if (isLooping(t)) { looped = true; ac.abort(); return; } } o.onThought && o.onThought(t); } });
  } catch (e) {
    if (outer && outer.aborted) throw e;
    if (looped) { const err = new AIError('The model got stuck repeating itself.', { kind: 'timeout' }); err.looped = true; throw err; }
    if (timedOut) { const err = new AIError('The model stopped responding.', { kind: 'timeout' }); err.partial = partial; throw err; }
    if (partial) e.partial = partial;
    throw e;
  } finally { clearTimeout(timer); clearTimeout(cap); if (outer) outer.removeEventListener('abort', fwd); }
}

// turns: [{role:'user'|'model', parts:[neutral parts]}]
export async function chat(turns, opts = {}) {
  const s = settings();
  const o = { temperature: s.temperature, thinking: s.thinking, showThinking: s.showThinking, ...opts };
  if (isMock()) return mockChat(turns, o);
  let routes = buildRoutes(o);
  if (!routes.length) throw new AIError('Add your free Gemini API key in Settings first.', { kind: 'no-key' });
  if (navigator.onLine === false && !isLocalBase()) throw new AIError('offline', { kind: 'offline' });
  // Files only Gemini can read (video, audio): keep Gemini routes first.
  if (hasMedia(turns) && routes.some((r) => r.p === 'gemini')) routes = [...routes.filter((r) => r.p === 'gemini'), ...routes.filter((r) => r.p !== 'gemini')];
  const notes = [];
  // Skip routes whose daily free limit is known to be used up (until Google's reset), but keep them as a last resort.
  if (routes.length > 1) {
    const ex = exhaustedMap(), now = Date.now();
    const skip = routes.filter((r) => ex[exKey(r)] > now);
    if (skip.length && skip.length < routes.length) {
      routes = [...routes.filter((r) => !(ex[exKey(r)] > now)), ...skip];
      const said = 'jarvis.exhNote.' + skip.map(exKey).join(',');
      if (!sessionStorage.getItem(said)) { sessionStorage.setItem(said, '1'); notes.push(`Daily free limit already used today for ${skip.map(modelLabel).join(', ')}, so Jarvis is using ${modelLabel(routes[0])} (resets ${resetLabel()}).`); }
    }
  }
  let geminiCtx = null, contents = null;
  const errors = [];
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i]; const last = i === routes.length - 1;
    const slow = /gemma/i.test(route.model);
    const limits = { firstMs: last ? 150e3 : slow ? 75e3 : 45e3, idleMs: last ? 150e3 : 60e3, maxMs: o.maxMs || (last ? 420e3 : 300e3) };
    let lastErr = null;
    let body = null;
    if (route.p === 'gemini') {
      if (!contents) {
        geminiCtx = { links: [], signal: o.signal, onStatus: o.onStatus, onUploaded: o.onUploaded };
        contents = [];
        for (const t of turns) contents.push({ role: t.role === 'model' ? 'model' : 'user', parts: await toGeminiParts(t.parts, geminiCtx) });
      }
      const tools = [];
      if (o.webSearch && o.googleGrounding) tools.push({ googleSearch: {} });
      if (geminiCtx.links.length && o.urlContext !== false) tools.push({ urlContext: {} });
      const gemma = /gemma/i.test(route.model);
      body = geminiBody({ contents, system: gemma && o.json ? `${o.system || ''} Reply with one valid JSON object only, no Markdown fences.${o.schema ? ' It must match this JSON schema exactly (same top-level keys): ' + JSON.stringify(o.schema) : ''}`.trim() : o.system, tools, temperature: gemma && o.json ? Math.min(o.temperature ?? 1, 0.4) : o.temperature, thinking: o.thinking, showThinking: o.showThinking, json: o.json && !gemma, schema: o.schema, maxTokens: o.maxTokens });
    }
    let retried = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        o.onModel && o.onModel(route.p === 'gemini' ? route.model : modelLabel(route));
        const r = route.p === 'gemini'
          ? await guarded((oo) => geminiStreamOnce(route.model, body, oo), o, limits)
          : await guarded((oo) => oaiStream(turns, { ...oo, cfg: oaiCfgFor(route) }), o, limits);
        r.notes = [...compactNotes(notes), ...(r.notes || [])];
        if (route.p !== 'gemini') r.model = modelLabel(route);
        clearExhausted(exKey(route)); bumpUsage(exKey(route));
        return r;
      } catch (e) {
        if (e.name === 'AbortError' && !(e instanceof AIError)) throw e;
        lastErr = e;
        // The connection or Google's stream broke mid-answer (not a slow model): start this answer over once,
        // so a half-written game or code block isn't left cut off.
        const broke = e.partial && !retried && !e.looped && e.message !== 'The model stopped responding.' && (e.kind === 'server' || e.kind === 'error' || e.kind === 'rate-limit' || e instanceof TypeError);
        if (broke) { retried = true; o.onText && o.onText(''); o.onStatus && o.onStatus('Connection dropped mid-answer, starting the answer again…'); await sleep(1200); continue; }
        // Text already on screen: keep it instead of starting over with another model.
        if (e.partial && e.partial.length > 200) return { text: e.partial, thoughts: '', model: route.p === 'gemini' ? route.model : modelLabel(route), notes: [...notes, 'The model stopped mid-answer. Say "continue" for the rest.'] };
        if (route.p === 'gemini') {
          // Some models don't support every option: drop it and retry the same model.
          if (e.status === 400 && body.generationConfig.thinkingConfig && /think/i.test(e.message)) { delete body.generationConfig.thinkingConfig; continue; }
          if (e.status === 400 && body.tools && /tool|search|url|grounding|function/i.test(e.message)) {
            notes.push(o.webSearch && o.googleGrounding ? 'Google Search grounding needs a paid key on Gemini 3+, so Jarvis answered without it.' : 'This model could not open links directly; answered from the text Jarvis fetched.');
            delete body.tools; continue;
          }
          if (e.status === 400 && body.generationConfig.responseSchema && /schema|json/i.test(e.message)) { delete body.generationConfig.responseSchema; continue; }
          if (e.status === 400 && body.systemInstruction && /system|developer instruction/i.test(e.message)) {
            body.contents = [{ role: 'user', parts: [{ text: `Instructions:\n${body.systemInstruction.parts[0].text}` }] }, { role: 'model', parts: [{ text: 'Understood.' }] }, ...body.contents];
            delete body.systemInstruction; continue;
          }
        }
        // One retry for a hiccup (5xx, timeout, connection drop), or a short per-minute wait.
        const netErr = e instanceof TypeError;
        if (!retried && !e.looped && (e.kind === 'server' || e.kind === 'timeout' || netErr)) { retried = true; o.onStatus && o.onStatus(`${modelLabel(route)} is slow, retrying…`); await sleep(1500); continue; }
        if (!retried && e.kind === 'rate-limit' && parseDur(e.retryIn) && parseDur(e.retryIn) <= 15e3) { retried = true; o.onStatus && o.onStatus(`Free per-minute limit, waiting ${Math.ceil(parseDur(e.retryIn) / 1000)} s…`); await sleep(parseDur(e.retryIn) + 300); continue; }
        break;
      }
    }
    errors.push({ route, err: lastErr });
    // A rejected key is rejected for every model on that provider: don't walk the rest of its models.
    if (lastErr && lastErr.kind === 'bad-key') routes = [...routes.slice(0, i + 1), ...routes.slice(i + 1).filter((r) => r.p !== route.p)];
    // No internet: every other model would fail the same way.
    if (lastErr instanceof TypeError && navigator.onLine === false) break;
    if (lastErr && lastErr.kind === 'daily-limit') { markExhausted(exKey(route), lastErr.retryIn); markLimit(exKey(route)); }
    const moveOn = lastErr && (['daily-limit', 'rate-limit', 'not-found', 'server', 'timeout', 'bad-key', 'forbidden'].includes(lastErr.kind) || lastErr instanceof TypeError || lastErr.status === 400 && route.p !== 'gemini');
    if (!moveOn) break;
    const next = routes[i + 1];
    if (next) {
      const why = { 'daily-limit': 'daily free limit reached', 'rate-limit': 'too many requests this minute', 'not-found': 'not available', timeout: lastErr.looped ? 'got stuck repeating itself' : 'not responding', 'bad-key': 'key rejected', forbidden: 'not allowed' }[lastErr.kind] || 'busy';
      notes.push(`Switched to ${modelLabel(next)} (${modelLabel(route)}: ${why}).`);
      o.onStatus && o.onStatus(`Switching to ${modelLabel(next)}…`);
    }
  }
  throw allFailedError(errors);
}

// Several "Switched to …" notes in a row become one line: "Switched to Gemma 4 26B (daily free limit reached on: A, B, C)."
function compactNotes(notes) {
  const sw = notes.map((n) => /^Switched to (.+) \((.+): (.+)\)\.$/.exec(n));
  if (sw.filter(Boolean).length < 2) return notes;
  const hits = sw.filter(Boolean); const final = hits[hits.length - 1][1];
  const byWhy = {}; hits.forEach((h) => { (byWhy[h[3]] = byWhy[h[3]] || []).push(h[2]); });
  const why = Object.entries(byWhy).map(([w, ms]) => `${w}: ${ms.join(', ')}`).join('; ');
  return [...notes.filter((n, i) => !sw[i]), `Switched to ${final} (${why}).`];
}

function allFailedError(errors) {
  const s = settings();
  const kinds = errors.map((x) => x.err && x.err.kind);
  const last = errors.length ? errors[errors.length - 1].err : null;
  if (errors.length === 1 && last && !['daily-limit', 'rate-limit', 'server', 'timeout'].includes(last.kind)) return last;
  if (kinds.every((k) => k === 'bad-key')) return new AIError('key', { kind: 'bad-key' });
  if (errors.length && errors.every((x) => x.err instanceof TypeError)) return navigator.onLine === false ? new AIError('offline', { kind: 'offline' }) : errors[errors.length - 1].err;
  // The Gemini key itself was rejected (and any backups also failed): say so, the key is the thing to fix.
  if (errors[0] && errors[0].err && errors[0].err.kind === 'bad-key' && errors[0].route.p === 'gemini') return errors[0].err;
  const more = !s.groqKey ? ' Add a free Groq key in Settings (AI model → Backup keys) for more chats today.' : !s.openrouterKey ? ' Add a free OpenRouter key in Settings (AI model → Backup keys) for more.' : '';
  if (kinds.includes('daily-limit') && kinds.every((k) => ['daily-limit', 'rate-limit', 'not-found', 'bad-key', 'forbidden'].includes(k)))
    return new AIError('limits', { kind: 'all-limits', friendly: `Daily free limit reached on all your free models. It resets at ${resetLabel()}.${more}` });
  return new AIError('busy', { kind: 'all-busy', friendly: `All free AI models are busy right now. Wait a minute and tap Retry.${more}` });
}

async function mockChat(turns, o) {
  // Test hook: window.__JARVIS_MOCK_FAIL = ['daily-limit', 'server', ...] makes the first routes fail like the real API.
  const fails = window.__JARVIS_MOCK_FAIL || [];
  const routes = window.__JARVIS_MOCK_ROUTES || ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemma-4-26b-a4b-it'];
  const notes = [];
  // Test hooks: __JARVIS_MOCK_HANG = never answers (until stopped); __JARVIS_MOCK_FIRST_DELAY = ms before the first words.
  const abortable = (ms) => new Promise((res, rej) => { const t = ms == null ? null : setTimeout(res, ms); o.signal && o.signal.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')); }); });
  if (window.__JARVIS_MOCK_HANG) await abortable(null);
  if (window.__JARVIS_MOCK_FIRST_DELAY) await abortable(window.__JARVIS_MOCK_FIRST_DELAY);
  for (let i = 0; i < routes.length; i++) {
    const f = fails[i];
    o.onModel && o.onModel(routes[i]);
    if (!f) { bumpUsage(routes[i]); const r = await mockReply(turns, o); r.model = routes[i]; r.notes = [...compactNotes(notes), ...(r.notes || [])]; return r; }
    if (f === 'daily-limit') { markLimit(routes[i]); }
    if (routes[i + 1]) notes.push(`Switched to ${modelLabel({ p: 'gemini', model: routes[i + 1] })} (${modelLabel({ p: 'gemini', model: routes[i] })}: ${f === 'daily-limit' ? 'daily free limit reached' : f === 'timeout' ? 'not responding' : 'busy'}).`);
    else return Promise.reject(allFailedError(fails.slice(0, routes.length).map((k) => ({ err: new AIError(k, { kind: k }) }))));
  }
}

// One-shot JSON generation helper (used by the AI video maker).
export async function generateJSON(prompt, { system, schema, signal, onStatus } = {}) {
  const r = await chat([{ role: 'user', parts: [{ text: prompt }] }], { system, schema, json: true, signal, onStatus, showThinking: false, temperature: 0.9 });
  return parseJSONLoose(r.text);
}
export function parseJSONLoose(t) {
  t = String(t || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t); if (fence) t = fence[1].trim();
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new AIError('The AI returned something that is not valid JSON. Try again.');
}

// ---------- Gemini text-to-speech ----------
// Returns {audio: AudioBuffer-ready ArrayBuffer (WAV)}.
export async function geminiTTS(text, { voice, model, signal, style } = {}) {
  const s = settings();
  if (isMock()) { const { mockTTS } = await import('./mock.js'); return mockTTS(text); }
  if (!s.geminiKey && !s.geminiBase) throw new AIError('Narration uses Gemini text-to-speech: add your free Gemini API key in Settings.', { kind: 'bad-key' });
  const models = [model || s.ttsModel, ...['gemini-3.8-flash-lite-tts', 'gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview']].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr;
  for (const m of models) {
    try {
      const res = await fetch(`${geminiBase()}/v1beta/models/${m}:generateContent`, {
        method: 'POST', signal, headers: geminiHeaders(),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text }] }], // plain text only: TTS models read any instruction prefix aloud
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || s.geminiVoice || 'Kore' } } } },
        }),
      });
      if (!res.ok) throw await parseError(res);
      const j = await res.json();
      const part = ((j.candidates || [])[0]?.content?.parts || []).find((p) => p.inlineData);
      if (!part) throw new AIError('No audio returned.');
      const mime = part.inlineData.mimeType || '';
      const bytes = Uint8Array.from(atob(part.inlineData.data), (c) => c.charCodeAt(0));
      if (/wav/i.test(mime) || (bytes[0] === 0x52 && bytes[1] === 0x49)) return bytes.buffer;
      const rate = +((/rate=(\d+)/.exec(mime) || [])[1] || 24000);
      return pcmToWav(bytes, rate, 1);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = e;
      if (!['daily-limit', 'rate-limit', 'not-found', 'server'].includes(e.kind) && !(e instanceof TypeError)) break;
    }
  }
  throw lastErr;
}
export function pcmToWav(pcmBytes, rate, ch) {
  const len = pcmBytes.byteLength, buf = new ArrayBuffer(44 + len), v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, len, true);
  new Uint8Array(buf, 44).set(pcmBytes);
  return buf;
}

// Validate a Gemini key quickly (lists models; costs no generation quota).
export async function testGeminiKey(key, base) {
  const res = await fetch(`${(base || '').replace(/\/+$/, '') || GEMINI_ORIGIN}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': cleanKey(key) } });
  if (!res.ok) throw await parseError(res);
  const j = await res.json();
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent')).map((m) => m.name.replace('models/', ''));
}
export async function openRouterFreeModels() {
  const r = await fetch('https://openrouter.ai/api/v1/models');
  const j = await r.json();
  return (j.data || []).filter((m) => /:free$/.test(m.id)).map((m) => m.id).sort();
}

// Free image generation (Pollinations.ai, no key). Returns a Blob.
export async function generateImage(prompt, { width = 1024, height = 1024, seed, signal } = {}) {
  if (isMock()) { const { mockImage } = await import('./mock.js'); return mockImage(prompt, width, height); }
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${width}&height=${height}&nologo=true&seed=${seed ?? Math.floor(Math.random() * 1e6)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new AIError(`Image service error (${res.status}). Try again in a minute.`);
  const b = await res.blob();
  if (!b.type.startsWith('image/')) throw new AIError('Image service returned no image. Try again.');
  return b;
}

// Read a web page as text with the free r.jina.ai reader (no key).
export async function readWebPage(url, { signal } = {}) {
  if (isMock()) return `# Mock page\nThis is mock text for ${url}. Jarvis test content: the capital of Karnataka is Bengaluru.`;
  const res = await fetch('https://r.jina.ai/' + url, { signal, headers: { 'x-return-format': 'markdown' } });
  if (!res.ok) throw new AIError(`Could not read that page (${res.status}).`);
  const t = await res.text();
  return t.length > 120000 ? t.slice(0, 120000) + '\n…[truncated]' : t;
}
