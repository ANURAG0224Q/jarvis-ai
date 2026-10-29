// Video Editor: trim, split, reorder, speed, crop/aspect, titles, text, music -> MP4/WebM, all on device.
import { el, $, $$, uid, toast, download, pickFiles, fmtTime, fmtBytes, clamp, confirm } from '../util.js';
import { blobs, kv } from '../store.js';
import { exportVideo, recordRealtime, decodeAudio, mixAudio, makeMixer, sizeFor, MAX_SECONDS, probeMedia, FrameSource, drawFit } from './engine.js';
import { fit } from './scenes.js';

const FPS = 30;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
let P = null;          // project
let sel = null;        // {kind:'clip'|'text'|'music', id}
let root = null, cv = null, cx = null;
let playhead = 0, playing = false, t0 = 0, tStart = 0, raf = 0;
const vids = new Map(), bmps = new Map();
let musicEl = null, abortCtl = null, pxPerSec = 40;

const NEW = () => ({ aspect: '16:9', quality: '720', clips: [], texts: [], music: null, customLen: null, media: {} });
async function load() { if (!P) P = { ...NEW(), ...((await kv.get('editor')) || {}) }; return P; }
let saveT = 0; function save() { clearTimeout(saveT); saveT = setTimeout(() => kv.put('editor', P).catch(() => {}), 250); }

export const clipDur = (c) => (c.type === 'video' ? Math.max(0.05, (c.out - c.in) / (c.speed || 1)) : Math.max(0.1, +c.dur || 3));
export function segments(proj = P) { let t = 0; return proj.clips.map((c) => { const d = clipDur(c); const s = { clip: c, start: t, end: t + d }; t += d; return s; }); }
export const totalDur = (proj = P) => proj.clips.reduce((a, c) => a + clipDur(c), 0);
export const exportLen = (proj = P) => Math.min(MAX_SECONDS, proj.customLen ? +proj.customLen : totalDur(proj));
const size = () => sizeFor(P.aspect, P.quality === '1080' ? '1080' : P.quality === '480' ? '480' : '720');

export async function renderEditor(container) {
  await load(); root = container; root.innerHTML = '';
  const { w, h } = sizeFor(P.aspect, '480');
  cv = el('canvas', { id: 'edCanvas', width: w, height: h }); cx = cv.getContext('2d');
  const scrub = el('input', { type: 'range', id: 'edScrub', min: 0, max: Math.max(0.1, totalDur()), step: 0.01, value: playhead, 'aria-label': 'Seek' });
  scrub.addEventListener('input', () => { pause(); seek(+scrub.value); });
  const aspect = el('select', { id: 'edAspect', 'aria-label': 'Aspect ratio' }, ...[['16:9', '16:9 landscape'], ['9:16', '9:16 vertical'], ['1:1', '1:1 square'], ['4:5', '4:5 portrait']].map(([v, l]) => el('option', { value: v }, l)));
  aspect.value = P.aspect; aspect.addEventListener('change', () => { P.aspect = aspect.value; save(); renderEditor(root); });
  root.append(el('div', { class: 'ed' },
    el('div', { class: 'ed-main' },
      el('div', { class: 'ed-stage' }, cv, el('div', { class: 'ed-empty', id: 'edEmpty' }, '🎬 Add videos, photos or a title to start')),
      el('div', { class: 'ed-transport' },
        el('button', { class: 'icon-btn', 'aria-label': 'Go to start', onclick: () => { pause(); seek(0); } }, '⏮'),
        el('button', { class: 'btn primary', id: 'edPlay', onclick: () => (playing ? pause() : play()) }, '▶'),
        el('span', { class: 'mono small', id: 'edTime' }, '0:00.0 / 0:00.0'), scrub)),
    el('div', { class: 'ed-tools' },
      el('button', { class: 'btn', id: 'edAddMedia', onclick: addMedia }, '＋ Media'),
      el('button', { class: 'btn', id: 'edAddTitle', onclick: addTitle }, '＋ Title card'),
      el('button', { class: 'btn', id: 'edAddText', onclick: addText }, '＋ Text'),
      el('button', { class: 'btn', id: 'edAddMusic', onclick: addMusic }, '🎵 Music'),
      el('button', { class: 'btn', id: 'edSplit', onclick: split, title: 'Split the clip at the playhead' }, '✂ Split'),
      aspect,
      el('button', { class: 'btn primary', id: 'edExport', onclick: exportDialog }, '⬇ Export'),
      el('button', { class: 'btn tiny danger', onclick: async () => { if (await confirm('Start a new project?', 'All clips on the timeline will be removed.', 'New project')) { for (const id of Object.keys(P.media)) blobs.del(id).catch(() => {}); P = NEW(); save(); sel = null; playhead = 0; renderEditor(root); } } }, 'New')),
    el('div', { class: 'ed-warn', id: 'edWarn' }),
    el('div', { class: 'ed-timeline', id: 'edTimeline' }),
    el('div', { class: 'ed-zoom row small' }, 'Zoom ', el('input', { type: 'range', min: 8, max: 160, value: pxPerSec, oninput: (e) => { pxPerSec = +e.target.value; drawTimeline(); } })),
    el('div', { class: 'card ed-props', id: 'edProps' }),
    el('div', { id: 'edOut' })));
  drawTimeline(); drawProps(); seek(Math.min(playhead, totalDur()));
}

