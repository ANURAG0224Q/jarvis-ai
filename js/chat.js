// Chat: conversations, streaming answers, attachments, sources, voice.
import { $, $$, el, uid, esc, toast, modal, prompt, confirm, copyText, download, pickFiles, fileKind, guessMime, KIND_ICON, fmtBytes, fmtDate, isUrl, youtubeId, blobToDataURL } from './util.js';
import { settings, saveSettings, convs, blobs, onSettings } from './store.js';
import { chat as aiChat, friendlyError, providerReady, activeModelLabel, generateImage, readWebPage, geminiTTS } from './providers.js';
import { webSearch, searchQuery, sourcesBlock } from './websearch.js';
import { renderMarkdown, typesetMath, extractCode, extFor } from './markdown.js';
import { openPreview } from './preview.js';
import { BASE_SYSTEM, PRESETS, presetById, SUGGESTIONS } from './presets.js';
import { pushDialog, github } from './github.js';
import { parseCommand, openTab, extractActions, stripActions } from './commands.js';

let conv = null;           // current conversation object
let busy = null;           // {ctrl, msgId}
let pending = [];          // composer attachments [{id,name,mime,size,kind,blob}]
let list = [];             // conversation index
let voiceMode = false;

const MAX_ATTACH = 50 * 1024 * 1024;

// ---------------- conversation index / sidebar ----------------
export async function refreshList(filter = $('#chatSearch')?.value || '') {
  list = await convs.all();
  const f = filter.trim().toLowerCase();
  const box = $('#chatList'); if (!box) return;
  box.innerHTML = '';
  const shown = f ? list.filter((c) => c.title.toLowerCase().includes(f) || c.messages.some((m) => (m.text || curText(m)).toLowerCase().includes(f))) : list;
  if (!shown.length) box.append(el('div', { class: 'muted small pad' }, f ? 'No chats match.' : 'No chats yet.'));
  for (const c of shown) {
    const item = el('div', { class: 'chat-item' + (conv && conv.id === c.id ? ' active' : ''), 'data-id': c.id, role: 'button', tabindex: 0, onclick: () => { location.hash = `#/chat/${c.id}`; closeSidebarMobile(); } },
      el('span', { class: 'ci-title' }, (c.pinned ? '📌 ' : '') + c.title),
      el('span', { class: 'ci-date' }, fmtDate(c.updated)),
      el('button', { class: 'icon-btn ci-more', 'aria-label': 'Chat options', onclick: (e) => { e.stopPropagation(); chatMenu(c, e.currentTarget); } }, '⋯'));
    item.addEventListener('keydown', (e) => { if (e.key === 'Enter') item.click(); });
    box.append(item);
  }
}
function closeSidebarMobile() { document.body.classList.remove('sidebar-open'); }

function chatMenu(c, anchor) {
  popMenu(anchor, [
    { label: '✏️ Rename', act: () => renameChat(c) },
    { label: c.pinned ? '📌 Unpin' : '📌 Pin', act: async () => { c.pinned = !c.pinned; await convs.put(c); if (conv && conv.id === c.id) conv.pinned = c.pinned; refreshList(); } },
    { label: '⬇️ Export (Markdown)', act: () => exportMarkdown(c) },
    { label: '🗑️ Delete', danger: true, act: () => deleteChat(c) },
  ]);
}
export function popMenu(anchor, items) {
  $$('.pop-menu').forEach((m) => m.remove());
  const r = anchor.getBoundingClientRect();
  const m = el('div', { class: 'pop-menu', role: 'menu' }, items.filter(Boolean).map((it) => el('button', { role: 'menuitem', class: it.danger ? 'danger' : '', onclick: () => { m.remove(); it.act(); } }, it.label)));
  document.body.append(m);
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(r.left, innerWidth - mw - 8), top = r.bottom + 4;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = Math.max(8, left) + 'px'; m.style.top = top + 'px';
  setTimeout(() => document.addEventListener('click', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('click', off, true); } }, true), 0);
  return m;
}
async function renameChat(c) {
  const t = await prompt('Rename chat', c.title);
  if (t == null || !t.trim()) return;
  c.title = t.trim().slice(0, 120); await convs.put(c);
  if (conv && conv.id === c.id) { conv.title = c.title; setTitle(); }
  refreshList();
}
async function deleteChat(c) {
  if (!(await confirm('Delete chat?', `"${c.title}" will be deleted from this device.`))) return;
  for (const m of c.messages) for (const a of m.attachments || []) blobs.del(a.blobId).catch(() => {});
  for (const s of c.sources || []) if (s.blobId) blobs.del(s.blobId).catch(() => {});
  await convs.del(c.id);
  if (conv && conv.id === c.id) { conv = null; location.hash = '#/chat'; }
  refreshList(); toast('Chat deleted');
}
function exportMarkdown(c) {
  const md = `# ${c.title}\n\n` + c.messages.map((m) => `**${m.role === 'user' ? 'You' : 'Jarvis'}:**\n\n${m.role === 'user' ? m.text : curText(m)}\n`).join('\n---\n\n');
  download(md, c.title.replace(/[^\w-]+/g, '_').slice(0, 50) + '.md', 'text/markdown');
}

// ---------------- open / new ----------------
function newConv(preset = 'general') {
  return { id: uid(), title: 'New chat', created: Date.now(), updated: Date.now(), preset, system: '', messages: [], sources: [], pinned: false };
}
export async function openChat(id) {
  if (busy) stop();
  if (id) {
    const c = await convs.get(id);
    if (!c) { toast('Chat not found'); location.hash = '#/chat'; return; }
    conv = c;
  } else conv = null;
  renderAll();
  refreshList();
}
export function currentConv() { return conv; }
async function ensureConv() {
  if (!conv) { conv = newConv($('#presetSel')?.value || 'general'); await convs.put(conv); history.replaceState(null, '', `#/chat/${conv.id}`); }
  return conv;
}
async function save() { if (conv) { conv.updated = Date.now(); await convs.put(conv); } }

const curVer = (m) => (m.versions ? m.versions[m.vi ?? m.versions.length - 1] : { text: m.text || '' });
const curText = (m) => (m.role === 'model' ? curVer(m).text || '' : m.text || '');

