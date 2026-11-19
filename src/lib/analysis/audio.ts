import type { AudioFeatures } from '../types';
import { clamp } from '../color';

// Собственный аудиоанализ: темп (автокорреляция огибающей атак), фаза долей,
// тональность (хромаграмма + профили Крумхансла–Кесслер), громкость, яркость, динамика.

const SR = 22050;
const N = 2048;
const HOP = 512;

let twCos: Float32Array | null = null;
let twSin: Float32Array | null = null;
function prepTw() {
  if (twCos) return;
  twCos = new Float32Array(N / 2);
  twSin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) {
    twCos[i] = Math.cos((-2 * Math.PI * i) / N);
    twSin[i] = Math.sin((-2 * Math.PI * i) / N);
  }
}

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = twCos![k * step],
          wi = twSin![k * step];
        const a = i + k,
          b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/** Монофонический сигнал 22 050 Гц */
export async function toMono22k(buf: AudioBuffer, from = 0, dur?: number): Promise<Float32Array> {
  const len = Math.min(buf.duration - from, dur ?? buf.duration);
  const off = new OfflineAudioContext(1, Math.ceil(len * SR), SR);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start(0, from, len);
  const r = await off.startRendering();
  return r.getChannelData(0);
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]) {
  const ma = a.reduce((s, x) => s + x, 0) / a.length;
  const mb = b.reduce((s, x) => s + x, 0) / b.length;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db + 1e-12);
}

