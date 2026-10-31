// Owner lock: only the owner (or someone who knows the owner's full name) can change settings on this device.
// Honest limit: this is a lock inside this browser's copy of the app, not a server account.
import { $, el, toast, modal } from './util.js';
import { settings, setWriteGuard } from './store.js';

const OKEY = 'jarvis.owner.v1';
const UNLOCK_MS = 30 * 60e3;
// SHA-256 of 'jarvis-owner-v1|' + the owner's full name (lowercase, no spaces). The name itself is not stored here.
const NAME_HASH = '93c53bb8b8bbd1cb4bafb5125d4e85ddbcc936211cec4e9cddbe2c8d2fffa16e';
// Only the first name is ever shown: the full name is the unlock, so the app never displays it.
export const OWNER_FIRST = 'Anurag';
export const ownerLabel = () => OWNER_FIRST;
export const WELCOME = `Welcome back, ${OWNER_FIRST} sir.`;
// Settings anyone may change while locked (cosmetic or per-chat): everything else needs the owner.
const FREE_KEYS = new Set(['theme', 'webSearch', 'onboarded']);

let until = 0, timer = 0, fails = 0, coolUntil = 0;
const listeners = new Set();
export function onOwnerChange(f) { listeners.add(f); return () => listeners.delete(f); }
const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

export function isUnlocked() { return Date.now() < until; }
export function unlockLeftMin() { return Math.max(0, Math.ceil((until - Date.now()) / 60e3)); }
export function hasPassword() { try { return !!JSON.parse(localStorage.getItem(OKEY) || 'null')?.hash; } catch { return false; } }
function unlock() { until = Date.now() + UNLOCK_MS; fails = 0; clearTimeout(timer); timer = setTimeout(lockNow, UNLOCK_MS + 50); emit(); }
export function lockNow() { until = 0; clearTimeout(timer); emit(); }

// ---------- hashing ----------
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function sha256hex(s) { const d = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function pbkdf2(pw, salt, iter) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, k, 256);
}
export async function setPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iter = 150000;
  const hash = await pbkdf2(pw, salt, iter);
  localStorage.setItem(OKEY, JSON.stringify({ v: 1, salt: b64(salt), iter, hash: b64(hash), set: Date.now() }));
  emit();
}
async function checkPassword(pw) {
  let o; try { o = JSON.parse(localStorage.getItem(OKEY) || 'null'); } catch { o = null; }
  if (!o || !o.hash || !pw) return false;
  const h = b64(await pbkdf2(pw, unb64(o.salt), o.iter || 150000));
  return h === o.hash;
}