// ---------------- rendering ----------------
function setTitle() {
  $('#topTitle').textContent = conv ? conv.title : 'New chat';
  const n = conv ? (conv.sources || []).length : 0;
  $('#srcCount').textContent = n ? String(n) : '';
  $('#srcBtn').classList.toggle('has', n > 0);
}
export function renderAll() {
  setTitle(); renderMessages(); renderPending(); renderSources(); syncPresetSel(); updateModelChip(); updateSendBtn();
}
function syncPresetSel() {
  const sel = $('#presetSel'); if (!sel) return;
  const custom = settings().customPresets || [];
  sel.innerHTML = '';
  [...PRESETS, ...custom].forEach((p) => sel.append(el('option', { value: p.id }, `${p.icon || '⭐'} ${p.name}`)));
  sel.value = conv ? conv.preset || 'general' : sel.dataset.next || 'general';
}
export function updateModelChip() {
  const chip = $('#modelChip'); if (!chip) return;
  const s = settings();
  chip.textContent = (sessionStorage.getItem('jarvis.mock') === '1' ? 'mock · ' : '') + ({ gemini: '', groq: 'Groq · ', openrouter: 'OpenRouter · ', custom: 'Custom · ' }[s.provider] || '') + activeModelLabel().replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ');
}

function renderMessages() {
  const box = $('#messages'); box.innerHTML = '';
  if (!conv || !conv.messages.length) { box.append(emptyState()); return; }
  for (const m of conv.messages) box.append(renderMsg(m));
  typesetMath(box);
  requestAnimationFrame(() => scrollBottom(true));
}
function emptyState() {
  const s = settings();
  const name = s.userName ? `, ${s.userName}` : '';
  return el('div', { class: 'empty' },
    el('div', { class: 'logo-big', 'aria-hidden': 'true' }, el('img', { src: 'icons/icon.svg', alt: '' })),
    el('h1', {}, `Hi${name}! What should we build today?`),
    el('p', { class: 'muted' }, 'Chat, code, make websites & games, read your files and videos, or make a video in Video Studio.'),
    !providerReady() ? el('button', { class: 'btn primary', onclick: () => (location.hash = '#/settings') }, '🔑 Add your free Gemini key to start') : null,
    el('div', { class: 'suggest' }, SUGGESTIONS.slice(0, 4).map((sg) => el('button', { class: 'sugg', onclick: () => { $('#presetSel').value = sg.preset; $('#presetSel').dataset.next = sg.preset; $('#input').value = sg.text; autoGrow(); $('#input').focus(); updateSendBtn(); } }, el('span', {}, sg.icon), sg.text))));
}

function attachThumb(a) {
  const wrap = el('div', { class: 'att' + (a.kind === 'image' ? ' img' : '') , title: a.name });
  if (a.kind === 'image' || a.kind === 'video' || a.kind === 'audio') {
    blobs.get(a.blobId).then((b) => {
      if (!b) { wrap.append(el('span', {}, `${KIND_ICON[a.kind]} ${a.name} (missing)`)); return; }
      const url = URL.createObjectURL(b);
      if (a.kind === 'image') wrap.append(el('img', { src: url, alt: a.name, loading: 'lazy', onclick: () => window.open(url, '_blank') }));
      else if (a.kind === 'video') wrap.append(el('video', { src: url, controls: true, preload: 'metadata', playsinline: true }));
      else wrap.append(el('audio', { src: url, controls: true, preload: 'metadata' }));
    });
    if (a.kind !== 'image') wrap.append(el('div', { class: 'att-name' }, `${KIND_ICON[a.kind]} ${a.name}`));
  } else wrap.append(el('span', {}, `${KIND_ICON[a.kind] || '📎'} ${a.name}`), el('small', { class: 'muted' }, ' ' + fmtBytes(a.size)));
  return wrap;
}

function renderMsg(m) {
  const node = el('div', { class: `msg ${m.role}`, 'data-id': m.id });
  if (m.role === 'user') {
    const bubble = el('div', { class: 'bubble' });
    if (m.attachments && m.attachments.length) bubble.append(el('div', { class: 'atts' }, m.attachments.map(attachThumb)));
    if (m.text) bubble.append(el('div', { class: 'utext' }, m.text));
    node.append(bubble, el('div', { class: 'msg-actions' },
      actBtn('✏️', 'Edit', () => editMessage(m)),
      actBtn('📋', 'Copy', () => copyText(m.text).then(() => toast('Copied'))),
      actBtn('🧠', 'Remember this', () => remember(m.text)),
      actBtn('🗑️', 'Delete', () => deleteMessage(m))));
    return node;
  }
  const v = curVer(m);
  node.append(el('div', { class: 'avatar', 'aria-hidden': 'true' }, el('img', { src: 'icons/icon.svg', alt: '' })));
  const body = el('div', { class: 'mbody' });
  if (v.thoughts && settings().showThinking) body.append(el('details', { class: 'thoughts' }, el('summary', {}, '💭 Thoughts'), el('div', { class: 'md', html: renderMarkdown(v.thoughts) })));
  const acts0 = v.actions || extractActions(v.text || '');
  const md = el('div', { class: 'md' + (v.error ? ' err' : ''), html: v.error ? '' : renderMarkdown(linkCites(stripActions(v.text || ''), v.web)) });
  if (v.error) md.append(el('div', { class: 'error-box' }, '⚠️ ', v.error, ' ', el('button', { class: 'btn tiny', onclick: () => regenerate(m) }, 'Retry'), !providerReady() ? el('button', { class: 'btn tiny', onclick: () => (location.hash = '#/settings') }, 'Settings') : null));
  body.append(md);
  if (v.images && v.images.length) body.append(el('div', { class: 'atts gen' }, v.images.map(attachThumb)));
  if (acts0.length) body.append(el('div', { class: 'action-btns' }, acts0.map((a) => el('a', { class: 'btn primary open-btn', href: a.url, target: '_blank', rel: 'noopener noreferrer' }, '↗ Open ' + a.label))));
  if (v.stopped) body.append(el('div', { class: 'note' }, '⏹ Stopped'));
  for (const n of v.notes || []) body.append(el('div', { class: 'note' }, 'ℹ️ ' + n));
  const g = v.grounding;
  const links = [];
  if (g && g.groundingChunks) g.groundingChunks.forEach((c) => c.web && links.push({ uri: c.web.uri, title: c.web.title || c.web.uri }));
  if (g && g.urlContext && g.urlContext.urlMetadata) g.urlContext.urlMetadata.forEach((u) => links.push({ uri: u.retrievedUrl, title: (u.urlRetrievalStatus || '').includes('SUCCESS') ? u.retrievedUrl : `${u.retrievedUrl} (could not open)` }));
  if (v.web && v.web.results) v.web.results.forEach((r) => links.push({ uri: r.url, title: r.title || r.url }));
  if (links.length) body.append(el('div', { class: 'cites' }, el('span', { class: 'muted small' }, v.web ? `🌐 Sources (${v.web.provider}): ` : 'Sources: '), links.slice(0, 10).map((l, i) => el('a', { href: l.uri, target: '_blank', rel: 'noopener', class: 'cite' }, `${i + 1}. ${l.title.slice(0, 50)}`))));
  const acts = el('div', { class: 'msg-actions' });
  if (m.versions && m.versions.length > 1) {
    const i = m.vi ?? m.versions.length - 1;
    acts.append(el('span', { class: 'ver' }, actBtn('‹', 'Previous version', () => { m.vi = Math.max(0, i - 1); save(); rerender(m); }), el('span', { class: 'small' }, `${i + 1}/${m.versions.length}`), actBtn('›', 'Next version', () => { m.vi = Math.min(m.versions.length - 1, i + 1); save(); rerender(m); })));
  }
  if (v.text) {
    acts.append(actBtn('📋', 'Copy', () => copyText(v.text).then(() => toast('Copied'))));
    acts.append(actBtn('🔊', 'Read aloud', (e) => speak(v.text, e.currentTarget)));
    const code = extractCode(v.text);
    if (code.some((b) => ['html', 'htm', 'css', 'js', 'javascript', 'svg', 'jsx'].includes(b.lang))) acts.append(actBtn('▶️', 'Preview app', () => preview(v.text)));
    if (code.length) acts.append(actBtn('📦', 'Download all code', () => downloadCode(v.text)));
  }
  acts.append(actBtn('🔄', 'Regenerate', () => regenerate(m)), actBtn('🗑️', 'Delete', () => deleteMessage(m)));
  if (v.model) acts.append(el('span', { class: 'model-tag', title: 'Model that answered' }, v.model));
  body.append(acts);
  node.append(body);
  return node;
}
function actBtn(icon, label, fn) { return el('button', { class: 'act', title: label, 'aria-label': label, onclick: fn }, icon); }
function rerender(m) { const old = $(`.msg[data-id="${m.id}"]`); if (old) { const n = renderMsg(m); old.replaceWith(n); typesetMath(n); } }
function scrollBottom(force = false) {
  const box = $('#messages'); if (!box) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 160;
  if (force || near) box.scrollTop = box.scrollHeight;
}

