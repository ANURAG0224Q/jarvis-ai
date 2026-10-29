// AI Video Maker: topic + duration -> script -> narrated animated video, rendered on your device.
import { el, $, $$, uid, toast, download, pickFiles, fmtTime, fmtBytes, clamp, modal, confirm } from '../util.js';
import { settings, blobs, kv, GEMINI_VOICES } from '../store.js';
import { generateJSON, geminiTTS, generateImage, friendlyError, providerReady } from '../providers.js';
import { THEMES, LAYOUTS, drawVideoFrame } from './scenes.js';
import { normalizeDurations, planTiming, splitBySilence, sliceBuffer } from './timing.js';
import { exportVideo, recordRealtime, decodeAudio, mixAudio, makeMixer, sizeFor, MAX_SECONDS, webCodecsAvailable } from './engine.js';

const LAYOUT_NAMES = { title: 'Title', bullets: 'Bullet points', big: 'Big number', quote: 'Quote', image: 'Picture', emoji: 'Emoji + text', outro: 'Ending' };
const DEFAULT = { topic: '', T: 60, aspect: '16:9', quality: '720', theme: 'midnight', lang: 'English', narration: true, voice: 'Kore', captions: true, aiImages: true, musicId: null, musicName: '', musicVol: 0.25, userImages: [], script: null };
let st = null, root = null, player = null, abortCtl = null;
const ttsMem = new Map();