// ---------- the owner's name ----------
const norm = (t) => String(t || '').normalize('NFKC').toLowerCase().replace(/[’'`]/g, '').replace(/[^a-z0-9\u0900-\u097f]+/g, ' ').trim();
const LEAD = /^(?:(?:hi|hey|hello|ok|okay|yo|namaste)\s+)?(?:jarvis\s+)?/;
const INTRO = /^(?:my\s+name\s+is|my\s+names|my\s+name|myself|i\s+am|im|this\s+is|it\s+is|its|mera\s+naam|mera\s+nam|main)\s+(.+)$/;
/** Quick check, no hashing: does this look like "my name is …"? */
export function looksLikeIntro(text) { const t = norm(text).replace(LEAD, ''); return t.length < 80 && INTRO.test(t); }
async function nameMatches(words) {
  for (let k = 1; k <= Math.min(3, words.length); k++) if ((await sha256hex('jarvis-owner-v1|' + words.slice(0, k).join(''))) === NAME_HASH) return true;
  return false;
}
/** True if the text is "my name is <owner>" (or I am / this is / mera naam …), any case or spacing. */
export async function isOwnerIntro(text) {
  const t = norm(text).replace(LEAD, ''); if (t.length >= 80) return false;
  const m = t.match(INTRO); return !!m && nameMatches(m[1].split(' '));
}
async function isOwnerName(text) {
  const t = norm(text); if (!t || t.length >= 80) return false;
  return (await isOwnerIntro(t)) || nameMatches([t.replace(/\s+/g, '')]);
}
/** Chat / voice: "my name is <owner>" unlocks. Returns 'unlocked' | 'already' | null (not the owner's name). */
export async function tryChatUnlock(text) {
  if (!looksLikeIntro(text)) return null;
  if (!(await isOwnerIntro(text))) return null;
  if (isUnlocked()) { unlock(); return 'already'; }
  unlock(); return 'unlocked';
}
/** Unlock screen: owner password or the owner's full name. */
export async function tryUnlock(input) {
  if (Date.now() < coolUntil) return { ok: false, wait: Math.ceil((coolUntil - Date.now()) / 1000) };
  const v = String(input || '');
  const ok = (await checkPassword(v)) || (await checkPassword(v.trim())) || (await isOwnerName(v));
  if (ok) { unlock(); return { ok: true }; }
  fails++; if (fails >= 5) { coolUntil = Date.now() + 30e3; fails = 0; }
  return { ok: false };
}

// ---------- dialogs ----------
export function unlockDialog() {
  const inp = el('input', { type: 'password', id: 'ownerUnlockInput', autocomplete: 'off', spellcheck: 'false', placeholder: hasPassword() ? 'Owner password or full name' : 'Owner’s full name' });
  const eye = el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Show or hide', onclick: () => { inp.type = inp.type === 'password' ? 'text' : 'password'; } }, '👁');
  const msg = el('div', { class: 'small', id: 'ownerUnlockMsg' });
  return modal({
    title: '🔒 Owner lock',
    content: el('div', { class: 'stack' },
      el('p', { class: 'small' }, 'Only the owner can change settings on this device. ' + (hasPassword() ? 'Enter the owner password, or the owner’s full name.' : 'Enter the owner’s full name.')),
      el('div', { class: 'key-row' }, inp, eye), msg),
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (box, close) => {
      const go = async () => {
        btn.disabled = true; msg.textContent = 'Checking…'; msg.className = 'small muted';
        const r = await tryUnlock(inp.value);
        btn.disabled = false;
        if (r.ok) { close(true); toast(`👋 ${WELCOME} Unlocked for 30 minutes.` + (hasPassword() ? '' : ' Please set an owner password in Settings.'), 'info', 5000); return; }
        msg.className = 'small bad'; msg.textContent = r.wait ? `Too many tries. Wait ${r.wait} s.` : '❌ That’s not right.';
        inp.select();
      };
      const btn = el('button', { class: 'btn primary', id: 'ownerUnlockBtn', onclick: go }, '🔓 Unlock');
      box.querySelector('.modal-foot').append(btn);
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    },
  });
}
/** Resolve true if the owner is (or becomes) unlocked. */
export async function requireOwner() { if (isUnlocked()) return true; return !!(await unlockDialog()) && isUnlocked(); }

export function passwordDialog() {
  const a = el('input', { type: 'password', id: 'ownerPw1', autocomplete: 'new-password', placeholder: 'New owner password' });
  const b = el('input', { type: 'password', id: 'ownerPw2', autocomplete: 'new-password', placeholder: 'Type it again' });
  const msg = el('div', { class: 'small bad', id: 'ownerPwMsg' });
  return modal({
    title: hasPassword() ? '🔑 Change owner password' : '🔑 Set owner password',
    content: el('div', { class: 'stack' }, el('p', { class: 'small muted' }, 'Saved on this device only, as a scrambled code (never as plain text). If you forget it, unlock with your full name and set a new one.'), a, b, msg),
    buttons: [{ label: 'Cancel', value: null }],
    onOpen: (box, close) => {
      const go = async () => {
        if (!isUnlocked()) { msg.textContent = 'Unlock first.'; return; }
        if (a.value.length < 4) { msg.textContent = 'Use at least 4 characters.'; return; }
        if (a.value !== b.value) { msg.textContent = 'The two passwords don’t match.'; return; }
        save.disabled = true; await setPassword(a.value); close(true); toast('🔑 Owner password saved', 'info');
      };
      const save = el('button', { class: 'btn primary', id: 'ownerPwSave', onclick: go }, 'Save password');
      box.querySelector('.modal-foot').append(save);
      b.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    },
  });
}

// ---------- the guard on every settings change ----------
let lastToast = 0;
setWriteGuard((patch) => {
  if (isUnlocked() || !settings().onboarded) return true; // first setup on a new device is allowed
  if (Object.keys(patch).every((k) => FREE_KEYS.has(k))) return true;
  if (Date.now() - lastToast > 1500) {
    lastToast = Date.now();
    const t = toast(el('span', {}, '🔒 Settings are locked. Only the owner can change them. ', el('button', { class: 'btn primary tiny', onclick: () => { t.remove(); unlockDialog(); } }, 'Unlock')), 'info', 6000);
  }
  return false;
});