// Delegated code-block buttons.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.code-btn'); if (!b) return;
  const block = b.closest('.code-block'); const code = block.querySelector('code').textContent; const lang = block.dataset.lang;
  if (b.dataset.act === 'copy') { await copyText(code); b.textContent = 'Copied ✓'; setTimeout(() => (b.textContent = 'Copy'), 1500); }
  else if (b.dataset.act === 'download') download(code, `code.${extFor(lang)}`);
  else if (b.dataset.act === 'preview') {
    const msgEl = b.closest('.msg'); const m = conv && conv.messages.find((x) => x.id === msgEl?.dataset.id);
    const full = m ? curText(m) : '';
    const blocks = extractCode(full).filter((x) => ['html', 'htm', 'css', 'js', 'javascript', 'svg', 'jsx', ''].includes(x.lang));
    if (blocks.length > 1 && blocks.some((x) => x.code === code || x.code.trim() === code.trim())) preview(full);
    else openPreview({ single: { lang, code, name: '' }, title: conv ? conv.title : 'Preview', onFix, onPush: (files) => pushDialog(files, conv ? conv.title : 'my-app') });
  }
});
function preview(text) { openPreview({ source: text, title: conv ? conv.title : 'Preview', onFix, onPush: (files) => pushDialog(files, conv ? conv.title : 'my-app') }); }
function onFix(errors) {
  $('#input').value = `The preview shows these errors. Please fix them and send the complete corrected code:\n\n${errors}`;
  autoGrow(); updateSendBtn(); send();
}
async function downloadCode(text) {
  const { filesFromBlocks, loadJSZip } = await import('./preview.js');
  const files = filesFromBlocks(extractCode(text));
  const names = Object.keys(files);
  if (names.length === 1) return download(files[names[0]], names[0]);
  const JSZip = await loadJSZip(); const z = new JSZip(); names.forEach((n) => z.file(n, files[n]));
  download(await z.generateAsync({ type: 'blob' }), 'code.zip');
}

// ---------------- composer ----------------
export function autoGrow() { const t = $('#input'); t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, innerHeight * 0.4) + 'px'; }
export function updateSendBtn() {
  const btn = $('#sendBtn'); if (!btn) return;
  if (busy) { btn.classList.add('stop'); btn.innerHTML = '■'; btn.title = 'Stop'; btn.setAttribute('aria-label', 'Stop generating'); btn.disabled = false; return; }
  btn.classList.remove('stop'); btn.innerHTML = '➤'; btn.title = 'Send'; btn.setAttribute('aria-label', 'Send message');
  btn.disabled = lock || !($('#input').value.trim() || pending.length);
}
function renderPending() {
  const box = $('#pending'); box.innerHTML = '';
  for (const p of pending) {
    const chip = el('div', { class: 'chip' + (p.kind === 'image' ? ' img' : '') });
    if (p.kind === 'image') { const u = URL.createObjectURL(p.blob); chip.append(el('img', { src: u, alt: '' })); }
    else chip.append(el('span', {}, KIND_ICON[p.kind] || '📎'));
    chip.append(el('span', { class: 'chip-name' }, p.name), el('button', { class: 'chip-x', 'aria-label': `Remove ${p.name}`, onclick: () => { pending = pending.filter((x) => x !== p); renderPending(); updateSendBtn(); } }, '✕'));
    box.append(chip);
  }
  box.style.display = pending.length ? '' : 'none';
}
export async function addAttachments(files) {
  for (const f of files) {
    if (f.size > MAX_ATTACH) { toast(`${f.name} is over 50 MB, too big.`, 'error'); continue; }
    const mime = guessMime(f.name, f.type);
    pending.push({ id: uid(), name: f.name || 'file', mime, size: f.size, kind: fileKind(f.name, mime), blob: f });
  }
  renderPending(); updateSendBtn();
}