async function load() { if (!st) st = { ...DEFAULT, ...((await kv.get('aimaker')) || {}) }; return st; }
let saveT = 0; function save() { clearTimeout(saveT); saveT = setTimeout(() => kv.put('aimaker', st).catch(() => {}), 300); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

export async function renderAIMaker(container, { onOpenInEditor } = {}) {
  await load(); root = container; root.innerHTML = '';
  root.append(el('div', { class: 'vm-grid' }, formPanel(), el('div', { class: 'vm-right' }, el('div', { id: 'vmScript' }), el('div', { id: 'vmOut' }))));
  drawScript();
  root._openInEditor = onOpenInEditor;
}

function formPanel() {
  const topic = el('textarea', { id: 'vmTopic', rows: 3, placeholder: 'What is the video about? e.g. “How a Raspberry Pi works, for beginners” or “5 study tips before exams”' });
  topic.value = st.topic; topic.addEventListener('input', () => { st.topic = topic.value; save(); });
  const dur = el('input', { type: 'range', id: 'vmDurRange', min: 10, max: MAX_SECONDS, step: 5, value: st.T });
  const durN = el('input', { type: 'number', id: 'vmDur', min: 10, max: MAX_SECONDS, step: 1, value: st.T, 'aria-label': 'Duration in seconds' });
  const durL = el('b', { id: 'vmDurLabel' }, fmtTime(st.T));
  const setDur = (v) => { v = clamp(Math.round(+v || 10), 10, MAX_SECONDS); const crossed = st.T <= 300 && v > 300; st.T = v; if (crossed && st.quality !== '480' && lowEnd()) { setQuality('480'); toast('Switched to 480p for a long video (faster, smaller). You can change it.'); } qHint && qHint(); dur.value = v; durN.value = v; durL.textContent = fmtTime(v); save(); drawScript(); };
  dur.addEventListener('input', () => setDur(dur.value)); durN.addEventListener('change', () => setDur(durN.value));
  const seg = (name, opts, key, extra) => { const s = el('div', { class: 'seg', id: 'vm-' + key }); opts.forEach(([v, l]) => s.append(el('button', { 'data-v': v, class: st[key] === v ? 'on' : '', onclick: (e) => { st[key] = v; save(); s.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === e.currentTarget)); qHint(); } }, l))); return el('div', { class: 'field' }, el('span', { class: 'flabel' }, name), s, extra || null); };
  const hintBox = el('div', { class: 'small muted', id: 'vmQHint' });
  const setQuality = (q) => { st.quality = q; save(); $$('#vm-quality button').forEach((b) => b.classList.toggle('on', b.dataset.v === q)); qHint(); };
  function qHint() {
    hintBox.innerHTML = '';
    if (st.T > 300 && st.quality !== '480') hintBox.append('Long video: 480p renders faster and makes a smaller file (good for phones and WhatsApp). ', el('button', { class: 'btn tiny', onclick: () => setQuality('480') }, 'Use 480p'));
  }
  setTimeout(qHint, 0);
  const lowEnd = () => matchMedia('(max-width: 760px)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4);
  const theme = el('select', { id: 'vmTheme' }); Object.entries(THEMES).forEach(([k, t]) => theme.append(el('option', { value: k }, t.name))); theme.value = st.theme;
  theme.addEventListener('change', () => { st.theme = theme.value; save(); });
  const lang = el('input', { type: 'text', value: st.lang, placeholder: 'English' }); lang.addEventListener('change', () => { st.lang = lang.value || 'English'; save(); });
  const chk = (key, label, id) => { const i = el('input', { type: 'checkbox', checked: !!st[key], id }); i.addEventListener('change', () => { st[key] = i.checked; save(); }); return el('label', { class: 'row' }, i, ' ', label); };
  const voice = el('select', { id: 'vmVoice' }); GEMINI_VOICES.forEach((v) => voice.append(el('option', { value: v }, v))); voice.value = st.voice; voice.addEventListener('change', () => { st.voice = voice.value; save(); });
  const imgs = el('div', { class: 'thumbs', id: 'vmImgs' });
  const drawImgs = () => { imgs.innerHTML = ''; st.userImages.forEach((im, i) => { const t = el('div', { class: 'thumb' }, el('span', { class: 'thumb-n' }, String(i + 1)), el('button', { class: 'chip-x', 'aria-label': 'Remove image', onclick: () => { st.userImages.splice(i, 1); blobs.del(im.id).catch(() => {}); save(); drawImgs(); } }, '✕')); blobs.get(im.id).then((b) => b && t.prepend(el('img', { src: URL.createObjectURL(b), alt: im.name }))); imgs.append(t); }); };
  drawImgs();
  const music = el('div', { class: 'row', id: 'vmMusic' });
  const drawMusic = () => { music.innerHTML = ''; if (st.musicId) music.append(el('span', { class: 'chip' }, '🎵 ' + st.musicName, el('button', { class: 'chip-x', 'aria-label': 'Remove music', onclick: () => { blobs.del(st.musicId).catch(() => {}); st.musicId = null; save(); drawMusic(); } }, '✕'))); else music.append(el('button', { class: 'btn', onclick: async () => { const [f] = await pickFiles({ accept: 'audio/*', multiple: false }); if (!f) return; const id = 'm_' + uid(); await blobs.put(id, f); st.musicId = id; st.musicName = f.name; save(); drawMusic(); } }, '🎵 Add background music')); };
  drawMusic();
  const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: st.musicVol }); vol.addEventListener('change', () => { st.musicVol = +vol.value; save(); });

  return el('div', { class: 'card vm-form' },
    el('h2', {}, '✨ AI Video Maker'),
    el('p', { class: 'muted small' }, 'Type a topic, pick the length, and Jarvis writes the script, adds a voice-over and renders an animated explainer video on your phone. (Realistic AI footage like Sora/Veo needs paid models, so it is not included.)'),
    el('label', { class: 'field' }, el('span', { class: 'flabel' }, 'Topic'), topic),
    el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Video length: ', durL, el('span', { class: 'muted' }, ' (max 5:00)')), el('div', { class: 'row' }, dur, durN, el('span', { class: 'muted small' }, 'sec'))),
    seg('Shape', [['16:9', '▭ 16:9 YouTube'], ['9:16', '▯ 9:16 Reels/Shorts'], ['1:1', '◻ 1:1']], 'aspect'),
    seg('Quality', [['480', '480p'], ['720', '720p'], ['1080', '1080p']], 'quality', hintBox),
    el('div', { class: 'row wrap' }, el('label', { class: 'field grow' }, el('span', { class: 'flabel' }, 'Style'), theme), el('label', { class: 'field grow' }, el('span', { class: 'flabel' }, 'Language'), lang)),
    el('div', { class: 'row wrap' }, chk('narration', 'AI voice-over (Gemini, free)', 'vmNarr'), el('label', { class: 'row' }, 'Voice ', voice)),
    chk('captions', 'Captions (subtitles)', 'vmCaps'),
    chk('aiImages', 'AI pictures for picture scenes (free Pollinations.ai)', 'vmAiImg'),
    el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Your photos (optional, used in picture scenes)'), imgs, el('button', { class: 'btn', onclick: async () => { const fs = await pickFiles({ accept: 'image/*' }); for (const f of fs) { const id = 'i_' + uid(); await blobs.put(id, f); st.userImages.push({ id, name: f.name }); } save(); drawImgs(); } }, '🖼 Add photos')),
    el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Music'), music, el('label', { class: 'row small' }, 'Music volume ', vol)),
    el('div', { class: 'row wrap' },
      el('button', { class: 'btn primary', id: 'vmWrite', onclick: writeScript }, '✨ Write script with AI'),
      el('button', { class: 'btn', id: 'vmManual', onclick: manualScript }, '✍️ Write it myself')));
}

const SCHEMA = {
  type: 'OBJECT', properties: {
    title: { type: 'STRING' },
    scenes: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
      layout: { type: 'STRING', enum: LAYOUTS }, heading: { type: 'STRING' }, text: { type: 'STRING' }, bullets: { type: 'ARRAY', items: { type: 'STRING' } },
      big: { type: 'STRING' }, emoji: { type: 'STRING' }, imagePrompt: { type: 'STRING' }, image: { type: 'INTEGER' }, narration: { type: 'STRING' }, duration: { type: 'NUMBER' } },
      required: ['layout', 'heading', 'narration', 'duration'] } } },
  required: ['title', 'scenes'],
};

async function writeScript() {
  if (!st.topic.trim()) { toast('Type a topic first', 'error'); $('#vmTopic').focus(); return; }
  if (!providerReady()) { toast('Add your free Gemini API key in Settings first (or tap “Write it myself”).', 'error'); return; }
  const T = st.T, n = clamp(Math.round(T / 9), 2, 32);
  const btn = $('#vmWrite'); btn.disabled = true; btn.textContent = '✨ Writing…';
  const prompt = `Write the script for an animated explainer video.
TOPIC: ${st.topic}
TARGET_SECONDS: ${T}
The scene durations MUST add up to exactly ${T} seconds. Use about ${n} scenes (${Math.max(2, n - 2)}–${n + 2}).
Language for ALL on-screen text and narration: ${st.lang || 'English'}.
Video shape: ${st.aspect}.
User photos available: ${st.userImages.length ? st.userImages.map((im, i) => `${i}: ${im.name}`).join(', ') : 'none'} (use "image": index for a picture scene that should show one, otherwise -1).

For each scene give:
- layout: one of title, bullets, big, quote, image, emoji, outro. First scene = title, last scene = outro. Mix the others for variety.
- heading: max 8 words.
- text: one short sentence, max 18 words.
- bullets: 2–4 items of max 6 words (only for bullets layout).
- big: a short number or stat like "71%" or "1947" (only for big layout).
- emoji: exactly one fitting emoji.
- imagePrompt: for image layout, an English description of a picture to show (no text in the picture).
- image: index of a user photo or -1.
- narration: what the voice-over says in this scene: about ${'{'}2.2 × duration{'}'} words, natural spoken style, adds information beyond the on-screen text.
- duration: seconds (minimum 3).
Facts must be correct. Keep it engaging, like a good YouTube explainer.`;
  try {
    const j = await generateJSON(prompt, { schema: SCHEMA, system: 'You write concise, accurate, engaging video scripts. Output only JSON.' });
    if (!j || !Array.isArray(j.scenes) || !j.scenes.length) throw new Error('The AI returned an empty script. Try again.');
    const scenes = j.scenes.map(cleanScene);
    const d = normalizeDurations(scenes, T); scenes.forEach((s, i) => (s.duration = d[i]));
    st.script = { title: String(j.title || st.topic).slice(0, 100), scenes };
    save(); drawScript(); toast('Script ready. Edit anything, then render the video.');
    document.getElementById('vmScript')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast(friendlyError(e), 'error', 8000); }
  btn.disabled = false; btn.textContent = '✨ Write script with AI';
}
function cleanScene(s) {
  return {
    id: uid(), layout: LAYOUTS.includes(s.layout) ? s.layout : 'bullets', heading: String(s.heading || '').slice(0, 120), text: String(s.text || '').slice(0, 240),
    bullets: Array.isArray(s.bullets) ? s.bullets.map(String).filter(Boolean).slice(0, 6) : [], big: String(s.big || '').slice(0, 30), emoji: String(s.emoji || '').slice(0, 8),
    imagePrompt: String(s.imagePrompt || '').slice(0, 400), image: Number.isInteger(s.image) && s.image >= 0 && s.image < st.userImages.length ? s.image : -1,
    narration: String(s.narration || '').slice(0, 1500), duration: +s.duration || 5, aiImageId: null,
  };
}
function manualScript() {
  const T = st.T;
  const scenes = [
    { layout: 'title', heading: st.topic || 'My video', text: '', emoji: '🎬', narration: '' },
    { layout: 'bullets', heading: 'Key points', bullets: ['First point', 'Second point', 'Third point'], emoji: '💡', narration: '' },
    { layout: 'outro', heading: 'Thanks for watching!', text: 'Like and subscribe', emoji: '🙏', narration: '' },
  ].map((s) => cleanScene({ ...s, duration: T / 3 }));
  const d = normalizeDurations(scenes, T); scenes.forEach((s, i) => (s.duration = d[i]));
  st.script = { title: st.topic || 'My video', scenes }; save(); drawScript();
}

function drawScript() {
  const box = $('#vmScript'); if (!box) return; box.innerHTML = '';
  if (!st.script) { box.append(el('div', { class: 'card muted' }, el('h3', {}, '📝 Script'), el('p', {}, 'Your script will appear here. You can edit every scene before rendering.'))); return; }
  const sc = st.script.scenes; const sum = sc.reduce((a, s) => a + (+s.duration || 0), 0);
  const list = el('div', { class: 'scenes' });
  sc.forEach((s, i) => list.append(sceneCard(s, i)));
  const titleIn = el('input', { type: 'text', value: st.script.title }); titleIn.addEventListener('change', () => { st.script.title = titleIn.value; save(); });
  box.append(el('div', { class: 'card' },
    el('div', { class: 'row space' }, el('h3', {}, `📝 Script · ${sc.length} scenes`), el('span', { class: 'muted small', id: 'vmSum' }, `Scenes add up to ${sum.toFixed(1)} s → video will be exactly ${st.T} s`)),
    el('label', { class: 'field' }, el('span', { class: 'flabel' }, 'Title'), titleIn),
    list,
    el('div', { class: 'row wrap' },
      el('button', { class: 'btn', onclick: () => { sc.push(cleanScene({ layout: 'bullets', heading: 'New scene', duration: 5 })); fixDur(); } }, '＋ Add scene'),
      el('button', { class: 'btn', onclick: fixDur }, '⚖️ Fit scenes to ' + fmtTime(st.T)),
      el('button', { class: 'btn danger', onclick: async () => { if (await confirm('Clear script?', 'The current script will be removed.', 'Clear')) { st.script = null; save(); drawScript(); } } }, 'Clear')),
    el('div', { class: 'row wrap render-row' },
      el('button', { class: 'btn primary big', id: 'vmPreview', onclick: () => build('preview') }, '▶ Preview'),
      el('button', { class: 'btn primary big', id: 'vmExport', onclick: () => build('mp4') }, '⬇ Render MP4'),
      el('button', { class: 'btn', id: 'vmExportWebm', onclick: () => build('webm') }, 'Render WebM'))));
}
function fixDur() { const d = normalizeDurations(st.script.scenes, st.T); st.script.scenes.forEach((s, i) => (s.duration = d[i])); save(); drawScript(); }

function sceneCard(s, i) {
  const sc = st.script.scenes;
  const inp = (key, ph, type = 'text') => { const x = el(type === 'area' ? 'textarea' : 'input', type === 'area' ? { rows: 2, placeholder: ph } : { type, placeholder: ph }); x.value = s[key] ?? ''; x.addEventListener('change', () => { s[key] = type === 'number' ? Math.max(1, +x.value || 1) : x.value; if (key === 'imagePrompt') s.aiImageId = null; save(); if (key === 'duration') { const sum = sc.reduce((a, q) => a + (+q.duration || 0), 0); $('#vmSum').textContent = `Scenes add up to ${sum.toFixed(1)} s → will be scaled to exactly ${st.T} s`; } }); return x; };
  const lay = el('select', {}); LAYOUTS.forEach((l) => lay.append(el('option', { value: l }, LAYOUT_NAMES[l]))); lay.value = s.layout;
  lay.addEventListener('change', () => { s.layout = lay.value; save(); drawScript(); });
  const bullets = el('textarea', { rows: 3, placeholder: 'One point per line' }); bullets.value = (s.bullets || []).join('\n');
  bullets.addEventListener('change', () => { s.bullets = bullets.value.split('\n').map((x) => x.trim()).filter(Boolean); save(); });
  const imgSel = el('select', {}, el('option', { value: -1 }, st.aiImages ? 'AI picture (from description)' : 'None'), ...st.userImages.map((im, k) => el('option', { value: k }, `Photo ${k + 1}: ${im.name}`)));
  imgSel.value = s.image; imgSel.addEventListener('change', () => { s.image = +imgSel.value; save(); });
  const move = (dir) => { const j = i + dir; if (j < 0 || j >= sc.length) return; [sc[i], sc[j]] = [sc[j], sc[i]]; save(); drawScript(); };
  return el('details', { class: 'scene', open: i < 2 },
    el('summary', {}, el('span', { class: 'sc-n' }, String(i + 1)), el('span', { class: 'sc-e' }, s.emoji || '🎬'), el('span', { class: 'sc-h' }, s.heading || '(no heading)'), el('span', { class: 'muted small' }, `${LAYOUT_NAMES[s.layout]} · ${(+s.duration).toFixed(1)}s`)),
    el('div', { class: 'scene-body' },
      el('div', { class: 'row wrap' }, el('label', { class: 'field' }, 'Layout', lay), el('label', { class: 'field sm' }, 'Seconds', inp('duration', '5', 'number')), el('label', { class: 'field sm' }, 'Emoji', inp('emoji', '🎬'))),
      el('label', { class: 'field' }, 'Heading', inp('heading', 'Heading')),
      el('label', { class: 'field' }, 'On-screen text', inp('text', 'Short sentence')),
      s.layout === 'bullets' ? el('label', { class: 'field' }, 'Bullet points', bullets) : null,
      s.layout === 'big' ? el('label', { class: 'field' }, 'Big number / stat', inp('big', '71%')) : null,
      s.layout === 'image' ? el('div', {}, el('label', { class: 'field' }, 'Picture', imgSel), el('label', { class: 'field' }, 'AI picture description', inp('imagePrompt', 'e.g. a raspberry pi board on a desk, photo'))) : null,
      el('label', { class: 'field' }, 'Voice-over (what the narrator says)', inp('narration', 'Narration…', 'area')),
      el('div', { class: 'row' },
        el('button', { class: 'btn tiny', onclick: () => move(-1), 'aria-label': 'Move up' }, '↑'), el('button', { class: 'btn tiny', onclick: () => move(1), 'aria-label': 'Move down' }, '↓'),
        el('button', { class: 'btn tiny', onclick: () => { sc.splice(i + 1, 0, cleanScene({ ...s, id: uid() })); fixDur(); } }, 'Duplicate'),
        el('button', { class: 'btn tiny danger', onclick: () => { if (sc.length <= 1) return toast('A video needs at least one scene'); sc.splice(i, 1); fixDur(); } }, 'Delete'))));
}

// ---------------- build: narration, images, timing, audio ----------------
function progressUI(title) {
  const bar = el('div', { class: 'progress' }, el('i')); const label = el('div', { class: 'small muted', id: 'vmProgLabel' }, 'Starting…');
  const cancel = el('button', { class: 'btn tiny', onclick: () => abortCtl && abortCtl.abort() }, 'Cancel');
  const box = $('#vmOut'); box.innerHTML = '';
  box.append(el('div', { class: 'card', id: 'vmProg' }, el('div', { class: 'row space' }, el('h3', {}, title), cancel), bar, label));
  return { set: (p, text) => { bar.firstChild.style.width = Math.round(p * 100) + '%'; if (text) label.textContent = text; } };
}

async function getNarration(scenes, prog, signal) {
  // Group scenes into chunks of <= ~250 words to save free requests (Gemini TTS free tier is ~10 requests/day per model);
  // split each chunk back into scenes at silences. If the voice runs out part-way, keep what we have.
  const groups = []; let cur = [], words = 0;
  scenes.forEach((s, i) => { const w = (s.narration || '').trim().split(/\s+/).filter(Boolean).length; if (!w) return; if (cur.length && words + w > 250) { groups.push(cur); cur = []; words = 0; } cur.push(i); words += w; });
  if (cur.length) groups.push(cur);
  const out = scenes.map(() => null);
  let error = null, done = 0;
  for (let g = 0; g < groups.length; g++) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    const idx = groups[g]; const text = idx.map((i) => scenes[i].narration.trim()).join('\n\n');
    const key = 'tts2_' + hash(st.voice + '|' + text);
    prog.set(0.05 + 0.3 * (g / groups.length), `Recording voice-over ${g + 1} of ${groups.length}…`);
    let buf = ttsMem.get(key);
    try {
      if (!buf) {
        let wav = await blobs.get(key);
        if (!wav) { const ab = await geminiTTS(text, { voice: st.voice, signal, style: 'Say in a clear, friendly, engaging narrator voice' }); wav = new Blob([ab], { type: 'audio/wav' }); await blobs.put(key, wav); }
        buf = await decodeAudio(wav);
        if (!buf) throw new Error('Could not decode the voice-over audio.');
        ttsMem.set(key, buf);
      }
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      error = e; break; // most likely the free voice limit; the rest gets captions
    }
    const weights = idx.map((i) => scenes[i].narration.split(/\s+/).length);
    const segs = splitBySilence(buf, weights);
    idx.forEach((i, k) => { out[i] = sliceBuffer(buf, segs[k].start, segs[k].end); });
    done++;
  }
  return { out, error, done, total: groups.length };
}

async function getImages(scenes, prog, signal) {
  const bitmaps = []; // index -> ImageBitmap; user photos first
  for (const im of st.userImages) { const b = await blobs.get(im.id); bitmaps.push(b ? await createImageBitmap(b).catch(() => null) : null); }
  const resolved = scenes.map((s) => ({ ...s }));
  const need = resolved.map((s, i) => [s, i]).filter(([s]) => s.layout === 'image' && s.image < 0 && st.aiImages && (s.imagePrompt || s.heading));
  const { w, h } = sizeFor(st.aspect, '720');
  let done = 0;
  const work = need.map(([s, i]) => async () => {
    try {
      let id = scenes[i].aiImageId; let b = id ? await blobs.get(id) : null;
      if (!b) { b = await generateImage(`${s.imagePrompt || s.heading}, high quality, no text`, { width: w, height: h, signal, seed: hash(s.imagePrompt || s.heading).length * 997 }); id = 'ai_' + uid(); await blobs.put(id, b); scenes[i].aiImageId = id; }
      bitmaps.push(await createImageBitmap(b)); s.image = bitmaps.length - 1;
    } catch (e) { if (e.name === 'AbortError') throw e; s.image = -1; }
    done++; prog.set(0.35 + 0.15 * (done / need.length), `Getting AI pictures ${done} of ${need.length}…`);
  });
  // 3 at a time
  for (let k = 0; k < work.length; k += 3) await Promise.all(work.slice(k, k + 3).map((f) => f()));
  save();
  return { resolved, bitmaps };
}

async function build(mode) {
  if (!st.script || !st.script.scenes.length) return;
  if (player) player.stop();
  abortCtl = new AbortController(); const signal = abortCtl.signal;
  const T = clamp(st.T, 10, MAX_SECONDS);
  const prog = progressUI(mode === 'preview' ? 'Preparing preview' : `Rendering ${mode.toUpperCase()} · ${fmtTime(T)}`);
  const btns = ['#vmPreview', '#vmExport', '#vmExportWebm'].map((s) => $(s)); btns.forEach((b) => b && (b.disabled = true));
  try {
    const scenes = st.script.scenes;
    let narr = null, narrLens = null, notes = [];
    if (st.narration && scenes.some((s) => s.narration && s.narration.trim())) {
      const r = await getNarration(scenes, prog, signal);
      if (r.error && !r.done) { notes.push('Voice-over failed: ' + friendlyError(r.error) + ' The video was made with captions only.'); }
      else {
        narr = r.out; narrLens = narr.map((b) => (b ? b.duration : 0));
        if (r.error) { notes.push(`Voice-over stopped after part ${r.done} of ${r.total}: ${friendlyError(r.error)} The rest of the video has captions only. Render again tomorrow (the free voice limit resets daily) to get full narration; finished parts are saved and won't be re-recorded.`); }
      }
    }
    prog.set(0.35, 'Preparing pictures…');
    const { resolved, bitmaps } = await getImages(scenes, prog, signal);
    const plan = planTiming(resolved, T, narrLens); plan.scenes = resolved;
    if (plan.rate > 1.01) notes.push(`Voice-over is a bit long for ${fmtTime(T)}, so it was sped up ${(plan.rate).toFixed(2)}×.`);
    prog.set(0.5, 'Mixing audio…');
    const tracks = [];
    if (narr) narr.forEach((b, i) => { if (!b) return; const len = b.duration / plan.rate, room = plan.durs[i] - 0.3; tracks.push({ buffer: b, start: plan.starts[i] + 0.25, dur: Math.min(len, room), rate: plan.rate, gain: 1, fadeOut: len > room ? 0.15 : 0.02 }); });
    if (st.musicId) { const mb = await blobs.get(st.musicId); const buf = mb ? await decodeAudio(mb, st.musicId) : null; if (buf) tracks.push({ buffer: buf, start: 0, dur: T, loop: true, gain: narr ? st.musicVol : Math.max(st.musicVol, 0.6), fadeIn: 1, fadeOut: 2.5 }); else notes.push('Background music could not be read, skipped.'); }
    const audio = mode === 'preview' ? await mixAudio(T, tracks, { sampleRate: 24000, channels: 1 }) : makeMixer(T, tracks);
    const { w, h } = sizeFor(st.aspect, st.quality);
    const missingVoice = st.narration && (!narr || scenes.some((s, i) => s.narration && s.narration.trim() && !narr[i]));
    const opts = { W: w, H: h, theme: THEMES[st.theme] || THEMES.midnight, images: bitmaps, captions: st.captions || missingVoice };
    const draw = (ctx, t) => drawVideoFrame(ctx, t, plan, opts);
    if (mode === 'preview') { showPlayer(draw, audio, T, w, h, notes); return; }
    let res;
    try {
      res = await exportVideo({ width: w, height: h, fps: 30, duration: T, drawFrame: draw, audio, format: mode, signal,
        onProgress: (p, i, N) => prog.set(0.5 + p * 0.5, `Rendering frame ${i} of ${N}…`) });
    } catch (e) {
      if (e.code !== 'NO_WEBCODECS') throw e;
      notes.push('Your browser can’t do fast rendering, so the video was recorded in real time.');
      const c = el('canvas', { width: w, height: h, class: 'vm-canvas' }); $('#vmProg').append(c); const cx = c.getContext('2d');
      res = await recordRealtime({ canvas: c, duration: T, audio: audio && audio.isMixer ? await mixAudio(T, tracks) : audio, signal, play: (t) => draw(cx, t), onProgress: (p) => prog.set(0.5 + p * 0.5, `Recording ${fmtTime(p * T)} / ${fmtTime(T)}…`) });
    }
    showResult(res, T, notes);
  } catch (e) {
    $('#vmOut').innerHTML = '';
    if (e.name === 'AbortError') toast('Cancelled'); else { console.error(e); toast(friendlyError(e), 'error', 8000); $('#vmOut').append(el('div', { class: 'card error-box' }, '⚠️ ' + friendlyError(e))); }
  } finally { btns.forEach((b) => b && (b.disabled = false)); abortCtl = null; }
}

function showPlayer(draw, audio, T, w, h, notes) {
  const box = $('#vmOut'); box.innerHTML = '';
  const c = el('canvas', { width: w, height: h, class: 'vm-canvas', id: 'vmCanvas' }); const ctx = c.getContext('2d');
  const scrub = el('input', { type: 'range', min: 0, max: T, step: 0.05, value: 0, 'aria-label': 'Seek' });
  const time = el('span', { class: 'small mono' }, `0:00 / ${fmtTime(T)}`);
  const playBtn = el('button', { class: 'btn primary', id: 'vmPlay' }, '▶ Play');
  let ac = null, src = null, t0 = 0, off = 0, raf = 0, playing = false;
  const paint = (t) => { draw(ctx, Math.min(T - 1e-3, Math.max(0, t))); scrub.value = t; time.textContent = `${fmtTime(t)} / ${fmtTime(T)}`; };
  const stopAudio = () => { try { src && src.stop(); } catch {} src = null; };
  const loop = () => { const t = off + (ac ? ac.currentTime - t0 : (performance.now() - t0) / 1000); if (t >= T) { pause(); paint(T - 1e-3); off = 0; return; } paint(t); raf = requestAnimationFrame(loop); };
  const play = () => {
    if (playing) return; playing = true; playBtn.textContent = '⏸ Pause';
    if (audio) { ac = ac || new AudioContext(); src = ac.createBufferSource(); src.buffer = audio; src.connect(ac.destination); t0 = ac.currentTime; src.start(0, off); }
    else { ac = null; t0 = performance.now(); }
    loop();
  };
  const pause = () => { if (!playing) return; playing = false; playBtn.textContent = '▶ Play'; off = +scrub.value; cancelAnimationFrame(raf); stopAudio(); };
  playBtn.onclick = () => (playing ? pause() : play());
  scrub.addEventListener('input', () => { const was = playing; pause(); off = +scrub.value; paint(off); if (was) play(); });
  player = { stop: () => { pause(); if (ac) ac.close().catch(() => {}); ac = null; } };
  paint(0.8);
  box.append(el('div', { class: 'card' }, el('h3', {}, '👀 Preview'), el('div', { class: 'vm-stage' }, c), el('div', { class: 'row' }, playBtn, scrub, time),
    ...notes.map((n) => el('div', { class: 'note' }, 'ℹ️ ' + n)),
    el('div', { class: 'row wrap' }, el('button', { class: 'btn primary', onclick: () => build('mp4') }, '⬇ Render MP4'), el('button', { class: 'btn', onclick: () => build('webm') }, 'Render WebM'))));
}

function videoName(T, ext) {
  const base = (st.topic || st.script?.title || 'jarvis-video').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).toLowerCase() || 'jarvis-video';
  return `${base}-${Math.floor(T / 60)}m${String(Math.round(T % 60)).padStart(2, '0')}s.${ext}`;
}
async function shareOrDownload(blob, name, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  download(blob, name); toast('Sharing isn’t supported here, so it was downloaded instead.');
}
async function showResult(res, T, notes) {
  const box = $('#vmOut'); box.innerHTML = '';
  const url = URL.createObjectURL(res.blob);
  const ext = res.mime.includes('webm') ? 'webm' : 'mp4';
  const name = videoName(T, ext);
  const v = el('video', { src: url + '#t=0.8', controls: true, playsinline: true, class: 'vm-result', id: 'vmResult' });
  const info = el('div', { class: 'small muted', id: 'vmInfo' }, `${fmtBytes(res.blob.size)} · ${res.codecs.video}${res.codecs.audio ? ' + ' + res.codecs.audio : ''}`);
  v.addEventListener('loadedmetadata', () => { info.textContent = `Length ${v.duration.toFixed(2)} s · ${fmtBytes(res.blob.size)} · ${v.videoWidth}×${v.videoHeight} · ${res.codecs.video}${res.codecs.audio ? ' + ' + res.codecs.audio : ' (no sound)'}`; });
  window.__lastVideo = res; // for tests
  const file = new File([res.blob], name, { type: res.mime });
  const phone = matchMedia('(pointer: coarse)').matches || !!(navigator.canShare && navigator.canShare({ files: [file] }));
  const other = ext === 'mp4' ? 'webm' : 'mp4';
  box.append(el('div', { class: 'card' }, el('h3', {}, '✅ Your video is ready'), v, info,
    ...notes.map((n) => el('div', { class: 'note' }, 'ℹ️ ' + n)),
    el('div', { class: 'row wrap dl-row' },
      el('button', { class: 'btn primary big', id: 'vmDownload', onclick: () => download(res.blob, name) }, `⬇ Download ${ext.toUpperCase()} (${fmtBytes(res.blob.size)})`),
      phone ? el('button', { class: 'btn big', id: 'vmShare', onclick: () => shareOrDownload(res.blob, name, st.script?.title || 'Jarvis video') }, '📤 Share') : null),
    el('div', { class: 'small muted' }, `Saves as ${name}`),
    el('div', { class: 'row wrap' },
      el('button', { class: 'btn', id: other === 'webm' ? 'vmAlsoWebm' : 'vmAlsoMp4', onclick: () => build(other) }, `Also make ${other.toUpperCase()}`),
      el('button', { class: 'btn', id: 'vmToEditor', onclick: () => root._openInEditor && root._openInEditor(file) }, '✂️ Edit in Video Editor'))));
}
