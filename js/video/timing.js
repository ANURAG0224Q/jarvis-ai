// Pure timing helpers for the AI video maker (unit-tested in the browser test suite).
export function normalizeDurations(scenes, T, min = 1.5) {
  const n = scenes.length; if (!n) return [];
  let d = scenes.map((s) => Math.max(min, +s.duration || T / n));
  const sum = d.reduce((a, b) => a + b, 0);
  d = d.map((x) => (x * T) / sum);
  // enforce min after scaling
  for (let k = 0; k < 5; k++) {
    const low = d.map((x) => x < min); if (!low.some(Boolean) || min * n > T) break;
    const fixed = low.filter(Boolean).length * min, rest = d.filter((x, i) => !low[i]).reduce((a, b) => a + b, 0);
    d = d.map((x, i) => (low[i] ? min : (x * (T - fixed)) / rest));
  }
  const r = d.map((x) => Math.round(x * 10) / 10);
  r[n - 1] = +(T - r.slice(0, -1).reduce((a, b) => a + b, 0)).toFixed(3);
  return r;
}

/**
 * Fit narration into scenes so the total stays exactly T.
 * narr: per-scene narration length in seconds (0 when none).
 * returns {durs, starts, narr:[[a,b]], rate, total}
 */
export function planTiming(scenes, T, narr = null) {
  const n = scenes.length;
  let base = normalizeDurations(scenes, T);
  const LEAD = 0.25, TAIL = 0.35;
  let rate = 1, durs = base.slice();
  if (narr && narr.some((x) => x > 0)) {
    const need = (r) => narr.map((x) => (x > 0 ? x / r + LEAD + TAIL : 1.5));
    let sumNeed = need(1).reduce((a, b) => a + b, 0);
    if (sumNeed > T) {
      const fixed = narr.map((x) => (x > 0 ? LEAD + TAIL : 1.5)).reduce((a, b) => a + b, 0);
      const total = narr.reduce((a, b) => a + b, 0);
      rate = T - fixed > 0 ? total / (T - fixed) : 9;
      rate = Math.min(1.35, Math.max(1, rate));
    }
    const nd = need(rate); sumNeed = nd.reduce((a, b) => a + b, 0);
    if (sumNeed <= T) {
      const extra = T - sumNeed;
      durs = nd.map((x, i) => x + (extra * base[i]) / T);
    } else {
      durs = nd.map((x) => (x * T) / sumNeed); // narration will be trimmed to fit
    }
  }
  // fix floating error so the sum is exactly T
  const s = durs.slice(0, -1).reduce((a, b) => a + b, 0); durs[n - 1] = T - s;
  const starts = []; let acc = 0; for (const d of durs) { starts.push(acc); acc += d; }
  const nw = durs.map((d, i) => (narr && narr[i] > 0 ? [LEAD, Math.min(d - 0.2, LEAD + narr[i] / rate)] : [0.2, Math.max(0.4, d - 0.3)]));
  return { durs, starts, narr: nw, rate, total: T };
}

/**
 * Split one narration buffer into `weights.length` segments at silences close to the expected positions.
 * Returns [{start, end}] in seconds.
 */
export function splitBySilence(buffer, weights) {
  const n = weights.length, dur = buffer.duration;
  if (n <= 1) return [{ start: 0, end: dur }];
  const data = buffer.getChannelData(0), sr = buffer.sampleRate, win = Math.round(sr * 0.02);
  const rms = [];
  for (let i = 0; i + win <= data.length; i += win) { let s = 0; for (let j = i; j < i + win; j++) s += data[j] * data[j]; rms.push(Math.sqrt(s / win)); }
  const sorted = rms.slice().sort((a, b) => a - b); const loud = sorted[Math.floor(sorted.length * 0.9)] || 0.1;
  const thr = Math.max(0.004, loud * 0.06);
  const runs = []; let st = -1;
  for (let i = 0; i <= rms.length; i++) { const q = i < rms.length && rms[i] < thr; if (q && st < 0) st = i; if (!q && st >= 0) { const len = (i - st) * 0.02; if (len >= 0.12) runs.push({ mid: ((st + i) / 2) * 0.02, len }); st = -1; } }
  const tot = weights.reduce((a, b) => a + b, 0) || 1;
  let cum = 0; const cuts = []; let prev = 0;
  for (let k = 0; k < n - 1; k++) {
    cum += weights[k]; const e = (cum / tot) * dur; const winS = Math.max(1.5, (dur / n) * 0.45);
    let best = null, bestScore = -Infinity;
    for (const r of runs) { if (r.mid <= prev + 0.3 || Math.abs(r.mid - e) > winS) continue; const sc = r.len * 2 - Math.abs(r.mid - e) / winS; if (sc > bestScore) { bestScore = sc; best = r; } }
    const c = best ? best.mid : Math.max(prev + 0.3, e);
    cuts.push(c); prev = c;
  }
  const out = []; let a = 0;
  for (const c of cuts) { out.push({ start: a, end: c }); a = c; }
  out.push({ start: a, end: dur });
  return out;
}

export function sliceBuffer(buf, start, end) {
  const sr = buf.sampleRate, a = Math.max(0, Math.floor(start * sr)), b = Math.min(buf.length, Math.ceil(end * sr));
  // trim leading/trailing near-silence
  const d0 = buf.getChannelData(0); let s = a, e = b;
  while (s < e && Math.abs(d0[s]) < 0.003) s++;
  while (e > s && Math.abs(d0[e - 1]) < 0.003) e--;
  const len = Math.max(1, e - s);
  const out = new AudioBuffer({ length: len, numberOfChannels: buf.numberOfChannels, sampleRate: sr });
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(s, s + len), c);
  return out;
}
