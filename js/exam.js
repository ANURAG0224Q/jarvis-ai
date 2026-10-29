// Exam Mode: AI-generated practice papers with exact marks, timer, grading, solutions and analysis.
import { el, $, $$, uid, toast, pickFiles, fileKind, guessMime, fmtTime, clamp, confirm, esc } from './util.js';
import { kv, settings } from './store.js';
import { chat, parseJSONLoose, friendlyError, providerReady } from './providers.js';
import { renderMarkdown, typesetMath } from './markdown.js';
import { rebalance, gradeLocal } from './exam-core.js';
export { rebalance, gradeLocal };

const TYPES = { mcq: 'MCQ', numerical: 'Numerical', short: 'Short answer', long: 'Long answer' };
let cfg = { subject: '', level: '', topics: [], total: 20, difficulty: 'mixed', types: ['mcq', 'short', 'numerical'], minutes: 0, lang: 'English', layout: 'one' };
let files = [];       // [{name,mime,kind,blob}]
let exam = null;      // active attempt
let timerId = 0;

async function history() { return (await kv.get('exams')) || []; }
async function saveHistory(list) { await kv.put('exams', list.slice(-100)); }

export async function renderExam() {
  const root = $('#view-exam'); root.innerHTML = '';
  if (exam && !exam.submitted) return drawTaking();
  if (exam && exam.submitted) return drawResults();
  const saved = await kv.get('examCfg'); if (saved) cfg = { ...cfg, ...saved };
  root.append(el('div', { class: 'page' }, el('h1', {}, '📝 Exam Mode'),
    el('p', { class: 'muted' }, 'Practice papers made by AI from your topics and notes, with exact marks, a timer, instant grading, solutions and analysis.'),
    setupForm(), el('div', { id: 'examHistory' })));
  drawHistory();
}

