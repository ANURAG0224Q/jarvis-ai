// Video engine: frame-exact export with WebCodecs (via Mediabunny), audio decode + mixing.
import * as MB from '../../lib/mediabunny.js';

export const MAX_SECONDS = 600; // 10 min, verified end-to-end at 720p      // hard limit: 5 minutes
export const MIN_SECONDS = 1;
export const SAMPLE_RATE = 48000;

export function sizeFor(aspect = '16:9', q = '720') {
  const s = +q; const even = (n) => Math.round(n / 2) * 2;
  if (aspect === '9:16') return { w: s, h: even(s * 16 / 9) };
  if (aspect === '1:1') return { w: s, h: s };
  if (aspect === '4:5') return { w: s, h: even(s * 5 / 4) };
  return { w: even(s * 16 / 9), h: s };
}

export function webCodecsAvailable() { return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined'; }

export async function pickCodecs(format, w, h) {
  if (!webCodecsAvailable()) return null;
  const v = await MB.getFirstEncodableVideoCodec(format === 'webm' ? ['vp9', 'vp8', 'av1'] : ['avc', 'vp9', 'av1'], { width: w, height: h });
  if (!v) return null;
  let a = null;
  if (typeof AudioEncoder !== 'undefined') a = await MB.getFirstEncodableAudioCodec(format === 'webm' ? ['opus', 'vorbis'] : ['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  return { video: v, audio: a };
}

/**
 * Render a video frame by frame.
 * drawFrame(ctx, t, i) draws the frame at time t (may be async).
 * audio: AudioBuffer (exactly `duration` long) or null.
 * Returns {blob, mime, codecs}
 */
export async function exportVideo({ width, height, fps = 30, duration, drawFrame, audio = null, format = 'mp4', onProgress, signal, quality }) {
  duration = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, duration));
  const codecs = await pickCodecs(format, width, height);
  if (!codecs) throw Object.assign(new Error('NO_WEBCODECS'), { code: 'NO_WEBCODECS' });
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { alpha: false });
  const output = new MB.Output({ format: format === 'webm' ? new MB.WebMOutputFormat() : new MB.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new MB.BufferTarget() });
  const q = quality === 'high' || Math.min(width, height) >= 1000 ? MB.QUALITY_HIGH : MB.QUALITY_MEDIUM;
  const vs = new MB.CanvasSource(canvas, { codec: codecs.video, quality: q, keyFrameInterval: 2 });
  output.addVideoTrack(vs, { frameRate: fps });
  let as = null;
  if (audio && codecs.audio) { as = new MB.AudioBufferSource({ codec: codecs.audio, quality: MB.QUALITY_HIGH }); output.addAudioTrack(as); }
  await output.start();
  const N = Math.round(duration * fps);
  let lastReport = 0;
  try {
    for (let i = 0; i < N; i++) {
      if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / fps;
      ctx.save(); await drawFrame(ctx, t, i, width, height); ctx.restore();
      await vs.add(t, 1 / fps);
      const now = performance.now();
      if (onProgress && (now - lastReport > 150 || i === N - 1)) { lastReport = now; onProgress((i + 1) / N * (as ? 0.92 : 0.98), i + 1, N); }
    }
    vs.close();
    if (as) {
      // feed audio in chunks to respect encoder backpressure (and memory, for lazy mixers)
      const sr = audio.sampleRate, chunk = sr * (audio.isMixer ? 20 : 10), total = Math.min(audio.length, Math.round(duration * sr));
      for (let off = 0; off < total; off += chunk) {
        if (signal && signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        const len = Math.min(chunk, total - off);
        let part;
        if (audio.isMixer) part = await audio.render(off, len);
        else {
          part = new AudioBuffer({ length: len, numberOfChannels: audio.numberOfChannels, sampleRate: sr });
          for (let c = 0; c < audio.numberOfChannels; c++) part.copyToChannel(audio.getChannelData(c).subarray(off, off + len), c);
        }
        await as.add(part);
        onProgress && onProgress(0.92 + 0.07 * Math.min(1, (off + len) / total), N, N);
      }
      as.close();
    }
    onProgress && onProgress(0.99, N, N);
    await output.finalize();
  } catch (e) {
    try { await output.cancel(); } catch {}
    throw e;
  }
  const mime = format === 'webm' ? 'video/webm' : 'video/mp4';
  return { blob: new Blob([output.target.buffer], { type: mime }), mime, codecs: { video: codecs.video, audio: as ? codecs.audio : null } };
}

/**
 * Fallback for browsers without WebCodecs: records a canvas in real time with MediaRecorder.
 * play(t) is called every animation frame with the elapsed time and must draw onto `canvas`.
 */
export async function recordRealtime({ canvas, duration, fps = 30, audio = null, play, onProgress, signal }) {
  duration = Math.min(MAX_SECONDS, duration);
  const stream = canvas.captureStream(fps);
  let ac = null, src = null;
  if (audio) {
    ac = new AudioContext({ sampleRate: audio.sampleRate });
    const dest = ac.createMediaStreamDestination();
    src = ac.createBufferSource(); src.buffer = audio; src.connect(dest);
    dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  }
  const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = types.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 5e6 } : {});
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((res) => { rec.onstop = res; });
  rec.start(1000);
  const t0 = performance.now();
  if (src) src.start();
  await new Promise((resolve, reject) => {
    const tick = () => {
      if (signal && signal.aborted) { reject(new DOMException('Export cancelled', 'AbortError')); return; }
      const t = (performance.now() - t0) / 1000;
      if (t >= duration) { resolve(); return; }
      play(t); onProgress && onProgress(t / duration);
      requestAnimationFrame(tick);
    };
    tick();
  }).finally(() => { try { rec.stop(); } catch {} try { src && src.stop(); } catch {} });
  await done; if (ac) ac.close();
  const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
  return { blob: new Blob(chunks, { type }), mime: type, codecs: { video: 'mediarecorder', audio: audio ? 'mediarecorder' : null } };
}

