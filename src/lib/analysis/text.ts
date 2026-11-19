import type { Phrase, Season, TextFeatures, TimeOfDay, Weather } from '../types';
import { clamp, hashString, mulberry32 } from '../color';
import {
  BIGRAM_EVENTS,
  CELEBRATION_STEMS,
  COMPANIONS,
  EVENTS,
  INTENSIFIERS,
  MONTH_ADJ,
  MOOD,
  MOOD_ADJ,
  NATURE_STEMS,
  NEGATIONS,
  NOSTALGIA_STEMS,
  OBJECTS,
  PLACES,
  SEASON_ADJ,
  SEASON_CUES,
  SENSORY_STEMS,
  SOLITUDE,
  TIME_CUES,
  TIME_NOUN,
  WEATHER_ADJ,
  WEATHER_CUES,
  WORK_STEMS,
  adj,
  type LexEntry,
} from './lexicon';

export const normalize = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

function tokenize(text: string): string[] {
  return normalize(text).match(/[а-яa-z0-9-]+/g) ?? [];
}

const startsAny = (tok: string, stems: string[]) => stems.some((s) => tok.startsWith(s));

function findEntries(tokens: string[], list: LexEntry[]): Phrase[] {
  const out: Phrase[] = [];
  for (const e of list) {
    let hits = 0;
    let first = -1;
    tokens.forEach((t, i) => {
      if (e.forms.includes(t) || (e.stems && startsAny(t, e.stems))) {
        hits++;
        if (first < 0) first = i;
      }
    });
    if (hits) {
      out.push({
        key: e.key,
        nom: e.nom,
        loc: e.loc,
        inst: e.inst,
        phrase: e.phrase,
        gender: e.gender,
        kind: e.kind ?? (e.group ? 'group' : undefined),
        warmth: e.warmth,
        hits: (e.salience ?? 1) * (1 + 0.3 * (hits - 1)),
        firstIndex: first,
      });
    }
  }
  // по значимости, при равенстве — что раньше упомянуто
  return out.sort((a, b) => b.hits - a.hits || a.firstIndex - b.firstIndex);
}

const SEASON_BY_MONTH: Season[] = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];