// ---------- media ----------
async function addMedia() { const fs = await pickFiles({ accept: 'video/*,image/*,audio/*' }); for (const f of fs) await importFile(f); }
export async function importFile(file, { toTimeline = true } = {}) {
  await load();
  const t = toast(`Importing ${file.name}…`, 'info', 60000);
  try {
    const mime = file.type || (/\.(mp4|mov|m4v)$/i.test(file.name) ? 'video/mp4' : /\.webm$/i.test(file.name) ? 'video/webm' : '');
    const blob = file.type ? file : new Blob([file], { type: mime });
    const info = await probeMedia(blob);
    const id = 'med_' + uid(); await blobs.put(id, blob);
    const m = { id, name: file.name, type: info.kind, duration: info.duration, width: info.width || 0, height: info.height || 0, webcodecs: !!info.webcodecs, hasAudio: !!info.hasAudio };
    if (info.kind === 'image') { bmps.set(id, info.bitmap); m.thumb = await thumbOf(info.bitmap); }
    if (info.kind === 'video') m.thumb = await videoThumb(blob).catch(() => '');
    P.media[id] = m;
    if (info.kind === 'audio') { P.music = { mediaId: id, volume: 0.5, offset: 0, fadeOut: true }; sel = { kind: 'music', id }; toast('Music added'); }
    else if (toTimeline) {
      const c = info.kind === 'video' ? { id: uid(), type: 'video', mediaId: id, in: 0, out: info.duration, speed: 1, volume: 1, muted: false, fit: 'cover', fade: false }
        : { id: uid(), type: 'image', mediaId: id, dur: 4, fit: 'cover', zoom: true, fade: true };
      P.clips.push(c); sel = { kind: 'clip', id: c.id };
    }
    save(); t.remove();
    if (root && root.isConnected) { drawTimeline(); drawProps(); seek(playhead); }
    return m;
  } catch (e) { t.remove(); toast(`${file.name}: ${e.message}`, 'error', 7000); return null; }
}
async function thumbOf(src) { const c = document.createElement('canvas'); c.width = 160; c.height = 90; drawFit(c.getContext('2d'), src, 160, 90, 'cover'); return c.toDataURL('image/jpeg', 0.6); }
function videoThumb(blob) {
  return new Promise((res, rej) => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(blob);
    v.onloadeddata = () => { v.currentTime = Math.min(0.5, v.duration / 3); };
    v.onseeked = async () => { const r = await thumbOf(v); URL.revokeObjectURL(v.src); res(r); };
    v.onerror = () => rej(new Error('thumb')); setTimeout(() => rej(new Error('thumb timeout')), 8000);
  });
}
async function mediaBlob(id) { return blobs.get(id); }
async function videoEl(id) {
  if (vids.has(id)) return vids.get(id);
  const b = await mediaBlob(id); if (!b) return null;
  const v = document.createElement('video'); v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(b); v.crossOrigin = 'anonymous';
  vids.set(id, v); return v;
}
async function bitmap(id) { if (bmps.has(id)) return bmps.get(id); const b = await mediaBlob(id); if (!b) return null; const bm = await createImageBitmap(b); bmps.set(id, bm); return bm; }

function addTitle() {
  const c = { id: uid(), type: 'title', dur: 3, fade: true, title: { text: 'My Video', sub: 'made with Jarvis', bg: '#111827', bg2: '#4f46e5', color: '#ffffff' } };
  const segs = segments(); const at = segs.findIndex((s) => playhead < s.end);
  P.clips.splice(at < 0 ? P.clips.length : at, 0, c);
  sel = { kind: 'clip', id: c.id }; save(); drawTimeline(); drawProps(); seek(playhead);
}
function addText() {
  const tot = totalDur(); if (!tot) return toast('Add a clip first', 'error');
  const start = Math.min(playhead, Math.max(0, tot - 0.5));
  const tx = { id: uid(), text: 'Your text', start, end: Math.min(tot, start + 3), pos: 'bottom', size: 7, color: '#ffffff', box: true };
  P.texts.push(tx); sel = { kind: 'text', id: tx.id }; save(); drawTimeline(); drawProps(); seek(playhead);
}
async function addMusic() { const [f] = await pickFiles({ accept: 'audio/*', multiple: false }); if (f) await importFile(f); }
function split() {
  const segs = segments(); const s = segs.find((x) => playhead > x.start + 0.05 && playhead < x.end - 0.05);
  if (!s) return toast('Move the playhead inside a clip to split it', 'error');
  const c = s.clip, i = P.clips.indexOf(c), local = playhead - s.start;
  const b = JSON.parse(JSON.stringify(c)); b.id = uid();
  if (c.type === 'video') { const at = c.in + local * (c.speed || 1); b.in = at; c.out = at; }
  else { b.dur = c.dur - local; c.dur = local; }
  P.clips.splice(i + 1, 0, b); sel = { kind: 'clip', id: b.id }; save(); drawTimeline(); drawProps(); seek(playhead); toast('Split ✂');
}

