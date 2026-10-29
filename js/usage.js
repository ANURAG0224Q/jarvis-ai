// "Free usage today": counts requests per model and per search service in this browser.
// Google's free daily limits reset at midnight Pacific time, so the day is counted in Pacific time.
const KEY = 'jarvis.usage.v1';
function pacificParts(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(d).map((x) => [x.type, x.value]));
  return p;
}
export function usageDay() { const p = pacificParts(); return `${p.year}-${p.month}-${p.day}`; }
// Next reset (midnight Pacific) as a Date.
export function nextReset(now = new Date()) {
  const p = pacificParts(now);
  const secs = (+p.hour % 24) * 3600 + +p.minute * 60 + +p.second;
  return new Date(now.getTime() + (86400 - secs) * 1000);
}
// "12:30 PM IST" style, in the user's own time zone.
export function resetLabel(now = new Date()) {
  const d = nextReset(now);
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (/Calcutta|Kolkata/.test(tz)) return `${t} IST`;
  const z = (d.toLocaleTimeString('en-US', { timeZoneName: 'short' }).split(' ').pop()) || '';
  return `${t} ${z}`.trim();
}
function load() { try { const x = JSON.parse(localStorage.getItem(KEY) || '{}'); return x.day === usageDay() ? x : { day: usageDay(), n: {}, lim: {} }; } catch { return { day: usageDay(), n: {}, lim: {} }; } }
function store(x) { try { localStorage.setItem(KEY, JSON.stringify(x)); } catch {} }
export function bumpUsage(name) { const x = load(); x.n[name] = (x.n[name] || 0) + 1; store(x); }
export function markLimit(name) { const x = load(); x.lim[name] = Date.now(); store(x); }
export function usageToday() { return load(); }
export function resetUsage() { store({ day: usageDay(), n: {}, lim: {} }); }