export function initChat() {
  const input = $('#input');
  input.addEventListener('input', () => { autoGrow(); updateSendBtn(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && settings().sendOnEnter && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(); }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addAttachments(files); }
  });
  $('#sendBtn').addEventListener('click', () => (busy ? stop() : send()));
  $('#plusBtn').addEventListener('click', (e) => popMenu(e.currentTarget, [
    { label: '📎 Attach files / photos', act: async () => addAttachments(await pickFiles({ accept: '' })) },
    { label: '📷 Take a photo', act: async () => addAttachments(await pickFiles({ accept: 'image/*;capture=camera', multiple: false })) },
    { label: $('#webBtn').classList.contains('on') ? '🌐 Turn web search off' : '🌐 Search the web (free)', act: () => $('#webBtn').click() },
    { label: '📚 Add source (file, link, YouTube, GitHub)', act: () => openSources() },
    { label: '🎨 Create an image (free)', act: () => imageDialog() },
    { label: '🎬 Make a video…', act: () => { location.hash = '#/video/ai'; } },
  ]));
  $('#micBtn').addEventListener('click', toggleMic);
  $('#voiceModeBtn').addEventListener('click', () => setVoiceMode(!voiceMode));
  $('#voiceBar').addEventListener('click', (e) => { if (e.target.closest('#voiceStop')) return setVoiceMode(false); if (!voiceMode) return; if ($('#voiceBar').dataset.state === 'speaking' || $('#voiceBar').dataset.state === 'idle') { stopSpeaking(); listenFails = 0; startListening(true); } });
  setTimeout(startWake, 1000);
  $('#presetSel').addEventListener('change', async (e) => { $('#presetSel').dataset.next = e.target.value; if (conv) { conv.preset = e.target.value; await save(); } const p = presetById(e.target.value, settings().customPresets); toast(`${p.icon || '⭐'} ${p.name} mode`); });
  $('#webBtn').classList.toggle('on', !!settings().webSearch);
  $('#webBtn').addEventListener('click', () => { const on = !$('#webBtn').classList.contains('on'); $('#webBtn').classList.toggle('on', on); saveSettings({ webSearch: on }); toast(on ? '🌐 Web search on: Jarvis searches the web (free) and shows sources.' : 'Web search off', 'info', 4000); });
  $('#srcBtn').addEventListener('click', openSources);
  $('#chatSearch').addEventListener('input', (e) => refreshList(e.target.value));
  // Drag & drop files anywhere in the chat.
  const view = $('#view-chat');
  view.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); view.classList.add('drop'); } });
  view.addEventListener('dragleave', (e) => { if (e.target === view) view.classList.remove('drop'); });
  view.addEventListener('drop', (e) => { e.preventDefault(); view.classList.remove('drop'); addAttachments([...e.dataTransfer.files]); });
  onSettings((st, patch) => { updateModelChip(); if (patch && 'webSearch' in patch) $('#webBtn').classList.toggle('on', !!patch.webSearch); if (patch && 'wakeWord' in patch) { if (patch.wakeWord) startWake(); else stopWake(); } });
  refreshList();
}

// ---------------- sending ----------------
function systemPrompt() {
  const s = settings();
  const p = presetById(conv?.preset || 'general', s.customPresets);
  const parts = [BASE_SYSTEM];
  if (p.prompt) parts.push(`Mode: ${p.name}. ${p.prompt}`);
  if (s.systemPrompt) parts.push(`User's custom instructions:\n${s.systemPrompt}`);
  if (conv?.system) parts.push(`Instructions for this chat:\n${conv.system}`);
  if (s.memoryOn && s.memory && s.memory.length) parts.push(`Things the user asked you to remember:\n${s.memory.map((m) => '- ' + m.text).join('\n')}`);
  parts.push('Browser actions: this app can open websites in a new browser tab (nothing else on the computer). If the user asks you to open a website or search something on a site, add a line exactly like [[open: https://full-url | Short label]] (for example [[open: https://www.youtube.com/results?search_query=lofi | YouTube: lofi]]) and say you are opening it. Never claim you can control other apps or files.');
  parts.push(`Today is ${new Date().toDateString()}.`);
  return parts.join('\n\n');
}

async function attParts(a) {
  if (a.kind === 'text') {
    const b = await blobs.get(a.blobId);
    const t = b ? await b.text() : '[file missing]';
    return { text: `--- File: ${a.name} ---\n${t.length > 400000 ? t.slice(0, 400000) + '\n…[truncated]' : t}\n--- End of ${a.name} ---` };
  }
  if (a.kind === 'other') return { text: `[Attached file "${a.name}" (${a.mime}) — this file type can't be read by the AI.]` };
  const b = await blobs.get(a.blobId);
  return { file: { blob: b, mime: a.mime, name: a.name, kind: a.kind, size: a.size, uri: a.uri, uriExpires: a.uriExpires, ref: a } };
}
async function sourceParts() {
  const out = [];
  const srcs = (conv.sources || []).filter((s) => s.enabled !== false);
  if (!srcs.length) return out;
  out.push({ text: `The user added ${srcs.length} source(s) to this chat. Use them to answer:` });
  for (const s of srcs) {
    if (s.type === 'text' || (s.type === 'github') || (s.type === 'link' && s.text)) out.push({ text: `--- Source: ${s.name}${s.url ? ` (${s.url})` : ''} ---\n${s.text || ''}\n--- End of source ---` });
    else if (s.type === 'link') out.push({ link: s.url });
    else if (s.type === 'youtube') { out.push({ text: `--- Source: YouTube video ${s.url} ---` }); out.push({ youtube: s.url }); }
    else if (s.type === 'file') {
      if (s.kind === 'text') { const b = await blobs.get(s.blobId); out.push({ text: `--- Source: ${s.name} ---\n${b ? await b.text() : '[missing]'}\n--- End of source ---` }); }
      else { out.push({ text: `--- Source: ${s.name} ---` }); out.push(await attParts(s)); }
    }
  }
  return out;
}
async function buildTurns(uptoIdx) {
  const turns = [];
  const msgs = conv.messages.slice(0, uptoIdx + 1);
  const lastUser = msgs.map((m) => m.role).lastIndexOf('user');
  const oai = settings().provider !== 'gemini';
  const start = oai ? Math.max(0, msgs.length - 40) : 0;
  for (let i = start; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'user') {
      const parts = [];
      if (i === lastUser) parts.push(...(await sourceParts()));
      for (const a of m.attachments || []) parts.push(await attParts(a));
      parts.push({ text: m.text || (m.attachments?.length ? 'Please look at the attached file(s).' : '') });
      turns.push({ role: 'user', parts });
    } else {
      const v = curVer(m);
      if (v.error || !v.text) continue;
      turns.push({ role: 'model', parts: [{ text: v.text }] });
    }
  }
  // Merge consecutive same-role turns (APIs require alternation).
  const merged = [];
  for (const t of turns) { const last = merged[merged.length - 1]; if (last && last.role === t.role) last.parts.push(...t.parts); else merged.push(t); }
  return merged;
}