// ---------- drawing ----------
function drawTitleCard(ctx, c, lt, W, H) {
  const t = c.title || {}; const u = Math.min(W, H) / 100;
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, t.bg || '#111827'); g.addColorStop(1, t.bg2 || t.bg || '#111827');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const a = Math.min(1, lt / 0.6); const y0 = H / 2;
  const f = fit(ctx, t.text || '', W * 0.86, H * 0.4, u * 12, u * 4, 900, 1.1);
  const sf = t.sub ? fit(ctx, t.sub, W * 0.8, H * 0.15, u * 5, u * 2.5, 500, 1.25) : null;
  const bh = f.lines.length * f.lh + (sf ? sf.lines.length * sf.lh + u * 3 : 0);
  ctx.save(); ctx.globalAlpha *= a; ctx.fillStyle = t.color || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = `900 ${f.size}px system-ui, sans-serif`; let y = y0 - bh / 2 + (1 - a) * u * 4;
  f.lines.forEach((l) => { ctx.fillText(l, W / 2, y); y += f.lh; });
  if (sf) { ctx.globalAlpha *= 0.85; ctx.font = `500 ${sf.size}px system-ui, sans-serif`; y += u * 3; sf.lines.forEach((l) => { ctx.fillText(l, W / 2, y); y += sf.lh; }); }
  ctx.restore();
}
function drawTexts(ctx, t, W, H, proj = P) {
  const u = Math.min(W, H) / 100;
  for (const tx of proj.texts) {
    if (t < tx.start || t > tx.end || !tx.text) continue;
    const a = Math.min(1, (t - tx.start) / 0.3, (tx.end - t) / 0.3);
    const f = fit(ctx, tx.text, W * 0.88, H * 0.3, u * (tx.size || 7), u * 2.5, 800, 1.2);
    ctx.font = `800 ${f.size}px system-ui, sans-serif`;
    const bw = Math.max(...f.lines.map((l) => ctx.measureText(l).width)) + u * 4, bh = f.lines.length * f.lh + u * 2;
    const y = tx.pos === 'top' ? u * 5 : tx.pos === 'center' ? (H - bh) / 2 : H - bh - u * 6;
    ctx.save(); ctx.globalAlpha *= Math.max(0, a);
    if (tx.box) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.roundRect ? ctx.roundRect((W - bw) / 2, y, bw, bh, u * 1.5) : ctx.rect((W - bw) / 2, y, bw, bh); ctx.fill(); }
    else { ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = u * 1.2; }
    ctx.fillStyle = tx.color || '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    f.lines.forEach((l, i) => ctx.fillText(l, W / 2, y + u + i * f.lh));
    ctx.restore();
  }
}
function fadeAlpha(c, lt, d) { if (!c.fade) return 1; return Math.max(0, Math.min(1, lt / 0.4, (d - lt) / 0.4)); }
function drawClipFrame(ctx, c, src, lt, d, W, H) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const a = fadeAlpha(c, lt, d);
  ctx.save(); ctx.globalAlpha = a;
  if (c.type === 'title') drawTitleCard(ctx, c, lt, W, H);
  else if (src) {
    if (c.type === 'image' && c.zoom) drawFit(ctx, src, W, H, c.fit, 1 + 0.1 * (lt / Math.max(0.5, d)), 0.5, 0.5);
    else drawFit(ctx, src, W, H, c.fit || 'cover');
  }
  ctx.restore();
}

// ---------- preview playback ----------
async function paint(t, live = false) {
  const W = cv.width, H = cv.height; const segs = segments();
  $('#edEmpty') && ($('#edEmpty').style.display = segs.length ? 'none' : '');
  const s = segs.find((x) => t >= x.start && t < x.end) || (t >= totalDur() && segs.length ? segs[segs.length - 1] : null);
  if (!s) { cx.fillStyle = '#0b0b0f'; cx.fillRect(0, 0, W, H); drawTexts(cx, t, W, H); return; }
  const c = s.clip, lt = Math.min(t, s.end - 0.001) - s.start, d = s.end - s.start;
  let src = null;
  if (c.type === 'video') {
    const v = await videoEl(c.mediaId);
    if (v) {
      for (const [id, o] of vids) if (o !== v && !o.paused) o.pause();
      const want = c.in + lt * (c.speed || 1);
      v.muted = !!c.muted; v.volume = clamp(c.volume ?? 1, 0, 1); v.playbackRate = c.speed || 1;
      if (live) {
        if (Math.abs(v.currentTime - want) > 0.3) v.currentTime = want;
        if (v.paused) v.play().catch(() => {});
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - want) > 0.02) { v.currentTime = want; await new Promise((r) => { const on = () => { v.removeEventListener('seeked', on); r(); }; v.addEventListener('seeked', on); setTimeout(r, 1500); }); }
      }
      if (v.readyState >= 2) src = v;
    }
  } else if (c.type === 'image') src = await bitmap(c.mediaId);
  if (c.type !== 'video') for (const o of vids.values()) if (!o.paused) o.pause();
  drawClipFrame(cx, c, src, lt, d, W, H);
  drawTexts(cx, t, W, H);
}
function updateTime(t) {
  const tot = totalDur();
  const tt = $('#edTime'); if (tt) tt.textContent = `${fmtTime(t, true)} / ${fmtTime(tot, true)}`;
  const sc = $('#edScrub'); if (sc) { sc.max = Math.max(0.1, tot); sc.value = t; }
  const ph = $('#edPlayhead'); if (ph) ph.style.left = (t * pxPerSec) + 'px';
}
async function seek(t) { playhead = clamp(t, 0, totalDur()); updateTime(playhead); await paint(playhead, false); }
async function play() {
  const tot = totalDur(); if (!tot) return;
  if (playhead >= tot - 0.05) playhead = 0;
  playing = true; $('#edPlay').textContent = '⏸'; t0 = performance.now(); tStart = playhead;
  if (P.music) {
    const b = await mediaBlob(P.music.mediaId);
    if (b) { if (!musicEl) musicEl = new Audio(); if (!musicEl.src || musicEl.dataset.id !== P.music.mediaId) { musicEl.src = URL.createObjectURL(b); musicEl.dataset.id = P.music.mediaId; } musicEl.loop = true; musicEl.volume = clamp(P.music.volume, 0, 1); const md = P.media[P.music.mediaId]?.duration || 1; musicEl.currentTime = (P.music.offset + playhead) % md; musicEl.play().catch(() => {}); }
  }
  const tick = async () => {
    if (!playing) return;
    const t = tStart + (performance.now() - t0) / 1000;
    if (t >= tot) { pause(); seek(tot); return; }
    playhead = t; updateTime(t); await paint(t, true);
    raf = requestAnimationFrame(tick);
  };
  tick();
}
function pause() { playing = false; cancelAnimationFrame(raf); const b = $('#edPlay'); if (b) b.textContent = '▶'; for (const v of vids.values()) v.pause(); if (musicEl) musicEl.pause(); }