export function analyzeText(raw: string, dateISO: string): TextFeatures {
  const text = raw.trim();
  const norm = normalize(text);
  const tokens = tokenize(text);
  const month = new Date(dateISO + 'T12:00:00').getMonth();

  // ——— Настроение ———
  const moodWords: { word: string; v: number; a: number }[] = [];
  tokens.forEach((t, i) => {
    for (const m of MOOD) {
      if (startsAny(t, m.stems)) {
        let v = m.v,
          a = m.a;
        const prev = tokens.slice(Math.max(0, i - 2), i);
        if (prev.some((p) => NEGATIONS.includes(p))) {
          v = -v * 0.6;
          a = a * 0.5;
        }
        if (prev.some((p) => ['немного', 'чуть', 'слегка', 'капельку', 'чуть-чуть'].includes(p))) {
          v *= 0.55;
          a *= 0.6;
        }
        if (prev.some((p) => INTENSIFIERS.includes(p))) {
          v *= 1.3;
          a = a * 1.3 + 0.1;
        }
        moodWords.push({ word: t, v: clamp(v, -1, 1), a: clamp(a, -1, 1) });
        break;
      }
    }
  });

  let valence = 0.1,
    arousal = -0.05;
  if (moodWords.length) {
    // средние, но крайние значения весят больше
    let wv = 0,
      sv = 0,
      wa = 0,
      sa = 0;
    for (const m of moodWords) {
      const w1 = 0.5 + Math.abs(m.v);
      const w2 = 0.5 + Math.abs(m.a);
      sv += m.v * w1;
      wv += w1;
      sa += m.a * w2;
      wa += w2;
    }
    valence = sv / wv;
    arousal = sa / wa;
  }

  const has = (stems: string[]) => tokens.some((t) => startsAny(t, stems)) || stems.some((s) => s.includes(' ') && norm.includes(s));

  const work = has(WORK_STEMS);
  const celebration = has(CELEBRATION_STEMS) || BIGRAM_EVENTS.some((b) => b.kind === 'celebration' && b.re.test(norm));
  const nature = has(NATURE_STEMS);
  const nostalgiaHits = NOSTALGIA_STEMS.filter((s) => (s.includes(' ') ? norm.includes(s) : tokens.some((t) => t.startsWith(s)))).length;

  // ——— Сезон / время суток / погода ———
  let season: Season | null = null;
  let best = 0;
  const monthSeason = SEASON_BY_MONTH[month];
  for (const c of SEASON_CUES) {
    let n = tokens.filter((t) => startsAny(t, c.stems) || (c.forms ?? []).includes(t)).length;
    if (n > 0 && c.season === monthSeason) n += 0.5; // при равенстве верим дате
    if (n > best) {
      best = n;
      season = c.season;
    }
  }
  const seasonFromText = !!season;
  if (!season) season = SEASON_BY_MONTH[month];

  let timeOfDay: TimeOfDay | null = null;
  best = 0;
  const tillMorning = (norm.match(/до утра/g) ?? []).length;
  for (const c of TIME_CUES) {
    let n = tokens.filter((t) => startsAny(t, c.stems)).length + c.stems.filter((s) => s.includes(' ') && norm.includes(s)).length;
    if (c.time === 'morning') n -= tillMorning;
    if (n > best) {
      best = n;
      timeOfDay = c.time;
    }
  }

  const weather: Weather[] = [];
  const weatherWords: Partial<Record<Weather, string>> = {};
  let weatherWarmth = 0;
  for (const c of WEATHER_CUES) {
    const tok = tokens.find((t) => startsAny(t, c.stems));
    if (tok) {
      weather.push(c.w);
      weatherWords[c.w] = tok;
      weatherWarmth += c.warmth;
    }
  }

  // ——— Сущности ———
  const places = findEntries(tokens, PLACES);
  const companions = findEntries(tokens, COMPANIONS);
  const objects = findEntries(tokens, OBJECTS);
  let events = findEntries(tokens, EVENTS);
  for (const b of BIGRAM_EVENTS) {
    const m = norm.match(b.re);
    if (m) {
      events = events.filter((e) => e.key !== b.key);
      events.push({ key: b.key, nom: b.nom, phrase: b.phrase, kind: b.kind, hits: b.salience * 1.5, firstIndex: norm.slice(0, m.index).split(/\s+/).length });
    }
  }
  // «сдача» без проекта/работы — не дедлайн
  events = events.filter((e) => e.key !== 'deadline' || work);
  events.sort((a, b) => b.hits - a.hits);

  const solitude = tokens.some((t) => SOLITUDE.includes(t)) && companions.length === 0 && !tokens.includes('мы');

  // ——— Тепло ———
  const objWarm = [...objects, ...places, ...companions].reduce((s, p) => s + (p.warmth ?? 0), 0);
  let warmth = clamp(weatherWarmth * 0.6 + objWarm * 0.5, -1, 1);
  if (timeOfDay === 'night') warmth -= 0.15;
  if (season === 'summer') warmth += 0.15;
  if (season === 'winter') warmth -= 0.15;
  warmth = clamp(warmth, -1, 1);

  // Поправки к настроению
  if (celebration) {
    valence += 0.25;
    arousal += 0.35;
  }
  if (work) {
    arousal += 0.25;
    valence -= 0.08;
  }
  if (solitude) {
    valence -= 0.1;
    arousal -= 0.2;
  }
  if (timeOfDay === 'night' && !celebration) arousal -= 0.05;
  if (nature) {
    valence += 0.08;
    arousal -= 0.1;
  }
  const excl = (text.match(/!/g) ?? []).length;
  arousal += Math.min(0.3, excl * 0.08);
  if (companions.some((c) => c.kind === 'group')) arousal += 0.1;
  valence = clamp(valence, -1, 1);
  arousal = clamp(arousal, -1, 1);

  const tension = clamp((arousal > 0 ? arousal : 0) * (valence < 0.15 ? 1 : 0.4) + (work ? 0.25 : 0), 0, 1);
  const nostalgia = clamp(nostalgiaHits * 0.3 + (timeOfDay === 'evening' ? 0.05 : 0), 0, 1);

  const sensory = tokens.filter((t) => startsAny(t, SENSORY_STEMS));

  return {
    valence,
    arousal,
    warmth,
    nostalgia,
    tension,
    season,
    seasonFromText,
    timeOfDay,
    weather,
    weatherWords,
    places,
    companions,
    objects,
    events,
    solitude,
    celebration,
    work,
    nature,
    night: timeOfDay === 'night',
    sensory: [...new Set(sensory)],
    moodWords,
    caption: pickCaption(text),
    wordCount: tokens.length,
  };
}

/** Самая «чувственная» фраза текста — для рукописной подписи */
export function pickCaption(text: string): string {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  if (!sentences.length) return '';
  let bestS = sentences[0];
  let bestScore = -Infinity;
  for (const s of sentences) {
    const toks = tokenize(s);
    let score = 0;
    for (const t of toks) {
      if (startsAny(t, SENSORY_STEMS)) score += 2;
      if (startsAny(t, ['запах', 'пахл', 'пахн', 'аромат', 'шурш', 'хруст', 'стрекот'])) score += 1;
      if (MOOD.some((m) => startsAny(t, m.stems))) score += 1.2;
      if (PLACES.some((p) => p.forms.includes(t)) || OBJECTS.some((o) => o.forms.includes(t))) score += 0.8;
    }
    const len = s.length;
    if (len > 120) score -= (len - 120) / 25;
    if (len < 25) score -= 1;
    if (score > bestScore) {
      bestScore = score;
      bestS = s;
    }
  }
  let cap = bestS.replace(/[.]+$/, '');
  if (cap.length > 110) {
    // режем по запятой или по слову
    const cut = cap.slice(0, 110);
    const comma = cut.lastIndexOf(',');
    cap = (comma > 50 ? cut.slice(0, comma) : cut.slice(0, cut.lastIndexOf(' '))) + '…';
  }
  return cap;
}