let lock = false;
export async function send(textOverride) {
  if (busy || lock) return;
  lock = true;
  try { await sendInner(textOverride); } finally { lock = false; updateSendBtn(); }
}
async function sendInner(textOverride) {
  const input = $('#input');
  const text = (textOverride ?? input.value).trim();
  if (!text && !pending.length) return;
  if (/^\/image\s+/i.test(text)) { input.value = ''; autoGrow(); updateSendBtn(); return createImage(text.replace(/^\/image\s+/i, '')); }
  const cmd = !pending.length && parseCommand(text);
  if (cmd) { input.value = ''; autoGrow(); updateSendBtn(); return runCommand(text, cmd); }
  if (!providerReady()) { toast('Add your free Gemini API key first.', 'error'); location.hash = '#/settings'; return; }
  await ensureConv();
  const atts = [];
  for (const p of pending) { const blobId = 'b_' + uid(); await blobs.put(blobId, p.blob); atts.push({ id: p.id, name: p.name, mime: p.mime, size: p.size, kind: p.kind, blobId }); }
  pending = []; renderPending();
  const um = { id: uid(), role: 'user', text, attachments: atts, ts: Date.now() };
  if (!conv.messages.length) conv.title = (text || atts[0]?.name || 'New chat').replace(/\s+/g, ' ').slice(0, 60);
  conv.messages.push(um);
  input.value = ''; autoGrow();
  await save(); setTitle(); refreshList();
  if ($('#messages .empty')) $('#messages').innerHTML = '';
  $('#messages').append(renderMsg(um));
  scrollBottom(true);
  await runModel(conv.messages.length - 1);
}

// Turn [1], [2] in an answer into links to the web search results they cite.
function linkCites(text, web) {
  if (!web || !web.results || !web.results.length) return text;
  return text.replace(/\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\](?!\()/g, (m, list) => {
    const ns = list.split(/\s*,\s*/); if (!ns.every((n) => web.results[+n - 1])) return m;
    return ns.map((n) => `[[${n}]](${web.results[+n - 1].url})`).join('');
  });
}

async function runModel(userIdx, existing = null) {
  const m = existing || { id: uid(), role: 'model', versions: [], vi: 0, ts: Date.now() };
  const v = { text: '', thoughts: '', model: '', notes: [] };
  m.versions.push(v); m.vi = m.versions.length - 1;
  if (!existing) conv.messages.splice(userIdx + 1, 0, m);
  const ctrl = new AbortController();
  busy = { ctrl, msgId: m.id }; updateSendBtn();
  // Placeholder with typing dots.
  let node = $(`.msg[data-id="${m.id}"]`);
  const fresh = renderMsg(m); fresh.classList.add('streaming');
  if (node) node.replaceWith(fresh); else $('#messages').append(fresh);
  node = fresh;
  const mdEl = node.querySelector('.md'); mdEl.innerHTML = '<div class="typing"><i></i><i></i><i></i></div>';
  const status = el('div', { class: 'note status' }); node.querySelector('.mbody').insertBefore(status, node.querySelector('.msg-actions'));
  let thoughtsEl = null, raf = 0;
  const paint = () => {
    raf = 0;
    if (v.text) mdEl.innerHTML = renderMarkdown(stripActions(v.text), { streaming: true });
    if (v.thoughts && settings().showThinking) {
      if (!thoughtsEl) { thoughtsEl = el('details', { class: 'thoughts', open: true }, el('summary', {}, '💭 Thinking…'), el('div', { class: 'md' })); node.querySelector('.mbody').prepend(thoughtsEl); }
      thoughtsEl.querySelector('.md').textContent = v.thoughts;
    }
    scrollBottom();
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };
  try {
    const turns = await buildTurns(userIdx);
    const webOn = $('#webBtn').classList.contains('on');
    const searchNotes = [];
    if (webOn && !settings().googleGrounding) {
      const q = searchQuery(conv.messages.slice(0, userIdx + 1).filter((x) => x.role === 'user').map((x) => x.text || ''));
      if (q) {
        status.textContent = '🔎 Searching the web…';
        try {
          const sr = await webSearch(q, { signal: ctrl.signal });
          const lastUser = [...turns].reverse().find((t) => t.role === 'user');
          if (lastUser) lastUser.parts.push({ text: sourcesBlock(q, sr) });
          v.web = { provider: sr.provider, query: q, results: sr.results.map((x) => ({ title: x.title, url: x.url })) };
          searchNotes.push(...sr.notes);
          status.textContent = `🌐 Read ${sr.results.length} web results, thinking…`;
        } catch (e) {
          if (e.name === 'AbortError') throw e;
          searchNotes.push(`Web search didn’t work this time (${e.message}), so this answer is from the AI’s own knowledge.`);
        }
      }
    }
    const r = await aiChat(turns, {
      system: systemPrompt(), signal: ctrl.signal, webSearch: webOn, googleGrounding: !!settings().googleGrounding,
      onText: (t) => { v.text = t; status.textContent = ''; schedule(); },
      onThought: (t) => { v.thoughts = t; schedule(); },
      onStatus: (s) => { status.textContent = s; },
      onModel: (mm) => { v.model = mm; },
      onUploaded: (f) => { if (f.ref) { f.ref.uri = f.uri; f.ref.uriExpires = f.uriExpires; } },
    });
    v.text = r.text; v.thoughts = r.thoughts || v.thoughts; v.model = r.model || v.model; v.notes = [...searchNotes, ...(r.notes || [])]; v.grounding = r.grounding || null;
    if (r.finish === 'MAX_TOKENS') v.notes.push('The answer hit the length limit. Say "continue" to get the rest.');
  } catch (e) {
    if (e.name === 'AbortError') { v.stopped = true; if (!v.text) v.text = ''; }
    else { console.warn('AI error', e); v.error = friendlyError(e); }
  } finally {
    if (raf) cancelAnimationFrame(raf);
    busy = null; updateSendBtn();
    if (!v.text && v.stopped && !v.thoughts) { v.error = 'Stopped before any answer.'; delete v.stopped; }
    await save();
    rerender(m); scrollBottom();
    refreshList();
    const acts = extractActions(v.text || '');
    if (acts.length && !v.stopped) tryOpen(acts[0]);
    if (voiceMode && v.text) { setVoice('speaking'); speak(stripActions(v.text), null, () => { if (voiceMode) startListening(true); }); } else if (voiceMode) startListening(true);
    else setTimeout(startWake, 800);
  }
}
export function stop() { if (busy) busy.ctrl.abort(); }

