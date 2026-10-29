// AI providers. Everything runs in the browser with the user's own keys.
import { settings } from './store.js';
import { blobToBase64, sleep } from './util.js';

export const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
export const INLINE_MAX = 14 * 1024 * 1024; // bigger files go through the Gemini Files API

export class AIError extends Error {
  constructor(message, { status = 0, kind = 'error', retryIn = null, raw = '' } = {}) { super(message); this.status = status; this.kind = kind; this.retryIn = retryIn; this.raw = raw; }
}

const isMock = () => !!(window.__JARVIS_MOCK || sessionStorage.getItem('jarvis.mock') === '1');
export function geminiBase() { const b = (settings().geminiBase || '').trim().replace(/\/+$/, ''); return b || GEMINI_ORIGIN; }
export function providerReady(p = settings().provider) {
  if (isMock()) return true;
  const s = settings();
  return !!({ gemini: s.geminiKey || s.geminiBase, groq: s.groqKey, openrouter: s.openrouterKey, custom: s.customBase && s.customModel }[p]);
}
export function activeModelLabel() {
  const s = settings();
  if (s.provider === 'gemini') return s.model;
  if (s.provider === 'groq') return s.groqModel;
  if (s.provider === 'openrouter') return s.openrouterModel;
  return s.customModel || 'custom';
}

function geminiHeaders(extra = {}) { return { 'content-type': 'application/json', 'x-goog-api-key': settings().geminiKey || '', ...extra }; }

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
    case 'daily-limit': return `Daily free limit reached for this model${e.retryIn ? ` (resets in ${e.retryIn})` : ''}. Pick another model in Settings, or turn on auto-fallback.`;
    case 'rate-limit': return `Too many requests per minute on the free tier${e.retryIn ? `, retry in ${e.retryIn}` : ''}. Wait a moment and try again.`;
    case 'not-found': return `Model not found: ${e.message}`;
    case 'server': return `The AI service had a problem (${e.status}). Try again in a moment.`;
    case 'blocked': return e.message;
  }
  return e.message || String(e);
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
      if (f.blob.size <= INLINE_MAX) out.push({ inlineData: { mimeType: f.mime, data: await blobToBase64(f.blob) } });
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
  if (showThinking) tc.includeThoughts = true;
  if (thinking && thinking !== 'default') tc.thinkingLevel = thinking;
  if (Object.keys(tc).length) body.generationConfig.thinkingConfig = tc;
  if (json) { body.generationConfig.responseMimeType = 'application/json'; if (schema) body.generationConfig.responseSchema = schema; }
  return body;
}

