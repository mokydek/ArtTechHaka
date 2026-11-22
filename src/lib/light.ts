import type { DayRecord } from './types';
import { moods } from './moods';

/**
 * «Что было светлым»: в тяжёлый день память видит только серое.
 * Здесь мы находим в самом дне то, что было тёплым — людей рядом, свет, тёплые вещи,
 * хорошие слова, яркий момент песни и тёплые места на снимке — и проявляем их.
 * Ничего не придумываем: всё берётся из текста, фото и песни этого дня.
 */

/** Серый ли день. Слово человека важнее анализа: сначала его отметка дня, потом настроение в тот день, потом текст. */
export function isGray(rec: DayRecord): boolean {
  if (rec.feel != null) return rec.feel <= 2;
  const m = moods()[rec.date];
  if (m != null) return m <= 2;
  const t = rec.analysis.text;
  const sad = t.moodWords.some((w) => w.v <= -0.3);
  return rec.design.mood.valence <= -0.15 || (sad && t.valence < 0);
}

export type LightKind = 'people' | 'light' | 'warm' | 'calm';
export interface LightBit {
  kind: LightKind;
  label: string;
  text: string;
}
export interface Light {
  /** участки текста [начало, конец), которые светятся */
  marks: [number, number][];
  bits: LightBit[];
}

const LABEL: Record<LightKind, string> = { people: 'Рядом', light: 'Свет', warm: 'Тепло', calm: 'Хорошие слова' };

// слова про свет: огни, фонари, солнце, свечи, закат, звёзды…
const LIGHT_STEMS = ['огн', 'огон', 'фонар', 'солн', 'свеч', 'закат', 'рассвет', 'звезд', 'гирлянд', 'ламп', 'светил', 'светл', 'свет', 'луч', 'сия', 'сиял', 'искр', 'луна', 'луну', 'луной'];
// холодный свет рядом — не то, что греет («мониторы светились синим»)
const COLD = ['син', 'холодн', 'мертв', 'бледн', 'тускл'];
const STOP = new Set(['и', 'а', 'но', 'мы', 'я', 'он', 'она', 'они', 'что', 'как', 'же', 'ли', 'бы', 'не', 'уже', 'еще', 'ещё', 'так', 'там', 'тут']);

