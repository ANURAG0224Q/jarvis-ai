// Animated scene renderer for the AI video maker. Pure function of time: same t -> same frame.
export const THEMES = {
  midnight: { name: 'Midnight', bg: ['#0b1020', '#1e1b4b'], accent: '#818cf8', accent2: '#22d3ee', text: '#f8fafc', sub: '#cbd5e1', card: 'rgba(255,255,255,0.07)' },
  neon: { name: 'Neon', bg: ['#07000f', '#2b0a3d'], accent: '#f0abfc', accent2: '#22d3ee', text: '#ffffff', sub: '#e9d5ff', card: 'rgba(240,171,252,0.10)' },
  ocean: { name: 'Ocean', bg: ['#042f2e', '#0c4a6e'], accent: '#2dd4bf', accent2: '#fbbf24', text: '#ecfeff', sub: '#a5f3fc', card: 'rgba(255,255,255,0.08)' },
  sunrise: { name: 'Sunrise', bg: ['#fff7ed', '#fed7aa'], accent: '#ea580c', accent2: '#db2777', text: '#1c1917', sub: '#57534e', card: 'rgba(255,255,255,0.65)' },
  paper: { name: 'Clean white', bg: ['#ffffff', '#e2e8f0'], accent: '#2563eb', accent2: '#16a34a', text: '#0f172a', sub: '#475569', card: 'rgba(15,23,42,0.05)' },
  chalk: { name: 'Chalkboard', bg: ['#1c2b22', '#243b2e'], accent: '#fde047', accent2: '#93c5fd', text: '#f5f5f4', sub: '#d6d3d1', card: 'rgba(255,255,255,0.06)' },
};
export const LAYOUTS = ['title', 'bullets', 'big', 'quote', 'image', 'emoji', 'outro'];
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", "Helvetica Neue", Arial, sans-serif';
const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

const ease = (x) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const easeBack = (x) => { x = Math.min(1, Math.max(0, x)); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
function rnd(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

export function wrap(ctx, text, maxW) {
  const words = String(text || '').split(/\s+/).filter(Boolean); const lines = []; let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !line) line = test; else { lines.push(line); line = w; }
    // break very long single words
    while (ctx.measureText(line).width > maxW && line.length > 4) { let k = line.length - 1; while (k > 1 && ctx.measureText(line.slice(0, k)).width > maxW) k--; lines.push(line.slice(0, k)); line = line.slice(k); }
  }
  if (line) lines.push(line);
  return lines;
}
export function fit(ctx, text, maxW, maxH, size, minSize, weight = 700, lh = 1.18) {
  for (let s = size; s >= minSize; s = Math.floor(s * 0.92)) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    const lines = wrap(ctx, text, maxW);
    if (lines.length * s * lh <= maxH) return { size: s, lines, lh: s * lh };
  }
  ctx.font = `${weight} ${minSize}px ${FONT}`;
  const lines = wrap(ctx, text, maxW); const max = Math.max(1, Math.floor(maxH / (minSize * lh)));
  if (lines.length > max) { lines.length = max; lines[max - 1] = lines[max - 1].replace(/\s*\S*$/, '') + '…'; }
  return { size: minSize, lines, lh: minSize * lh };
}
function drawLines(ctx, f, x, y, align = 'left', color) {
  ctx.textAlign = align; ctx.textBaseline = 'top'; if (color) ctx.fillStyle = color;
  f.lines.forEach((l, i) => ctx.fillText(l, x, y + i * f.lh));
  return y + f.lines.length * f.lh;
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

export function drawBackground(ctx, W, H, th, t, seed = 1) {
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, th.bg[0]); g.addColorStop(1, th.bg[1]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const r = rnd(seed); const u = Math.min(W, H);
  ctx.save(); ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 5; i++) {
    const bx = r() * W, by = r() * H, rad = u * (0.25 + r() * 0.35), sp = 0.15 + r() * 0.25, ph = r() * 6.28;
    const x = bx + Math.sin(t * sp + ph) * u * 0.08, y = by + Math.cos(t * sp * 0.8 + ph) * u * 0.08;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, (i % 2 ? th.accent2 : th.accent) + '33'); rg.addColorStop(1, (i % 2 ? th.accent2 : th.accent) + '00');
    ctx.fillStyle = rg; ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // floating particles
  ctx.fillStyle = th.text + '22';
  for (let i = 0; i < 28; i++) { const px = (r() * W + t * u * 0.01 * (1 + r())) % W, py = (r() * H - t * u * 0.02 * (0.5 + r()) % H + H) % H; ctx.beginPath(); ctx.arc(px, py, u * 0.003 * (1 + r() * 2), 0, 6.283); ctx.fill(); }
  ctx.restore();
}