function setupForm() {
  const subj = el('input', { type: 'text', id: 'exSubject', placeholder: 'e.g. Physics, Data Structures, Basic Electronics', value: cfg.subject });
  const level = el('input', { type: 'text', id: 'exLevel', placeholder: 'e.g. Class 12 CBSE, B.E. 1st year, KCET', value: cfg.level });
  const topicIn = el('input', { type: 'text', id: 'exTopic', placeholder: 'Type a topic and press Enter (e.g. Ohm’s law)' });
  const chips = el('div', { class: 'row wrap', id: 'exTopics' });
  const drawChips = () => { chips.innerHTML = ''; cfg.topics.forEach((t, i) => chips.append(el('span', { class: 'chip' }, t, el('button', { class: 'chip-x', 'aria-label': `Remove ${t}`, onclick: () => { cfg.topics.splice(i, 1); drawChips(); } }, '✕')))); };
  const addTopic = () => { topicIn.value.split(/[,;]/).map((x) => x.trim()).filter(Boolean).forEach((t) => { if (!cfg.topics.includes(t)) cfg.topics.push(t); }); topicIn.value = ''; drawChips(); };
  topicIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTopic(); } });
  topicIn.addEventListener('blur', addTopic);
  drawChips();
  const total = el('input', { type: 'number', id: 'exTotal', min: 5, max: 100, step: 1, value: cfg.total });
  const diff = el('select', { id: 'exDiff' }, ...[['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['mixed', 'Mixed']].map(([v, l]) => el('option', { value: v }, l))); diff.value = cfg.difficulty;
  const types = el('div', { class: 'row wrap', id: 'exTypes' }, ...Object.entries(TYPES).map(([k, l]) => { const c = el('input', { type: 'checkbox', checked: cfg.types.includes(k), value: k }); c.addEventListener('change', () => { cfg.types = $$('#exTypes input:checked').map((x) => x.value); }); return el('label', { class: 'row' }, c, ' ', l); }));
  const mins = el('input', { type: 'number', id: 'exMinutes', min: 0, max: 300, step: 1, value: cfg.minutes });
  const layout = el('select', { id: 'exLayout' }, el('option', { value: 'one' }, 'One question at a time'), el('option', { value: 'full' }, 'Full paper on one page')); layout.value = cfg.layout;
  const lang = el('input', { type: 'text', value: cfg.lang });
  const fileBox = el('div', { class: 'row wrap', id: 'exFiles' });
  const drawFiles = () => { fileBox.innerHTML = ''; files.forEach((f, i) => fileBox.append(el('span', { class: 'chip' }, '📄 ' + f.name, el('button', { class: 'chip-x', onclick: () => { files.splice(i, 1); drawFiles(); } }, '✕')))); };
  drawFiles();
  const go = el('button', { class: 'btn primary big', id: 'exGenerate', onclick: async () => {
    addTopic();
    cfg = { ...cfg, subject: subj.value.trim(), level: level.value.trim(), total: clamp(Math.round(+total.value || 20), 5, 100), difficulty: diff.value, minutes: clamp(Math.round(+mins.value || 0), 0, 300), layout: layout.value, lang: lang.value || 'English', types: $$('#exTypes input:checked').map((x) => x.value) };
    kv.put('examCfg', cfg);
    if (!cfg.subject && !cfg.topics.length && !files.length) return toast('Add a subject, topics or notes first', 'error');
    if (!cfg.types.length) return toast('Pick at least one question type', 'error');
    if (!providerReady()) { toast('Add your free Gemini API key in Settings first.', 'error'); return; }
    go.disabled = true; go.textContent = '⏳ Making your paper…';
    try { await generatePaper(); } catch (e) { toast(friendlyError(e), 'error', 8000); }
    go.disabled = false; go.textContent = '✨ Create exam';
  } }, '✨ Create exam');
  return el('section', { class: 'card' }, el('h2', {}, 'New exam'),
    el('div', { class: 'row wrap' }, el('label', { class: 'field grow' }, 'Subject', subj), el('label', { class: 'field grow' }, 'Class / level', level)),
    el('label', { class: 'field' }, 'Topics', topicIn), chips,
    el('div', { class: 'row wrap' }, el('label', { class: 'field sm' }, 'Total marks', total), el('label', { class: 'field sm' }, 'Difficulty', diff), el('label', { class: 'field sm' }, 'Time limit (min, 0 = none)', mins), el('label', { class: 'field' }, 'Layout', layout), el('label', { class: 'field sm' }, 'Language', lang)),
    el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Question types'), types),
    el('div', { class: 'field' }, el('span', { class: 'flabel' }, 'Your notes / syllabus (optional: PDF, images, text)'), fileBox,
      el('button', { class: 'btn', onclick: async () => { const fs = await pickFiles({ accept: '.pdf,.txt,.md,image/*,text/*' }); fs.forEach((f) => files.push({ name: f.name, mime: guessMime(f.name, f.type), kind: fileKind(f.name, guessMime(f.name, f.type)), blob: f })); drawFiles(); } }, '📎 Add notes')),
    go);
}

// ---------- marks maths ----------
export function validQuestion(q, allowed) {
  if (!q || typeof q.question !== 'string' || !q.question.trim()) return false;
  if (!TYPES[q.type] || (allowed && !allowed.includes(q.type))) return false;
  if (q.type === 'mcq') return Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(+q.answer) && +q.answer >= 0 && +q.answer < q.options.length;
  if (q.type === 'numerical') return isFinite(parseFloat(q.answer));
  return true;
}

const SCHEMA = { type: 'OBJECT', properties: { title: { type: 'STRING' }, questions: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  type: { type: 'STRING', enum: Object.keys(TYPES) }, topic: { type: 'STRING' }, marks: { type: 'INTEGER' }, question: { type: 'STRING' },
  options: { type: 'ARRAY', items: { type: 'STRING' } }, answer: { type: 'STRING' }, tolerance: { type: 'NUMBER' }, unit: { type: 'STRING' },
  solution: { type: 'STRING' }, markingScheme: { type: 'STRING' } }, required: ['type', 'topic', 'marks', 'question', 'answer', 'solution'] } } }, required: ['title', 'questions'] };

