import type { DayRecord, PhotosSummary, TextFeatures } from './types';

// «Атмосфера дневника»: что общего во всех воспоминаниях человека — и как под это подстраивается весь сайт.
// Мотивы считаются по словам записи и по фото; свежие дни весят больше старых.

export type Motif = 'sunset' | 'sea' | 'love' | 'snow' | 'rain' | 'night' | 'city' | 'nature' | 'autumn' | 'summer' | 'party' | 'cozy';

export const MOTIFS: Motif[] = ['sunset', 'sea', 'love', 'snow', 'rain', 'night', 'city', 'nature', 'autumn', 'summer', 'party', 'cozy'];

export const MOTIF_NAMES: Record<Motif, string> = {
  sunset: 'закаты',
  sea: 'вода',
  love: 'любовь',
  snow: 'снег',
  rain: 'дожди',
  night: 'ночи',
  city: 'город',
  nature: 'природа',
  autumn: 'осень',
  summer: 'лето',
  party: 'праздники',
  cozy: 'уют',
};

/** Цвета мотива: небо сверху → к низу, акцент */
export const MOTIF_COLORS: Record<Motif, { sky: [string, string, string]; accent: string }> = {
  sunset: { sky: ['#f6b26b', '#f08a7a', '#f7d9b8'], accent: '#d4663a' },
  sea: { sky: ['#8fc3e6', '#bfe0ef', '#e8f3f4'], accent: '#2f7fae' },
  love: { sky: ['#f4b4c4', '#f8cfd8', '#fbe8e6'], accent: '#c9496b' },
  snow: { sky: ['#c9dbee', '#e3ecf6', '#f4f7fa'], accent: '#5579a8' },
  rain: { sky: ['#9aa9b8', '#c3ccd5', '#e3e6e8'], accent: '#4f6378' },
  night: { sky: ['#2c3566', '#55608f', '#c9c8d9'], accent: '#4b4ea3' },
  city: { sky: ['#5d4f8f', '#a387c2', '#ead7cf'], accent: '#7a52b8' },
  nature: { sky: ['#a8cf9a', '#d4e6c3', '#eef2e2'], accent: '#4f8a3c' },
  autumn: { sky: ['#e9a15b', '#f1c58b', '#f6e5cc'], accent: '#c25b1f' },
  summer: { sky: ['#ffd36e', '#ffe7a8', '#fdf3d6'], accent: '#d99a08' },
  party: { sky: ['#f6a6d0', '#c8b6f2', '#f6e9f2'], accent: '#c2338e' },
  cozy: { sky: ['#e8b07a', '#f1cfa4', '#f7ead9'], accent: '#b6652c' },
};

const has = (t: TextFeatures, keys: string[]) => [...t.objects, ...t.places, ...t.companions, ...t.events].some((p) => keys.includes(p.key));
const kind = (t: TextFeatures, k: string) => [...t.places, ...t.events].some((p) => p.kind === k);

/** Мотивы одного воспоминания: 0..1 */
export function dayMotifs(t: TextFeatures, text = '', ph?: PhotosSummary | null): Partial<Record<Motif, number>> {
  const raw = text.toLowerCase();
  const m: Partial<Record<Motif, number>> = {};
  const add = (k: Motif, v: number) => (m[k] = Math.min(1, (m[k] ?? 0) + v));
  if (has(t, ['sunset', 'sunrise']) || /закат|рассвет/.test(raw)) add('sunset', 1);
  else if (t.timeOfDay === 'evening' && ph && ph.warmth > 0.25 && ph.sky > 0.2) add('sunset', 0.5);
  if (has(t, ['sea', 'beach', 'embankment'])) add('sea', 1);
  else if (kind(t, 'water')) add('sea', 0.7);
  if (has(t, ['girlfriend', 'boyfriend', 'wife', 'husband', 'date'])) add('love', 0.9);
  if (/люблю|любим|любов|поцел|обнял|обнима|романт|влюб|свидан/.test(raw)) add('love', 0.6);
  if (t.weather.includes('snow') || has(t, ['firstsnow'])) add('snow', 1);
  else if (t.season === 'winter') add('snow', 0.4);
  if (t.weather.includes('rain') || t.weather.includes('storm')) add('rain', 1);
  else if (t.weather.includes('fog')) add('rain', 0.4);
  if (t.timeOfDay === 'night' || t.night) add('night', 0.9);
  if (has(t, ['stars'])) add('night', 0.6);
  if (ph && ph.lights > 0.3) add('night', 0.3);
  if (kind(t, 'urban') || has(t, ['lights'])) add('city', 0.7);
  if (kind(t, 'nature') || t.nature) add('nature', kind(t, 'nature') ? 0.8 : 0.4);
  if (t.season === 'autumn') add('autumn', 0.8);
  if (has(t, ['leaves'])) add('autumn', 0.6);
  if (t.season === 'summer') add('summer', 0.7);
  if (t.weather.includes('hot') || t.weather.includes('sun')) add('summer', 0.35);
  if (t.celebration) add('party', 0.9);
  if (kind(t, 'party') || has(t, ['fireworks', 'dances'])) add('party', 0.6);
  if (kind(t, 'home')) add('cozy', 0.5);
  if (has(t, ['cocoa', 'blanket', 'candles', 'fireplace', 'bonfire', 'mulled', 'tea'])) add('cozy', 0.7);
  if (has(t, ['mom', 'dad', 'parents', 'family', 'grandma', 'grandpa'])) add('cozy', 0.5);
  return m;
}

