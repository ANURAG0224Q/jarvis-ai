// Unit tests for the pure parts of Jarvis. Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { rebalance, gradeLocal } from '../js/exam-core.js';
import { parseCommand, extractActions, stripActions } from '../js/commands.js';
import { normalizeDurations, planTiming } from '../js/video/timing.js';

const q = (marks, type = 'short') => ({ question: 'Q?', type, marks });

test('rebalance makes marks sum exactly to the total', () => {
  for (const total of [5, 10, 20, 25, 50, 100]) {
    for (const raw of [[1, 2, 3], [5, 5, 5, 5], [7, 1, 1, 9, 2, 4], [1], [3, 3]]) {
      const out = rebalance(raw.map((m) => q(m)), total);
      assert.equal(out.reduce((a, b) => a + b.marks, 0), total, `total ${total} raw ${raw}`);
      assert.ok(out.every((x) => x.marks >= 1 && Number.isInteger(x.marks)));
    }
  }
});
test('rebalance keeps an already-correct paper unchanged', () => {
  const qs = [q(10), q(5), q(5)];
  assert.deepEqual(rebalance(qs, 20).map((x) => x.marks), [10, 5, 5]);
});
test('rebalance trims to at most `total` questions when marks cannot be 1+ each', () => {
  const out = rebalance(Array.from({ length: 8 }, () => q(1)), 5);
  assert.equal(out.length, 5); assert.equal(out.reduce((a, b) => a + b.marks, 0), 5);
});
test('local grading: MCQ and numerical with tolerance', () => {
  assert.equal(gradeLocal({ type: 'mcq', marks: 2, answer: '1' }, 1).awarded, 2);
  assert.equal(gradeLocal({ type: 'mcq', marks: 2, answer: '1' }, 0).awarded, 0);
  assert.equal(gradeLocal({ type: 'numerical', marks: 3, answer: '5', tolerance: 0.01 }, '5.0').awarded, 3);
  assert.equal(gradeLocal({ type: 'numerical', marks: 3, answer: '5', tolerance: 0.01 }, '5.2').awarded, 0);
  assert.equal(gradeLocal({ type: 'numerical', marks: 3, answer: '1,000' }, '1000').awarded, 3);
  assert.equal(gradeLocal({ type: 'short', marks: 4, answer: 'x' }, 'something'), null);
  assert.equal(gradeLocal({ type: 'mcq', marks: 2, answer: '1' }, '').awarded, 0);
});
test('browser commands map to the right URLs', () => {
  const url = (t) => { const c = parseCommand(t); return c && (c.url || (c.actions && c.actions[0] && c.actions[0].url)); };
  assert.equal(url('open youtube'), 'https://www.youtube.com/');
  assert.equal(url('open Gmail'), 'https://mail.google.com/');
  assert.equal(url('search youtube for lofi'), 'https://www.youtube.com/results?search_query=lofi');
  assert.equal(url('play Believer on YouTube'), 'https://www.youtube.com/results?search_query=believer');
  assert.equal(parseCommand('what is the capital of France'), null);
});
test('[[open: url | label]] markers from the AI are extracted and stripped', () => {
  const t = 'Sure! [[open: https://www.youtube.com/ | YouTube]] Enjoy.';
  const a = extractActions(t);
  assert.equal(a.length, 1); assert.equal(a[0].url, 'https://www.youtube.com/');
  assert.ok(!stripActions(t).includes('[[open'));
  assert.equal(extractActions('[[open: javascript:alert(1) | x]]').length, 0);
});
test('video scene durations add up exactly to the target length', () => {
  for (const T of [10, 15, 60, 300, 600]) {
    const scenes = Array.from({ length: 7 }, (_, i) => ({ duration: 3 + i }));
    const d = normalizeDurations(scenes, T);
    assert.ok(Math.abs(d.reduce((a, b) => a + b, 0) - T) < 1e-6, `T=${T}`);
  }
});
test('narration timing never exceeds the video length', () => {
  const scenes = [{ duration: 5 }, { duration: 5 }, { duration: 5 }];
  const p = planTiming(scenes, 15, [6, 6, 6]);
  assert.ok(Math.abs(p.durs.reduce((a, b) => a + b, 0) - 15) < 1e-6);
  assert.ok(p.rate >= 1 && p.rate <= 1.35);
});