// ---------- timeline ----------
function drawTimeline() {
  const box = $('#edTimeline'); if (!box) return; box.innerHTML = '';
  const tot = totalDur(); const width = Math.max(box.clientWidth || 600, (Math.max(tot, exportLen()) + 2) * pxPerSec);
  const inner = el('div', { class: 'tl-inner', style: { width: width + 'px' } });
  // ruler
  const ruler = el('div', { class: 'tl-ruler' }); const step = pxPerSec >= 60 ? 1 : pxPerSec >= 20 ? 5 : pxPerSec >= 10 ? 10 : 30;
  for (let s = 0; s <= tot + 2; s += step) ruler.append(el('span', { style: { left: s * pxPerSec + 'px' } }, fmtTime(s)));
  ruler.addEventListener('click', (e) => { const r = inner.getBoundingClientRect(); pause(); seek((e.clientX - r.left) / pxPerSec); });
  // video track
  const vt = el('div', { class: 'tl-track tl-video' });
  segments().forEach((s, i) => {
    const c = s.clip; const m = P.media[c.mediaId];
    const label = c.type === 'title' ? '🅃 ' + (c.title?.text || 'Title') : (c.type === 'image' ? '🖼 ' : '🎬 ') + (m?.name || 'missing');
    const blk = el('div', { class: 'tl-clip ' + c.type + (sel?.id === c.id ? ' sel' : ''), draggable: 'true', 'data-id': c.id, style: { left: s.start * pxPerSec + 'px', width: Math.max(18, (s.end - s.start) * pxPerSec - 2) + 'px', backgroundImage: m?.thumb ? `url(${m.thumb})` : '' }, title: `${label} · ${(s.end - s.start).toFixed(1)}s`,
      onclick: (e) => { e.stopPropagation(); sel = { kind: 'clip', id: c.id }; drawTimeline(); drawProps(); if (playhead < s.start || playhead >= s.end) seek(s.start); } },
      el('span', { class: 'tl-label' }, label), el('span', { class: 'tl-dur' }, (s.end - s.start).toFixed(1) + 's' + (c.speed && c.speed !== 1 ? ` · ${c.speed}×` : '')));
    blk.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/clip', c.id); e.dataTransfer.effectAllowed = 'move'; });
    blk.addEventListener('dragover', (e) => e.preventDefault());
    blk.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/clip'); const from = P.clips.findIndex((x) => x.id === id), to = P.clips.indexOf(c); if (from < 0 || from === to) return; const [mv] = P.clips.splice(from, 1); P.clips.splice(to, 0, mv); save(); drawTimeline(); seek(playhead); });
    vt.append(blk);
  });
  if (!P.clips.length) vt.append(el('div', { class: 'tl-hint' }, 'Clips appear here'));
  // text track
  const tt = el('div', { class: 'tl-track tl-text' });
  P.texts.forEach((tx) => tt.append(el('div', { class: 'tl-clip text' + (sel?.id === tx.id ? ' sel' : ''), style: { left: tx.start * pxPerSec + 'px', width: Math.max(18, (tx.end - tx.start) * pxPerSec - 2) + 'px' }, onclick: (e) => { e.stopPropagation(); sel = { kind: 'text', id: tx.id }; drawTimeline(); drawProps(); seek(tx.start + 0.01); } }, el('span', { class: 'tl-label' }, '💬 ' + tx.text))));
  // music track
  const mt = el('div', { class: 'tl-track tl-music' });
  if (P.music) { const m = P.media[P.music.mediaId]; mt.append(el('div', { class: 'tl-clip music' + (sel?.kind === 'music' ? ' sel' : ''), style: { left: 0, width: Math.max(40, exportLen() * pxPerSec - 2) + 'px' }, onclick: (e) => { e.stopPropagation(); sel = { kind: 'music', id: P.music.mediaId }; drawTimeline(); drawProps(); } }, el('span', { class: 'tl-label' }, '🎵 ' + (m?.name || 'music')))); }
  // export length marker
  if (P.customLen) inner.append(el('div', { class: 'tl-end', style: { left: exportLen() * pxPerSec + 'px' }, title: 'Export ends here' }));
  if (tot > MAX_SECONDS) inner.append(el('div', { class: 'tl-max', style: { left: MAX_SECONDS * pxPerSec + 'px' }, title: '5:00 limit' }));
  inner.append(ruler, vt, tt, mt, el('div', { class: 'tl-playhead', id: 'edPlayhead', style: { left: playhead * pxPerSec + 'px' } }));
  inner.addEventListener('click', (e) => { if (e.target === inner || e.target.classList.contains('tl-track')) { const r = inner.getBoundingClientRect(); pause(); seek((e.clientX - r.left) / pxPerSec); } });
  box.append(inner);
  const warn = $('#edWarn');
  if (warn) warn.innerHTML = tot > MAX_SECONDS ? `⚠️ Timeline is ${fmtTime(tot)}. Videos are limited to 5:00, so the export will stop at 5:00. Trim or delete clips, or set a custom length.` : '';
  warn && (warn.style.display = tot > MAX_SECONDS ? '' : 'none');
}