interface Tok {
  w: string; // в нижнем регистре, ё → е
  s: number;
  e: number;
}
function tokens(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(/[а-яёa-z0-9-]+/gi)) out.push({ w: m[0].toLowerCase().replace(/ё/g, 'е'), s: m.index!, e: m.index! + m[0].length });
  return out;
}
const PUNCT = /[.,!?;:…()«»"—–]/;

/** короткая фраза от слова: до трёх слов подряд, пока не встретится знак препинания */
function phrase(text: string, toks: Tok[], i: number): [number, number] {
  let e = toks[i].e;
  for (let k = i + 1; k < Math.min(toks.length, i + 3); k++) {
    if (PUNCT.test(text.slice(e, toks[k].s)) || STOP.has(toks[k].w)) break;
    e = toks[k].e;
  }
  return [toks[i].s, e];
}

export function findLight(rec: DayRecord): Light {
  const text = rec.text;
  const toks = tokens(text);
  const t = rec.analysis.text;
  const marks: [number, number][] = [];
  const bits: LightBit[] = [];
  // цитаты из текста — в кавычках, тёплые вещи — просто словами
  const add = (kind: LightKind, parts: string[]) => {
    const uniq = [...new Set(parts.map((p) => p.trim()).filter(Boolean))];
    if (uniq.length) bits.push({ kind, label: LABEL[kind], text: uniq.map((u) => (kind === 'warm' ? u : `«${u}»`)).join(', ') });
  };

  // люди рядом: «с братом», «с Аней»
  const people: string[] = [];
  for (const p of t.companions) {
    const i = p.firstIndex;
    if (i < 0 || i >= toks.length) continue;
    const s = i > 0 && ['с', 'со'].includes(toks[i - 1].w) ? toks[i - 1].s : toks[i].s;
    marks.push([s, toks[i].e]);
    people.push(text.slice(s, toks[i].e));
  }
  add('people', people);

  // свет: «огни ночного города», «фонари светились жёлтым»
  const lights: string[] = [];
  for (let i = 0; i < toks.length && lights.length < 2; i++) {
    const w = toks[i].w;
    if (!LIGHT_STEMS.some((st) => w.startsWith(st))) continue;
    if (w.startsWith('светофор')) continue;
    const near = toks.slice(Math.max(0, i - 2), i + 3).map((x) => x.w);
    if (near.some((x) => COLD.some((c) => x.startsWith(c)))) continue;
    const [s, e] = phrase(text, toks, i);
    if (marks.some(([a, b]) => s < b && e > a)) continue;
    marks.push([s, e]);
    lights.push(text.slice(s, e));
    while (i + 1 < toks.length && toks[i + 1].e <= e) i++;
  }
  add('light', lights);

  // тёплые вещи: чай, какао, плед, костёр (тепло из словаря)
  const warm: string[] = [];
  for (const p of t.objects) {
    if ((p.warmth ?? 0) < 0.25 || p.firstIndex < 0 || p.firstIndex >= toks.length) continue;
    // «кофе уже не помогал», «без чая» — это не про тепло
    const around = toks.slice(Math.max(0, p.firstIndex - 2), p.firstIndex + 4).map((x) => x.w);
    if (around.some((x) => x === 'не' || x === 'без' || x === 'нет')) continue;
    const k = toks[p.firstIndex];
    if (marks.some(([a, b]) => k.s < b && k.e > a)) continue;
    marks.push([k.s, k.e]);
    warm.push(p.nom);
  }
  add('warm', warm.slice(0, 3));

  // хорошие слова из самого текста: «тихо», «спокойно», «правильно»
  const calm: string[] = [];
  for (const m of t.moodWords) {
    if (m.v <= 0.1) continue;
    const i = toks.findIndex((x) => x.w === m.word && !marks.some(([a, b]) => x.s < b && x.e > a));
    if (i < 0) continue;
    const [s, e] = phrase(text, toks, i);
    if (marks.some(([a, b]) => s < b && e > a)) continue;
    marks.push([s, e]);
    calm.push(text.slice(s, e).toLowerCase());
  }
  add('calm', calm.slice(0, 3));

  marks.sort((a, b) => a[0] - b[0]);
  return { marks, bits };
}

/** Тёплые светлые места на снимке: лампы, солнце, огни, лица. Координаты 0..1. */
export interface Spot {
  x: number;
  y: number;
  r: number; // радиус в долях диагонали
}
export function lightSpots(bmp: ImageBitmap | HTMLCanvasElement, max = 3): Spot[] {
  const W = 96;
  const H = Math.max(8, Math.round((W * bmp.height) / bmp.width));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0, W, H);
  let d: Uint8ClampedArray;
  try {
    d = g.getImageData(0, 0, W, H).data;
  } catch {
    return [{ x: 0.5, y: 0.45, r: 0.3 }];
  }
  // «тёплый свет»: яркость, усиленная теплотой цвета
  let a = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = d[i * 4] / 255,
      gr = d[i * 4 + 1] / 255,
      b = d[i * 4 + 2] / 255;
    const l = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
    const warm = Math.max(0, r - b);
    a[i] = Math.pow(l, 1.6) * (0.35 + warm * 1.8);
  }
  // мягкое размытие, чтобы находились пятна, а не отдельные пиксели
  const blur = (src: Float32Array, rad: number) => {
    const t = new Float32Array(W * H),
      o = new Float32Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0,
          n = 0;
        for (let k = -rad; k <= rad; k++) {
          const xx = x + k;
          if (xx >= 0 && xx < W) (s += src[y * W + xx]), n++;
        }
        t[y * W + x] = s / n;
      }
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0,
          n = 0;
        for (let k = -rad; k <= rad; k++) {
          const yy = y + k;
          if (yy >= 0 && yy < H) (s += t[yy * W + x]), n++;
        }
        o[y * W + x] = s / n;
      }
    return o;
  };
  a = blur(blur(a, 3), 3);
  const spots: Spot[] = [];
  let top = 0;
  const sup = 0.26 * W;
  for (let n = 0; n < max; n++) {
    let bi = -1,
      bv = 0;
    for (let i = 0; i < W * H; i++) if (a[i] > bv) (bv = a[i]), (bi = i);
    if (bi < 0 || (n > 0 && bv < top * 0.55)) break;
    if (!n) top = bv;
    const x = bi % W,
      y = (bi / W) | 0;
    spots.push({ x: x / W, y: y / H, r: 0.16 + 0.1 * (bv / top) });
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) if (Math.hypot(xx - x, yy - y) < sup) a[yy * W + xx] = 0;
  }
  return spots.length ? spots : [{ x: 0.5, y: 0.45, r: 0.3 }];
}

/** Самый яркий момент песни: окно в несколько секунд с наибольшей громкостью. Возвращает секунду начала. */
export function brightMoment(buf: AudioBuffer, win = 7): number {
  const ch = buf.getChannelData(0);
  const step = Math.max(1, Math.round(buf.sampleRate / 4)); // 4 замера в секунду
  const rms: number[] = [];
  for (let i = 0; i + step <= ch.length; i += step) {
    let s = 0;
    for (let k = i; k < i + step; k += 8) s += ch[k] * ch[k];
    rms.push(Math.sqrt(s / (step / 8)));
  }
  const n = Math.min(rms.length, Math.round(win * 4));
  if (rms.length <= n) return 0;
  let sum = rms.slice(0, n).reduce((x, y) => x + y, 0),
    best = sum,
    at = 0;
  for (let i = n; i < rms.length; i++) {
    sum += rms[i] - rms[i - n];
    if (sum > best) (best = sum), (at = i - n + 1);
  }
  return Math.max(0, at / 4 - 0.5);
}

/** какое фото дня самое «светлое» — его и проявляем */
export function brightestPhoto(rec: DayRecord): number {
  const list = rec.analysis.photoList ?? [];
  let bi = 0,
    bv = -1e9;
  list.forEach((p, i) => {
    const v = p.lights * 0.9 + Math.max(0, p.warmth) * 0.7 + p.brightness * 0.4;
    if (v > bv) (bv = v), (bi = i);
  });
  return bi;
}
