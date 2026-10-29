// Pure exam helpers (no DOM), unit-tested with `node --test test/`.
export function rebalance(questions, total) {
  let qs = questions.filter((q) => q && q.question);
  if (qs.length > total) qs = qs.slice(0, total);
  if (!qs.length) return qs;
  const raw = qs.map((q) => Math.max(1, +q.marks || 1));
  const sum = raw.reduce((a, b) => a + b, 0);
  if (sum === total && raw.every((m, i) => m === qs[i].marks)) return qs;
  // largest-remainder rounding with a floor of 1 mark
  const exact = raw.map((m) => (m * total) / sum);
  let marks = exact.map((x) => Math.max(1, Math.floor(x)));
  let diff = total - marks.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  let k = 0;
  while (diff > 0) { marks[order[k % order.length]]++; diff--; k++; }
  const desc = marks.map((m, i) => [m, i]).sort((a, b) => b[0] - a[0]).map((x) => x[1]);
  k = 0;
  while (diff < 0) { const i = desc[k % desc.length]; if (marks[i] > 1) { marks[i]--; diff++; } k++; if (k > 10000) break; }
  return qs.map((q, i) => ({ ...q, marks: marks[i] }));
}

export function gradeLocal(q, a) {
  if (a == null || String(a).trim() === '') return { awarded: 0, correct: false, reason: 'Not answered.' };
  if (q.type === 'mcq') { const ok = +a === +q.answer; return { awarded: ok ? q.marks : 0, correct: ok, reason: ok ? 'Correct option.' : `Correct option is ${'ABCDEFGH'[+q.answer]}.` }; }
  if (q.type === 'numerical') {
    const x = parseFloat(String(a).replace(/,/g, '')), ans = parseFloat(String(q.answer).replace(/,/g, ''));
    const tol = q.tolerance != null && +q.tolerance >= 0 ? +q.tolerance : Math.max(Math.abs(ans) * 0.01, 1e-9);
    if (!isFinite(x)) return { awarded: 0, correct: false, reason: 'Not a number.' };
    const ok = Math.abs(x - ans) <= tol + 1e-12;
    return { awarded: ok ? q.marks : 0, correct: ok, reason: ok ? 'Correct value.' : `Expected ${q.answer}${q.unit ? ' ' + q.unit : ''}.` };
  }
  return null; // needs AI
}
