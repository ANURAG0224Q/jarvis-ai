// Hidden mock provider for automated tests (enable with ?mock=1). Never used otherwise.
import { sleep } from './util.js';
import { pcmToWav } from './providers.js';

const SNAKE = `Here's a complete Snake game in one file. Use the arrow keys (or swipe on a phone).

\`\`\`html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Snake</title>
<style>body{margin:0;background:#111;color:#eee;font-family:sans-serif;display:flex;flex-direction:column;align-items:center}canvas{background:#000;border:2px solid #4ade80;margin-top:10px;touch-action:none}#s{margin:8px}</style>
</head><body><div id="s">Score: 0</div><canvas id="c" width="300" height="300"></canvas>
<script>
const c=document.getElementById('c'),x=c.getContext('2d'),N=15,S=20;let snake=[{x:7,y:7}],dir={x:1,y:0},food={x:3,y:3},score=0,dead=false;
function place(){food={x:Math.floor(Math.random()*N),y:Math.floor(Math.random()*N)}}
document.addEventListener('keydown',e=>{const k={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];if(k&&(k[0]!==-dir.x||k[1]!==-dir.y))dir={x:k[0],y:k[1]}});
function step(){if(dead)return;const h={x:(snake[0].x+dir.x+N)%N,y:(snake[0].y+dir.y+N)%N};if(snake.some(p=>p.x===h.x&&p.y===h.y)){dead=true;document.getElementById('s').textContent='Game over! Score: '+score;return}snake.unshift(h);if(h.x===food.x&&h.y===food.y){score++;document.getElementById('s').textContent='Score: '+score;place()}else snake.pop();draw()}
function draw(){x.fillStyle='#000';x.fillRect(0,0,300,300);x.fillStyle='#f43f5e';x.fillRect(food.x*S,food.y*S,S-1,S-1);x.fillStyle='#4ade80';snake.forEach(p=>x.fillRect(p.x*S,p.y*S,S-1,S-1))}
draw();setInterval(step,120);window.__snake=()=>({len:snake.length,head:snake[0],score});
</script></body></html>
\`\`\`

Tap **Preview** to play it right here.`;

function lastUserText(turns) {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].role === 'user') return turns[i].parts.filter((p) => p.text).map((p) => p.text).join('\n');
  return '';
}
function describeParts(turns) {
  const names = [];
  for (const t of turns) for (const p of t.parts) {
    if (p.file) names.push(`${p.file.kind}:${p.file.name}`);
    if (p.youtube) names.push(`youtube:${p.youtube}`);
    if (p.link) names.push(`link:${p.link}`);
    if (p.text && /^--- Source: (.+?) ---/m.test(p.text)) names.push('text:' + /^--- Source: (.+?) ---/m.exec(p.text)[1]);
  }
  return names;
}

function videoScript(prompt) {
  const T = +((/TARGET_SECONDS:\s*(\d+)/.exec(prompt) || [])[1] || 30);
  const n = Math.max(2, Math.min(24, Math.round(T / 9)));
  const layouts = ['title', 'bullets', 'big', 'emoji', 'quote', 'bullets', 'image', 'emoji'];
  const scenes = [];
  for (let i = 0; i < n; i++) {
    const layout = i === 0 ? 'title' : i === n - 1 ? 'outro' : layouts[i % layouts.length];
    const words = Math.round((T / n) * 2.2);
    scenes.push({
      layout, heading: i === 0 ? 'How Rainbows Form' : i === n - 1 ? 'Thanks for watching!' : `Fact ${i}: light bends`,
      text: 'Sunlight splits into colours inside raindrops.', bullets: ['Refraction', 'Reflection', 'Dispersion'], big: `${i * 7 + 3}°`,
      emoji: ['🌈', '☀️', '💧', '🔬', '🎨'][i % 5], image: layout === 'image' ? 0 : -1,
      narration: Array.from({ length: words }, (_, k) => ['light', 'water', 'colour', 'sun', 'drop', 'bends', 'into', 'seven', 'bands'][k % 9]).join(' ') + '.',
      duration: +(T / n).toFixed(1),
    });
  }
  return JSON.stringify({ title: 'How Rainbows Form', scenes });
}

