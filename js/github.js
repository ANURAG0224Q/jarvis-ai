// GitHub connector: uses YOUR personal access token, straight from the browser to api.github.com.
import { settings, saveSettings } from './store.js';
import { el, toast, modal, esc } from './util.js';

const API = 'https://api.github.com';
function base() { return (window.__JARVIS_GH_API || API); }
async function gh(path, { method = 'GET', body, token } = {}) {
  const t = token ?? settings().githubToken;
  const res = await fetch(base() + path, {
    method,
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(t ? { authorization: `Bearer ${t}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const txt = await res.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch {}
  if (!res.ok) {
    const msg = (j && (j.message + (j.errors ? ': ' + j.errors.map((e) => e.message || e.code).join(', ') : ''))) || txt || res.statusText;
    const err = new Error(res.status === 401 ? 'GitHub rejected the token (401). Create a new token and paste it again.' : res.status === 403 && /rate limit/i.test(msg) ? 'GitHub rate limit reached. Try again later.' : `GitHub: ${msg} (${res.status})`);
    err.status = res.status; throw err;
  }
  return j;
}
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
function b64utf8(str) { const bytes = new TextEncoder().encode(str); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function utf8b64(b64) { const bin = atob(b64.replace(/\s/g, '')); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new TextDecoder().decode(u); }

export const github = {
  connected: () => !!settings().githubToken,
  async connect(token) {
    const u = await gh('/user', { token });
    saveSettings({ githubToken: token, githubUser: u.login });
    return u;
  },
  disconnect() { saveSettings({ githubToken: '', githubUser: '' }); },
  repos: () => gh('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator'),
  async tree(owner, repo, branch) {
    const r = branch ? null : await gh(`/repos/${owner}/${repo}`);
    const br = branch || r.default_branch;
    const t = await gh(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(br)}?recursive=1`);
    return { branch: br, files: (t.tree || []).filter((x) => x.type === 'blob'), truncated: t.truncated };
  },
  async readFile(owner, repo, path, ref) {
    const j = await gh(`/repos/${owner}/${repo}/contents/${enc(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
    if (Array.isArray(j)) throw new Error('That path is a folder.');
    if (j.size > 1000000 && !j.content) throw new Error('File is larger than 1 MB; GitHub API cannot return it this way.');
    return utf8b64(j.content || '');
  },
  createRepo: (name, { isPrivate = false, description = 'Made with Jarvis AI' } = {}) => gh('/user/repos', { method: 'POST', body: { name, private: isPrivate, description, auto_init: true } }),
  async pushFiles(owner, repo, files, { message = 'Update from Jarvis AI', branch, prefix = '' } = {}) {
    const info = await gh(`/repos/${owner}/${repo}`);
    const br = branch || info.default_branch || 'main';
    const pre = prefix ? prefix.replace(/^\/+|\/+$/g, '') + '/' : '';
    let ref;
    try { ref = await gh(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(br)}`); } catch (e) { if (e.status !== 404 && e.status !== 409) throw e; }
    if (!ref) {
      // Empty repository: the contents API creates the first commit.
      for (const [p, c] of Object.entries(files)) await gh(`/repos/${owner}/${repo}/contents/${enc(pre + p)}`, { method: 'PUT', body: { message, content: b64utf8(c), branch: br } });
      return { branch: br, commitUrl: `https://github.com/${owner}/${repo}/tree/${br}` };
    }
    const baseCommit = await gh(`/repos/${owner}/${repo}/git/commits/${ref.object.sha}`);
    const tree = [];
    for (const [p, c] of Object.entries(files)) {
      const blob = await gh(`/repos/${owner}/${repo}/git/blobs`, { method: 'POST', body: { content: b64utf8(c), encoding: 'base64' } });
      tree.push({ path: pre + p, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await gh(`/repos/${owner}/${repo}/git/trees`, { method: 'POST', body: { base_tree: baseCommit.tree.sha, tree } });
    const commit = await gh(`/repos/${owner}/${repo}/git/commits`, { method: 'POST', body: { message, tree: newTree.sha, parents: [ref.object.sha] } });
    await gh(`/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(br)}`, { method: 'PATCH', body: { sha: commit.sha } });
    return { branch: br, commitUrl: commit.html_url || `https://github.com/${owner}/${repo}/commit/${commit.sha}` };
  },
  async enablePages(owner, repo, branch) {
    try { const p = await gh(`/repos/${owner}/${repo}/pages`, { method: 'POST', body: { source: { branch, path: '/' } } }); return p.html_url || `https://${owner.toLowerCase()}.github.io/${repo}/`; }
    catch (e) {
      if (e.status === 409 || /already/i.test(e.message)) { const p = await gh(`/repos/${owner}/${repo}/pages`); return p.html_url; }
      throw e;
    }
  },
};

// Dialog: push a set of files to GitHub (from the code preview).
export async function pushDialog(files, suggestedName = 'my-jarvis-app') {
  if (!github.connected()) { toast('Connect GitHub first (Connectors page).', 'error'); location.hash = '#/connectors'; return; }
  const repoSel = el('select', {}, el('option', { value: '__new' }, '➕ New repository…'));
  const newName = el('input', { type: 'text', value: suggestedName.replace(/[^\w.-]+/g, '-').toLowerCase().slice(0, 60) });
  const priv = el('input', { type: 'checkbox' });
  const pages = el('input', { type: 'checkbox', checked: true });
  const msg = el('input', { type: 'text', value: 'Add app made with Jarvis AI' });
  const status = el('div', { class: 'muted small' }, 'Loading your repositories…');
  const list = Object.keys(files).map((f) => el('code', { class: 'chip-mini' }, f));
  github.repos().then((rs) => { rs.forEach((r) => repoSel.append(el('option', { value: r.full_name }, r.full_name))); status.textContent = `${rs.length} repositories`; }).catch((e) => { status.textContent = e.message; });
  const newRow = el('label', { class: 'field' }, 'New repository name', newName, el('span', { class: 'row' }, priv, ' Private'));
  repoSel.addEventListener('change', () => { newRow.style.display = repoSel.value === '__new' ? '' : 'none'; });
  const content = el('div', { class: 'stack' },
    el('div', { class: 'row wrap' }, ...list),
    el('label', { class: 'field' }, 'Repository', repoSel), newRow,
    el('label', { class: 'field' }, 'Commit message', msg),
    el('label', { class: 'row' }, pages, ' Turn on GitHub Pages (free live website link)'),
    status);
  const ok = await modal({ title: 'Push to GitHub', content, buttons: [{ label: 'Cancel', value: false }, { label: 'Push', value: true, primary: true }] });
  if (!ok) return;
  const t = toast('Pushing to GitHub…', 'info', 60000);
  try {
    let owner, repo;
    if (repoSel.value === '__new') {
      const r = await github.createRepo(newName.value.trim(), { isPrivate: priv.checked });
      owner = r.owner.login; repo = r.name;
      await new Promise((res) => setTimeout(res, 1500));
    } else [owner, repo] = repoSel.value.split('/');
    const res = await github.pushFiles(owner, repo, files, { message: msg.value || 'Update from Jarvis AI' });
    let live = '';
    if (pages.checked) { try { live = await github.enablePages(owner, repo, res.branch); } catch (e) { live = ''; toast('Pushed, but Pages could not be turned on: ' + e.message, 'error', 8000); } }
    t.remove();
    await modal({ title: 'Pushed ✅', content: el('div', { class: 'stack' },
      el('p', {}, 'Your code is on GitHub.'),
      el('a', { href: `https://github.com/${owner}/${repo}`, target: '_blank', rel: 'noopener' }, `github.com/${owner}/${repo}`),
      live ? el('p', {}, 'Live website (can take 1–2 minutes the first time): ', el('a', { href: live, target: '_blank', rel: 'noopener' }, live)) : null) });
  } catch (e) { t.remove(); toast(e.message, 'error', 8000); }
}