// ---------- properties ----------
function num(label, val, { min = 0, max = 9999, step = 0.1, onchange, id }) {
  const i = el('input', { type: 'number', min, max, step, value: +(+val).toFixed(2), id });
  i.addEventListener('change', () => { const v = clamp(+i.value, min, max); i.value = +v.toFixed(2); onchange(v); });
  return el('label', { class: 'field sm' }, label, i);
}
function after() { save(); drawTimeline(); seek(Math.min(playhead, totalDur())); }
function drawProps() {
  const box = $('#edProps'); if (!box) return; box.innerHTML = '';
  if (!sel) { box.append(el('div', { class: 'muted small' }, 'Tap a clip, text or music on the timeline to edit it. Tip: drag clips to reorder (or use ◀ ▶).'), el('div', { class: 'muted small' }, `Length: ${fmtTime(totalDur(), true)} · Max 5:00`)); return; }
  if (sel.kind === 'clip') {
    const c = P.clips.find((x) => x.id === sel.id); if (!c) { sel = null; return drawProps(); }
    const i = P.clips.indexOf(c); const m = P.media[c.mediaId];
    const row = el('div', { class: 'row wrap' });
    box.append(el('h3', {}, c.type === 'video' ? '🎬 Video clip' : c.type === 'image' ? '🖼 Photo' : '🅃 Title card', el('small', { class: 'muted' }, m ? ' · ' + m.name : '')));
    if (c.type === 'video') {
      const md = m?.duration || c.out;
      row.append(num('Start (s)', c.in, { min: 0, max: md, id: 'edIn', onchange: (v) => { c.in = Math.min(v, c.out - 0.1); after(); drawProps(); } }),
        num('End (s)', c.out, { min: 0.1, max: md, id: 'edEnd', onchange: (v) => { c.out = Math.max(v, c.in + 0.1); after(); drawProps(); } }));
      const sp = el('select', { id: 'edSpeed' }, ...SPEEDS.map((s) => el('option', { value: s }, s + '×'))); sp.value = c.speed || 1;
      sp.addEventListener('change', () => { c.speed = +sp.value; after(); drawProps(); });
      const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: c.volume ?? 1 }); vol.addEventListener('change', () => { c.volume = +vol.value; save(); });
      const mute = el('input', { type: 'checkbox', checked: !!c.muted }); mute.addEventListener('change', () => { c.muted = mute.checked; save(); });
      row.append(el('label', { class: 'field sm' }, 'Speed', sp), el('label', { class: 'field' }, 'Volume', vol), el('label', { class: 'row' }, mute, ' Mute'));
      box.append(el('div', { class: 'small muted' }, `Uses ${c.in.toFixed(1)}s → ${c.out.toFixed(1)}s of ${md.toFixed(1)}s · on timeline ${clipDur(c).toFixed(2)}s`));
      const trim = el('div', { class: 'trim' });
      const a = el('input', { type: 'range', min: 0, max: md, step: 0.05, value: c.in, 'aria-label': 'Trim start' });
      const b = el('input', { type: 'range', min: 0, max: md, step: 0.05, value: c.out, 'aria-label': 'Trim end' });
      a.addEventListener('input', () => { c.in = Math.min(+a.value, c.out - 0.1); a.value = c.in; drawTimeline(); seek(segments().find((s) => s.clip === c).start); });
      b.addEventListener('input', () => { c.out = Math.max(+b.value, c.in + 0.1); b.value = c.out; drawTimeline(); const s = segments().find((s) => s.clip === c); seek(s.end - 0.05); });
      a.addEventListener('change', () => { save(); drawProps(); }); b.addEventListener('change', () => { save(); drawProps(); });
      trim.append(el('label', { class: 'small' }, 'Trim start', a), el('label', { class: 'small' }, 'Trim end', b));
      box.append(trim);
    } else {
      row.append(num('Seconds', c.dur, { min: 0.5, max: 300, id: 'edDurIn', onchange: (v) => { c.dur = v; after(); } }));
    }
    if (c.type !== 'title') {
      const fitSel = el('select', {}, el('option', { value: 'cover' }, 'Fill (crop)'), el('option', { value: 'contain' }, 'Fit (bars)')); fitSel.value = c.fit || 'cover';
      fitSel.addEventListener('change', () => { c.fit = fitSel.value; after(); });
      row.append(el('label', { class: 'field sm' }, 'Crop', fitSel));
    }
    if (c.type === 'image') { const z = el('input', { type: 'checkbox', checked: !!c.zoom }); z.addEventListener('change', () => { c.zoom = z.checked; after(); }); row.append(el('label', { class: 'row' }, z, ' Slow zoom')); }
    const fd = el('input', { type: 'checkbox', checked: !!c.fade }); fd.addEventListener('change', () => { c.fade = fd.checked; after(); }); row.append(el('label', { class: 'row' }, fd, ' Fade in/out'));
    box.append(row);
    if (c.type === 'title') {
      const t = c.title; const tIn = el('input', { type: 'text', value: t.text, id: 'edTitleText' }); const sIn = el('input', { type: 'text', value: t.sub || '' });
      const bg = el('input', { type: 'color', value: t.bg }); const bg2 = el('input', { type: 'color', value: t.bg2 || t.bg }); const col = el('input', { type: 'color', value: t.color });
      [[tIn, 'text'], [sIn, 'sub'], [bg, 'bg'], [bg2, 'bg2'], [col, 'color']].forEach(([inp, k]) => inp.addEventListener('input', () => { t[k] = inp.value; save(); seek(playhead); drawTimeline(); }));
      box.append(el('label', { class: 'field' }, 'Title', tIn), el('label', { class: 'field' }, 'Subtitle', sIn), el('div', { class: 'row' }, el('label', {}, 'Colour 1 ', bg), el('label', {}, ' Colour 2 ', bg2), el('label', {}, ' Text ', col)));
    }
    box.append(el('div', { class: 'row wrap' },
      el('button', { class: 'btn tiny', 'aria-label': 'Move left', onclick: () => { if (i > 0) { [P.clips[i - 1], P.clips[i]] = [P.clips[i], P.clips[i - 1]]; after(); drawProps(); } } }, '◀ Move'),
      el('button', { class: 'btn tiny', 'aria-label': 'Move right', onclick: () => { if (i < P.clips.length - 1) { [P.clips[i + 1], P.clips[i]] = [P.clips[i], P.clips[i + 1]]; after(); drawProps(); } } }, 'Move ▶'),
      el('button', { class: 'btn tiny', onclick: () => { const d = JSON.parse(JSON.stringify(c)); d.id = uid(); P.clips.splice(i + 1, 0, d); sel = { kind: 'clip', id: d.id }; after(); drawProps(); } }, 'Duplicate'),
      el('button', { class: 'btn tiny danger', id: 'edDelete', onclick: () => { P.clips.splice(i, 1); sel = null; after(); drawProps(); } }, '🗑 Delete')));
  } else if (sel.kind === 'text') {
    const tx = P.texts.find((x) => x.id === sel.id); if (!tx) { sel = null; return drawProps(); }
    const tIn = el('textarea', { rows: 2, id: 'edTextIn' }); tIn.value = tx.text; tIn.addEventListener('input', () => { tx.text = tIn.value; save(); seek(playhead); });
    tIn.addEventListener('change', drawTimeline);
    const pos = el('select', {}, el('option', { value: 'top' }, 'Top'), el('option', { value: 'center' }, 'Middle'), el('option', { value: 'bottom' }, 'Bottom')); pos.value = tx.pos; pos.addEventListener('change', () => { tx.pos = pos.value; save(); seek(playhead); });
    const col = el('input', { type: 'color', value: tx.color }); col.addEventListener('input', () => { tx.color = col.value; save(); seek(playhead); });
    const bx = el('input', { type: 'checkbox', checked: !!tx.box }); bx.addEventListener('change', () => { tx.box = bx.checked; save(); seek(playhead); });
    box.append(el('h3', {}, '💬 Text'), el('label', { class: 'field' }, 'Text', tIn),
      el('div', { class: 'row wrap' }, num('From (s)', tx.start, { min: 0, max: 300, onchange: (v) => { tx.start = Math.min(v, tx.end - 0.1); after(); } }), num('To (s)', tx.end, { min: 0.1, max: 300, onchange: (v) => { tx.end = Math.max(v, tx.start + 0.1); after(); } }),
        num('Size', tx.size, { min: 2, max: 20, step: 0.5, onchange: (v) => { tx.size = v; save(); seek(playhead); } }), el('label', { class: 'field sm' }, 'Position', pos), el('label', {}, 'Colour ', col), el('label', { class: 'row' }, bx, ' Background box')),
      el('button', { class: 'btn tiny danger', onclick: () => { P.texts = P.texts.filter((x) => x !== tx); sel = null; after(); drawProps(); } }, '🗑 Delete text'));
  } else if (sel.kind === 'music' && P.music) {
    const mu = P.music; const m = P.media[mu.mediaId];
    const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: mu.volume }); vol.addEventListener('change', () => { mu.volume = +vol.value; save(); });
    const fo = el('input', { type: 'checkbox', checked: !!mu.fadeOut }); fo.addEventListener('change', () => { mu.fadeOut = fo.checked; save(); });
    box.append(el('h3', {}, '🎵 Background music', el('small', { class: 'muted' }, m ? ' · ' + m.name + ` (${fmtTime(m.duration)})` : '')),
      el('div', { class: 'row wrap' }, el('label', { class: 'field' }, 'Volume', vol), num('Start song at (s)', mu.offset, { min: 0, max: m?.duration || 600, onchange: (v) => { mu.offset = v; save(); } }), el('label', { class: 'row' }, fo, ' Fade out at end')),
      el('div', { class: 'small muted' }, 'Music loops if the video is longer than the song.'),
      el('button', { class: 'btn tiny danger', onclick: () => { P.music = null; sel = null; save(); drawTimeline(); drawProps(); } }, '🗑 Remove music'));
  }
}

