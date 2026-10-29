// Free web search for Jarvis. Runs in the browser, no server.
// 1) Tavily: works with NO key (keyless mode, rate-limited); a free key (1,000 searches/month, no card) raises the limit.
// 2) Serper.dev (optional backup, Google results): 2,500 free searches with a free key, no card.
import { settings } from './store.js';
import { bumpUsage } from './usage.js';

export class SearchError extends Error { constructor(msg, { status = 0, kind = 'error' } = {}) { super(msg); this.status = status; this.kind = kind; } }
const isMock = () => !!(window.__JARVIS_MOCK || sessionStorage.getItem('jarvis.mock') === '1');

function clean(s, n = 1200) { return String(s || '').replace(/\s+/g, ' ').trim().slice(0, n); }
function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

async function tavily(query, { signal, key, max = 6 }) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers.authorization = 'Bearer ' + key; else headers['X-Tavily-Access-Mode'] = 'keyless';
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal, headers,
    body: JSON.stringify({ query: query.slice(0, 380), max_results: max, search_depth: 'basic', include_answer: false, topic: 'general' }),
  });
  if (!res.ok) {
    let t = ''; try { t = await res.text(); } catch {}
    const kind = res.status === 401 || res.status === 403 ? (key ? 'bad-key' : 'limit') : res.status === 429 || res.status === 432 || res.status === 433 ? 'limit' : 'error';
    throw new SearchError(`Tavily ${res.status}: ${t.slice(0, 160)}`, { status: res.status, kind });
  }
  const j = await res.json();
  return { provider: key ? 'Tavily' : 'Tavily (free, no key)', results: (j.results || []).map((r) => ({ title: clean(r.title, 140) || host(r.url), url: r.url, content: clean(r.content), date: r.published_date || '' })) };
}

async function serper(query, { signal, key, max = 6 }) {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST', signal, headers: { 'content-type': 'application/json', 'X-API-KEY': key },
    body: JSON.stringify({ q: query.slice(0, 380), num: max }),
  });
  if (!res.ok) { const kind = res.status === 401 || res.status === 403 ? 'bad-key' : res.status === 429 || res.status === 400 ? 'limit' : 'error'; throw new SearchError(`Serper ${res.status}`, { status: res.status, kind }); }
  const j = await res.json();
  const out = [];
  if (j.answerBox && (j.answerBox.answer || j.answerBox.snippet)) out.push({ title: clean(j.answerBox.title || 'Google answer', 140), url: j.answerBox.link || `https://www.google.com/search?q=${encodeURIComponent(query)}`, content: clean(j.answerBox.answer || j.answerBox.snippet), date: '' });
  for (const r of j.organic || []) out.push({ title: clean(r.title, 140), url: r.link, content: clean(r.snippet), date: r.date || '' });
  return { provider: 'Serper (Google)', results: out.slice(0, max) };
}

function mockSearch(query) {
  if (window.__JARVIS_SEARCH_FAIL) throw new SearchError('mock search down', { kind: 'error' });
  return { provider: 'Tavily (mock)', results: [
    { title: 'Mock result one about ' + query.slice(0, 40), url: 'https://example.com/one', content: 'MOCK-FACT-ALPHA: the first mock search result for testing citations.', date: '' },
    { title: 'Mock result two', url: 'https://example.org/two', content: 'MOCK-FACT-BETA: the second mock search result.', date: '' },
  ] };
}

// Returns { provider, results:[{title,url,content,date}], notes:[] }. Throws SearchError only when every option failed.
export async function webSearch(query, { signal } = {}) {
  if (isMock()) { const r = mockSearch(query); bumpUsage('search:mock'); return { ...r, notes: [] }; }
  const s = settings(); const notes = []; let last = null;
  const attempts = [];
  attempts.push(['tavily', s.tavilyKey ? s.tavilyKey.trim() : '']);
  if (s.tavilyKey) attempts.push(['tavily', '']); // key used up or wrong: keyless still works
  if (s.serperKey) attempts.push(['serper', s.serperKey.trim()]);
  for (const [p, key] of attempts) {
    try {
      const r = p === 'tavily' ? await tavily(query, { signal, key }) : await serper(query, { signal, key });
      bumpUsage(p === 'tavily' ? (key ? 'search:tavily' : 'search:tavily-keyless') : 'search:serper');
      if (!r.results.length) { last = new SearchError('No results'); continue; }
      return { ...r, notes };
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      last = e; console.warn('search failed', p, e);
      if (p === 'tavily' && key && e.kind === 'bad-key') notes.push('Your Tavily key was rejected, so Jarvis used free no-key search. Check the key in Settings.');
    }
  }
  const lim = last && last.kind === 'limit';
  throw new SearchError(lim ? 'the free search limit is used up for now' + (s.tavilyKey ? '' : ' (add a free Tavily key in Settings for 1,000 searches a month)') : 'the search service could not be reached', { kind: lim ? 'limit' : 'error' });
}

// Build a search query from the conversation: the latest user message, plus the previous one when the latest is a short follow-up.
export function searchQuery(userTexts) {
  const t = userTexts.filter(Boolean);
  let q = (t[t.length - 1] || '').replace(/\s+/g, ' ').trim();
  if (q.split(' ').length < 5 && t.length > 1) q = (t[t.length - 2].replace(/\s+/g, ' ').trim().slice(0, 200) + ' ' + q).trim();
  return q.slice(0, 380);
}

// Text block handed to the model with the user's message.
export function sourcesBlock(query, r) {
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `[Web search results for "${query}" — searched ${today}. Use them to answer, prefer them over older knowledge, and cite them inline as [1], [2] matching the numbers. If they don't answer the question, say so.]\n` +
    r.results.map((x, i) => `[${i + 1}] ${x.title}${x.date ? ` (${x.date})` : ''}\n${x.url}\n${x.content}`).join('\n\n');
}