// ——— Генератор названий папок ———
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function moodQuadrant(v: number, a: number) {
  if (a >= 0.15) return v >= 0 ? 'energyPos' : 'energyNeg';
  return v >= -0.05 ? 'calmPos' : 'calmNeg';
}

export interface TitleResult {
  title: string;
  pattern: string;
}

export function makeTitle(t: TextFeatures, dateISO: string, energy: number, valence: number): TitleResult {
  const seed = hashString(t.caption + dateISO);
  const rnd = mulberry32(seed);
  const month = new Date(dateISO + 'T12:00:00').getMonth();
  const timeKey = t.timeOfDay ?? 'day';
  const time = TIME_NOUN[timeKey];
  const timeKnown = !!t.timeOfDay;

  const place = t.places[0];
  const comp = t.companions[0];
  const ev = t.events[0];
  const objs = t.objects.filter((o) => o.key !== 'walk' && o.key !== 'headphones');
  const obj = objs[0];
  const obj2 = objs[1];
  const w = t.weather.find((x) => WEATHER_ADJ[x] && x !== 'cold') ?? t.weather[0];

  const q = moodQuadrant(valence, energy * 2 - 1);
  const moodList = MOOD_ADJ.find((m) => m.q === q)!.list;
  const [mStem, mDecl] = moodList[Math.floor(rnd() * moodList.length)];
  const [monStem, monDecl] = MONTH_ADJ[month];
  const [sStem, sDecl] = SEASON_ADJ[t.season ?? 'autumn'];

  const cands: { title: string; weight: number; pattern: string }[] = [];
  const add = (title: string | null, weight: number, pattern: string) => {
    if (!title) return;
    const words = title.split(/\s+/).length;
    if (words < 3 || words > 7) return;
    cands.push({ title: cap(title), weight, pattern });
  };
  const tw = timeKnown ? 0 : -1.2; // без явного времени суток шаблоны с ним слабее

  if (comp && place) add(`${time.nom} ${comp.inst} ${place.loc}`, 5 + tw + comp.hits * 0.3, 'время + с кем + где');
  if (ev && place && ev.phrase && ev.key !== place.key) add(`${time.nom} ${place.loc} ${ev.phrase}`, 5.6 + tw + ev.hits * 0.2, 'время + где + событие');
  if (ev && place && ev.key !== place.key) add(`${cap(ev.nom)} ${place.loc}`, 4.6 + ev.hits * 0.2 + (ev.kind === 'celebration' || ev.kind === 'nature' ? 1.6 : 0), 'событие + где');
  const objS = objs.find((o) => o.key !== 'leaves' && o.key !== 'stars');
  if (place && objS && place.gender && place.key !== 'home') add(`${adj(sStem, sDecl, place.gender)} ${place.nom} и ${objS.nom}`, 4.8 + (t.seasonFromText ? 0.5 : 0) + objS.hits * 0.3, 'сезон + место + деталь');
  if (w && WEATHER_ADJ[w] && place) {
    const [ws, wd] = WEATHER_ADJ[w];
    add(`${adj(ws, wd, time.g)} ${time.nom} ${place.loc}`, 4.2 + tw, 'погода + время + где');
  }
  if (obj && obj2 && place) add(`${obj.nom} и ${obj2.nom} ${place.loc}`, 3.6, 'детали + где');
  if (comp) add(`${adj(mStem, mDecl, time.g)} ${time.nom} ${comp.inst}`, 3.5 + tw * 0.5, 'настроение + время + с кем');
  if (comp && obj) add(`${obj.nom} ${comp.inst}`, 1.5, 'деталь + с кем'); // обычно короче 3 слов — отсеется
  if (place) add(`${adj(sStem, sDecl, time.g)} ${time.nom} ${place.loc}`, 3 + tw, 'сезон + время + где');
  if (ev && ev.phrase) add(`${adj(monStem, monDecl, time.g)} ${time.nom} ${ev.phrase}`, 3.2, 'месяц + время + событие');
  if (obj && comp && place) add(`${obj.nom} ${comp.inst} ${place.loc}`, 4.2 + obj.hits * 0.2, 'деталь + с кем + где');
  if (w && WEATHER_ADJ[w]) {
    const [ws, wd] = WEATHER_ADJ[w];
    add(`${adj(ws, wd, time.g)} ${adj(monStem, monDecl, time.g)} ${time.nom}`, 2.2, 'погода + месяц + время');
  }
  add(`${adj(mStem, mDecl, time.g)} ${adj(monStem, monDecl, time.g)} ${time.nom}`, 1, 'настроение + месяц + время');

  cands.sort((a, b) => b.weight - a.weight);
  const top = cands[0];
  return { title: top.title, pattern: top.pattern };
}

export function folderName(dateISO: string, title: string) {
  return `${dateISO} ${title}`;
}