// ---------- export ----------
function exportDialog() {
  const tot = totalDur(); if (!tot) return toast('Add some clips first', 'error');
  pause();
  const out = $('#edOut'); out.innerHTML = '';
  const fmt = el('select', { id: 'edFmt' }, el('option', { value: 'mp4' }, 'MP4 (best for WhatsApp/YouTube)'), el('option', { value: 'webm' }, 'WebM'));
  const q = el('select', { id: 'edQ' }, el('option', { value: '480' }, '480p (fast)'), el('option', { value: '720' }, '720p HD'), el('option', { value: '1080' }, '1080p Full HD')); q.value = P.quality;
  const lenMode = el('select', { id: 'edLenMode' }, el('option', { value: 'auto' }, `Same as timeline (${fmtTime(Math.min(tot, MAX_SECONDS), true)})`), el('option', { value: 'custom' }, 'Custom length'));
  const lenIn = el('input', { type: 'number', id: 'edLen', min: 1, max: MAX_SECONDS, step: 0.5, value: +(P.customLen || Math.min(tot, MAX_SECONDS)).toFixed(1), style: { display: P.customLen ? '' : 'none' } });
  lenMode.value = P.customLen ? 'custom' : 'auto';
  lenMode.addEventListener('change', () => { lenIn.style.display = lenMode.value === 'custom' ? '' : 'none'; P.customLen = lenMode.value === 'custom' ? clamp(+lenIn.value, 1, MAX_SECONDS) : null; save(); drawTimeline(); });
  lenIn.addEventListener('change', () => { lenIn.value = clamp(+lenIn.value || 1, 1, MAX_SECONDS); P.customLen = +lenIn.value; save(); drawTimeline(); });
  out.append(el('div', { class: 'card', id: 'edExportCard' }, el('h3', {}, '⬇ Export video'),
    el('div', { class: 'row wrap' }, el('label', { class: 'field' }, 'Format', fmt), el('label', { class: 'field' }, 'Quality', q), el('label', { class: 'field' }, 'Length (max 5:00)', lenMode, lenIn)),
    el('div', { class: 'small muted' }, 'Shorter than the timeline = the end is cut. Longer = the last frame is held. Rendering happens on your device.'),
    el('div', { class: 'row' }, el('button', { class: 'btn primary', id: 'edGo', onclick: () => { P.quality = q.value; save(); runExport(fmt.value); } }, 'Start export'))));
  out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export async function renderProject(proj, { format = 'mp4', onProgress, signal } = {}) {
  const L = exportLen(proj); const { w, h } = sizeFor(proj.aspect, proj.quality || '720');
  const segs = segments(proj); const tot = totalDur(proj); const N = Math.round(L * FPS);
  const sources = new Map();
  const getSrc = async (id) => { if (!sources.has(id)) { const b = await blobs.get(id); sources.set(id, await new FrameSource(b, proj.media[id]).open()); } return sources.get(id); };
  // audio
  const tracks = [];
  for (const s of segs) {
    const c = s.clip; if (c.type !== 'video' || c.muted || !(c.volume ?? 1) || s.start >= L) continue;
    const m = proj.media[c.mediaId]; if (m && m.hasAudio === false) continue;
    const buf = await decodeAudio(await blobs.get(c.mediaId), c.mediaId);
    if (buf) tracks.push({ buffer: buf, start: s.start, offset: c.in, dur: Math.min(s.end, L) - s.start, rate: c.speed || 1, gain: c.volume ?? 1, fadeIn: c.fade ? 0.4 : 0.01, fadeOut: c.fade ? 0.4 : 0.01 });
  }
  if (proj.music) { const buf = await decodeAudio(await blobs.get(proj.music.mediaId), proj.music.mediaId); if (buf) tracks.push({ buffer: buf, start: 0, offset: proj.music.offset || 0, dur: L, loop: true, gain: proj.music.volume, fadeIn: 0.5, fadeOut: proj.music.fadeOut ? 2 : 0.05 }); }
  const audio = makeMixer(L, tracks);
  // frames
  let cur = null, iter = null, last = null;
  const bmpCache = new Map();
  const draw = async (ctx, t, i, W, H) => {
    const tt = Math.min(t, tot - 1 / FPS);
    const s = segs.find((x) => tt >= x.start && tt < x.end) || segs[segs.length - 1];
    if (!s) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); return; }
    const c = s.clip, lt = tt - s.start, d = s.end - s.start;
    let src = null;
    if (c.type === 'video') {
      if (cur !== s) {
        if (iter && iter.return) await iter.return();
        cur = s; last = null;
        const fs = await getSrc(c.mediaId);
        const ts = []; for (let k = i; k < N; k++) { const tk = Math.min(k / FPS, tot - 1 / FPS); if (tk >= s.end) break; ts.push(c.in + (tk - s.start) * (c.speed || 1)); }
        iter = fs.frames(ts)[Symbol.asyncIterator]();
      }
      const r = await iter.next(); if (!r.done && r.value) last = r.value; src = last;
    } else {
      if (cur !== s) { if (iter && iter.return) await iter.return(); iter = null; cur = s; }
      if (c.type === 'image') { if (!bmpCache.has(c.mediaId)) bmpCache.set(c.mediaId, await createImageBitmap(await blobs.get(c.mediaId))); src = bmpCache.get(c.mediaId); }
    }
    drawClipFrame(ctx, c, src, lt, d, W, H);
    drawTexts(ctx, t, W, H, proj);
  };
  try {
    return await exportVideo({ width: w, height: h, fps: FPS, duration: L, drawFrame: draw, audio, format, onProgress, signal });
  } finally { if (iter && iter.return) iter.return().catch(() => {}); for (const s of sources.values()) s.close(); }
}