// ---------------- browser actions ----------------
function tryOpen(a) {
  const ok = openTab(a.url);
  if (ok) toast(`Opening ${a.label}…`);
  else {
    const t = toast(el('span', {}, 'Your browser blocked the new tab. ', el('a', { class: 'btn primary tiny', href: a.url, target: '_blank', rel: 'noopener noreferrer', id: 'popupFallback', onclick: () => t.remove() }, `↗ Open ${a.label}`)), 'info', 15000);
  }
  return ok;
}
async function runCommand(text, cmd) {
  // Open first, while the tap/Enter still counts as a user action (avoids popup blockers).
  const ok = openTab(cmd.url);
  await ensureConv();
  const um = { id: uid(), role: 'user', text, attachments: [], ts: Date.now() };
  if (!conv.messages.length) conv.title = text.slice(0, 60);
  const m = { id: uid(), role: 'model', versions: [{ text: ok ? `Opening **${cmd.label}** in a new tab ↗` : `Your browser blocked the new tab. Tap the button to open **${cmd.label}**.`, actions: [{ url: cmd.url, label: cmd.label }], model: 'browser action', notes: [] }], vi: 0, ts: Date.now() };
  conv.messages.push(um, m);
  await save(); setTitle(); refreshList();
  if ($('#messages .empty')) $('#messages').innerHTML = '';
  $('#messages').append(renderMsg(um), renderMsg(m)); scrollBottom(true);
  if (ok) toast(`Opening ${cmd.label}…`);
  else tryOpen(cmd);
  if (!voiceMode) setTimeout(startWake, 800); // keep listening for “Hey Jarvis” after a command
  if (voiceMode) { setVoice('speaking'); speak(ok ? `Opening ${cmd.label}` : `Tap the button to open ${cmd.label}`, null, () => voiceMode && startListening(true)); }
}

async function regenerate(m) {
  if (busy) return;
  const idx = conv.messages.indexOf(m);
  const userIdx = conv.messages.slice(0, idx).map((x) => x.role).lastIndexOf('user');
  if (userIdx < 0) return;
  // drop failed versions so the history stays clean
  m.versions = m.versions.filter((x) => !x.error);
  await runModel(userIdx, m);
}
async function editMessage(m) {
  if (busy) return;
  const t = await prompt('Edit message', m.text, { multiline: true, okLabel: 'Save & resend' });
  if (t == null || !t.trim()) return;
  const idx = conv.messages.indexOf(m);
  m.text = t.trim();
  conv.messages = conv.messages.slice(0, idx + 1);
  await save(); renderMessages();
  await runModel(idx);
}
async function deleteMessage(m) {
  if (busy) return;
  const idx = conv.messages.indexOf(m);
  // Deleting a question also deletes its answer.
  const n = m.role === 'user' && conv.messages[idx + 1]?.role === 'model' ? 2 : 1;
  conv.messages.splice(idx, n); await save(); renderMessages();
}
async function remember(text) {
  const t = await prompt('Save to memory', text.slice(0, 300), { multiline: true, okLabel: 'Remember' });
  if (!t || !t.trim()) return;
  saveSettings({ memory: [...(settings().memory || []), { id: uid(), text: t.trim() }] });
  toast('🧠 Saved to memory (Settings → Memory)');
}

// ---------------- images ----------------
async function imageDialog() {
  const t = await prompt('Create an image', '', { placeholder: 'e.g. a futuristic Bengaluru skyline at night, digital art', okLabel: 'Create' });
  if (t && t.trim()) createImage(t.trim());
}
async function createImage(p) {
  await ensureConv();
  const um = { id: uid(), role: 'user', text: `/image ${p}`, attachments: [], ts: Date.now() };
  if (!conv.messages.length) conv.title = `Image: ${p}`.slice(0, 60);
  conv.messages.push(um);
  const m = { id: uid(), role: 'model', versions: [{ text: '', model: 'Pollinations (free images)', notes: [] }], vi: 0, ts: Date.now() };
  conv.messages.push(m);
  if ($('#messages .empty')) $('#messages').innerHTML = '';
  $('#messages').append(renderMsg(um));
  const node = renderMsg(m); node.querySelector('.md').innerHTML = '<div class="typing"><i></i><i></i><i></i></div> <span class="muted small">Painting… (10–30 s)</span>'; $('#messages').append(node); scrollBottom(true);
  const v = m.versions[0];
  try {
    const b = await generateImage(p);
    const blobId = 'b_' + uid(); await blobs.put(blobId, b);
    v.images = [{ id: uid(), name: 'image.' + (b.type.split('/')[1] || 'jpg'), mime: b.type, size: b.size, kind: 'image', blobId }];
    v.text = `Here's your image for: *${p}*`;
    v.notes = ['Made with the free Pollinations.ai image service (no key needed). Tap the image to open it full size.'];
  } catch (e) { v.error = friendlyError(e); }
  await save(); rerender(m); refreshList(); scrollBottom(true);
}

// ---------------- speech ----------------
let speakingBtn = null, audioEl = null;
function plainForSpeech(t) { return t.replace(/```[\s\S]*?```/g, ' (code block) ').replace(/[#*_`>|~]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/\$+([^$]+)\$+/g, '$1').replace(/\n+/g, '. ').slice(0, 6000); }
export async function speak(text, btn, onEnd) {
  const s = settings();
  const prev = speakingBtn;
  if (speakingBtn || (window.speechSynthesis && speechSynthesis.speaking) || audioEl) { stopSpeaking(); if (btn && btn === prev) return; }
  speakingBtn = btn; btn && (btn.textContent = '⏹');
  const done = () => { if (btn) btn.textContent = '🔊'; speakingBtn = null; audioEl = null; onEnd && onEnd(); };
  const t = plainForSpeech(text);
  if (s.ttsEngine === 'gemini') {
    try {
      const wav = await geminiTTS(t.slice(0, 3000));
      audioEl = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
      audioEl.onended = done; audioEl.onerror = done; await audioEl.play(); return;
    } catch (e) { toast('Gemini voice failed (' + friendlyError(e) + '). Using the phone voice.', 'error'); }
  }
  if (!window.speechSynthesis) { toast('Read-aloud is not supported in this browser.', 'error'); done(); return; }
  const chunks = t.match(/[^.!?]+[.!?]*\s*/g) || [t];
  const voices = speechSynthesis.getVoices();
  const voice = voices.find((v) => v.name === s.ttsVoice) || voices.find((v) => /en-IN/i.test(v.lang)) || null;
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c); if (voice) u.voice = voice; u.rate = s.ttsRate || 1;
    if (i === chunks.length - 1) { u.onend = done; u.onerror = done; }
    speechSynthesis.speak(u);
  });
}
export function stopSpeaking() { try { speechSynthesis.cancel(); } catch {} if (audioEl) { audioEl.pause(); audioEl = null; } if (speakingBtn) speakingBtn.textContent = '🔊'; speakingBtn = null; }