async function fileParts() {
  const parts = [];
  for (const f of files) {
    if (f.kind === 'text') parts.push({ text: `--- Notes: ${f.name} ---\n${(await f.blob.text()).slice(0, 200000)}` });
    else if (['pdf', 'image'].includes(f.kind)) { parts.push({ text: `--- Notes: ${f.name} ---` }); parts.push({ file: { blob: f.blob, mime: f.mime, name: f.name, kind: f.kind, size: f.blob.size } }); }
  }
  return parts;
}

async function generatePaper() {
  const T = cfg.total;
  const prompt = `Create an exam paper (EXAM_PAPER).
Subject: ${cfg.subject || '(see notes)'}
Class/level: ${cfg.level || 'not specified, choose a sensible level'}
Topics: ${cfg.topics.join(', ') || 'from the notes / whole subject'}
TOTAL_MARKS: ${T}  (the marks of all questions MUST add up to exactly ${T})
Difficulty: ${cfg.difficulty}
Allowed question types: ${cfg.types.map((t) => TYPES[t]).join(', ')} (type codes: ${cfg.types.join(', ')})
Language: ${cfg.lang}
${files.length ? 'Base the questions on the attached notes.' : ''}
Guidelines: MCQ 1–2 marks with exactly 4 options and "answer" = the index (0-3) of the correct option as a string; numerical 2–4 marks with "answer" = the number only, "tolerance" = allowed absolute error, "unit"; short answer 2–5 marks; long answer 5–10 marks. "solution" = clear step-by-step worked solution (Markdown, LaTeX in $...$ allowed). "markingScheme" = how marks are given (for written answers, list key points with marks). Spread questions over all topics; tag each with its topic. Questions must be correct and unambiguous.`;
  const parts = [...(await fileParts()), { text: prompt }];
  let j = null, lastErr = null;
  for (let attempt = 0; attempt < 2 && !j; attempt++) {
    try {
      const st = $('#exGenerate');
      const r = await chat([{ role: 'user', parts }], { json: true, schema: SCHEMA, system: 'You are an expert examiner and teacher. Output only JSON.', showThinking: false, temperature: 0.7, maxTokens: 16000, maxMs: 240e3,
        onModel: (m) => { if (st) st.textContent = `⏳ Writing your paper with ${m}…`; }, onStatus: (s) => { if (st) st.textContent = '⏳ ' + s; },
        onText: (t) => { if (st) st.textContent = `⏳ Writing your paper… ${Math.round(t.length / 100) / 10}k characters`; } });
      let p = parseJSONLoose(r.text);
      if (p && !p.questions) { const inner = Object.values(p).find((v) => v && typeof v === 'object' && Array.isArray(v.questions)); if (inner) p = inner; }
      const qs = (p.questions || []).map((q) => ({ ...q, type: String(q.type || '').toLowerCase() })).filter((q) => validQuestion(q, cfg.types));
      if (qs.length) j = { title: p.title, questions: qs };
      else lastErr = new Error('The AI paper had no valid questions. Trying again…');
    } catch (e) { lastErr = e; if (e.kind === 'bad-key' || e.kind === 'daily-limit') break; }
  }
  if (!j) throw lastErr || new Error('Could not create the paper.');
  const before = j.questions.reduce((a, q) => a + (+q.marks || 0), 0);
  const questions = rebalance(j.questions, T).map((q) => ({ ...q, id: uid(), answer: q.type === 'mcq' ? +q.answer : q.answer }));
  exam = { id: uid(), title: j.title || `${cfg.subject} test`, cfg: { ...cfg }, questions, answers: {}, flags: {}, time: {}, started: Date.now(), cur: 0, submitted: false,
    deadline: cfg.minutes ? Date.now() + cfg.minutes * 60000 : 0, rebalanced: before !== T ? before : 0 };
  window.__exam = exam;
  renderExam();
}

