// Live preview of HTML/CSS/JS answers in a sandboxed iframe (no access to Jarvis or your keys).
import { el, $, download, toast, esc } from './util.js';
import { extractCode, extFor } from './markdown.js';

const KIND = (lang, name = '') => {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['html', 'htm', 'xml', 'svg'].includes(lang) || ['html', 'htm'].includes(ext)) return lang === 'svg' || ext === 'svg' ? 'svg' : 'html';
  if (lang === 'css' || ext === 'css') return 'css';
  if (['js', 'javascript', 'jsx', 'mjs'].includes(lang) || ['js', 'mjs'].includes(ext)) return 'js';
  return 'other';
};

// Turn code blocks into a file map {name: code}
export function filesFromBlocks(blocks) {
  const files = {}; const used = new Set(); let n = { html: 0, css: 0, js: 0, other: 0 };
  for (const b of blocks) {
    const k = KIND(b.lang, b.name);
    let name = b.name;
    if (!name) {
      if (k === 'html') name = n.html ? `page${n.html + 1}.html` : 'index.html';
      else if (k === 'css') name = n.css ? `style${n.css + 1}.css` : 'style.css';
      else if (k === 'js') name = n.js ? `script${n.js + 1}.js` : 'script.js';
      else if (k === 'svg') name = 'image.svg';
      else name = `file${n.other + 1}.${extFor(b.lang)}`;
    }
    n[k === 'svg' ? 'html' : k] = (n[k === 'svg' ? 'html' : k] || 0) + 1;
    while (used.has(name)) name = name.replace(/(\.\w+)?$/, (e) => '-2' + (e || ''));
    used.add(name); files[name] = b.code;
  }
  return files;
}

const CONSOLE_SHIM = `<script>(function(){var send=function(t,a){try{parent.postMessage({__jarvisPreview:1,type:t,msg:Array.prototype.map.call(a,function(x){try{return typeof x==='object'?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};['log','info','warn','error'].forEach(function(k){var o=console[k];console[k]=function(){send(k,arguments);o&&o.apply(console,arguments)}});window.addEventListener('error',function(e){send('error',[e.message+(e.lineno?' (line '+e.lineno+')':'')])});window.addEventListener('unhandledrejection',function(e){send('error',['Unhandled promise: '+(e.reason&&e.reason.message||e.reason)])});['localStorage','sessionStorage'].forEach(function(n){try{window[n].length}catch(e){var d={},m={getItem:function(k){return k in d?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null}};Object.defineProperty(m,'length',{get:function(){return Object.keys(d).length}});try{Object.defineProperty(window,n,{value:m,configurable:true,writable:true})}catch(e2){try{Object.defineProperty(window,n,{get:function(){return m},configurable:true})}catch(e3){}}}});})();<\/script>`;