let rec = null, recording = null, wakeRec = null, listenFails = 0;
// Feature detection only (no user-agent checks): Chrome and Edge both expose webkitSpeechRecognition.
const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const speechSupported = () => !!SR();
let wakeNetFails = 0, wakeTimer = 0, recLang = '';
const isEdge = () => /\bEdg\//.test(navigator.userAgent) || !!(navigator.userAgentData && navigator.userAgentData.brands.some((b) => /Edge/i.test(b.brand))); // wording only
function speechLang() { return recLang || settings().voiceLang || 'en-IN'; }
function netHelp() {
  return isEdge()
    ? 'Edge couldn’t reach its online speech service. Check your internet, and on Windows turn on Settings → Privacy & security → Speech → Online speech recognition.'
    : 'The browser couldn’t reach its online speech service. Check your internet connection. (Voice typing works in Chrome and Edge; Brave and Opera block it.)';
}
function setVoice(state) {
  const bar = $('#voiceBar'); if (!bar) return;
  const on = voiceMode || state === 'wake';
  bar.style.display = on && state !== 'off' ? '' : 'none';
  bar.dataset.state = state;
  $('#voiceState').textContent = { listening: '🎙️ Listening… speak now', thinking: '🤔 Thinking…', speaking: '🔊 Speaking… tap to interrupt', wake: '👂 Say “Hey Jarvis”…', idle: '🎧 Voice chat on' }[state] || '';
  $('#voiceModeBtn')?.classList.toggle('on', voiceMode);
}
export function setVoiceMode(on) {
  if (on && !SR()) { toast('Voice chat needs Chrome / Edge: this browser has no speech recognition. You can still record voice notes with the mic.', 'error', 7000); return; }
  voiceMode = on; listenFails = 0;
  if (on) { stopWake(); toast('🎧 Voice chat on: speak, Jarvis answers out loud'); if (!busy) startListening(true); else setVoice('thinking'); }
  else { stopListening(); stopSpeaking(); setVoice('off'); toast('Voice chat off'); startWake(); }
}
function toggleMic() { if (rec || recording) stopListening(); else startListening(false); }
function startListening(autoSend) {
  const Rec = SR(); const btn = $('#micBtn');
  if (!Rec) return recordVoiceNote();
  if (rec) return;
  stopWake(); stopSpeaking();
  try {
    rec = new Rec(); rec.lang = settings().voiceLang || 'en-IN'; rec.interimResults = true; rec.continuous = !autoSend; rec.maxAlternatives = 1;
    const base = autoSend ? '' : ($('#input').value ? $('#input').value + ' ' : '');
    let finalText = '', errored = '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; }
      $('#input').value = base + finalText + interim; autoGrow(); updateSendBtn();
    };
    rec.lang = speechLang();
    rec.onerror = (e) => {
      errored = e.error;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast(e.error === 'service-not-allowed' ? 'Speech recognition is turned off in this browser. ' + netHelp() : 'Microphone blocked. Click the 🔒/mic icon in the address bar → Allow microphone, then try again.', 'error', 9000); if (voiceMode) { voiceMode = false; setVoice('off'); } }
      else if (e.error === 'network') { toast(netHelp(), 'error', 9000); if (voiceMode) { voiceMode = false; setVoice('off'); } }
      else if (e.error === 'language-not-supported' && speechLang() !== 'en-US') { recLang = 'en-US'; toast('This browser doesn’t support that voice language, switched to English (US).', 'info'); }
      else if (e.error === 'audio-capture') { toast('No microphone found. Plug one in or check your sound settings.', 'error', 7000); if (voiceMode) { voiceMode = false; setVoice('off'); } }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Voice input stopped (' + e.error + '). Tap the mic to try again.', 'error');
    };
    rec.onend = () => {
      btn.classList.remove('rec'); rec = null;
      if (autoSend && finalText.trim()) { listenFails = 0; if (voiceMode) setVoice('thinking'); send(); return; }
      if (voiceMode && !busy && !['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'aborted'].includes(errored)) { if (++listenFails < 8) setTimeout(() => voiceMode && !busy && startListening(true), 300); else { setVoice('idle'); toast('Voice chat paused (no speech heard). Tap the bar to listen again.'); } return; }
      if (!voiceMode) startWake();
    };
    rec.start(); btn.classList.add('rec');
    if (voiceMode) setVoice('listening');
  } catch (e) { toast('Voice input not available: ' + e.message, 'error'); rec = null; }
}
function stopListening() { try { rec && rec.abort(); } catch {} rec = null; $('#micBtn')?.classList.remove('rec'); if (recording) recording.stop(); }
// "Hey Jarvis" wake phrase: continuous listening while the page is open and visible (off by default).
export function startWake() {
  if (!settings().wakeWord || voiceMode || rec || wakeRec || !SR() || document.hidden) return;
  try {
    const Rec = SR(); const r = new Rec(); wakeRec = r;
    r.lang = speechLang(); r.continuous = true; r.interimResults = false;
    let werr = '';
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const said = e.results[i][0].transcript;
        const m = matchWake(said);
        if (m) {
          stopWake();
          const rest = m[1].trim();
          if (rest) { $('#input').value = rest; send(); }
          else { voiceMode = true; listenFails = 0; startListening(true); }
          return;
        }
      }
    };
    r.onresult = ((orig) => (e) => { wakeNetFails = 0; orig(e); })(r.onresult);
    r.onerror = (e) => {
      werr = e.error;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { toast('“Hey Jarvis” needs the microphone. Click the 🔒/mic icon in the address bar → Allow, then turn it on again in Settings.', 'error', 9000); wakeRec = null; setVoice('off'); }
      else if (e.error === 'audio-capture') { toast('“Hey Jarvis”: no microphone found.', 'error'); wakeRec = null; setVoice('off'); }
      else if (e.error === 'language-not-supported' && speechLang() !== 'en-US') recLang = 'en-US';
      else if (e.error === 'network') wakeNetFails++;
    };
    // Chrome and Edge end continuous recognition on their own (silence, ~60 s, network blips): restart it.
    r.onend = () => {
      const was = wakeRec === r; wakeRec = null;
      if (!was) return;
      if (werr === 'network' && wakeNetFails >= 4) { setVoice('off'); toast('“Hey Jarvis” paused: ' + netHelp(), 'error', 10000); wakeNetFails = 0; return; }
      const delay = werr === 'network' ? Math.min(1500 * 2 ** wakeNetFails, 8000) : 300;
      clearTimeout(wakeTimer); wakeTimer = setTimeout(startWake, delay);
    };
    r.start(); setVoice('wake');
  } catch { wakeRec = null; }
}
export function stopWake() { clearTimeout(wakeTimer); const r = wakeRec; wakeRec = null; try { r && r.abort(); } catch {} if (!voiceMode) setVoice('off'); }
// Edge and Chrome hear "Jarvis" in a few ways; accept the common mishearings.
export function matchWake(said) {
  return /\b(?:hey|hi|hello|ok|okay|hay|he)[\s,]+(?:jarvis|jarvi|jarves|jervis|javis|jarvees|charvis)\b[\s,.!?]*(.*)$/i.exec(String(said || ''));
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopWake(); else startWake(); });
async function recordVoiceNote() {
  // Browsers without speech recognition: record a voice note and send it to the AI as audio.
  const btn = $('#micBtn');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream); const chunks = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = () => { stream.getTracks().forEach((t) => t.stop()); btn.classList.remove('rec'); recording = null; const type = (mr.mimeType || 'audio/webm').split(';')[0]; const b = new Blob(chunks, { type }); addAttachments([new File([b], `voice-note.${type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'}`, { type })]); toast('Voice note attached. Press send.'); };
    mr.start(); recording = mr; btn.classList.add('rec'); toast('Recording… tap the mic again to stop');
  } catch (e) { toast('Microphone not available: ' + e.message, 'error'); }
}