// ---------- audio ----------
const audioCache = new Map();
export async function decodeAudio(blob, key) {
  if (key && audioCache.has(key)) return audioCache.get(key);
  let buf = null;
  try {
    const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
    buf = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    try {
      const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(blob) });
      const track = await input.getPrimaryAudioTrack();
      if (track && (await track.canDecode())) {
        const sink = new MB.AudioBufferSink(track); const parts = [];
        for await (const w of sink.buffers()) parts.push(w);
        if (parts.length) {
          const sr = parts[0].buffer.sampleRate, ch = parts[0].buffer.numberOfChannels;
          const end = parts[parts.length - 1].timestamp + parts[parts.length - 1].duration;
          const out = new AudioBuffer({ length: Math.ceil(end * sr), numberOfChannels: ch, sampleRate: sr });
          for (const p of parts) for (let c = 0; c < ch; c++) { const off = Math.max(0, Math.round(p.timestamp * sr)); const d = p.buffer.getChannelData(c); if (off + d.length <= out.length) out.copyToChannel(d, c, off); }
          buf = out;
        }
      }
    } catch { buf = null; }
  }
  if (key) audioCache.set(key, buf);
  return buf;
}

/**
 * Mix tracks into one stereo AudioBuffer of exactly `duration` seconds.
 * track: {buffer, start, offset=0, dur, rate=1, gain=1, fadeIn=0, fadeOut=0, loop=false}
 */

