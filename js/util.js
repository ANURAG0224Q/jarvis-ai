// Small DOM + data helpers shared by every module.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return n;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 16);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtTime(sec, withTenths = false) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return withTenths ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}
export function fmtBytes(b) {
  if (!b && b !== 0) return '';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
export function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
export function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
export function base64ToBlob(b64, mime) {
  const bin = atob(b64); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}

export function download(blobOrText, name, mime = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function pickFiles({ accept = '', multiple = true } = {}) {
  return new Promise((res) => {
    const inp = el('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    inp.addEventListener('change', () => { res([...inp.files]); inp.remove(); });
    inp.addEventListener('cancel', () => { res([]); inp.remove(); });
    document.body.append(inp); inp.click();
  });
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|cfg|conf|log|html?|css|scss|less|js|mjs|cjs|jsx|ts|tsx|py|java|c|h|cpp|hpp|cc|cs|go|rs|rb|php|swift|kt|kts|dart|lua|sh|bash|zsh|bat|ps1|sql|r|m|scala|pl|vue|svelte|ipynb|gradle|env|gitignore|dockerfile|makefile|tex|srt|vtt)$/i;
export function fileKind(name = '', mime = '') {
  mime = mime || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf';
  if (mime.startsWith('text/') || /json|xml|javascript|yaml|x-sh|x-python/.test(mime) || TEXT_EXT.test(name)) return 'text';
  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(name)) return 'image';
  if (/\.(mp4|mov|webm|mkv|avi|3gp|m4v)$/i.test(name)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|weba)$/i.test(name)) return 'audio';
  return 'other';
}
export const KIND_ICON = { image: '🖼️', video: '🎬', audio: '🎵', pdf: '📕', text: '📄', other: '📎', link: '🔗', youtube: '▶️', github: '🐙' };

export function guessMime(name = '', mime = '') {
  if (mime) return mime;
  const ext = (name.split('.').pop() || '').toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', pdf: 'application/pdf',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
    aac: 'audio/aac', flac: 'audio/flac', md: 'text/markdown', txt: 'text/plain', json: 'application/json', html: 'text/html', css: 'text/css', js: 'text/javascript', py: 'text/x-python', csv: 'text/csv' })[ext] || 'application/octet-stream';
}

export function youtubeId(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
export function isUrl(s) { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } }

// Toasts
export function toast(msg, type = 'info', ms = 3500) {
  let host = $('#toasts');
  if (!host) { host = el('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(host); }
  const t = el('div', { class: `toast ${type}` }, msg);
  host.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, ms);
  return t;
}

// Modal dialog. content: Node; buttons: [{label, value, primary, danger}]
export function modal({ title, content, buttons = [{ label: 'OK', value: true, primary: true }], wide = false, onOpen } = {}) {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'modal-head' }, el('h3', {}, title || ''), el('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close(null) }, '✕')),
      el('div', { class: 'modal-body' }, content || ''),
      buttons.length ? el('div', { class: 'modal-foot' }, buttons.map((b) => el('button', { class: 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), onclick: () => close(typeof b.value === 'function' ? b.value() : b.value) }, b.label))) : null);
    const back = el('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(null); } }, box);
    document.body.append(back);
    document.addEventListener('keydown', onKey);
    onOpen && onOpen(box, close);
    setTimeout(() => { const f = box.querySelector('input,textarea,select'); f && f.focus(); }, 30);
  });
}
export async function prompt(title, value = '', { placeholder = '', multiline = false, okLabel = 'Save' } = {}) {
  const inp = multiline ? el('textarea', { rows: 6, placeholder }) : el('input', { type: 'text', placeholder });
  inp.value = value;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !multiline) { e.preventDefault(); inp.closest('.modal').querySelector('.btn.primary').click(); } });
  const r = await modal({ title, content: inp, buttons: [{ label: 'Cancel', value: null }, { label: okLabel, value: () => inp.value, primary: true }] });
  return r;
}
export async function confirm(title, text, okLabel = 'Delete', danger = true) {
  return !!(await modal({ title, content: el('p', {}, text), buttons: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: !danger, danger }] }));
}
export function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => fallback());
  return Promise.resolve(fallback());
  function fallback() { const t = el('textarea', { style: { position: 'fixed', opacity: 0 } }); t.value = text; document.body.append(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove(); return ok; }
}