// ---------------- sources panel ----------------
export function openSources() { $('#sourcesPanel').classList.add('open'); document.body.classList.add('sources-open'); renderSources(); }
export function closeSources() { $('#sourcesPanel').classList.remove('open'); document.body.classList.remove('sources-open'); }
function renderSources() {
  const box = $('#srcList'); if (!box) return;
  box.innerHTML = '';
  const srcs = conv?.sources || [];
  if (!srcs.length) box.append(el('div', { class: 'muted small pad' }, 'No sources yet. Add PDFs, notes, code, images, videos, web pages or YouTube links. Jarvis will answer using them in this chat.'));
  for (const s of srcs) {
    const icon = s.type === 'file' ? KIND_ICON[s.kind] : KIND_ICON[s.type] || '📄';
    const tg = el('input', { type: 'checkbox', checked: s.enabled !== false, title: 'Use this source', 'aria-label': `Use ${s.name}` });
    tg.addEventListener('change', async () => { s.enabled = tg.checked; await save(); });
    box.append(el('div', { class: 'src-item' }, tg, el('span', { class: 'src-icon' }, icon),
      el('div', { class: 'src-meta' }, el('div', { class: 'src-name', title: s.url || s.name }, s.name), el('div', { class: 'muted small' }, s.detail || (s.size ? fmtBytes(s.size) : s.url || ''))),
      el('button', { class: 'icon-btn', 'aria-label': `Remove ${s.name}`, onclick: async () => { conv.sources = conv.sources.filter((x) => x !== s); if (s.blobId) blobs.del(s.blobId).catch(() => {}); await save(); renderSources(); setTitle(); } }, '✕')));
  }
  setTitle();
}
export async function addSource(src) {
  await ensureConv();
  conv.sources = conv.sources || [];
  conv.sources.push({ id: uid(), enabled: true, added: Date.now(), ...src });
  await save(); renderSources(); setTitle(); refreshList();
}
export async function addFileSources(files) {
  for (const f of files) {
    if (f.size > MAX_ATTACH) { toast(`${f.name} is over 50 MB.`, 'error'); continue; }
    const mime = guessMime(f.name, f.type); const kind = fileKind(f.name, mime);
    const blobId = 'b_' + uid(); await blobs.put(blobId, f);
    await addSource({ type: 'file', name: f.name, mime, kind, size: f.size, blobId });
  }
  if (files.length) toast(`Added ${files.length} source${files.length > 1 ? 's' : ''}`);
}
export async function addLinkSource(url) {
  url = url.trim();
  if (!isUrl(url)) { toast('That is not a valid link (must start with http:// or https://).', 'error'); return; }
  if (youtubeId(url)) {
    await addSource({ type: 'youtube', name: 'YouTube: ' + youtubeId(url), url, detail: 'Gemini watches the video (public videos only)' });
    toast('YouTube video added'); return;
  }
  const t = toast('Reading page…', 'info', 30000);
  let text = '', detail = '';
  try { text = await readWebPage(url); const title = /^Title:\s*(.+)$/m.exec(text); detail = `${(text.length / 1000).toFixed(0)}k chars read`; await addSource({ type: 'link', name: title ? title[1].slice(0, 80) : url, url, text, detail }); }
  catch (e) { await addSource({ type: 'link', name: url, url, detail: 'Gemini will open this link itself' }); }
  t.remove(); toast('Link added');
}
export function initSources() {
  $('#srcClose').addEventListener('click', closeSources);
  $('#srcAddFile').addEventListener('click', async () => addFileSources(await pickFiles()));
  $('#srcAddLink').addEventListener('click', async () => { const u = await prompt('Add a web page or YouTube link', '', { placeholder: 'https://…', okLabel: 'Add' }); if (u) addLinkSource(u); });
  $('#srcAddText').addEventListener('click', async () => {
    const t = await prompt('Paste text as a source', '', { multiline: true, placeholder: 'Notes, article text, code…', okLabel: 'Add' });
    if (t && t.trim()) addSource({ type: 'text', name: t.trim().split('\n')[0].slice(0, 50) || 'Pasted text', text: t, size: t.length });
  });
  $('#srcAddGithub').addEventListener('click', () => { location.hash = '#/connectors'; toast('Pick a repository file and tap "Add to chat"'); });
}