export async function analyzeAudio(buf: AudioBuffer): Promise<AudioFeatures> {
  prepTw();
  const x = await toMono22k(buf);
  const frames = Math.max(1, Math.floor((x.length - N) / HOP));
  const fps = SR / HOP;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const bins = N / 2 + 1;
  let prev = new Float32Array(bins);
  const flux = new Float32Array(frames);
  const rms = new Float32Array(frames);
  const cent = new Float32Array(frames);
  const chroma = new Array(12).fill(0);
  // вес полос: бочка и малый барабан задают долю сильнее, чем хай-хэт
  const bandW = new Float32Array(bins);
  for (let k = 0; k < bins; k++) {
    const f = (k * SR) / N;
    bandW[k] = f < 250 ? 3 : f < 2500 ? 1 : 0.3;
  }
  // соответствие бина и ноты
  const pcOfBin = new Int8Array(bins).fill(-1);
  for (let k = 1; k < bins; k++) {
    const f = (k * SR) / N;
    if (f >= 65 && f <= 2100) pcOfBin[k] = (((Math.round(12 * Math.log2(f / 440)) + 69) % 12) + 12) % 12;
  }
  for (let t = 0; t < frames; t++) {
    const o = t * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) {
      const v = x[o + i] ?? 0;
      e += v * v;
      re[i] = v * win[i];
      im[i] = 0;
    }
    rms[t] = Math.sqrt(e / N);
    fft(re, im);
    const cur = new Float32Array(bins);
    let fl = 0,
      sm = 0,
      sw = 0;
    for (let k = 0; k < bins; k++) {
      const m = Math.hypot(re[k], im[k]);
      const lm = Math.log1p(m * 10);
      cur[k] = lm;
      const d = lm - prev[k];
      if (d > 0 && k > 1) fl += d * bandW[k];
      sm += m;
      sw += m * k;
      if (pcOfBin[k] >= 0) chroma[pcOfBin[k]] += m;
    }
    flux[t] = fl;
    cent[t] = sm > 0 ? sw / sm / bins : 0;
    prev = cur;
  }

  // огибающая атак: вычитаем локальное среднее
  const env = new Float32Array(frames);
  const W = Math.round(fps * 0.4);
  for (let t = 0; t < frames; t++) {
    let s = 0,
      c = 0;
    for (let j = Math.max(0, t - W); j < Math.min(frames, t + W); j++) {
      s += flux[j];
      c++;
    }
    env[t] = Math.max(0, flux[t] - s / c);
  }
  // нормируем по 95-му перцентилю, чтобы один удар не «съел» остальные
  const sortedEnv = Float32Array.from(env).sort();
  const p95 = sortedEnv[Math.floor(frames * 0.95)] || sortedEnv[frames - 1] || 1;
  if (p95 > 0) for (let t = 0; t < frames; t++) env[t] = Math.min(1.5, env[t] / p95);

  // темп: автокорреляция с лог-нормальным приором около 115 BPM
  const minL = Math.floor((60 * fps) / 200);
  const maxL = Math.ceil((60 * fps) / 55);
  const ac = new Float32Array(maxL + 2);
  for (let l = minL - 1; l <= maxL + 1; l++) {
    let s = 0;
    for (let t = 0; t + l < frames; t++) s += env[t] * env[t + l];
    ac[l] = s / (frames - l);
  }
  let bestL = minL,
    bestS = -1;
  const scoreAt = (l: number) => {
    const bpm = (60 * fps) / l;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.85) ** 2);
    const harm = ac[l] + (l * 2 <= maxL + 1 ? 0.5 * ac[l * 2] : 0);
    return harm * prior;
  };
  for (let l = minL; l <= maxL; l++) {
    const s = scoreAt(l);
    if (s > bestS) {
      bestS = s;
      bestL = l;
    }
  }
  // параболическая доводка
  const y0 = ac[bestL - 1],
    y1 = ac[bestL],
    y2 = ac[bestL + 1];
  const denom = y0 - 2 * y1 + y2;
  const lagF = bestL + (denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0);
  let bpm = (60 * fps) / lagF;
  if (!isFinite(bpm) || bpm < 40) bpm = 100;
  // октавная проверка: сильны ли «промежуточные» доли?
  const midRatio = (period: number) => {
    let bo = 0,
      bs = -1;
    for (let o = 0; o < period; o += 0.5) {
      let s = 0;
      for (let p = o; p < frames; p += period) s += env[Math.round(p)] ?? 0;
      if (s > bs) {
        bs = s;
        bo = o;
      }
    }
    let on = 0,
      mid = 0,
      c = 0;
    for (let p = bo; p + period / 2 < frames; p += period) {
      on += Math.max(env[Math.round(p) - 1] ?? 0, env[Math.round(p)] ?? 0, env[Math.round(p) + 1] ?? 0);
      const m = p + period / 2;
      mid += Math.max(env[Math.round(m) - 1] ?? 0, env[Math.round(m)] ?? 0, env[Math.round(m) + 1] ?? 0);
      c++;
    }
    return c ? mid / (on + 1e-9) : 1;
  };
  let lagUse = lagF;
  if (bpm / 2 >= 58 && midRatio(lagF * 2) < 0.72) {
    lagUse = lagF * 2;
    bpm /= 2;
  } else if (bpm < 78 && midRatio(lagF) > 0.85) {
    lagUse = lagF / 2;
    bpm *= 2;
  }
  let acMean = 0;
  for (let l = minL; l <= maxL; l++) acMean += ac[l];
  acMean /= maxL - minL + 1;
  const beatConfidence = clamp((ac[bestL] / (acMean + 1e-9) - 1) / 4);

  // фаза долей
  const period = lagUse;
  let bestOff = 0,
    bestOS = -1;
  for (let o = 0; o < period; o += 0.5) {
    let s = 0;
    for (let p = o; p < frames; p += period) s += env[Math.round(p)] ?? 0;
    if (s > bestOS) {
      bestOS = s;
      bestOff = o;
    }
  }
  const beatOffset = bestOff / fps;

  // тональность
  let best = { key: 0, mode: 'major' as 'major' | 'minor', r: -2 };
  let bestMaj = -2,
    bestMin = -2;
  for (let k = 0; k < 12; k++) {
    const rot = chroma.map((_, i) => chroma[(i + k) % 12]);
    const rM = corr(rot, MAJOR);
    const rm = corr(rot, MINOR);
    if (rM > bestMaj) bestMaj = rM;
    if (rm > bestMin) bestMin = rm;
    if (rM > best.r) best = { key: k, mode: 'major', r: rM };
    if (rm > best.r) best = { key: k, mode: 'minor', r: rm };
  }
  const modeConfidence = clamp(Math.abs(bestMaj - bestMin) * 4 + 0.15);

  // громкость, яркость, динамика
  let rm = 0;
  for (let t = 0; t < frames; t++) rm += rms[t];
  rm /= frames;
  const db = 20 * Math.log10(rm + 1e-9);
  const loudness = clamp((db + 32) / 24);
  let cm = 0;
  for (let t = 0; t < frames; t++) cm += cent[t];
  cm /= frames;
  const brightness = clamp((cm - 0.05) / 0.25);
  const dbs = Array.from(rms, (r) => 20 * Math.log10(r + 1e-6));
  const dbm = dbs.reduce((s, v) => s + v, 0) / dbs.length;
  const dbsd = Math.sqrt(dbs.reduce((s, v) => s + (v - dbm) ** 2, 0) / dbs.length);
  const dynamics = clamp(dbsd / 12);

  // плотность атак
  let onsets = 0;
  for (let t = 1; t < frames - 1; t++) if (env[t] > 0.3 && env[t] > env[t - 1] && env[t] >= env[t + 1]) onsets++;
  const duration = x.length / SR;
  const onsetRate = onsets / duration;

  const bpmN = clamp((bpm - 60) / 110);
  // энергия: громкость, плотность атак, темп, яркость тембра и выраженность пульса (барабаны)
  const energy = clamp(0.32 * loudness + 0.18 * clamp((onsetRate - 1) / 5) + 0.15 * bpmN + 0.1 * brightness + 0.25 * beatConfidence);

  // дорожка: пики
  const P = 160;
  const peaks: number[] = [];
  const per = Math.floor(x.length / P);
  let pmax = 1e-6;
  for (let i = 0; i < P; i++) {
    let m = 0;
    for (let j = i * per; j < (i + 1) * per; j += 4) m = Math.max(m, Math.abs(x[j]));
    peaks.push(m);
    pmax = Math.max(pmax, m);
  }
  // огибающая 4 Гц
  const envelope: number[] = [];
  const step = Math.round(fps / 4);
  let emx = 1e-6;
  for (let t = 0; t < frames; t += step) {
    let s = 0;
    for (let j = t; j < Math.min(frames, t + step); j++) s += rms[j];
    envelope.push(s / step);
    emx = Math.max(emx, s / step);
  }

  return {
    bpm: Math.round(bpm * 10) / 10,
    beatOffset,
    beatConfidence,
    key: best.key,
    mode: best.mode,
    modeConfidence,
    loudness,
    energy,
    brightness,
    onsetRate: Math.round(onsetRate * 100) / 100,
    dynamics,
    duration,
    peaks: peaks.map((p) => Math.round((p / pmax) * 1000) / 1000),
    envelope: envelope.map((e) => Math.round((e / emx) * 1000) / 1000),
  };
}