function emojiAt(ctx, e, x, y, size, alpha = 1, rot = 0) {
  if (!e) return; ctx.save(); ctx.globalAlpha *= alpha; ctx.translate(x, y); ctx.rotate(rot);
  ctx.font = `${size}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e, 0, 0); ctx.restore();
}

/**
 * Draw one scene.
 * s: scene {layout, heading, text, bullets[], big, emoji, image}
 * lt: local time in scene, d: scene duration, o: {theme, images[], W, H, index, total, title, captions, narrationWindow:[a,b], progress}
 */
export function drawScene(ctx, s, lt, d, o) {
  const { W, H } = o; const th = o.theme; const u = Math.min(W, H) / 100; const portrait = H > W * 1.1;
  const pad = u * (portrait ? 7 : 8); const cw = W - pad * 2;
  const inA = ease(lt / 0.7), outA = 1; // fade handled by transitions
  const img = s.image >= 0 && o.images && o.images[s.image];
  let layout = s.layout || 'bullets';
  if (layout === 'image' && !img) layout = 'emoji';
  drawBackground(ctx, W, H, th, o.globalT ?? lt, (o.index || 0) + 3);
  ctx.save();
  ctx.globalAlpha = 1;
  const capReserve = o.captions ? H * (portrait ? 0.2 : 0.2) : H * 0.06;
  const top = pad, bottom = H - capReserve;

  if (layout === 'image' && img) {
    const z = 1 + 0.12 * (lt / Math.max(1, d));
    ctx.save(); ctx.globalAlpha = inA;
    const iw = img.width, ih = img.height, sc = Math.max(W / iw, H / ih) * z;
    ctx.drawImage(img, (W - iw * sc) / 2 + (o.index % 2 ? -1 : 1) * u * 2 * (lt / Math.max(1, d)), (H - ih * sc) / 2, iw * sc, ih * sc);
    const gr = ctx.createLinearGradient(0, H * 0.35, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.globalAlpha = inA;
    const hf = fit(ctx, s.heading, cw, H * 0.16, u * (portrait ? 8 : 7.5), u * 3.5, 800);
    const tf = s.text ? fit(ctx, s.text, cw, H * 0.12, u * 4, u * 2.4, 500, 1.3) : null;
    const blockH = hf.lines.length * hf.lh + (tf ? tf.lines.length * tf.lh + u * 2 : 0);
    let y = bottom - blockH - u * 2 + (1 - inA) * u * 4;
    ctx.font = `800 ${hf.size}px ${FONT}`; y = drawLines(ctx, hf, pad, y, 'left', '#ffffff');
    if (tf) { ctx.font = `500 ${tf.size}px ${FONT}`; drawLines(ctx, tf, pad, y + u * 2, 'left', '#e5e7eb'); }
  } else if (layout === 'title' || layout === 'outro') {
    const cx = W / 2;
    if (s.emoji) emojiAt(ctx, s.emoji, cx, top + H * 0.14, u * (portrait ? 18 : 15) * easeBack(lt / 0.8), inA, Math.sin(lt * 1.5) * 0.06);
    const hf = fit(ctx, s.heading, cw * 0.92, H * 0.3, u * (portrait ? 11 : 10), u * 4, 900, 1.08);
    const tf = s.text ? fit(ctx, s.text, cw * 0.85, H * 0.18, u * 4.4, u * 2.6, 500, 1.3) : null;
    const blockH = hf.lines.length * hf.lh + (tf ? tf.lines.length * tf.lh + u * 5 : 0);
    let y = (top + (s.emoji ? H * 0.24 : 0) + bottom) / 2 - blockH / 2;
    ctx.globalAlpha = inA; ctx.font = `900 ${hf.size}px ${FONT}`;
    y = drawLines(ctx, hf, cx, y + (1 - inA) * u * 6, 'center', th.text);
    const lw = cw * 0.25 * ease((lt - 0.3) / 0.8);
    ctx.fillStyle = th.accent; rr(ctx, cx - lw / 2, y + u * 1.6, lw, u * 0.9, u * 0.45); ctx.fill();
    if (tf) { ctx.globalAlpha = ease((lt - 0.4) / 0.7); ctx.font = `500 ${tf.size}px ${FONT}`; drawLines(ctx, tf, cx, y + u * 4.5, 'center', th.sub); }
    if (layout === 'outro') { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(lt * 3); ctx.strokeStyle = th.accent2; ctx.lineWidth = u * 0.6; ctx.beginPath(); ctx.arc(cx, (top + bottom) / 2, Math.min(W, H) * 0.42 + Math.sin(lt * 2) * u, 0, 6.283); ctx.stroke(); }
  } else if (layout === 'big') {
    const cx = W / 2;
    let big = String(s.big || s.heading || '');
    const num = /^([^\d-]*)(-?[\d,.]+)(.*)$/.exec(big);
    if (num && lt < 1.2) { const target = parseFloat(num[2].replace(/,/g, '')); if (isFinite(target)) { const dec = (num[2].split('.')[1] || '').length; big = num[1] + (target * ease(lt / 1.2)).toLocaleString('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + num[3]; } }
    const bf = fit(ctx, big, cw, H * 0.3, u * (portrait ? 26 : 24), u * 8, 900, 1);
    const hf = fit(ctx, s.heading && s.heading !== s.big ? s.heading : (s.text || ''), cw * 0.9, H * 0.15, u * 5.5, u * 3, 700);
    const tf = s.text && s.heading && s.heading !== s.big ? fit(ctx, s.text, cw * 0.85, H * 0.14, u * 3.8, u * 2.4, 500, 1.3) : null;
    const blockH = bf.lines.length * bf.lh + u * 3 + hf.lines.length * hf.lh + (tf ? tf.lines.length * tf.lh + u * 3 : 0);
    let y = (top + bottom) / 2 - blockH / 2;
    ctx.save(); ctx.globalAlpha = inA; ctx.translate(cx, y + bf.lh / 2); const sc = 0.6 + 0.4 * easeBack(lt / 0.7); ctx.scale(sc, sc);
    const gg = ctx.createLinearGradient(-cw / 2, 0, cw / 2, 0); gg.addColorStop(0, th.accent); gg.addColorStop(1, th.accent2);
    ctx.font = `900 ${bf.size}px ${FONT}`; ctx.fillStyle = gg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; bf.lines.forEach((l, i) => ctx.fillText(l, 0, i * bf.lh)); ctx.restore();
    y += bf.lines.length * bf.lh + u * 3;
    ctx.globalAlpha = ease((lt - 0.3) / 0.6); ctx.font = `700 ${hf.size}px ${FONT}`; y = drawLines(ctx, hf, cx, y, 'center', th.text);
    if (tf) { ctx.globalAlpha = ease((lt - 0.6) / 0.6); ctx.font = `500 ${tf.size}px ${FONT}`; drawLines(ctx, tf, cx, y + u * 3, 'center', th.sub); }
  } else if (layout === 'quote') {
    const cx = W / 2;
    ctx.globalAlpha = 0.25 * inA; ctx.fillStyle = th.accent; ctx.font = `900 ${u * 40}px Georgia, serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText('“', cx, top - u * 4);
    const qf = fit(ctx, s.text || s.heading, cw * 0.88, H * 0.45, u * (portrait ? 7 : 6.5), u * 3, 600, 1.3);
    const af = s.text && s.heading ? fit(ctx, '— ' + s.heading, cw * 0.8, H * 0.1, u * 3.8, u * 2.4, 700) : null;
    const blockH = qf.lines.length * qf.lh + (af ? af.lh * af.lines.length + u * 4 : 0);
    let y = (top + bottom) / 2 - blockH / 2;
    ctx.globalAlpha = inA; ctx.font = `italic 600 ${qf.size}px ${FONT}`;
    // reveal line by line
    qf.lines.forEach((l, i) => { ctx.globalAlpha = ease((lt - i * 0.25) / 0.6); ctx.fillStyle = th.text; ctx.textAlign = 'center'; ctx.fillText(l, cx, y + i * qf.lh); });
    y += qf.lines.length * qf.lh;
    if (af) { ctx.globalAlpha = ease((lt - 0.8) / 0.6); ctx.font = `700 ${af.size}px ${FONT}`; drawLines(ctx, af, cx, y + u * 4, 'center', th.accent); }
  } else if (layout === 'emoji') {
    const cx = W / 2;
    if (portrait) {
      emojiAt(ctx, s.emoji || '✨', cx, top + H * 0.16, u * 24 * easeBack(lt / 0.8), 1, Math.sin(lt * 2) * 0.08);
      const hf = fit(ctx, s.heading, cw, H * 0.18, u * 9, u * 4, 800);
      const tf = s.text ? fit(ctx, s.text, cw, H * 0.22, u * 5, u * 2.8, 500, 1.35) : null;
      let y = top + H * 0.33;
      ctx.globalAlpha = ease((lt - 0.2) / 0.6); ctx.font = `800 ${hf.size}px ${FONT}`; y = drawLines(ctx, hf, cx, y, 'center', th.text);
      if (tf) { ctx.globalAlpha = ease((lt - 0.5) / 0.6); ctx.font = `500 ${tf.size}px ${FONT}`; drawLines(ctx, tf, cx, y + u * 3, 'center', th.sub); }
    } else {
      const ex = pad + cw * 0.2;
      ctx.save(); ctx.globalAlpha = inA; ctx.fillStyle = th.card; ctx.beginPath(); ctx.arc(ex, (top + bottom) / 2, Math.min(cw * 0.18, (bottom - top) * 0.38), 0, 6.283); ctx.fill(); ctx.restore();
      emojiAt(ctx, s.emoji || '✨', ex, (top + bottom) / 2, u * 22 * easeBack(lt / 0.8), 1, Math.sin(lt * 2) * 0.08);
      const tx = pad + cw * 0.44, tw = cw * 0.56;
      const hf = fit(ctx, s.heading, tw, (bottom - top) * 0.4, u * 8, u * 3.5, 800);
      const tf = s.text ? fit(ctx, s.text, tw, (bottom - top) * 0.45, u * 4.4, u * 2.5, 500, 1.35) : null;
      const blockH = hf.lines.length * hf.lh + (tf ? tf.lines.length * tf.lh + u * 3 : 0);
      let y = (top + bottom) / 2 - blockH / 2;
      ctx.globalAlpha = ease((lt - 0.2) / 0.6); ctx.font = `800 ${hf.size}px ${FONT}`; y = drawLines(ctx, hf, tx + (1 - ease((lt - 0.2) / 0.6)) * u * 5, y, 'left', th.text);
      if (tf) { ctx.globalAlpha = ease((lt - 0.5) / 0.6); ctx.font = `500 ${tf.size}px ${FONT}`; drawLines(ctx, tf, tx, y + u * 3, 'left', th.sub); }
    }
  } else { // bullets
    const bullets = (s.bullets && s.bullets.length ? s.bullets : String(s.text || '').split(/(?<=[.!?])\s+/)).filter(Boolean).slice(0, 6);
    const hf = fit(ctx, s.heading, cw - (s.emoji ? u * 14 : 0), H * 0.2, u * (portrait ? 8.5 : 7.5), u * 3.5, 800);
    ctx.globalAlpha = inA; ctx.font = `800 ${hf.size}px ${FONT}`;
    let y = drawLines(ctx, hf, pad + (1 - inA) * -u * 5, top, 'left', th.text);
    if (s.emoji) emojiAt(ctx, s.emoji, W - pad - u * 6, top + hf.lh / 2 + u, u * 11 * easeBack(lt / 0.8), 1, Math.sin(lt * 2) * 0.08);
    ctx.fillStyle = th.accent; rr(ctx, pad, y + u * 1.5, cw * 0.18 * ease((lt - 0.2) / 0.6), u * 0.8, u * 0.4); ctx.fill();
    y += u * 5;
    const avail = bottom - y; const n = bullets.length || 1;
    const each = Math.min(avail / n, u * (portrait ? 20 : 15));
    const fs = Math.min(u * (portrait ? 5 : 4.4), each * 0.42);
    const stagger = Math.min(0.9, (d * 0.55) / n);
    bullets.forEach((b, i) => {
      const a = ease((lt - 0.4 - i * stagger) / 0.5); if (a <= 0) return;
      ctx.globalAlpha = a;
      const by = y + i * each, bx = pad + (1 - a) * u * 6;
      ctx.fillStyle = th.card; rr(ctx, bx, by, cw, each - u * 1.5, u * 2); ctx.fill();
      ctx.fillStyle = i % 2 ? th.accent2 : th.accent; ctx.beginPath(); ctx.arc(bx + u * 4, by + (each - u * 1.5) / 2, u * 1.4, 0, 6.283); ctx.fill();
      const f = fit(ctx, b, cw - u * 11, each - u * 3, fs, u * 2.2, 600, 1.25);
      ctx.font = `600 ${f.size}px ${FONT}`; ctx.fillStyle = th.text; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      const ty = by + (each - u * 1.5) / 2 - (f.lines.length * f.lh) / 2;
      f.lines.forEach((l, k) => ctx.fillText(l, bx + u * 8, ty + k * f.lh));
    });
  }
  ctx.restore();

  // captions
  if (o.captions && s.narration && o.narrationWindow) {
    const [a, b] = o.narrationWindow;
    if (lt >= a && lt <= b + 0.2) {
      const words = s.narration.split(/\s+/).filter(Boolean); const per = portrait ? 5 : 8;
      const chunks = []; for (let i = 0; i < words.length; i += per) chunks.push(words.slice(i, i + per).join(' '));
      const k = Math.min(chunks.length - 1, Math.floor(((lt - a) / Math.max(0.1, b - a)) * chunks.length));
      if (k >= 0) {
        const f = fit(ctx, chunks[k], W * 0.86, H * 0.12, u * (portrait ? 5 : 4.2), u * 2.4, 700, 1.25);
        const bw = Math.max(...f.lines.map((l) => { ctx.font = `700 ${f.size}px ${FONT}`; return ctx.measureText(l).width; })) + u * 5;
        const bh = f.lines.length * f.lh + u * 2.4; const by = H - capReserve + (capReserve - bh) / 2;
        ctx.save(); ctx.globalAlpha = 0.92; ctx.fillStyle = 'rgba(0,0,0,0.72)'; rr(ctx, (W - bw) / 2, by, bw, bh, u * 1.5); ctx.fill();
        ctx.globalAlpha = 1; ctx.font = `700 ${f.size}px ${FONT}`; drawLines(ctx, f, W / 2, by + u * 1.2, 'center', '#ffffff'); ctx.restore();
      }
    }
  }
}