// ---------- taking ----------
function tickTimer() {
  clearInterval(timerId);
  if (!exam || !exam.deadline || exam.submitted) return;
  const tEl = () => $('#exTimer');
  const tick = () => {
    const left = Math.max(0, exam.deadline - Date.now());
    const e = tEl(); if (e) { e.textContent = '⏱ ' + fmtTime(left / 1000); e.classList.toggle('warn', left < 60000); }
    if (left <= 0) { clearInterval(timerId); toast('⏰ Time is up! Submitting your paper.', 'info', 5000); submit(true); }
  };
  tick(); timerId = setInterval(tick, 500);
}
let qShownAt = 0;
function trackTime() { if (!exam || exam.layout === 'full') return; const q = exam.questions[exam.cur]; if (q && qShownAt) exam.time[q.id] = (exam.time[q.id] || 0) + (Date.now() - qShownAt) / 1000; qShownAt = Date.now(); }

function answerInput(q) {
  const a = exam.answers[q.id];
  if (q.type === 'mcq') {
    return el('div', { class: 'opts', role: 'radiogroup' }, q.options.map((o, i) => {
      const r = el('input', { type: 'radio', name: 'q_' + q.id, value: i, checked: a === i });
      r.addEventListener('change', () => { exam.answers[q.id] = i; drawNav(); });
      return el('label', { class: 'opt' + (a === i ? ' on' : '') }, r, el('span', { class: 'opt-l' }, 'ABCDEFGH'[i]), el('span', { class: 'md', html: renderMarkdown(o) }));
    }));
  }
  if (q.type === 'numerical') {
    const i = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Your answer (number)', value: a ?? '', class: 'num-ans' });
    i.addEventListener('input', () => { exam.answers[q.id] = i.value; drawNav(); });
    return el('div', { class: 'row' }, i, q.unit ? el('span', { class: 'muted' }, q.unit) : null);
  }
  const t = el('textarea', { rows: q.type === 'long' ? 8 : 4, placeholder: q.type === 'long' ? 'Write your full answer…' : 'Write your answer…' });
  t.value = a ?? ''; t.addEventListener('input', () => { exam.answers[q.id] = t.value; drawNav(); });
  return t;
}
function questionCard(q, i) {
  const flag = el('button', { class: 'btn tiny' + (exam.flags[q.id] ? ' on' : ''), onclick: (e) => { exam.flags[q.id] = !exam.flags[q.id]; e.currentTarget.classList.toggle('on'); drawNav(); } }, exam.flags[q.id] ? '🚩 Flagged' : '🏳 Flag for review');
  const card = el('div', { class: 'card qcard', 'data-q': q.id },
    el('div', { class: 'row space' }, el('b', {}, `Q${i + 1}.`), el('span', { class: 'muted small' }, `${TYPES[q.type]} · ${q.topic || ''} · `, el('b', {}, `${q.marks} mark${q.marks > 1 ? 's' : ''}`))),
    el('div', { class: 'md qtext', html: renderMarkdown(q.question) }), answerInput(q), el('div', { class: 'row' }, flag));
  card.addEventListener('focusin', () => { if (exam.layout === 'full') { exam._focus = { id: q.id, at: Date.now() }; } });
  card.addEventListener('focusout', () => { if (exam.layout === 'full' && exam._focus && exam._focus.id === q.id) { exam.time[q.id] = (exam.time[q.id] || 0) + (Date.now() - exam._focus.at) / 1000; exam._focus = null; } });
  return card;
}
function drawNav() {
  const nav = $('#exNav'); if (!nav) return; nav.innerHTML = '';
  exam.questions.forEach((q, i) => {
    const ans = exam.answers[q.id] != null && String(exam.answers[q.id]).trim() !== '';
    nav.append(el('button', { class: 'qn' + (ans ? ' done' : '') + (exam.flags[q.id] ? ' flag' : '') + (exam.layout !== 'full' && i === exam.cur ? ' cur' : ''), 'aria-label': `Question ${i + 1}`, onclick: () => { if (exam.layout === 'full') document.querySelector(`[data-q="${q.id}"]`)?.scrollIntoView({ behavior: 'smooth' }); else { trackTime(); exam.cur = i; drawTaking(); } } }, String(i + 1)));
  });
  const done = exam.questions.filter((q) => exam.answers[q.id] != null && String(exam.answers[q.id]).trim() !== '').length;
  const p = $('#exProgress'); if (p) p.textContent = `${done}/${exam.questions.length} answered`;
}
function drawTaking() {
  const root = $('#view-exam'); root.innerHTML = '';
  exam.layout = exam.layout || exam.cfg.layout;
  const total = exam.questions.reduce((a, q) => a + q.marks, 0);
  const head = el('div', { class: 'exam-head' }, el('div', {}, el('b', {}, exam.title), el('div', { class: 'muted small' }, `${exam.questions.length} questions · ${total} marks`, el('span', { id: 'exProgress', class: 'pill' }))),
    el('div', { class: 'row' }, exam.deadline ? el('span', { class: 'timer', id: 'exTimer' }, '⏱') : null,
      el('button', { class: 'btn tiny', onclick: () => { trackTime(); exam.layout = exam.layout === 'full' ? 'one' : 'full'; drawTaking(); } }, exam.layout === 'full' ? 'One at a time' : 'Full paper'),
      el('button', { class: 'btn primary', id: 'exSubmit', onclick: () => submit(false) }, 'Submit')));
  const page = el('div', { class: 'page' }, head, el('div', { class: 'qnav', id: 'exNav' }));
  if (exam.rebalanced) page.append(el('div', { class: 'note small' }, `ℹ️ The AI's marks added up to ${exam.rebalanced}; Jarvis adjusted them so the paper is exactly ${total} marks.`));
  if (exam.layout === 'full') exam.questions.forEach((q, i) => page.append(questionCard(q, i)));
  else {
    const i = exam.cur, q = exam.questions[i];
    page.append(questionCard(q, i), el('div', { class: 'row space' },
      el('button', { class: 'btn', disabled: i === 0, onclick: () => { trackTime(); exam.cur--; drawTaking(); } }, '‹ Previous'),
      i < exam.questions.length - 1 ? el('button', { class: 'btn primary', id: 'exNext', onclick: () => { trackTime(); exam.cur++; drawTaking(); } }, 'Next ›') : el('button', { class: 'btn primary', onclick: () => submit(false) }, 'Finish & submit')));
    qShownAt = Date.now();
  }
  root.append(page); drawNav(); tickTimer(); typesetMath(root);
}