function examPaper(prompt) {
  const T = +((/TOTAL_MARKS:\s*(\d+)/.exec(prompt) || [])[1] || 20);
  const allowed = ((/type codes: ([a-z, ]+)\)/.exec(prompt) || [])[1] || 'mcq, numerical, short, long').split(/,\s*/);
  const bank = [
    { type: 'mcq', topic: 'Arithmetic', marks: 2, question: 'What is $2 + 2$?', options: ['3', '4', '5', '22'], answer: '1', solution: '$2 + 2 = 4$, so option **B**.' },
    { type: 'mcq', topic: 'Electronics', marks: 2, question: 'Unit of resistance?', options: ['Volt', 'Ampere', 'Ohm', 'Watt'], answer: '2', solution: 'Resistance is measured in ohms (Ω).' },
    { type: 'numerical', topic: 'Electronics', marks: 3, question: 'A 10 V source drives 2 A. Find R.', answer: '5', tolerance: 0.01, unit: 'Ω', solution: '$R = V/I = 10/2 = 5\\,\\Omega$' },
    { type: 'short', topic: 'Electronics', marks: 4, question: 'State Ohm\'s law.', answer: 'Current through a conductor is proportional to the voltage across it at constant temperature (V = IR).', markingScheme: '2 marks proportionality, 2 marks V=IR', solution: 'V = IR at constant temperature.' },
    { type: 'long', topic: 'Semiconductors', marks: 8, question: 'Explain how an NPN transistor works as a switch.', answer: 'Base current turns on collector current…', markingScheme: 'structure 2, biasing 3, switching 3', solution: 'Explain regions, cutoff and saturation.' },
    { type: 'mcq', topic: 'Arithmetic', marks: 1, question: 'What is $3 \\times 3$?', options: ['6', '9', '12', '33'], answer: '1', solution: '9' },
  ].filter((q) => allowed.includes(q.type));
  // deliberately wrong total (sum + 3) so the app's rebalancing is exercised
  return JSON.stringify({ title: 'Mock practice paper', questions: bank.map((q, i) => (i === 0 ? { ...q, marks: q.marks + 3 } : q)) });
}
function examGrade(prompt) {
  const items = [...prompt.matchAll(/ID: (\w+)[\s\S]*?STUDENT ANSWER: ([^\n]*)/g)];
  return JSON.stringify({ results: items.map((m) => ({ id: m[1], awarded: m[2].trim().length > 10 ? 2 : 0, reason: m[2].trim().length > 10 ? 'Partly correct (mock).' : 'Too short (mock).' })), revise: ['Revise Ohm\'s law (mock)', 'Practise transistor biasing (mock)'], summary: 'Good effort! (mock)' });
}

export async function mockReply(turns, o) {
  const prompt = lastUserText(turns);
  let text;
  if (o.json && /EXAM_PAPER/.test(prompt)) text = examPaper(prompt);
  else if (o.json && /GRADE_ANSWERS/.test(prompt)) text = examGrade(prompt);
  else if (o.json) text = videoScript(prompt + '\n' + (o.system || ''));
  else if (/snake/i.test(prompt)) text = SNAKE;
  else if (/^\s*title for/i.test(prompt) || /short title/i.test(o.system || '')) text = 'Mock chat title';
  else {
    const names = describeParts(turns);
    text = `**Mock answer** to: "${prompt.slice(0, 80)}"\n\n` +
      (names.length ? `I can see these sources: ${names.join(', ')}.\n\n` : '') +
      (o.system ? `System prompt active (${o.system.length} chars).\n\n` : '') +
      `| Item | Value |\n|---|---|\n| Turns | ${turns.length} |\n| Model | mock |\n\n` +
      'Example code:\n\n```js\nfunction add(a, b) {\n  return a + b;\n}\nconsole.log(add(2, 3));\n```\n\nDone.';
  }
  if (o.showThinking && !o.json) { o.onThought && o.onThought('Thinking about the request (mock)…'); }
  o.onModel && o.onModel('mock-model');
  let out = '';
  const step = Math.max(8, Math.ceil(text.length / 40));
  for (let i = 0; i < text.length; i += step) {
    if (o.signal && o.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    out = text.slice(0, i + step);
    o.onText && o.onText(out);
    await sleep(window.__JARVIS_MOCK_DELAY ?? 25);
  }
  return { text, thoughts: o.showThinking && !o.json ? 'Thinking about the request (mock)…' : '', finish: 'STOP', model: 'mock-model', notes: [] };
}

export async function mockTTS(text) {
  const words = text.trim().split(/\s+/).length;
  const sec = Math.max(0.6, words / 2.6), rate = 24000, n = Math.round(sec * rate);
  const pcm = new Uint8Array(n * 2), v = new DataView(pcm.buffer);
  for (let i = 0; i < n; i++) {
    const t = i / rate, word = Math.floor(t * 2.6), inWord = (t * 2.6) % 1 < 0.75;
    const s = inWord ? Math.sin(2 * Math.PI * (180 + (word % 5) * 30) * t) * 0.25 : 0;
    v.setInt16(i * 2, Math.round(s * 32767), true);
  }
  await sleep(50);
  return pcmToWav(pcm, rate, 1);
}

export async function mockImage(prompt, w, h) {
  const c = new OffscreenCanvas(Math.min(w, 512), Math.min(h, 512)); const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, '#6366f1'); g.addColorStop(1, '#06b6d4');
  x.fillStyle = g; x.fillRect(0, 0, c.width, c.height); x.fillStyle = '#fff'; x.font = 'bold 28px sans-serif'; x.fillText(prompt.slice(0, 24), 20, c.height / 2);
  return c.convertToBlob({ type: 'image/png' });
}