export interface Atmos {
  weights: Record<Motif, number>; // 0..1, сумма ≤ 1 по ведущим мотивам
  top: Motif[]; // ведущие, по убыванию
  counts: Partial<Record<Motif, number>>; // сколько дней с этим мотивом
  days: number;
  paper: string;
  paper2: string;
  accent: string;
  tint: string; // общий тон снимков
}

const BASE_PAPER = '#efe9df',
  BASE_PAPER2 = '#f6f2ea',
  BASE_ACCENT = '#55449e';

export const EMPTY: Atmos = {
  weights: Object.fromEntries(MOTIFS.map((k) => [k, 0])) as Record<Motif, number>,
  top: [],
  counts: {},
  days: 0,
  paper: BASE_PAPER,
  paper2: BASE_PAPER2,
  accent: BASE_ACCENT,
  tint: BASE_PAPER,
};

/** Общая атмосфера по дням (свежие весят больше) + черновик записи, который пишут прямо сейчас */
export function computeAtmos(days: DayRecord[], draft?: { motifs: Partial<Record<Motif, number>>; weight: number } | null): Atmos {
  const sorted = [...days].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const sum = Object.fromEntries(MOTIFS.map((k) => [k, 0])) as Record<Motif, number>;
  const counts: Partial<Record<Motif, number>> = {};
  let wsum = 0;
  const tint = [0, 0, 0];
  const acc = [0, 0, 0];
  let tw = 0;
  sorted.forEach((d, i) => {
    const w = Math.max(0.15, Math.pow(0.82, i));
    wsum += w;
    const m = dayMotifs(d.analysis.text, d.text, d.analysis.photos);
    for (const k of MOTIFS) {
      const v = m[k] ?? 0;
      sum[k] += v * w;
      if (v >= 0.5) counts[k] = (counts[k] ?? 0) + 1;
    }
    const c = hex(d.design.palette.colors[3] ?? d.design.palette.paper);
    const a = hex(d.design.palette.accent);
    for (let j = 0; j < 3; j++) {
      tint[j] += c[j] * w;
      acc[j] += a[j] * w;
    }
    tw += w;
  });
  if (draft) {
    const w = Math.max(wsum, 1) * draft.weight;
    for (const k of MOTIFS) sum[k] += (draft.motifs[k] ?? 0) * w;
    wsum += w;
  }
  const weights = Object.fromEntries(MOTIFS.map((k) => [k, wsum ? sum[k] / wsum : 0])) as Record<Motif, number>;
  const top = MOTIFS.filter((k) => weights[k] >= 0.12)
    .sort((a, b) => weights[b] - weights[a])
    .slice(0, 3);
  // цвета сайта: бумага с оттенком ведущего мотива и снимков, акцент — смесь акцентов дней и мотива
  const tintHex = tw ? rgbHex(tint.map((v) => v / tw)) : BASE_PAPER;
  const lead = top[0];
  const motifTint = lead ? MOTIF_COLORS[lead].sky[2] : tintHex;
  const motifAcc = lead ? MOTIF_COLORS[lead].accent : BASE_ACCENT;
  const dayAcc = tw ? rgbHex(acc.map((v) => v / tw)) : BASE_ACCENT;
  const k = lead ? Math.min(1, weights[lead] * 1.6) : 0;
  return {
    weights,
    top,
    counts,
    days: sorted.length,
    paper: mix(mix(BASE_PAPER, tintHex, 0.08), motifTint, 0.28 * k),
    paper2: mix(mix(BASE_PAPER2, tintHex, 0.05), motifTint, 0.18 * k),
    accent: readable(mix(mix(BASE_ACCENT, dayAcc, 0.35), motifAcc, 0.55 * k)),
    tint: tintHex,
  };
}

// ——— цвет ———
export function hex(h: string): [number, number, number] {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, (c) => c + c) : s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbHex(c: number[]) {
  return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
export function mix(a: string, b: string, t: number) {
  const x = hex(a),
    y = hex(b);
  return rgbHex(x.map((v, i) => v + (y[i] - v) * t));
}
/** Акцент должен читаться на бумаге: не светлее середины */
export function readable(c: string) {
  const [r, g, b] = hex(c);
  const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
  return l > 0.5 ? mix(c, '#1d1b1f', (l - 0.45) / 0.55) : c;
}

/** Светлый тон дня для бумаги сайта: из палитры снимков, но всегда читаемый */
export function lightOf(p: { paper: string; colors: string[]; accent: string }) {
  const lum = (h: string) => {
    const [r, g, b] = hex(h);
    return (0.3 * r + 0.59 * g + 0.11 * b) / 255;
  };
  const c = [p.paper, ...[...p.colors].reverse()].find((x) => lum(x) > 0.72);
  return c ? mix('#f3eee6', c, 0.6) : mix('#f3eee6', p.accent, 0.14);
}
