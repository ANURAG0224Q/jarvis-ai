import { $, el, toast, confirm, download, pickFiles, uid, fmtBytes, modal, prompt } from './util.js';
import { settings, saveSettings, GEMINI_MODELS, GEMINI_VOICES, GROQ_MODELS, convs, blobs, usage, resetSettings, cleanKey } from './store.js';
import { testGeminiKey, openRouterFreeModels, friendlyError, geminiTTS, modelLabel } from './providers.js';
import { usageToday, resetLabel, resetUsage } from './usage.js';
import { PRESETS } from './presets.js';
import { pickGreeting, speak, precache, state as gstate } from './greeting.js';
import { runIntro } from './intro.js';
import { refreshList } from './chat.js';
import { blobToBase64, base64ToBlob } from './util.js';

export const APP_VERSION = '1.1.2';

function field(label, input, help) { return el('label', { class: 'field' }, el('span', { class: 'flabel' }, label), input, help ? el('small', { class: 'muted' }, help) : null); }
function toggle(key, label, help) {
  const i = el('input', { type: 'checkbox', checked: !!settings()[key], id: 'set-' + key });
  i.addEventListener('change', () => saveSettings({ [key]: i.checked }));
  return el('label', { class: 'toggle-row' }, el('span', {}, el('b', {}, label), help ? el('small', { class: 'muted block' }, help) : null), el('span', { class: 'switch' }, i, el('i')));
}
function bindInput(input, key, transform = (v) => v) {
  input.value = settings()[key] ?? '';
  input.addEventListener('change', () => saveSettings({ [key]: transform(input.value) }));
  return input;
}
function keyInput(key, placeholder) {
  const i = el('input', { type: 'password', placeholder, autocomplete: 'off', spellcheck: 'false', id: 'set-' + key });
  bindInput(i, key, cleanKey);
  // Save as soon as a key is pasted (not only when the field loses focus), and show the cleaned key.
  i.addEventListener('input', () => { const k = cleanKey(i.value); if (k !== (settings()[key] || '')) saveSettings({ [key]: k }); });
  i.addEventListener('change', () => { const k = cleanKey(i.value); if (i.value !== k) i.value = k; });
  const eye = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Show or hide key', onclick: () => { i.type = i.type === 'password' ? 'text' : 'password'; } }, '👁');
  return el('div', { class: 'key-row' }, i, eye);
}
function section(title, ...kids) { return el('section', { class: 'card' }, el('h2', {}, title), ...kids); }