// Memory-friendly mixer for long exports: renders the mix in windows (default 20 s) instead of one huge buffer.
// A 10-minute stereo mix as one AudioBuffer is ~230 MB; one window is ~8 MB.
export function makeMixer(duration, tracks, { sampleRate = SAMPLE_RATE, channels = 2 } = {}) {
  tracks = tracks.filter((t) => t && t.buffer && t.dur > 0.01 && t.start < duration);
  if (!tracks.length) return null;
  const length = Math.round(duration * sampleRate);
  const envAt = (t, x) => { // gain of track t at absolute time x
    const end = Math.min(duration, t.start + t.dur), gain = t.gain ?? 1;
    const fi = Math.min(t.fadeIn || 0, (end - t.start) / 2), fo = Math.min(t.fadeOut || 0, (end - t.start) / 2);
    if (x < t.start || x > end) return 0;
    if (fi && x < t.start + fi) return gain * (x - t.start) / fi;
    if (fo && x > end - fo) return gain * Math.max(0, (end - x) / fo);
    return gain;
  };
  return {
    isMixer: true, sampleRate, numberOfChannels: channels, length, duration,
    async render(offSamples, lenSamples) {
      const w0 = offSamples / sampleRate, wl = lenSamples / sampleRate, w1 = w0 + wl;
      const ctx = new OfflineAudioContext(channels, lenSamples, sampleRate);
      for (const t of tracks) {
        const end = Math.min(duration, t.start + t.dur);
        if (end <= w0 || t.start >= w1) continue;
        const rate = t.rate || 1;
        const src = ctx.createBufferSource(); src.buffer = t.buffer; src.playbackRate.value = rate;
        if (t.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = t.buffer.duration; }
        const g = ctx.createGain();
        const a = Math.max(t.start, w0), b = Math.min(end, w1);
        g.gain.setValueAtTime(envAt(t, a), a - w0);
        // breakpoints of the envelope inside this window
        const gain = t.gain ?? 1, fi = Math.min(t.fadeIn || 0, (end - t.start) / 2), fo = Math.min(t.fadeOut || 0, (end - t.start) / 2);
        for (const p of [t.start + fi, end - fo, b]) if (p > a && p <= b) g.gain.linearRampToValueAtTime(envAt(t, p), p - w0);
        src.connect(g).connect(ctx.destination);
        let offset = Math.max(0, t.offset || 0) + (a - t.start) * rate;
        if (t.loop) offset %= t.buffer.duration;
        else if (offset >= t.buffer.duration) continue;
        src.start(a - w0, offset); src.stop(b - w0);
      }
      return ctx.startRendering();
    },
  };
}

export async function mixAudio(duration, tracks, { sampleRate = SAMPLE_RATE, channels = 2 } = {}) {
  tracks = tracks.filter((t) => t && t.buffer && t.dur > 0.01 && t.start < duration);
  if (!tracks.length) return null;
  const ctx = new OfflineAudioContext(channels, Math.round(duration * sampleRate), sampleRate);
  for (const t of tracks) {
    const src = ctx.createBufferSource(); src.buffer = t.buffer;
    src.playbackRate.value = t.rate || 1;
    if (t.loop) { src.loop = true; src.loopStart = 0; src.loopEnd = t.buffer.duration; }
    const g = ctx.createGain();
    const end = Math.min(duration, t.start + t.dur), gain = t.gain ?? 1;
    const fi = Math.min(t.fadeIn || 0, (end - t.start) / 2), fo = Math.min(t.fadeOut || 0, (end - t.start) / 2);
    g.gain.setValueAtTime(fi ? 0 : gain, t.start);
    if (fi) g.gain.linearRampToValueAtTime(gain, t.start + fi);
    if (fo) { g.gain.setValueAtTime(gain, Math.max(t.start + fi, end - fo)); g.gain.linearRampToValueAtTime(0, end); }
    src.connect(g).connect(ctx.destination);
    const offset = Math.max(0, t.offset || 0);
    if (t.loop) src.start(t.start, offset % t.buffer.duration); else src.start(t.start, offset);
    src.stop(end);
  }
  return ctx.startRendering();
}

