// Startup intro: an original "AI HUD" boot animation, then the spoken greeting.
// Browsers block sound until the user taps, so a fresh visit ends on a power button.
import { el, $ } from './util.js';
import { settings } from './store.js';
import { pickGreeting, speak, stopSpeaking } from './greeting.js';

const STATUS = ['Initializing systems…', 'Loading neural core…', 'Calibrating voice…', 'Connecting knowledge…', 'All systems online.'];

function hud() {
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = (i / 60) * Math.PI * 2, r1 = 92, r2 = i % 5 ? 88 : 84; return `<line x1="${100 + r1 * Math.cos(a)}" y1="${100 + r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${100 + r2 * Math.sin(a)}"/>`; }).join('');
  return `<svg class="hud-svg" viewBox="0 0 200 200" aria-hidden="true">
    <defs><radialGradient id="core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#e0fbff"/><stop offset=".35" stop-color="#67e8f9"/><stop offset="1" stop-color="#0891b2" stop-opacity="0"/></radialGradient></defs>
    <g class="r r-ticks">${ticks}</g>
    <circle class="r r1" cx="100" cy="100" r="78" stroke-dasharray="40 14 6 14"/>
    <circle class="r r2" cx="100" cy="100" r="66" stroke-dasharray="120 30"/>
    <circle class="r r3" cx="100" cy="100" r="54" stroke-dasharray="3 6"/>
    <g class="r r4"><path d="M100 36 a64 64 0 0 1 55 32"/><path d="M100 164 a64 64 0 0 1 -55 -32"/></g>
    <circle class="core-glow" cx="100" cy="100" r="40" fill="url(#core)"/>
    <circle class="r core-ring" cx="100" cy="100" r="22"/>
    <g class="r tri"><path d="M100 84 L114 108 L86 108 Z"/></g>
  </svg><div class="hud-scan"></div>`;
}

export function shouldShowIntro() {
  const qp = new URLSearchParams(location.search);
  if (qp.get('intro') === '0') return false;
  if (navigator.webdriver && qp.get('intro') !== '1') return false; // automated tests opt in with ?intro=1
  return !!settings().introOn;
}

export function runIntro() {
  return new Promise((resolve) => {
    const s = settings();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const status = el('div', { class: 'intro-status', id: 'introStatus' }, STATUS[0]);
    const bar = el('div', { class: 'intro-bar' }, el('i'));
    const say = el('div', { class: 'intro-say', id: 'introSay', 'aria-live': 'polite' });
    const power = el('button', { class: 'intro-power', id: 'introStart', 'aria-label': 'Start Jarvis' }, el('span', { class: 'pw-ico' }, '⏻'), el('span', {}, 'Tap to start'));
    const skip = el('button', { class: 'intro-skip', id: 'introSkip' }, 'Skip ›');
    const title = el('div', { class: 'intro-title', 'aria-label': 'JARVIS' }, ...'JARVIS'.split('').map((c, i) => el('span', { style: { animationDelay: (0.5 + i * 0.12) + 's' } }, c)));
    const box = el('div', { class: 'intro' + (reduced ? ' reduced' : ''), id: 'intro', role: 'dialog', 'aria-label': 'Jarvis starting up' },
      el('div', { class: 'intro-grid' }), el('div', { class: 'hud', html: hud() }), title, status, bar, say, power, skip);
    document.body.append(box);
    let finished = false, timers = [];
    const later = (f, ms) => timers.push(setTimeout(f, ms));
    const finish = () => {
      if (finished) return; finished = true; timers.forEach(clearTimeout);
      document.removeEventListener('keydown', onKey);
      box.classList.add('out'); setTimeout(() => box.remove(), reduced ? 150 : 450);
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Escape') { stopSpeaking(); finish(); } else if ((e.key === 'Enter' || e.key === ' ') && box.classList.contains('ready')) { e.preventDefault(); start(); } };
    document.addEventListener('keydown', onKey);
    skip.onclick = () => { stopSpeaking(); finish(); };
    const text = pickGreeting(s);
    const typeOut = (t) => { say.textContent = ''; let i = 0; const step = () => { if (finished) return; say.textContent = t.slice(0, ++i); if (i < t.length) later(step, 28); }; step(); };
    let started = false;
    async function start() {
      if (started) return; started = true;
      box.classList.remove('ready'); box.classList.add('speaking');
      typeOut(text);
      if (!s.greetVoiceOn) { later(finish, 1600); return; }
      try {
        const r = await speak(text);
        later(finish, 9000); // safety
        r.done.catch(() => {}).finally(() => later(finish, 500));
      } catch { later(finish, 1600); }
    }
    power.onclick = start;
    // boot sequence
    const T = reduced ? 600 : 2600;
    STATUS.forEach((m, i) => later(() => { status.textContent = m; }, (T / STATUS.length) * i));
    later(async () => {
      box.classList.add('booted');
      if (!s.greetVoiceOn) { start(); return; }
      if (sessionStorage.getItem('jarvis.introSeen') === '1') {
        // later launch in this session: try to speak straight away; fall back to the button if sound is blocked
        try {
          started = true; box.classList.add('speaking'); typeOut(text);
          const r = await speak(text);
          r.done.then(() => later(finish, 500), () => { started = false; box.classList.remove('speaking'); box.classList.add('ready'); });
          later(finish, 9000);
        } catch { started = false; box.classList.remove('speaking'); box.classList.add('ready'); say.textContent = ''; }
      } else box.classList.add('ready');
      sessionStorage.setItem('jarvis.introSeen', '1');
    }, T);
  });
}