export function renderSettings() {
  const root = $('#view-settings'); root.innerHTML = '';
  const s = settings();
  const wrap = el('div', { class: 'page' }, el('h1', {}, '⚙️ Settings'));

  // ---------- Provider ----------
  const provSeg = el('div', { class: 'seg', role: 'tablist' });
  const provBody = el('div');
  const provs = [['gemini', 'Gemini (free)'], ['groq', 'Groq'], ['openrouter', 'OpenRouter'], ['custom', 'Custom']];
  provs.forEach(([id, label]) => provSeg.append(el('button', { class: s.provider === id ? 'on' : '', 'data-p': id, onclick: () => { saveSettings({ provider: id }); renderSettings(); } }, label)));
  if (s.provider === 'gemini') {
    const modelSel = el('select', { id: 'set-model' });
    const fillModels = (extra = []) => {
      modelSel.innerHTML = '';
      GEMINI_MODELS.forEach((m) => modelSel.append(el('option', { value: m.id }, `${m.label} — ${m.note}`)));
      extra.filter((id) => !GEMINI_MODELS.some((m) => m.id === id)).forEach((id) => modelSel.append(el('option', { value: id }, id)));
      if (![...modelSel.options].some((o) => o.value === settings().model)) modelSel.append(el('option', { value: settings().model }, settings().model));
      modelSel.value = settings().model;
    };
    fillModels();
    modelSel.addEventListener('change', () => saveSettings({ model: modelSel.value }));
    const status = el('div', { class: 'small', id: 'keyStatus' });
    const testBtn = el('button', { class: 'btn', onclick: async () => {
      status.textContent = 'Checking…';
      try { const ms = await testGeminiKey(settings().geminiKey, settings().geminiBase); status.innerHTML = ''; status.append(el('span', { class: 'ok' }, `✅ Key works. ${ms.length} models available.`)); fillModels(ms.filter((m) => /gemini|gemma/.test(m) && !/tts|image|embedding|live|audio|robotics|computer|transcribe|deep-research|antigravity|lyria|aqa|omni|banana/.test(m))); }
      catch (e) { status.innerHTML = ''; status.append(el('span', { class: 'bad' }, '❌ ' + friendlyError(e))); }
    } }, 'Test key');
    provBody.append(
      el('div', { class: 'howto' },
        el('b', {}, 'Get your free key (1 minute, no card):'),
        el('ol', {}, el('li', {}, 'Open ', el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), ' and sign in with Google.'), el('li', {}, 'Tap “Create API key”, then copy it.'), el('li', {}, 'Paste it below and tap Test key.'))),
      field('Gemini API key', keyInput('geminiKey', 'AIza…'), 'Stored only in this browser. It is sent only to Google.'),
      el('div', { class: 'row' }, testBtn, status),
      field('Model', modelSel, 'Gemini 3.8 Flash is the smartest free model but allows only about 20 messages a day. Flash-Lite models allow about 500.'),
      toggle('autoFallback', 'Auto-switch model when a limit is hit', 'Tries 3.8 Flash → 3.6 Flash → 3 Flash (preview) → 3.5 Flash-Lite → 3.1 Flash-Lite → Gemma 4, then your backup keys below, so chat keeps working all day.'),
      el('details', { class: 'adv', id: 'backupKeys' }, el('summary', {}, 'Backup keys (free, optional): more chats per day'),
        el('p', { class: 'small muted' }, 'When every free Gemini model hits its daily limit, Jarvis switches to these. Both are free with no card.'),
        field('Groq API key', keyInput('groqKey', 'gsk_…'), el('span', {}, 'Free at ', el('a', { href: 'https://console.groq.com/keys', target: '_blank', rel: 'noopener' }, 'console.groq.com/keys'), ': very fast, about 1,000 requests/day per model.')),
        field('OpenRouter API key', keyInput('openrouterKey', 'sk-or-…'), el('span', {}, 'Free at ', el('a', { href: 'https://openrouter.ai/keys', target: '_blank', rel: 'noopener' }, 'openrouter.ai/keys'), ': free “:free” models, about 50 requests/day.'))),
      el('p', { class: 'privacy' }, '🔒 Privacy: on Google’s free tier, your prompts may be used to improve Google’s products (outside the EU/UK). Don’t paste passwords or private data.'),
      el('details', { class: 'adv' }, el('summary', {}, 'Advanced'),
        field('Custom Gemini endpoint (optional)', bindInput(el('input', { type: 'url', placeholder: 'https://generativelanguage.googleapis.com', id: 'set-geminiBase' }), 'geminiBase', (v) => v.trim()), 'Only change this if you use your own proxy. Leave empty normally.')));
  } else if (s.provider === 'groq') {
    const ms = el('select', { id: 'set-groqModel' }); [...new Set([s.groqModel, ...GROQ_MODELS])].forEach((m) => ms.append(el('option', { value: m }, m))); ms.value = s.groqModel;
    ms.addEventListener('change', () => saveSettings({ groqModel: ms.value }));
    provBody.append(el('div', { class: 'howto' }, 'Free key: ', el('a', { href: 'https://console.groq.com/keys', target: '_blank', rel: 'noopener' }, 'console.groq.com/keys'), '. Very fast; about 1,000 free requests/day. Text and images only (no PDFs/videos).'),
      field('Groq API key', keyInput('groqKey', 'gsk_…')), field('Model', ms));
  } else if (s.provider === 'openrouter') {
    const ms = el('select', { id: 'set-openrouterModel' }); ms.append(el('option', { value: s.openrouterModel }, s.openrouterModel)); ms.value = s.openrouterModel;
    ms.addEventListener('change', () => saveSettings({ openrouterModel: ms.value }));
    openRouterFreeModels().then((list) => { list.forEach((m) => { if (m !== s.openrouterModel) ms.append(el('option', { value: m }, m)); }); }).catch(() => {});
    provBody.append(el('div', { class: 'howto' }, 'Free key: ', el('a', { href: 'https://openrouter.ai/keys', target: '_blank', rel: 'noopener' }, 'openrouter.ai/keys'), '. One key, many free models (":free"), about 50 free requests/day.'),
      field('OpenRouter API key', keyInput('openrouterKey', 'sk-or-…')), field('Free model', ms));
  } else {
    provBody.append(el('div', { class: 'howto' }, 'Any OpenAI-compatible API (e.g. a local Ollama / LM Studio server at http://localhost:11434/v1).'),
      field('Base URL', bindInput(el('input', { type: 'url', placeholder: 'https://api.example.com/v1', id: 'set-customBase' }), 'customBase', (v) => v.trim())),
      field('API key (if needed)', keyInput('customKey', 'key')),
      field('Model name', bindInput(el('input', { type: 'text', placeholder: 'model-id', id: 'set-customModel' }), 'customModel', (v) => v.trim())));
  }
  wrap.append(section('🧠 AI model', provSeg, provBody));

  // ---------- Response ----------
  const temp = el('input', { type: 'range', min: 0, max: 2, step: 0.1, value: s.temperature });
  const tempV = el('span', { class: 'muted' }, String(s.temperature));
  temp.addEventListener('input', () => { tempV.textContent = temp.value; });
  temp.addEventListener('change', () => saveSettings({ temperature: +temp.value }));
  const think = el('select', {}, el('option', { value: 'default' }, 'Default'), el('option', { value: 'low' }, 'Low (faster)'), el('option', { value: 'high' }, 'High (smarter, slower)'));
  think.value = s.thinking; think.addEventListener('change', () => saveSettings({ thinking: think.value }));
  wrap.append(section('💬 Answers',
    field('Creativity (temperature)', el('div', { class: 'row' }, temp, tempV), 'Lower = more focused, higher = more creative. Gemini works best at 1.0.'),
    field('Thinking level (Gemini 3)', think),
    toggle('showThinking', 'Show the model’s thoughts', 'A collapsible “Thoughts” box above answers when the model shares them.'),
    toggle('sendOnEnter', 'Enter sends (desktop)', 'Shift+Enter for a new line. On phones the send button is used.')));

  // ---------- Personalisation ----------
  const sys = el('textarea', { rows: 4, placeholder: 'e.g. I am Anurag, an engineering student in Bengaluru. Explain simply, use examples, reply in English.', id: 'set-systemPrompt' });
  bindInput(sys, 'systemPrompt');
  const name = bindInput(el('input', { type: 'text', placeholder: 'Your name', id: 'set-userName' }), 'userName', (v) => v.trim());
  const memList = el('div', { class: 'mem-list' });
  const drawMem = () => {
    memList.innerHTML = '';
    const mem = settings().memory || [];
    if (!mem.length) memList.append(el('div', { class: 'muted small' }, 'Nothing saved yet. Tap 🧠 under any of your messages, or add here.'));
    mem.forEach((m) => memList.append(el('div', { class: 'mem' }, el('span', {}, m.text), el('button', { class: 'icon-btn', 'aria-label': 'Forget', onclick: () => { saveSettings({ memory: settings().memory.filter((x) => x.id !== m.id) }); drawMem(); } }, '✕'))));
  };
  drawMem();
  wrap.append(section('🙋 Personalise',
    field('Your name', name),
    field('Custom instructions (used in every chat)', sys),
    toggle('memoryOn', 'Use memory', 'Facts you saved are added to every chat.'),
    memList,
    el('button', { class: 'btn', onclick: async () => { const t = await prompt('Add to memory', '', { okLabel: 'Add', placeholder: 'e.g. My exams end on 1 Nov' }); if (t && t.trim()) { saveSettings({ memory: [...(settings().memory || []), { id: uid(), text: t.trim() }] }); drawMem(); } } }, '＋ Add memory')));

  // ---------- Custom modes ----------
  const modes = el('div', { class: 'stack' });
  const drawModes = () => {
    modes.innerHTML = '';
    modes.append(el('div', { class: 'muted small' }, 'Built in: ' + PRESETS.map((p) => p.icon + ' ' + p.name).join(' · ')));
    (settings().customPresets || []).forEach((p) => modes.append(el('div', { class: 'mem' }, el('span', {}, `${p.icon} ${p.name}`), el('button', { class: 'icon-btn', 'aria-label': 'Delete mode', onclick: () => { saveSettings({ customPresets: settings().customPresets.filter((x) => x.id !== p.id) }); drawModes(); } }, '✕'))));
  };
  drawModes();
  wrap.append(section('🎭 Modes', modes, el('button', { class: 'btn', onclick: async () => {
    const n = el('input', { type: 'text', placeholder: 'Name, e.g. Physics teacher' }); const ic = el('input', { type: 'text', value: '⭐', maxlength: 4, style: { width: '4em' } }); const pr = el('textarea', { rows: 5, placeholder: 'How should Jarvis behave in this mode?' });
    const ok = await modal({ title: 'New mode', content: el('div', { class: 'stack' }, field('Name', n), field('Emoji', ic), field('Instructions', pr)), buttons: [{ label: 'Cancel', value: false }, { label: 'Create', value: true, primary: true }] });
    if (ok && n.value.trim()) { saveSettings({ customPresets: [...(settings().customPresets || []), { id: 'c_' + uid(), name: n.value.trim(), icon: ic.value || '⭐', desc: 'Custom', prompt: pr.value }] }); drawModes(); toast('Mode created: pick it from the mode menu under the chat box'); }
  } }, '＋ New mode')));


  // ---------- Startup & greeting ----------
  {
    const gStatus = el('div', { class: 'small muted', id: 'greetStatus' });
    let pcT = 0;
    const recache = () => { clearTimeout(pcT); pcT = setTimeout(async () => { const r = await precache(); if (r.failed) gStatus.textContent = 'Gemini voice not available right now (' + friendlyError(r.failed) + '). The device voice will be used.'; else if (r.made) gStatus.textContent = `✅ Saved ${r.made} new voice clip${r.made > 1 ? 's' : ''} for launch.`; }, 1200); };
    const save = (patch) => { saveSettings(patch); recache(); };
    const txt = (key, ph, id) => { const i = el('input', { type: 'text', value: settings()[key] || '', placeholder: ph, id, lang: 'mul' }); i.addEventListener('change', () => save({ [key]: i.value })); return i; };
    const mode = el('select', { id: 'greetMode' }, el('option', { value: 'one' }, 'Always use my main greeting'), el('option', { value: 'random' }, 'Pick randomly from my list'), el('option', { value: 'time' }, 'By time of day'));
    mode.value = s.greetMode || 'one';
    const listBox = el('div', { class: 'stack', id: 'greetList' });
    const drawList = () => {
      listBox.innerHTML = '';
      (settings().greetList || []).forEach((g, i) => {
        const inp = el('input', { type: 'text', value: g, lang: 'mul' });
        inp.addEventListener('change', () => { const l = [...settings().greetList]; l[i] = inp.value; save({ greetList: l }); });
        listBox.append(el('div', { class: 'row' }, inp, el('button', { class: 'icon-btn', 'aria-label': 'Delete greeting', onclick: () => { const l = [...settings().greetList]; l.splice(i, 1); save({ greetList: l }); drawList(); } }, '🗑️')));
      });
      listBox.append(el('button', { class: 'btn tiny', id: 'greetAdd', onclick: () => { save({ greetList: [...(settings().greetList || []), 'Namaste {name}, Jarvis online.'] }); drawList(); listBox.querySelectorAll('input')[settings().greetList.length - 1]?.select(); } }, '＋ Add greeting'));
    };
    drawList();
    const randomBox = el('div', { class: 'stack' }, el('span', { class: 'flabel' }, 'Saved greetings (random mode also uses the main one)'), listBox);
    const timeBox = el('div', { class: 'stack' }, field('Morning (before 12)', txt('greetMorning', 'Good morning, {name}.', 'greetMorning')), field('Afternoon (12–5 pm)', txt('greetAfternoon', 'Good afternoon, {name}.', 'greetAfternoon')), field('Evening (after 5 pm)', txt('greetEvening', 'Good evening, {name}.', 'greetEvening')));
    const showMode = () => { randomBox.style.display = mode.value === 'random' ? '' : 'none'; timeBox.style.display = mode.value === 'time' ? '' : 'none'; };
    mode.addEventListener('change', () => { save({ greetMode: mode.value }); showMode(); }); showMode();
    const vsel = el('select', { id: 'greetVoice' });
    const fillGV = () => {
      const cur = settings().greetVoice || 'gemini:Charon'; vsel.innerHTML = '';
      const g1 = el('optgroup', { label: 'Gemini voices (natural, uses free quota once per text)' }); GEMINI_VOICES.forEach((v) => g1.append(el('option', { value: 'gemini:' + v }, v + (v === 'Charon' ? ' (deep, calm)' : v === 'Fenrir' ? ' (strong)' : v === 'Orus' ? ' (firm)' : ''))));
      const g2 = el('optgroup', { label: 'This device’s voices (offline)' }); g2.append(el('option', { value: 'system:' }, 'Automatic device voice'));
      (window.speechSynthesis ? speechSynthesis.getVoices() : []).forEach((v) => g2.append(el('option', { value: 'system:' + v.voiceURI }, `${v.name} (${v.lang})`)));
      vsel.append(g1, g2); vsel.value = cur; if (vsel.value !== cur) vsel.append(el('option', { value: cur, selected: true }, cur));
    };
    fillGV(); if (window.speechSynthesis) speechSynthesis.addEventListener?.('voiceschanged', fillGV);
    vsel.addEventListener('change', () => save({ greetVoice: vsel.value }));
    const preview = el('button', { class: 'btn primary', id: 'greetPreview', onclick: async () => {
      preview.disabled = true; gStatus.textContent = 'Speaking…';
      try { const text = pickGreeting(); const r = await speak(text, { allowNetwork: true }); gStatus.textContent = `“${text}” · ${r.method === 'gemini-voice' ? 'Gemini voice (saved for launch)' : 'device voice' + (gstate.ttsError ? ' (Gemini voice not available: ' + friendlyError(gstate.ttsError) + ')' : '')}`; gstate.ttsError = null; await r.done.catch(() => {}); }
      catch (e) { gStatus.textContent = 'Could not play sound: ' + e.message; }
      preview.disabled = false;
    } }, '▶ Preview greeting');
    wrap.append(section('👋 Startup & greeting',
      toggle('introOn', 'Startup animation', 'Shows the Jarvis boot screen when the app opens. Tap or press Esc to skip.'),
      toggle('greetVoiceOn', 'Speak the greeting', 'Browsers only allow sound after a tap, so the first launch ends on a “Tap to start” button.'),
      field('What should Jarvis call you?', txt('greetName', 'sir', 'greetName')),
      field('Main greeting', txt('greetText', 'Hello {name}, I am Jarvis.', 'greetText'), 'Use {name}, {greeting} (Good morning/afternoon/evening), {time}, {day}. Any language works, e.g. नमस्ते {name}.'),
      field('Which greeting to use', mode), randomBox, timeBox,
      field('Greeting voice', vsel, 'Gemini makes the clip once per text and saves it on this device. Greetings with {time} use the device voice (they change every minute).'),
      el('div', { class: 'row wrap' }, preview, el('button', { class: 'btn', id: 'introReplay', onclick: () => runIntro() }, '🎬 Play intro now')), gStatus));
  }

  // ---------- Voice ----------
  const eng = el('select', {}, el('option', { value: 'browser' }, 'Phone/browser voice (offline, unlimited)'), el('option', { value: 'gemini' }, 'Gemini voice (natural, uses free quota)'));
  eng.value = s.ttsEngine; eng.addEventListener('change', () => saveSettings({ ttsEngine: eng.value }));
  const vSel = el('select', {}, el('option', { value: '' }, 'Automatic'));
  const fillVoices = () => { const vs = window.speechSynthesis ? speechSynthesis.getVoices() : []; vSel.innerHTML = ''; vSel.append(el('option', { value: '' }, 'Automatic')); vs.forEach((v) => vSel.append(el('option', { value: v.name }, `${v.name} (${v.lang})`))); vSel.value = settings().ttsVoice || ''; };
  fillVoices(); if (window.speechSynthesis) speechSynthesis.onvoiceschanged = fillVoices;
  vSel.addEventListener('change', () => saveSettings({ ttsVoice: vSel.value }));
  const gv = el('select', {}); GEMINI_VOICES.forEach((v) => gv.append(el('option', { value: v }, v))); gv.value = s.geminiVoice; gv.addEventListener('change', () => saveSettings({ geminiVoice: gv.value }));
  const lang = el('select', {}, ...[['en-IN', 'English (India)'], ['en-US', 'English (US)'], ['hi-IN', 'Hindi'], ['kn-IN', 'Kannada'], ['ta-IN', 'Tamil'], ['te-IN', 'Telugu'], ['mr-IN', 'Marathi'], ['bn-IN', 'Bengali']].map(([v, l]) => el('option', { value: v }, l)));
  lang.value = s.voiceLang || 'en-IN'; lang.addEventListener('change', () => saveSettings({ voiceLang: lang.value }));
  wrap.append(section('🎙️ Voice', toggle('wakeWord', '“Hey Jarvis” wake phrase', 'Listens for “Hey Jarvis” while this tab is open and on screen, then takes your command. Uses the microphone continuously. Works in Chrome / Edge (on a computer or Android). Off by default.'),
    el('p', { class: 'small muted' }, 'Voice chat: tap 🎧 next to the message box. Jarvis listens, answers out loud, then listens again. Tap the voice bar to interrupt. Works in Chrome / Edge. In Edge on Windows, “Online speech recognition” must be on (Windows Settings → Privacy & security → Speech).'),
    field('Read-aloud engine', eng), field('Browser voice', vSel), field('Gemini voice', el('div', { class: 'row' }, gv, el('button', { class: 'btn', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const w = await geminiTTS('Hi! I am Jarvis, your AI assistant.', { voice: gv.value }); new Audio(URL.createObjectURL(new Blob([w], { type: 'audio/wav' }))).play(); } catch (err) { toast(friendlyError(err), 'error'); } b.disabled = false; } }, '▶ Try'))), field('Voice typing language', lang)));

  // ---------- Web search ----------
  wrap.append(section('🌐 Web search',
    toggle('webSearch', 'Search the web (free)', 'Jarvis searches the web before answering, gives the results to the AI and shows numbered sources. Works with no key (free, with a fair-use limit). You can also turn it on per chat from the + menu.'),
    field('Tavily API key (optional)', keyInput('tavilyKey', 'tvly-…'), el('span', {}, 'For more searches: free key at ', el('a', { href: 'https://app.tavily.com', target: '_blank', rel: 'noopener' }, 'app.tavily.com'), ' (sign in with Google, 1,000 searches/month, no card).')),
    el('details', { class: 'adv' }, el('summary', {}, 'Backup search & advanced'),
      field('Serper.dev key (optional backup, Google results)', keyInput('serperKey', 'key'), el('span', {}, 'Free at ', el('a', { href: 'https://serper.dev', target: '_blank', rel: 'noopener' }, 'serper.dev'), ': 2,500 free searches, no card. Used only if Tavily fails.')),
      toggle('googleGrounding', 'Use Gemini’s own Google Search instead', 'Only for paid Gemini keys: Google charges for Search grounding on Gemini 3 models. Leave off on a free key.'))));

  // ---------- Free usage today ----------
  const useBox = el('div', { id: 'usageBox' });
  const drawUse = () => {
    useBox.innerHTML = '';
    const u = usageToday(); const names = Object.keys(u.n).concat(Object.keys(u.lim).filter((k) => !(k in u.n)));
    const cap = (k) => /flash-lite/.test(k) ? '~500' : /gemini-3/.test(k) ? '~20' : /^groq:/.test(k) ? '~1,000' : /^openrouter:/.test(k) ? '~50' : /tavily-keyless/.test(k) ? 'fair use' : /search:tavily/.test(k) ? '1,000/month' : '';
    const nice = (k) => k.startsWith('search:') ? { 'search:tavily': 'Web search (Tavily key)', 'search:tavily-keyless': 'Web search (free, no key)', 'search:serper': 'Web search (Serper)', 'search:mock': 'Web search (test)' }[k] || k : modelLabel(k.includes(':') ? { p: k.split(':')[0], model: k.split(':').slice(1).join(':') } : { p: 'gemini', model: k });
    if (!names.length) useBox.append(el('p', { class: 'muted small' }, 'No requests yet today.'));
    else useBox.append(el('table', { class: 'usage' }, el('tr', {}, el('th', {}, 'Model / service'), el('th', {}, 'Used'), el('th', {}, 'Free limit')),
      names.map((k) => el('tr', {}, el('td', {}, nice(k)), el('td', {}, String(u.n[k] || 0)), el('td', {}, u.lim[k] ? el('span', { class: 'bad' }, 'reached') : cap(k))))));
    useBox.append(el('p', { class: 'muted small' }, `Counted in this browser. Google’s daily free limits reset at ${resetLabel()}. When one model runs out, Jarvis switches to the next automatically.`));
  };
  drawUse();
  wrap.append(section('📊 Free usage today', useBox, el('div', { class: 'row' }, el('button', { class: 'btn', onclick: drawUse }, 'Refresh'), el('button', { class: 'btn', onclick: () => { resetUsage(); drawUse(); } }, 'Reset counter'))));

  // ---------- Browser actions ----------
  wrap.append(section('🧭 Browser actions',
    el('p', { class: 'small' }, 'Say or type things like “open YouTube”, “open Gmail”, “search YouTube for lofi”, “play Believer on YouTube” or “google cricket score”. Jarvis opens them in a new tab.'),
    el('p', { class: 'small muted' }, 'Honest limit: a website can only open tabs and links. Jarvis cannot control other apps, files or settings on your laptop or phone.'),
    el('p', { class: 'small muted' }, 'Tip: if Chrome blocks the new tab, tap the pop-up icon at the right of the address bar → “Always allow pop-ups from this site”. Jarvis also shows an “Open” button you can tap.')));

  // ---------- Appearance ----------
  const th = el('div', { class: 'seg' });
  [['dark', '🌙 Dark'], ['light', '☀️ Light'], ['system', '🖥 System']].forEach(([id, l]) => th.append(el('button', { class: s.theme === id ? 'on' : '', onclick: () => { saveSettings({ theme: id }); renderSettings(); } }, l)));
  wrap.append(section('🎨 Appearance', th));

  // ---------- Data ----------
  const use = el('span', { class: 'muted small' });
  usage().then((u) => { if (u) use.textContent = `Storage used: ${fmtBytes(u.usage)} of ~${fmtBytes(u.quota)}`; });
  wrap.append(section('💾 Your data',
    el('p', { class: 'muted small' }, 'Everything (chats, files, keys) is saved only in this browser on this device. Nothing is uploaded to any Jarvis server: there is none.'),
    el('div', { class: 'row wrap' },
      el('button', { class: 'btn', onclick: exportAll }, '⬇ Export all chats'),
      el('button', { class: 'btn', onclick: importAll }, '⬆ Import chats'),
      el('button', { class: 'btn danger', onclick: async () => { if (await confirm('Delete all chats?', 'All chats, sources and files saved in Jarvis on this device will be deleted. Settings and keys stay.')) { await convs.clear(); await blobs.clear(); refreshList(); location.hash = '#/chat'; toast('All chats deleted'); } } }, '🗑 Delete all chats'),
      el('button', { class: 'btn danger', onclick: async () => { if (await confirm('Reset settings?', 'Keys, memory and preferences will be removed from this browser.', 'Reset')) { resetSettings(); location.reload(); } } }, 'Reset settings')),
    use));

  wrap.append(section('ℹ️ About',
    el('p', {}, `Jarvis AI v${APP_VERSION}: a free, open-source AI app that runs entirely in your browser with your own free API key.`),
    el('ul', { class: 'small' },
      el('li', {}, 'Free limits come from Google (or Groq/OpenRouter), not from Jarvis. They can change.'),
      el('li', {}, 'Images are made with the free Pollinations.ai service. Web pages are read with the free r.jina.ai reader.'),
      el('li', {}, 'Video Studio renders videos on your device. It makes animated explainer videos and edits your own clips; it does not generate realistic AI footage (that needs paid models).')),
    el('p', {}, el('a', { href: 'https://github.com/ANURAG0224Q/jarvis-ai', target: '_blank', rel: 'noopener' }, 'Source code on GitHub'))));
  root.append(wrap);
}

async function exportAll() {
  const all = await convs.all();
  const out = { app: 'jarvis-ai', version: 1, exported: new Date().toISOString(), convs: all, blobs: {} };
  for (const c of all) {
    const ids = [...c.messages.flatMap((m) => [...(m.attachments || []), ...((m.versions || []).flatMap((v) => v.images || []))]), ...(c.sources || [])].map((a) => a.blobId).filter(Boolean);
    for (const id of ids) { const b = await blobs.get(id); if (b && b.size < 8 * 1024 * 1024) out.blobs[id] = { mime: b.type, data: await blobToBase64(b) }; }
  }
  download(JSON.stringify(out), `jarvis-chats-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  toast(`Exported ${all.length} chats`);
}
async function importAll() {
  const [f] = await pickFiles({ accept: '.json,application/json', multiple: false });
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== 'jarvis-ai' || !Array.isArray(j.convs)) throw new Error('This is not a Jarvis export file.');
    for (const [id, b] of Object.entries(j.blobs || {})) await blobs.put(id, base64ToBlob(b.data, b.mime));
    for (const c of j.convs) await convs.put(c);
    refreshList(); toast(`Imported ${j.convs.length} chats`);
  } catch (e) { toast('Import failed: ' + e.message, 'error'); }
}