export function buildDocument(files) {
  const names = Object.keys(files);
  const htmlName = names.find((n) => /^index\.html?$/i.test(n)) || names.find((n) => /\.html?$/i.test(n));
  const svgName = names.find((n) => /\.svg$/i.test(n));
  const css = names.filter((n) => /\.css$/i.test(n)), js = names.filter((n) => /\.m?js$/i.test(n));
  let doc;
  if (htmlName) doc = files[htmlName];
  else if (svgName && !js.length) doc = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;display:grid;place-items:center;min-height:100vh">${files[svgName]}</body></html>`;
  else doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>`;
  if (!/<html[\s>]/i.test(doc)) doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${doc}</body></html>`;
  // Inline referenced local files; append unreferenced CSS/JS.
  for (const c of css) {
    const re = new RegExp(`<link[^>]+href=["']\\.?/?${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i');
    if (re.test(doc)) doc = doc.replace(re, () => `<style>\n${files[c]}\n</style>`);
    else doc = doc.replace(/<\/head>/i, () => `<style>\n${files[c]}\n</style></head>`);
  }
  for (const j of js) {
    const re = new RegExp(`<script([^>]*)src=["']\\.?/?${j.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']([^>]*)>\\s*</script>`, 'i');
    const mod = /\bimport\s|export\s/.test(files[j]) ? ' type="module"' : '';
    if (re.test(doc)) doc = doc.replace(re, (m, a, b) => `<script${/type=/.test(a + b) ? ` ${(a + b).match(/type=["'][^"']+["']/)[0]}` : mod}>\n${files[j]}\n</script>`);
    else if (/<\/body>/i.test(doc)) doc = doc.replace(/<\/body>(?![\s\S]*<\/body>)/i, () => `<script${mod}>\n${files[j]}\n</script></body>`);
    else doc += `<script${mod}>\n${files[j]}\n</script>`;
  }
  // Console bridge first thing in <head>.
  if (/<head(\s[^>]*)?>/i.test(doc)) doc = doc.replace(/<head(\s[^>]*)?>/i, (m) => m + CONSOLE_SHIM);
  else if (/<html[^>]*>/i.test(doc)) doc = doc.replace(/<html[^>]*>/i, (m) => m + '<head>' + CONSOLE_SHIM + '</head>');
  else doc = CONSOLE_SHIM + doc;
  return doc;
}

let panel = null, state = null;
export function openPreview({ source, single = null, title = 'Preview', onFix = null, onPush = null }) {
  const blocks = single ? [single] : extractCode(source);
  const files = filesFromBlocks(blocks.filter((b) => b.code.trim()));
  if (!Object.keys(files).length) { toast('No code found to preview.'); return; }
  state = { files, onFix, onPush, title, logs: [] };
  if (!panel) build();
  panel.classList.add('open');
  document.body.classList.add('preview-open');
  $('#pvTitle').textContent = title;
  renderCode(); run();
}
export function closePreview() { if (panel) { panel.classList.remove('open'); document.body.classList.remove('preview-open'); const f = $('#pvFrame'); f && (f.srcdoc = ''); } }

function build() {
  panel = el('aside', { id: 'previewPanel', class: 'preview-panel', 'aria-label': 'Code preview' },
    el('div', { class: 'pv-head' },
      el('strong', { id: 'pvTitle' }, 'Preview'),
      el('div', { class: 'seg', id: 'pvTabs' },
        el('button', { class: 'on', 'data-tab': 'preview', onclick: () => tab('preview') }, 'Preview'),
        el('button', { 'data-tab': 'code', onclick: () => tab('code') }, 'Code')),
      el('div', { class: 'pv-actions' },
        el('button', { class: 'icon-btn', title: 'Reload', 'aria-label': 'Reload preview', onclick: run }, '⟳'),
        el('button', { class: 'icon-btn', title: 'Open in new tab', 'aria-label': 'Open in new tab', onclick: openTab }, '↗'),
        el('button', { class: 'icon-btn', title: 'Full screen', 'aria-label': 'Full screen', onclick: () => panel.classList.toggle('full') }, '⛶'),
        el('button', { class: 'icon-btn', title: 'Close', 'aria-label': 'Close preview', onclick: closePreview }, '✕'))),
    el('div', { class: 'pv-body' },
      el('div', { class: 'pv-pane on', 'data-pane': 'preview' },
        el('iframe', { id: 'pvFrame', title: 'App preview', sandbox: 'allow-scripts allow-modals allow-forms allow-pointer-lock allow-popups allow-downloads', allow: 'fullscreen; gamepad; accelerometer; gyroscope' })),
      el('div', { class: 'pv-pane', 'data-pane': 'code' }, el('div', { id: 'pvCode' }))),
    el('div', { class: 'pv-console', id: 'pvConsole' }, el('div', { class: 'pv-console-head' }, el('span', { id: 'pvConsoleLabel' }, 'Console'),
      el('button', { class: 'btn tiny', id: 'pvFix', style: { display: 'none' }, onclick: () => state.onFix && state.onFix(state.logs.filter((l) => l.type === 'error').map((l) => l.msg).join('\n')) }, '🛠 Ask Jarvis to fix')),
      el('div', { id: 'pvLogs' })),
    el('div', { class: 'pv-foot' },
      el('button', { class: 'btn', onclick: () => download(buildDocument(state.files), 'app.html', 'text/html') }, '⬇ HTML file'),
      el('button', { class: 'btn', onclick: zip }, '⬇ ZIP'),
      el('button', { class: 'btn', id: 'pvPush', onclick: () => state.onPush && state.onPush(state.files) }, '🐙 Push to GitHub')));
  document.body.append(panel);
  window.addEventListener('message', (e) => {
    const d = e.data; if (!d || !d.__jarvisPreview || !state) return;
    if (e.source !== $('#pvFrame').contentWindow) return;
    state.logs.push(d); if (state.logs.length > 200) state.logs.shift();
    const row = el('div', { class: 'log ' + d.type }, d.msg);
    $('#pvLogs').append(row); $('#pvLogs').scrollTop = 1e9;
    const errs = state.logs.filter((l) => l.type === 'error').length;
    $('#pvConsoleLabel').textContent = `Console${errs ? ` · ${errs} error${errs > 1 ? 's' : ''}` : ''}`;
    $('#pvConsole').classList.toggle('has-err', errs > 0);
    $('#pvFix').style.display = errs && state.onFix ? '' : 'none';
  });
}
function tab(t) {
  panel.querySelectorAll('#pvTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  panel.querySelectorAll('.pv-pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === t));
}
function renderCode() {
  const box = $('#pvCode'); box.innerHTML = '';
  for (const [name, code] of Object.entries(state.files)) {
    box.append(el('div', { class: 'pv-file' }, el('div', { class: 'pv-file-name' }, name), el('pre', {}, el('code', {}, code))));
  }
}
function run() {
  state.logs = []; $('#pvLogs').innerHTML = ''; $('#pvConsoleLabel').textContent = 'Console'; $('#pvConsole').classList.remove('has-err'); $('#pvFix').style.display = 'none';
  $('#pvPush').style.display = state.onPush ? '' : 'none';
  const f = $('#pvFrame');
  f.srcdoc = buildDocument(state.files);
  setTimeout(() => { try { f.focus(); } catch {} }, 300);
}
function openTab() {
  const url = URL.createObjectURL(new Blob([buildDocument(state.files)], { type: 'text/html' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 120000);
}
export async function loadJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((res, rej) => { const s = document.createElement('script'); s.src = new URL('../lib/jszip.min.js', import.meta.url).href; s.onload = res; s.onerror = () => rej(new Error('Could not load ZIP library')); document.head.append(s); });
  return window.JSZip;
}
async function zip() {
  try {
    const JSZip = await loadJSZip(); const z = new JSZip();
    for (const [n, c] of Object.entries(state.files)) z.file(n, c);
    download(await z.generateAsync({ type: 'blob' }), (state.title || 'project').replace(/[^\w-]+/g, '-').slice(0, 40).toLowerCase() + '.zip');
  } catch (e) { toast(e.message, 'error'); }
}
export function currentFiles() { return state && state.files; }