let layer = null;
// Draw a whole AI video frame at time t, with crossfades between scenes.
export function drawVideoFrame(ctx, t, plan, o) {
  const { scenes, starts, durs } = plan; const W = o.W, H = o.H; const u = Math.min(W, H) / 100;
  let i = 0; while (i < scenes.length - 1 && t >= starts[i + 1]) i++;
  const lt = t - starts[i];
  const XF = 0.5;
  const sceneOpts = (k) => ({ ...o, index: k, narrationWindow: plan.narr && plan.narr[k] ? plan.narr[k] : [0.2, durs[k] - 0.2], globalT: t });
  drawScene(ctx, scenes[i], lt, durs[i], sceneOpts(i));
  // crossfade into the next scene during the last XF seconds
  if (i < scenes.length - 1 && durs[i] - lt < XF) {
    const p = 1 - (durs[i] - lt) / XF;
    if (!layer || layer.width !== W || layer.height !== H) { layer = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H }); }
    const lc = layer.getContext('2d');
    lc.save(); lc.globalAlpha = 1; drawScene(lc, scenes[i + 1], 0, durs[i + 1], sceneOpts(i + 1)); lc.restore();
    ctx.save(); ctx.globalAlpha = ease(p); ctx.drawImage(layer, 0, 0); ctx.restore();
  }
  // progress bar
  if (o.progress !== false) {
    ctx.fillStyle = o.theme.accent; ctx.globalAlpha = 0.85; ctx.fillRect(0, H - u * 0.7, W * (t / plan.total), u * 0.7); ctx.globalAlpha = 1;
  }
  if (o.fadeEdges !== false) {
    const fi = Math.min(1, t / 0.4), fo = Math.min(1, (plan.total - t) / 0.5);
    const a = 1 - Math.min(fi, fo);
    if (a > 0) { ctx.fillStyle = `rgba(0,0,0,${a})`; ctx.fillRect(0, 0, W, H); }
  }
}