// ---------- grading ----------
const GRADE_SCHEMA = { type: 'OBJECT', properties: { results: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' }, awarded: { type: 'NUMBER' }, reason: { type: 'STRING' } }, required: ['id', 'awarded', 'reason'] } }, revise: { type: 'ARRAY', items: { type: 'STRING' } }, summary: { type: 'STRING' } }, required: ['results'] };

async function submit(auto) {
  if (!exam || exam.submitted) return;
  if (!auto) {
    const left = exam.questions.filter((q) => exam.answers[q.id] == null || String(exam.answers[q.id]).trim() === '').length;
    if (left && !(await confirm('Submit paper?', `${left} question${left > 1 ? 's are' : ' is'} not answered.`, 'Submit', false))) return;
  }
  trackTime(); if (exam._focus) { exam.time[exam._focus.id] = (exam.time[exam._focus.id] || 0) + (Date.now() - exam._focus.at) / 1000; exam._focus = null; }
  clearInterval(timerId);
  exam.submitted = true; exam.finished = Date.now(); exam.auto = !!auto;
  exam.results = {};
  const written = [];
  for (const q of exam.questions) { const g = gradeLocal(q, exam.answers[q.id]); if (g) exam.results[q.id] = g; else written.push(q); }
  const root = $('#view-exam'); root.innerHTML = ''; root.append(el('div', { class: 'page' }, el('div', { class: 'card center' }, el('div', { class: 'typing' }, el('i'), el('i'), el('i')), el('p', {}, written.length ? `Checking your ${written.length} written answer${written.length > 1 ? 's' : ''}…` : 'Calculating…'))));
  if (written.length) {
    try {
      const body = written.map((q) => `ID: ${q.id}\nQUESTION (${q.marks} marks): ${q.question}\nMODEL ANSWER: ${q.answer}\nMARKING SCHEME: ${q.markingScheme || q.solution}\nSTUDENT ANSWER: ${exam.answers[q.id]}`).join('\n\n---\n\n');
      const r = await chat([{ role: 'user', parts: [{ text: `GRADE_ANSWERS. Grade each student answer fairly against the marking scheme. Give partial marks in steps of 0.5 (0 to the question's marks). "reason" = one short line saying what was right/missing. Then give "revise": 2–4 specific things to revise, and "summary": one encouraging sentence. Language: ${exam.cfg.lang}.\n\n${body}` }] }],
        { json: true, schema: GRADE_SCHEMA, system: 'You are a fair, encouraging examiner. Output only JSON.', showThinking: false, temperature: 0.2 });
      const j = parseJSONLoose(r.text);
      for (const g of j.results || []) { const q = written.find((x) => x.id === g.id); if (!q) continue; const aw = clamp(Math.round((+g.awarded || 0) * 2) / 2, 0, q.marks); exam.results[q.id] = { awarded: aw, correct: aw >= q.marks, reason: String(g.reason || ''), ai: true }; }
      exam.revise = Array.isArray(j.revise) ? j.revise.slice(0, 6) : []; exam.summary = j.summary || '';
    } catch (e) { exam.gradeError = friendlyError(e); }
    for (const q of written) if (!exam.results[q.id]) {
      const empty = exam.answers[q.id] == null || String(exam.answers[q.id]).trim() === '';
      exam.results[q.id] = empty ? { awarded: 0, correct: false, reason: 'Not answered.' } : { awarded: 0, correct: false, reason: 'Not graded by AI. Compare with the model answer and set your marks.', manual: true };
    }
  }
  await storeAttempt();
  drawResults();
}
function score() { return exam.questions.reduce((a, q) => a + (exam.results[q.id]?.awarded || 0), 0); }
function topicStats() {
  const t = {};
  for (const q of exam.questions) { const k = q.topic || 'General'; t[k] = t[k] || { got: 0, max: 0, n: 0 }; t[k].got += exam.results[q.id]?.awarded || 0; t[k].max += q.marks; t[k].n++; }
  return t;
}
async function storeAttempt() {
  const list = await history();
  const total = exam.questions.reduce((a, q) => a + q.marks, 0), s = score();
  const rec = { id: exam.id, title: exam.title, subject: exam.cfg.subject, date: exam.finished, total, score: s, pct: Math.round((s / total) * 1000) / 10, topics: topicStats(), exam };
  const i = list.findIndex((x) => x.id === exam.id); if (i >= 0) list[i] = rec; else list.push(rec);
  await saveHistory(list);
}

function drawResults() {
  const root = $('#view-exam'); root.innerHTML = '';
  const total = exam.questions.reduce((a, q) => a + q.marks, 0), s = score(), pct = (s / total) * 100;
  const grade = pct >= 90 ? 'A+' : pct >= 80 ? 'A' : pct >= 70 ? 'B' : pct >= 60 ? 'C' : pct >= 50 ? 'D' : pct >= 35 ? 'E' : 'F';
  const ts = topicStats();
  const weak = Object.entries(ts).filter(([, v]) => v.got / v.max < 0.6).map(([k]) => k);
  const timed = Object.keys(exam.time).length;
  const page = el('div', { class: 'page results' },
    el('div', { class: 'card score-card' },
      el('div', { class: 'score-big', id: 'exScore' }, `${fmtNum(s)} / ${total}`),
      el('div', { class: 'score-pct' }, `${pct.toFixed(1)}% · Grade ${grade}`),
      el('div', { class: 'muted small' }, `${exam.title} · ${new Date(exam.finished).toLocaleString()}${exam.auto ? ' · auto-submitted when time ran out' : ''} · took ${fmtTime((exam.finished - exam.started) / 1000)}`),
      exam.summary ? el('p', {}, exam.summary) : null,
      exam.gradeError ? el('div', { class: 'note' }, '⚠️ AI grading failed: ' + exam.gradeError + ' Written answers can be marked by you below.') : null),
    el('div', { class: 'card' }, el('h3', {}, '📊 Topic analysis'),
      el('div', { class: 'bars' }, Object.entries(ts).map(([k, v]) => { const p = v.max ? (v.got / v.max) * 100 : 0; return el('div', { class: 'bar-row' }, el('span', { class: 'bar-l' }, k), el('div', { class: 'bar' }, el('i', { style: { width: p + '%', background: p >= 75 ? 'var(--ok)' : p >= 50 ? 'var(--warn)' : 'var(--bad)' } })), el('span', { class: 'bar-v' }, `${fmtNum(v.got)}/${v.max}`)); })),
      el('h4', {}, '📚 What to revise'),
      el('ul', {}, ...(exam.revise && exam.revise.length ? exam.revise : weak.length ? weak.map((w) => `Revise ${w}: you scored ${Math.round((ts[w].got / ts[w].max) * 100)}% here.`) : ['Great job! Try a harder paper next.']).map((r) => el('li', {}, r))),
      timed ? el('div', {}, el('h4', {}, '⏱ Time per question'), el('div', { class: 'bars' }, exam.questions.map((q, i) => { const t = exam.time[q.id] || 0; const mx = Math.max(...Object.values(exam.time), 1); return el('div', { class: 'bar-row' }, el('span', { class: 'bar-l' }, `Q${i + 1}`), el('div', { class: 'bar' }, el('i', { style: { width: (t / mx) * 100 + '%' } })), el('span', { class: 'bar-v' }, `${Math.round(t)}s`)); }))) : null),
    el('div', { class: 'row wrap no-print' },
      el('button', { class: 'btn primary', id: 'exRetryWrong', onclick: retryWrong }, '🔁 Retry wrong questions'),
      weak.length ? el('button', { class: 'btn', onclick: () => newOnTopics(weak) }, '🎯 New paper on weak topics') : null,
      el('button', { class: 'btn', onclick: () => window.print() }, '🖨 Print / Save PDF'),
      el('button', { class: 'btn', onclick: () => { exam = null; renderExam(); } }, '＋ New exam')),
    el('h3', {}, '🧾 Solutions'));
  exam.questions.forEach((q, i) => {
    const r = exam.results[q.id] || { awarded: 0 }; const a = exam.answers[q.id];
    const yours = a == null || String(a).trim() === '' ? '(not answered)' : q.type === 'mcq' ? `${'ABCDEFGH'[a]}. ${q.options[a]}` : String(a);
    const correct = q.type === 'mcq' ? `${'ABCDEFGH'[q.answer]}. ${q.options[q.answer]}` : `${q.answer}${q.unit ? ' ' + q.unit : ''}`;
    const markBox = el('span', { class: 'qmarks ' + (r.awarded >= q.marks ? 'ok' : r.awarded > 0 ? 'part' : 'bad') }, `${fmtNum(r.awarded)} / ${q.marks}`);
    const manual = r.manual ? el('label', { class: 'row small' }, 'Your marks: ', (() => { const inp = el('input', { type: 'number', min: 0, max: q.marks, step: 0.5, value: r.awarded, style: { width: '5em' } }); inp.addEventListener('change', async () => { r.awarded = clamp(Math.round(+inp.value * 2) / 2, 0, q.marks); await storeAttempt(); drawResults(); }); return inp; })()) : null;
    page.append(el('div', { class: 'card qres' },
      el('div', { class: 'row space' }, el('b', {}, `Q${i + 1} · ${q.topic || ''}`), markBox),
      el('div', { class: 'md', html: renderMarkdown(q.question) }),
      el('div', { class: 'ans' }, el('div', {}, el('span', { class: 'muted small' }, 'Your answer: '), el('span', { class: r.awarded >= q.marks ? 'ok' : 'bad' }, yours)),
        el('div', {}, el('span', { class: 'muted small' }, q.type === 'long' || q.type === 'short' ? 'Model answer: ' : 'Correct answer: '), el('span', { class: 'md inline', html: renderMarkdown(correct) }))),
      r.reason ? el('div', { class: 'small' }, (r.ai ? '🤖 ' : '') + r.reason) : null, manual,
      el('details', { open: r.awarded < q.marks }, el('summary', {}, 'Step-by-step solution'), el('div', { class: 'md', html: renderMarkdown(q.solution || '') }))));
  });
  root.append(page); typesetMath(root);
}
const fmtNum = (n) => (Math.round(n * 10) / 10).toString();
function retryWrong() {
  const wrong = exam.questions.filter((q) => (exam.results[q.id]?.awarded || 0) < q.marks);
  if (!wrong.length) return toast('Everything was correct! 🎉');
  exam = { ...exam, id: uid(), title: exam.title + ' (retry)', questions: wrong.map((q) => ({ ...q })), answers: {}, flags: {}, time: {}, results: {}, started: Date.now(), cur: 0, submitted: false, revise: null, summary: '', gradeError: '', rebalanced: 0,
    deadline: exam.cfg.minutes ? Date.now() + Math.max(1, Math.round((exam.cfg.minutes * wrong.length) / Math.max(1, exam.questions.length))) * 60000 : 0 };
  renderExam();
}
function newOnTopics(topics) { cfg = { ...exam.cfg, topics }; kv.put('examCfg', cfg); exam = null; renderExam(); toast('Topics set to your weak areas. Tap “Create exam”.'); }

async function drawHistory() {
  const box = $('#examHistory'); if (!box) return;
  const list = (await history()).slice().reverse();
  box.innerHTML = '';
  if (!list.length) return;
  const chart = el('div', { class: 'hist-chart', 'aria-label': 'Scores over time' }, list.slice(0, 20).reverse().map((r) => el('div', { class: 'hc-col', title: `${r.title}: ${r.pct}%` }, el('i', { style: { height: Math.max(3, r.pct) + '%' } }), el('small', {}, Math.round(r.pct) + '%'))));
  box.append(el('section', { class: 'card' }, el('h2', {}, '📈 Your exam history'), chart,
    el('div', { class: 'hist-list' }, list.map((r) => el('div', { class: 'hist-item' }, el('div', {}, el('b', {}, r.title), el('div', { class: 'muted small' }, new Date(r.date).toLocaleString())), el('span', { class: 'pill' }, `${fmtNum(r.score)}/${r.total} · ${r.pct}%`),
      el('button', { class: 'btn tiny', onclick: () => { exam = r.exam; renderExam(); } }, 'View'),
      el('button', { class: 'icon-btn', 'aria-label': 'Delete', onclick: async () => { await saveHistory((await history()).filter((x) => x.id !== r.id)); drawHistory(); } }, '✕'))))));
}
export function examActive() { return exam && !exam.submitted; }