async function geminiStreamOnce(model, body, { signal, onText, onThought }) {
  const res = await fetch(`${geminiBase()}/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', headers: geminiHeaders(), body: JSON.stringify(body), signal,
  });
  if (!res.ok) throw await parseError(res);
  let text = '', thoughts = '', finish = '', grounding = null, usage = null, block = '';
  for await (const data of sse(res, signal)) {
    let j; try { j = JSON.parse(data); } catch { continue; }
    if (j.error) throw new AIError(j.error.message || 'Stream error', { status: j.error.code || 0 });
    if (j.promptFeedback && j.promptFeedback.blockReason) block = j.promptFeedback.blockReason;
    if (j.usageMetadata) usage = j.usageMetadata;
    const c = j.candidates && j.candidates[0];
    if (!c) continue;
    if (c.finishReason) finish = c.finishReason;
    if (c.groundingMetadata) grounding = c.groundingMetadata;
    if (c.urlContextMetadata) grounding = { ...(grounding || {}), urlContext: c.urlContextMetadata };
    for (const part of (c.content && c.content.parts) || []) {
      if (typeof part.text !== 'string') continue;
      if (part.thought) { thoughts += part.text; onThought && onThought(thoughts); }
      else { text += part.text; onText && onText(text); }
    }
  }
  if (!text && block) throw new AIError(`Google blocked this request (${block}). Try rephrasing.`, { kind: 'blocked' });
  if (!text && finish && !['STOP', 'MAX_TOKENS'].includes(finish)) throw new AIError(`The model stopped without an answer (${finish}).`, { kind: 'blocked' });
  return { text, thoughts, finish, grounding, usage, model };
}

// ---------- OpenAI-compatible (Groq, OpenRouter, custom) ----------
function oaiConfig() {
  const s = settings();
  if (s.provider === 'groq') return { base: 'https://api.groq.com/openai/v1', key: s.groqKey, model: s.groqModel };
  if (s.provider === 'openrouter') return { base: 'https://openrouter.ai/api/v1', key: s.openrouterKey, model: s.openrouterModel, extra: { 'HTTP-Referer': location.origin, 'X-Title': 'Jarvis AI' } };
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
async function oaiStream(turns, { system, signal, onText, onThought, temperature, json }) {
  const cfg = oaiConfig();
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
// turns: [{role:'user'|'model', parts:[neutral parts]}]
export async function chat(turns, opts = {}) {
  const s = settings();
  const o = { temperature: s.temperature, thinking: s.thinking, showThinking: s.showThinking, ...opts };
  if (isMock()) return mockReply(turns, o);
  if (s.provider !== 'gemini') return oaiStream(turns, o);
  if (!s.geminiKey && !s.geminiBase) throw new AIError('Add your free Gemini API key in Settings first.', { kind: 'bad-key' });

  const ctx = { links: [], signal: o.signal, onStatus: o.onStatus, onUploaded: o.onUploaded };
  const contents = [];
  for (const t of turns) contents.push({ role: t.role === 'model' ? 'model' : 'user', parts: await toGeminiParts(t.parts, ctx) });
  const tools = [];
  if (o.webSearch) tools.push({ googleSearch: {} });
  if (ctx.links.length && o.urlContext !== false) tools.push({ urlContext: {} });

  const first = o.model || s.model;
  let chain = [first];
  if (s.autoFallback && !o.model) for (const m of s.fallbackChain) if (!chain.includes(m)) chain.push(m);
  let lastErr = null, notes = [];
  // Skip models whose daily free limit is known to be used up (remembered until Google's reset), but keep them as a last resort.
  if (chain.length > 1) {
    const ex = exhaustedMap(), now = Date.now();
    const skip = chain.filter((m) => ex[m] > now);
    if (skip.length && skip.length < chain.length) { chain = [...chain.filter((m) => !(ex[m] > now)), ...skip]; const said = 'jarvis.exhNote.' + skip.join(','); if (!sessionStorage.getItem(said)) { sessionStorage.setItem(said, '1'); notes.push(`${skip.join(', ')}: daily free limit used up for today, using ${chain[0]} until it resets.`); } }
  }
  for (const model of chain) {
    let body = geminiBody({ contents, system: o.system, tools, temperature: o.temperature, thinking: o.thinking, showThinking: o.showThinking, json: o.json, schema: o.schema, maxTokens: o.maxTokens });
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        o.onModel && o.onModel(model);
        const r = await geminiStreamOnce(model, body, o);
        r.notes = notes;
        clearExhausted(model);
        return r;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        // Some models don't support every option: drop it and retry the same model.
        if (e.status === 400 && body.generationConfig.thinkingConfig && /think/i.test(e.message)) { delete body.generationConfig.thinkingConfig; continue; }
        if (e.status === 400 && body.tools && /tool|search|url|grounding|function/i.test(e.message)) {
          notes.push(o.webSearch ? 'Web search is not available for this model/key (Google Search grounding needs a paid key on Gemini 3+), answered without it.' : 'This model could not open links directly; answered from the text Jarvis fetched.');
          delete body.tools; continue;
        }
        if (e.status === 400 && body.generationConfig.responseSchema && /schema|json/i.test(e.message)) { delete body.generationConfig.responseSchema; continue; }
        if (e.status === 400 && body.systemInstruction && /system|developer instruction/i.test(e.message)) {
          // Gemma models: move the system prompt into the first user turn.
          body.contents = [{ role: 'user', parts: [{ text: `Instructions:\n${body.systemInstruction.parts[0].text}` }] }, { role: 'model', parts: [{ text: 'Understood.' }] }, ...body.contents];
          delete body.systemInstruction; continue;
        }
        if (e.kind === 'server' && attempt < 1) { await sleep(1500); continue; }
        break;
      }
    }
    if (lastErr && lastErr.kind === 'daily-limit') markExhausted(model, lastErr.retryIn);
    const canFallback = lastErr && (['daily-limit', 'rate-limit', 'not-found', 'server'].includes(lastErr.kind));
    if (!canFallback) break;
    const next = chain[chain.indexOf(model) + 1];
    if (next) { notes.push(`${model}: ${lastErr.kind === 'daily-limit' ? 'daily free limit reached' : lastErr.kind === 'not-found' ? 'not available' : 'busy'} → switched to ${next}.`); o.onStatus && o.onStatus(`Switching to ${next}…`); }
  }
  throw lastErr || new AIError('No model answered.');
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
  const res = await fetch(`${(base || '').replace(/\/+$/, '') || GEMINI_ORIGIN}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
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
