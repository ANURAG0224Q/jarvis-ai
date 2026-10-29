// Markdown -> safe HTML with highlighted code blocks and action buttons.
import { marked } from '../lib/marked.js';
import DOMPurify from '../lib/purify.js';
import hljs from '../lib/hljs.js';
import { esc } from './util.js';

const PREVIEWABLE = new Set(['html', 'htm', 'xml', 'svg', 'css', 'js', 'javascript', 'jsx']);
const ALIAS = { js: 'javascript', ts: 'typescript', py: 'python', sh: 'bash', zsh: 'bash', html: 'xml', htm: 'xml', svg: 'xml', vue: 'xml', 'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', kt: 'kotlin', rs: 'rust', yml: 'yaml', md: 'markdown', console: 'bash', jsonc: 'json' };

const renderer = new marked.Renderer();
renderer.code = function (token) {
  const code = typeof token === 'object' ? token.text : token;
  const langRaw = (typeof token === 'object' ? token.lang : arguments[1]) || '';
  const lang = langRaw.trim().split(/\s+/)[0].toLowerCase();
  const hl = ALIAS[lang] || lang;
  let html;
  try { html = hl && hljs.getLanguage(hl) ? hljs.highlight(code, { language: hl, ignoreIllegals: true }).value : hljs.highlightAuto(code).value; }
  catch { html = esc(code); }
  const canPreview = PREVIEWABLE.has(lang) || (!lang && /<\/?(html|body|div|canvas|script)\b/i.test(code));
  return `<div class="code-block" data-lang="${esc(lang || 'text')}"><div class="code-head"><span class="code-lang">${esc(lang || 'code')}</span><span class="code-actions">` +
    (canPreview ? `<button class="code-btn" data-act="preview" title="Run / preview">▶ Preview</button>` : '') +
    `<button class="code-btn" data-act="download" title="Download as file">⬇</button><button class="code-btn" data-act="copy" title="Copy code">Copy</button></span></div>` +
    `<pre><code class="hljs language-${esc(hl || 'plaintext')}">${html}</code></pre></div>`;
};
renderer.link = function (token) {
  const href = token.href, title = token.title, text = this.parser.parseInline(token.tokens);
  return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
};
marked.use({ renderer, gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer'); }
});

// Protect math from the markdown parser, render with KaTeX when present.
let katexP = null;
function loadKatex() {
  if (!katexP) katexP = (async () => {
    const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.css'; document.head.append(css);
    const m = await import('https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.mjs');
    return m.default || m;
  })().catch((e) => { katexP = null; throw e; });
  return katexP;
}
const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?!\s)([^\n$]+?)(?<!\s)\$(?!\w)/g;

export function renderMarkdown(src, { streaming = false } = {}) {
  let text = String(src || '');
  if (streaming) {
    // Close an unfinished code fence so half-streamed code still renders as code.
    const fences = (text.match(/^```/gm) || []).length;
    if (fences % 2 === 1) text += '\n```';
  }
  const maths = [];
  // Don't touch math inside code.
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  text = parts.map((p, i) => (i % 2 ? p : p.replace(MATH_RE, (m, a, b, c, d) => {
    const tex = a ?? b ?? c ?? d; const display = a != null || b != null;
    if (d != null && !/[\\^_{}=+\-*/]|\d/.test(d)) return m; // probably money, not math
    maths.push({ tex, display }); return `@@MATH${maths.length - 1}@@`;
  }))).join('');
  let html = marked.parse(text);
  html = DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-act', 'data-lang'] });
  if (maths.length) {
    html = html.replace(/@@MATH(\d+)@@/g, (m, i) => {
      const { tex, display } = maths[+i];
      return `<span class="math${display ? ' display' : ''}" data-tex="${esc(tex)}">${esc(display ? `$$${tex}$$` : `$${tex}$`)}</span>`;
    });
  }
  return html;
}

export async function typesetMath(root) {
  const nodes = root.querySelectorAll('.math:not(.done)');
  if (!nodes.length) return;
  try {
    const katex = await loadKatex();
    nodes.forEach((n) => { try { katex.render(n.dataset.tex, n, { displayMode: n.classList.contains('display'), throwOnError: false }); n.classList.add('done'); } catch {} });
  } catch { /* offline: leave the raw TeX visible */ }
}

const EXT = { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', html: 'html', htm: 'html', xml: 'xml', svg: 'svg', css: 'css', json: 'json', bash: 'sh', sh: 'sh', shell: 'sh', c: 'c', cpp: 'cpp', java: 'java', go: 'go', rust: 'rs', php: 'php', sql: 'sql', markdown: 'md', md: 'md', kotlin: 'kt', csharp: 'cs', yaml: 'yml', dart: 'dart', swift: 'swift', ruby: 'rb', lua: 'lua', jsx: 'jsx', tsx: 'tsx' };
export const extFor = (lang) => EXT[lang] || 'txt';

// Collect code blocks from an answer: [{lang, code}]
export function extractCode(src) {
  const out = []; const re = /```([^\n`]*)\n([\s\S]*?)```/g; let m;
  const FN = /([\w\-./]+\.(?:html?|css|m?js|jsx|ts|tsx|json|py|md|svg|txt|xml|java|c|cpp|go|rs|php|sql|sh|kt|dart))\b/gi;
  while ((m = re.exec(src))) {
    const lang = (m[1] || '').trim().split(/\s+/)[0].toLowerCase();
    let name = ((m[1] || '').trim().split(/\s+/)[1] || '').replace(/^title=|["']/g, '');
    if (!name) { const before = src.slice(Math.max(0, m.index - 160), m.index).split('\n').filter((l) => l.trim()).pop() || ''; const f = before.match(FN); if (f) name = f[f.length - 1]; }
    if (!name) { const first = m[2].split('\n')[0]; const f = /^\s*(?:\/\/|#|<!--|\/\*)\s*([\w\-./]+\.\w+)/.exec(first); if (f) name = f[1]; }
    out.push({ lang, code: m[2], name: name.replace(/^\.?\//, '') });
  }
  return out;
}
