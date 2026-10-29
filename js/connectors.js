import { $, el, toast, esc, fmtBytes, pickFiles, fileKind, guessMime } from './util.js';
import { settings } from './store.js';
import { github } from './github.js';
import { addSource, addFileSources, currentConv } from './chat.js';

let ghState = { repo: null, files: [], branch: '', filter: '' };

function card(icon, title, status, desc, ...body) {
  return el('section', { class: 'card conn' }, el('div', { class: 'conn-head' }, el('span', { class: 'conn-icon' }, icon), el('div', {}, el('h2', {}, title), el('span', { class: 'badge ' + (status === 'Connected' || status === 'Built in' ? 'ok' : '') }, status))), el('p', { class: 'muted small' }, desc), ...body);
}

export function renderConnectors() {
  const root = $('#view-connectors'); root.innerHTML = '';
  const page = el('div', { class: 'page' }, el('h1', {}, '🔌 Connectors'),
    el('p', { class: 'muted' }, 'Connect your accounts and data so Jarvis can use them. Everything runs in your browser; tokens stay on this device.'));
  const c = currentConv();
  if (c) page.append(el('div', { class: 'note' }, `Files you add here go to the chat “${c.title}”.`));
  else page.append(el('div', { class: 'note' }, 'Files you add here start a new chat.'));

  // GitHub
  const gh = el('div', { id: 'ghBox' });
  page.append(card('🐙', 'GitHub', github.connected() ? 'Connected' : 'Not connected',
    'Read files from your repositories as chat sources, and push apps/websites that Jarvis builds straight to a repo (with a free GitHub Pages website link).', gh));
  drawGitHub(gh);

  // Web + YouTube (built in)
  page.append(card('🌐', 'Web pages', 'Built in', 'Paste any public link in Sources: Jarvis reads the page text (free r.jina.ai reader) and Gemini can open links too.',
    el('button', { class: 'btn', onclick: () => { location.hash = '#/chat'; setTimeout(() => $('#srcAddLink').click(), 200); } }, 'Add a link')));
  page.append(card('▶️', 'YouTube', 'Built in', 'Add a public YouTube link as a source and ask questions about the video: summaries, notes, timestamps. Uses Gemini’s free YouTube understanding (Gemini models only).',
    el('button', { class: 'btn', onclick: () => { location.hash = '#/chat'; setTimeout(() => $('#srcAddLink').click(), 200); } }, 'Add a YouTube link')));
  // Local folder
  page.append(card('📁', 'Folder from your device', 'Built in', 'Pick a project folder; its text/code files (up to 300 files, 5 MB) become sources so Jarvis can read your whole project.',
    el('button', { class: 'btn', onclick: pickFolder }, 'Choose folder')));
  // Honest list
  page.append(card('🔒', 'Google Drive, Gmail, Notion…', 'Not available', 'These need a company server and a verified Google/Notion app login, which a free app with no server can’t do safely. Workaround: download the file and add it as a source.'));
  root.append(page);
}

