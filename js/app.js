import { shouldShowIntro, runIntro } from './intro.js';
// Jarvis AI: app shell, routing, theme, onboarding, PWA.
import { $, $$, el, toast, modal } from './util.js';
import { settings, saveSettings, onSettings, persist, cleanKey } from './store.js';
import { initChat, initSources, openChat, refreshList, closeSources, updateModelChip, renderAll } from './chat.js';
import { renderSettings } from './settings.js';
import { renderConnectors } from './connectors.js';
import { testGeminiKey, friendlyError } from './providers.js';

// Hidden test mode: ?mock=1 uses a fake AI so every screen can be tested without a key.
const qp = new URLSearchParams(location.search);
if (qp.get('mock') === '1') sessionStorage.setItem('jarvis.mock', '1');
if (qp.get('mock') === '0') sessionStorage.removeItem('jarvis.mock');

function applyTheme() {
  const t = settings().theme;
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0d12' : '#ffffff');
}
applyTheme();
onSettings((s, patch) => { if (patch && 'theme' in patch) applyTheme(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

const VIEWS = ['chat', 'video', 'exam', 'connectors', 'settings'];
const TITLES = { video: 'Video Studio', exam: 'Exam Mode', connectors: 'Connectors', settings: 'Settings' };
let lastView = '';
async function route() {
  const [, view = 'chat', arg = ''] = (location.hash || '#/chat').split('/');
  const v = VIEWS.includes(view) ? view : 'chat';
  if (lastView === 'video' && v !== 'video') { try { (await import('./video/studio.js')).leaveStudio(); } catch {} }
  lastView = v;
  $$('.view').forEach((x) => x.classList.toggle('on', x.id === 'view-' + v));
  $$('.nav-item').forEach((x) => x.classList.toggle('on', x.dataset.view === v));
  document.body.dataset.view = v;
  document.body.classList.remove('sidebar-open');
  if (v !== 'chat') { closeSources(); $('#topTitle').textContent = TITLES[v]; }
  try {
    if (v === 'chat') await openChat(arg || null);
    else if (v === 'settings') renderSettings();
    else if (v === 'connectors') renderConnectors();
    else if (v === 'video') { const { renderStudio } = await import('./video/studio.js'); await renderStudio(arg); }
    else if (v === 'exam') { const { renderExam } = await import('./exam.js'); await renderExam(); }
  } catch (e) { console.error(e); toast('Something went wrong: ' + e.message, 'error'); }
}

async function onboarding() {
  const s = settings();
  if (s.onboarded || s.geminiKey || sessionStorage.getItem('jarvis.mock') === '1') return;
  const key = el('input', { type: 'password', placeholder: 'Paste your key (AIza…)', autocomplete: 'off', id: 'obKey' });
  key.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); key.closest('.modal')?.querySelector('.btn.primary')?.click(); } });
  const status = el('div', { class: 'small' });
  const content = el('div', { class: 'stack' },
    el('p', {}, 'Jarvis is your own free AI app. It runs in your browser using a free Google Gemini key, so you never pay for tokens.'),
    el('ol', {}, el('li', {}, 'Open ', el('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), ' and sign in with Google.'), el('li', {}, 'Tap “Create API key” and copy it.'), el('li', {}, 'Paste it here.')),
    key, status,
    el('p', { class: 'small muted' }, 'The key stays only on this device. On the free tier Google may use prompts to improve its products, so avoid private info.'));
  await modal({ title: '👋 Welcome to Jarvis', content, buttons: [
    { label: 'Later', value: 'later' },
    { label: 'Save key', primary: true, value: () => { const k = cleanKey(key.value); if (k) { saveSettings({ geminiKey: k }); testGeminiKey(k).then(() => toast('✅ Key works! Say hi to Jarvis.')).catch((e) => toast('Key problem: ' + friendlyError(e), 'error', 7000)); } return 'save'; } },
  ] });
  saveSettings({ onboarded: true });
  renderAll();
}

// PWA install
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#installBtn').style.display = ''; });
async function install() {
  if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $('#installBtn').style.display = 'none'; }
  else toast('To install: open the browser menu (⋮) → “Add to Home screen” / “Install app”. On iPhone: Share → Add to Home Screen.', 'info', 7000);
}

// Global safety net: any unexpected error shows a message instead of failing silently.
let lastErrToast = 0;
function showGlobalError(msg) {
  const now = Date.now(); if (now - lastErrToast < 4000) return; lastErrToast = now;
  try { toast('⚠️ Something went wrong: ' + String(msg || 'unknown error').slice(0, 140) + '. If Jarvis seems stuck, reload the page.', 'error', 8000); } catch {}
}
window.addEventListener('error', (e) => { if (e && e.message && !/ResizeObserver loop/.test(e.message)) { console.error('Jarvis error:', e.message); showGlobalError(e.message); } });
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason; if (r && (r.name === 'AbortError' || r.name === 'NotAllowedError')) return;
  console.error('Jarvis unhandled:', r); showGlobalError(r && r.message ? r.message : r);
});

// Updates: a tab that was open while a new version arrived gets a Reload button.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return; reloaded = true;
    // Pages load fresh files from the network first, so a just-opened page is already current. Only long-open tabs get a nudge.
    if (performance.now() < 30000) return;
    toast(el('span', {}, '✨ Jarvis was updated. ', el('button', { class: 'btn primary tiny', onclick: () => location.reload() }, 'Reload')), 'info', 12000);
  });
}

function init() {
  $('#menuBtn').addEventListener('click', () => document.body.classList.toggle('sidebar-open'));
  $('#scrim').addEventListener('click', () => { document.body.classList.remove('sidebar-open'); closeSources(); });
  const newChat = () => { if (location.hash === '#/chat') openChat(null); else location.hash = '#/chat'; setTimeout(() => $('#input')?.focus(), 50); };
  $('#newChatBtn').addEventListener('click', newChat); $('#topNewBtn').addEventListener('click', newChat);
  $('#modelChip').addEventListener('click', () => (location.hash = '#/settings'));
  $('#themeBtn').addEventListener('click', () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; saveSettings({ theme: t }); });
  $('#installBtn').addEventListener('click', install);
  $('#helpInstall').addEventListener('click', install);
  initChat(); initSources();
  window.addEventListener('hashchange', route);
  route();
  persist();
  if (shouldShowIntro()) runIntro().catch(() => {}).then(() => setTimeout(onboarding, 200)); else setTimeout(onboarding, 400);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || qp.get('sw') === '1')) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((r) => { try { r.update(); } catch {} }).catch((e) => console.warn('SW', e));
  window.__jarvisReady = true;
}
init();