// Probe a media file: duration, size, whether frame-exact decoding works.
export async function probeMedia(blob) {
  const kind = blob.type.split('/')[0];
  if (kind === 'image') {
    const bmp = await createImageBitmap(blob);
    return { kind: 'image', width: bmp.width, height: bmp.height, duration: 0, bitmap: bmp };
  }
  if (kind === 'audio') {
    const buf = await decodeAudio(blob);
    if (!buf) throw new Error('This audio file could not be read.');
    return { kind: 'audio', duration: buf.duration };
  }
  // video
  let info = { kind: 'video', duration: 0, width: 0, height: 0, webcodecs: false, hasAudio: false };
  try {
    const input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(blob) });
    const vt = await input.getPrimaryVideoTrack();
    if (vt) {
      info.width = await vt.getDisplayWidth(); info.height = await vt.getDisplayHeight();
      info.duration = await input.computeDuration();
      info.webcodecs = webCodecsAvailable() && (await vt.canDecode());
      info.hasAudio = !!(await input.getPrimaryAudioTrack());
    }
  } catch { /* fall back to the <video> element below */ }
  if (!info.duration || !info.width) {
    const v = document.createElement('video'); v.preload = 'metadata'; v.muted = true; v.src = URL.createObjectURL(blob);
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('This video format is not supported by your browser.')); setTimeout(() => rej(new Error('Timed out reading video')), 15000); });
    info.duration = v.duration; info.width = v.videoWidth; info.height = v.videoHeight; info.hasAudio = true;
    URL.revokeObjectURL(v.src);
  }
  if (!isFinite(info.duration) || info.duration <= 0) throw new Error('Could not read the video length.');
  return info;
}

// Frame source for export: exact frames from Mediabunny, or <video> seeking as a fallback.
export class FrameSource {
  constructor(blob, info) { this.blob = blob; this.info = info; this.input = null; this.sink = null; }
  async open() {
    if (this.info.webcodecs) {
      try {
        this.input = new MB.Input({ formats: MB.ALL_FORMATS, source: new MB.BlobSource(this.blob) });
        const vt = await this.input.getPrimaryVideoTrack();
        this.sink = new MB.CanvasSink(vt, { poolSize: 2 });
        this.first = await vt.getFirstTimestamp();
        return this;
      } catch { this.sink = null; }
    }
    this.video = document.createElement('video'); this.video.muted = true; this.video.playsInline = true; this.video.preload = 'auto';
    this.video.src = URL.createObjectURL(this.blob);
    await new Promise((res, rej) => { this.video.onloadeddata = res; this.video.onerror = () => rej(new Error('Video cannot be decoded')); });
    return this;
  }
  // Async iterator of drawable images for sorted timestamps.
  async *frames(timestamps) {
    if (this.sink) {
      const ts = timestamps.map((t) => Math.max(this.first || 0, t));
      let last = null;
      for await (const w of this.sink.canvasesAtTimestamps(ts)) { if (w) last = w.canvas; yield last; }
      return;
    }
    for (const t of timestamps) {
      const v = this.video; const target = Math.min(Math.max(0, t), v.duration - 0.001);
      if (Math.abs(v.currentTime - target) > 0.001) await new Promise((res) => { const on = () => { v.removeEventListener('seeked', on); res(); }; v.addEventListener('seeked', on); v.currentTime = target; setTimeout(res, 3000); });
      yield v;
    }
  }
  close() { try { this.input && this.input.dispose && this.input.dispose(); } catch {} if (this.video) { URL.revokeObjectURL(this.video.src); this.video.src = ''; } }
}

// Draw an image/video/canvas into a box with cover/contain fit.
export function drawFit(ctx, img, W, H, fit = 'cover', zoom = 1, panX = 0.5, panY = 0.5) {
  const iw = img.videoWidth || img.naturalWidth || img.width, ih = img.videoHeight || img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const s = (fit === 'contain' ? Math.min(W / iw, H / ih) : Math.max(W / iw, H / ih)) * zoom;
  const dw = iw * s, dh = ih * s;
  ctx.drawImage(img, (W - dw) * panX, (H - dh) * panY, dw, dh);
}