async function runExport(format) {
  const out = $('#edOut'); const L = exportLen();
  abortCtl = new AbortController();
  const bar = el('div', { class: 'progress' }, el('i')); const label = el('div', { class: 'small muted' }, 'Preparing audio…');
  out.innerHTML = ''; out.append(el('div', { class: 'card' }, el('div', { class: 'row space' }, el('h3', {}, `Exporting ${fmtTime(L, true)}…`), el('button', { class: 'btn tiny', onclick: () => abortCtl.abort() }, 'Cancel')), bar, label));
  try {
    let res;
    try { res = await renderProject(P, { format, signal: abortCtl.signal, onProgress: (p, i, N) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; label.textContent = `Frame ${i} of ${N}`; } }); }
    catch (e) {
      if (e.code !== 'NO_WEBCODECS') throw e;
      label.textContent = 'Your browser can’t do fast export, recording in real time…';
      res = await realtimeExport(L, abortCtl.signal, (p) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; });
    }
    const url = URL.createObjectURL(res.blob); const ext = res.mime.includes('webm') ? 'webm' : 'mp4'; const name = `jarvis-edit-${Math.floor(L / 60)}m${String(Math.round(L % 60)).padStart(2, '0')}s-${Date.now().toString(36).slice(-4)}.${ext}`;
    const v = el('video', { src: url + '#t=0.3', controls: true, playsinline: true, class: 'vm-result', id: 'edResult' });
    const info = el('div', { class: 'small muted', id: 'edInfo' }, fmtBytes(res.blob.size));
    v.addEventListener('loadedmetadata', () => { info.textContent = `Length ${v.duration.toFixed(2)} s · ${v.videoWidth}×${v.videoHeight} · ${fmtBytes(res.blob.size)}`; });
    window.__lastEdit = res;
    const file = new File([res.blob], name, { type: res.mime });
    out.innerHTML = ''; out.append(el('div', { class: 'card' }, el('h3', {}, '✅ Exported'), v, info, el('div', { class: 'row wrap' },
      el('button', { class: 'btn primary big', id: 'edDownload', onclick: () => download(res.blob, name) }, `⬇ Download ${ext.toUpperCase()} (${fmtBytes(res.blob.size)})`),
      matchMedia('(pointer: coarse)').matches || (navigator.canShare && navigator.canShare({ files: [file] })) ? el('button', { class: 'btn big', id: 'edShare', onclick: async () => { if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; } } download(res.blob, name); toast('Sharing isn’t supported here, so it was downloaded instead.'); } }, '📤 Share') : null),
      el('div', { class: 'small muted' }, `Saves as ${name}`)));
  } catch (e) {
    out.innerHTML = ''; if (e.name === 'AbortError') toast('Export cancelled'); else { console.error(e); out.append(el('div', { class: 'card error-box' }, '⚠️ Export failed: ' + e.message)); }
  }
  abortCtl = null;
}
async function realtimeExport(L, signal, onProgress) {
  // Fallback: play the preview in real time and record the canvas.
  const tracks = []; for (const s of segments()) { const c = s.clip; if (c.type === 'video' && !c.muted) { const buf = await decodeAudio(await blobs.get(c.mediaId), c.mediaId); if (buf) tracks.push({ buffer: buf, start: s.start, offset: c.in, dur: s.end - s.start, rate: c.speed || 1, gain: c.volume ?? 1 }); } }
  if (P.music) { const buf = await decodeAudio(await blobs.get(P.music.mediaId), P.music.mediaId); if (buf) tracks.push({ buffer: buf, start: 0, offset: P.music.offset, dur: L, loop: true, gain: P.music.volume, fadeOut: 2 }); }
  const audio = await mixAudio(L, tracks);
  for (const v of vids.values()) v.muted = true;
  const res = await recordRealtime({ canvas: cv, duration: L, audio, signal, onProgress, play: (t) => { paint(Math.min(t, totalDur() - 0.01), true); } });
  pause(); return res;
}

export function editorStop() { pause(); }

// test/debug hook
window.__ed = { get P() { return P; }, totalDur: () => totalDur(), seek: (t) => seek(t) };