async function pickFolder() {
  const inp = el('input', { type: 'file', webkitdirectory: true, multiple: true, style: { display: 'none' } });
  document.body.append(inp);
  inp.addEventListener('change', async () => {
    const files = [...inp.files].filter((f) => fileKind(f.name, guessMime(f.name, f.type)) === 'text' && !/(^|\/)(node_modules|\.git|dist|build|\.next)\//.test(f.webkitRelativePath));
    inp.remove();
    let total = 0, parts = [], n = 0;
    for (const f of files) { if (n >= 300 || total + f.size > 5e6) break; total += f.size; n++; parts.push(`### ${f.webkitRelativePath || f.name}\n\`\`\`\n${await f.text()}\n\`\`\``); }
    if (!n) { toast('No text/code files found in that folder.', 'error'); return; }
    const name = (files[0].webkitRelativePath || '').split('/')[0] || 'Folder';
    await addSource({ type: 'text', name: `📁 ${name} (${n} files)`, text: parts.join('\n\n'), size: total, detail: `${n} files · ${fmtBytes(total)}` });
    toast(`Added ${n} files from ${name}`);
  });
  inp.click();
}

function drawGitHub(box) {
  box.innerHTML = '';
  if (!github.connected()) {
    const tok = el('input', { type: 'password', placeholder: 'ghp_… or github_pat_…', autocomplete: 'off', id: 'ghToken' });
    const btn = el('button', { class: 'btn primary', onclick: async () => {
      if (!tok.value.trim()) return toast('Paste a token first', 'error');
      btn.disabled = true; btn.textContent = 'Connecting…';
      try { const u = await github.connect(tok.value.trim()); toast(`Connected as ${u.login}`); drawGitHub(box); renderConnectors(); }
      catch (e) { toast(e.message, 'error', 6000); btn.disabled = false; btn.textContent = 'Connect'; }
    } }, 'Connect');
    box.append(el('ol', { class: 'small howto' },
      el('li', {}, 'Open ', el('a', { href: 'https://github.com/settings/tokens/new?scopes=repo&description=Jarvis%20AI', target: '_blank', rel: 'noopener' }, 'GitHub → New token (classic)'), ' (it pre-selects the “repo” permission).'),
      el('li', {}, 'Choose an expiry, tap “Generate token”, copy it.'),
      el('li', {}, 'Paste it here. It is stored only in this browser and sent only to github.com.')),
      el('div', { class: 'key-row' }, tok, btn));
    return;
  }
  box.append(el('div', { class: 'row' }, el('span', {}, `Signed in as `, el('b', {}, settings().githubUser)), el('button', { class: 'btn tiny', onclick: () => { github.disconnect(); ghState = { repo: null, files: [] }; renderConnectors(); } }, 'Disconnect')));
  const browser = el('div', { class: 'gh-browser' });
  box.append(browser);
  if (!ghState.repo) {
    browser.append(el('div', { class: 'muted small' }, 'Loading repositories…'));
    github.repos().then((repos) => {
      browser.innerHTML = '';
      const q = el('input', { type: 'search', placeholder: 'Search repositories' });
      const list = el('div', { class: 'gh-list' });
      const draw = () => { list.innerHTML = ''; repos.filter((r) => r.full_name.toLowerCase().includes(q.value.toLowerCase())).forEach((r) => list.append(el('button', { class: 'gh-item', onclick: () => openRepo(r, box) }, el('span', {}, (r.private ? '🔒 ' : '📦 ') + r.full_name), el('small', { class: 'muted' }, r.description || '')))); if (!list.children.length) list.append(el('div', { class: 'muted small' }, 'No repositories.')); };
      q.addEventListener('input', draw); draw();
      browser.append(q, list);
    }).catch((e) => { browser.innerHTML = ''; browser.append(el('div', { class: 'bad small' }, e.message)); });
  } else drawRepo(browser, box);
}
async function openRepo(r, box) {
  ghState = { repo: r, files: [], branch: '', filter: '', loading: true };
  drawGitHub(box);
  try { const t = await github.tree(r.owner.login, r.name); ghState.files = t.files; ghState.branch = t.branch; ghState.truncated = t.truncated; }
  catch (e) { toast(e.message, 'error'); ghState.error = e.message; }
  ghState.loading = false; drawGitHub(box);
}
function drawRepo(browser, box) {
  const r = ghState.repo;
  browser.append(el('div', { class: 'row' }, el('button', { class: 'btn tiny', onclick: () => { ghState = { repo: null, files: [] }; drawGitHub(box); } }, '‹ Repos'), el('b', {}, r.full_name), el('small', { class: 'muted' }, ghState.branch)));
  if (ghState.loading) { browser.append(el('div', { class: 'muted small' }, 'Loading files…')); return; }
  if (ghState.error) { browser.append(el('div', { class: 'bad small' }, ghState.error)); return; }
  const q = el('input', { type: 'search', placeholder: `Filter ${ghState.files.length} files` });
  const list = el('div', { class: 'gh-list' });
  const draw = () => {
    list.innerHTML = '';
    ghState.files.filter((f) => f.path.toLowerCase().includes(q.value.toLowerCase())).slice(0, 300).forEach((f) => {
      const isText = fileKind(f.path, guessMime(f.path)) === 'text' || !/\.\w+$/.test(f.path);
      list.append(el('div', { class: 'gh-file' }, el('span', { class: 'gh-path' }, (isText ? '📄 ' : '📎 ') + f.path), el('small', { class: 'muted' }, fmtBytes(f.size)),
        isText ? el('button', { class: 'btn tiny', onclick: (e) => addGhFile(f, e.currentTarget) }, 'Add to chat') : el('small', { class: 'muted' }, 'binary')));
    });
  };
  q.addEventListener('input', draw); draw();
  browser.append(q, list,
    el('button', { class: 'btn', onclick: addWholeRepo }, '📚 Add all code files (up to 1.5 MB)'));
}
async function addGhFile(f, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = ghState.repo; const text = await github.readFile(r.owner.login, r.name, f.path, ghState.branch);
    await addSource({ type: 'github', name: `${r.name}/${f.path}`, url: `https://github.com/${r.full_name}/blob/${ghState.branch}/${f.path}`, text, size: text.length, detail: 'GitHub file' });
    btn.textContent = 'Added ✓'; toast(`Added ${f.path}`);
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = 'Add to chat'; }
}
async function addWholeRepo() {
  const r = ghState.repo;
  const files = ghState.files.filter((f) => fileKind(f.path, guessMime(f.path)) === 'text' && !/(^|\/)(node_modules|dist|build|vendor|\.min\.)/.test(f.path) && f.size < 200000);
  let total = 0; const pick = [];
  for (const f of files) { if (total + f.size > 1.5e6 || pick.length >= 120) break; total += f.size; pick.push(f); }
  if (!pick.length) return toast('No code files found.', 'error');
  const t = toast(`Reading ${pick.length} files…`, 'info', 120000);
  const parts = [];
  for (const f of pick) { try { parts.push(`### ${f.path}\n\`\`\`\n${await github.readFile(r.owner.login, r.name, f.path, ghState.branch)}\n\`\`\``); } catch {} }
  t.remove();
  await addSource({ type: 'github', name: `🐙 ${r.full_name} (${parts.length} files)`, url: `https://github.com/${r.full_name}`, text: parts.join('\n\n'), size: total, detail: `${parts.length} files · ${fmtBytes(total)}` });
  toast(`Added ${parts.length} files from ${r.name}`);
}