export const KEY_NAMES = ['до', 'до♯', 'ре', 'ми♭', 'ми', 'фа', 'фа♯', 'соль', 'ля♭', 'ля', 'си♭', 'си'];
export const keyName = (k: number, mode: 'major' | 'minor') => `${KEY_NAMES[k]} ${mode === 'major' ? 'мажор' : 'минор'}`;

/** Для своего аудиофайла: находим самые плотные 30 секунд (обычно припев) */
export async function bestExcerpt(buf: AudioBuffer, len = 30): Promise<{ start: number; dur: number }> {
  if (buf.duration <= len + 1) return { start: 0, dur: buf.duration };
  const ch = buf.getChannelData(0);
  const sr = buf.sampleRate;
  const block = Math.floor(sr / 2);
  const energies: number[] = [];
  for (let i = 0; i + block < ch.length; i += block) {
    let s = 0;
    for (let j = i; j < i + block; j += 8) s += ch[j] * ch[j];
    energies.push(s);
  }
  const winB = len * 2;
  let best = 0,
    bestI = 0,
    cur = 0;
  for (let i = 0; i < energies.length; i++) {
    cur += energies[i];
    if (i >= winB) cur -= energies[i - winB];
    // не берём самое начало и конец
    const startB = i - winB + 1;
    if (startB >= 0 && startB / 2 > buf.duration * 0.12 && cur > best) {
      best = cur;
      bestI = startB;
    }
  }
  return { start: bestI / 2, dur: len };
}

/** Кодируем фрагмент в WAV (моно 22 кГц) — храним 30 секунд, а не песню целиком */
export async function excerptToWav(buf: AudioBuffer, start: number, dur: number): Promise<Blob> {
  const mono = await toMono22k(buf, start, dur);
  // мягкие края
  const fade = Math.floor(SR * 0.8);
  for (let i = 0; i < fade && i < mono.length; i++) {
    mono[i] *= i / fade;
    mono[mono.length - 1 - i] *= i / fade;
  }
  const ab = new ArrayBuffer(44 + mono.length * 2);
  const v = new DataView(ab);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + mono.length * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, mono.length * 2, true);
  for (let i = 0; i < mono.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mono[i])) * 32767, true);
  return new Blob([ab], { type: 'audio/wav' });
}
