import type { DayAnalysis, DesignSpec, ModeId, ParticleKind, Rule, VoiceProfile } from '../types';
import { clamp, hashString, hexToRgb, luminance, mixHex, moodShift, rgbToHsl } from '../color';
import { keyName } from '../analysis/audio';
import { genrePrior } from '../analysis/music';

export interface ModeInfo {
  id: ModeId;
  name: string;
  ref: string;
  technique: string;
  when: string;
  why: string;
}

export const MODES: Record<ModeId, ModeInfo> = {
  impression: {
    id: 'impression',
    name: 'Импрессия',
    ref: 'Клод Моне и импрессионисты',
    technique: 'фото переписывается мазками; мягкий свет, размытые края, кадры «перекрашиваются» друг в друга',
    when: 'спокойный светлый день, природа и вода, дневной или золотой свет, тёплая неторопливая музыка',
    why: 'раздробленный мазок растворяет детали — в памяти остаются свет и воздух, а не подробности',
  },
  construct: {
    id: 'construct',
    name: 'Конструкция',
    ref: 'Василий Кандинский, «Композиции»; конструктивизм',
    technique: 'жёсткая сетка, постеризация в 4 тона, круги, линии и клинья пульсируют в долю',
    when: 'насыщенный или напряжённый день, работа, дедлайн, город, быстрая электронная музыка',
    why: 'Кандинский «писал музыку» формой: острые углы и контраст читаются как скорость и напряжение',
  },
  film: {
    id: 'film',
    name: 'Плёнка',
    ref: 'любительская 35-мм плёнка, семейные альбомы 70–90-х',
    technique: 'плёночная лента с перфорацией, зерно, ореол светов, засветки, оранжевая дата',
    when: 'друзья, лето, поездки, ностальгия, песня из прошлого',
    why: 'зерно и засветы — знаки прошедшего времени: так выглядят воспоминания, которые хочется пересматривать',
  },
  ma: {
    id: 'ma',
    name: 'Ма',
    ref: 'японская эстетика ма (間), тушь суми-э, минималистичная графика',
    technique: 'много пустоты, маленькое приглушённое фото, тушевой круг энсо, красная печать с датой',
    when: 'тихий, одинокий или задумчивый день; дождь, снег, туман, утро; медленная минорная песня',
    why: 'пустота — тоже содержание: тихий день ощущается простором и паузой',
  },
  collage: {
    id: 'collage',
    name: 'Коллаж',
    ref: 'Анри Матисс, вырезки «Джаз»; дадаистский коллаж',
    technique: 'фото с рваными краями и скотчем, вырезанные цветные формы, всё «наклеивается» в ритм',
    when: 'праздник, много фото, высокая энергия, мажорная песня',
    why: 'когда впечатлений больше, чем помещается в один кадр, их хочется наклеить все сразу',
  },
  nocturne: {
    id: 'nocturne',
    name: 'Ноктюрн',
    ref: 'Джеймс Уистлер, «Ноктюрны»; ночная тональная живопись',
    technique: 'синий тон, свечение огней, дрейфующий туман, медленное движение',
    when: 'вечер и ночь, огни города, спокойная или грустная музыка',
    why: 'ночью предметы исчезают, остаются тон и свет — ощущение вместо картинки',
  },
};

const gauss = (x: number, mu: number, s: number) => Math.exp(-0.5 * ((x - mu) / s) ** 2);
const sig = (x: number, k = 8) => 1 / (1 + Math.exp(-k * x));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const sgn = (x: number) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2);

export function designDay(an: DayAnalysis, dateISO: string, seedStr: string): DesignSpec {
  const t = an.text,
    p = an.photos,
    m = an.music;
  const a = m.audio;
  const rules: Rule[] = [];
  const seed = hashString(seedStr + dateISO);

  // ——— 1. Сведение признаков в «атмосферу» ———
  const photoV = (p.brightness - 0.45) * 1.2 + (p.saturation - 0.35) * 0.6;
  const valence = clamp(0.5 * t.valence + 0.3 * m.valence + 0.2 * photoV, -1, 1);
  const textE = (t.arousal + 1) / 2;
  const energy = clamp(0.38 * textE + 0.42 * m.energy + 0.12 * p.contrast + 0.04 * p.edges + 0.04 * clamp((p.count - 1) / 4));
  const timeW = t.timeOfDay === 'evening' ? 0.12 : t.timeOfDay === 'night' ? -0.15 : 0;
  const warmth = clamp(0.4 * p.warmth + 0.3 * t.warmth + 0.2 * m.warmth + timeW, -1, 1);
  const nostalgia = clamp(0.45 * m.era + 0.35 * t.nostalgia + (m.acoustic ? 0.08 : 0) + (t.timeOfDay === 'evening' ? 0.05 : 0));
  const tension = clamp(t.tension * 0.6 + (energy > 0.6 && valence < 0.1 ? 0.3 : 0) + (m.electronic ? 0.15 : 0));
  const night = t.night || p.brightness < 0.3 || p.lights > 0.35;
  const minor = a ? (a.mode === 'minor' ? a.modeConfidence : -a.modeConfidence) : 0;
  const air = clamp(0.55 * (1 - energy) + Math.max(0, minor) * 0.2 + (t.solitude ? 0.15 : 0) - (p.count > 3 ? 0.1 : 0));

  // ——— 2. Выбор художественного приёма ———
  const natureish = t.nature || p.sky > 0.15 ? 1 : 0.45;
  const scores: Record<ModeId, number> = {
    impression: gauss(energy, 0.36, 0.2) * sig(valence + 0.05) * (0.45 + 0.4 * natureish + 0.2 * Math.max(0, warmth)) * (night ? 0.45 : 1),
    construct: sig(energy - 0.56, 10) * (0.35 + 0.65 * Math.max(tension, m.electronic ? 0.9 : 0, t.work ? 1 : 0)),
    film: (0.25 + nostalgia * 0.9 + (t.companions.some((c) => c.kind === 'group') ? 0.2 : 0) + (t.season === 'summer' ? 0.15 : 0) + (t.events.some((e) => e.kind === 'trip') ? 0.2 : 0)) * gauss(energy, 0.55, 0.22) * (t.night ? 0.7 : night ? 0.85 : 1),
    ma: sig(0.36 - energy, 9) * (0.35 + (valence < 0.25 ? 0.25 : 0) + (t.solitude ? 0.3 : 0) + (t.weather.some((w) => w === 'rain' || w === 'snow' || w === 'fog') ? 0.25 : 0) + Math.max(0, minor) * 0.25 + (t.timeOfDay === 'morning' ? 0.15 : 0)),
    collage: sig(energy - 0.55, 9) * sig(valence - 0.1, 7) * (0.35 + 0.3 * clamp((p.count - 1) / 3) + (t.celebration ? 0.5 : 0)),
    // ноктюрн — для тихих ночей; шумный вечер с огнями остаётся «живым» приёмом
    nocturne: (night ? 1 : 0.08) * (0.25 + 0.75 * gauss(energy, 0.3, 0.22)) + p.lights * 0.25,
  };
  const ranked = (Object.keys(scores) as ModeId[]).sort((x, y) => scores[y] - scores[x]);
  const mode = ranked[0];
  const secondary = scores[ranked[1]] >= scores[mode] * 0.7 ? ranked[1] : null;
  const sum = ranked.reduce((s, k) => s + scores[k], 0) || 1;

  // ——— 3. Палитра ———
  const satMul =
    clamp(0.6 + 0.4 * Math.max(0, valence) + 0.35 * energy - Math.max(0, minor) * 0.25, 0.3, 1.5) *
    ({ impression: 1.05, construct: 1.1, film: 0.9, ma: 0.42, collage: 1.3, nocturne: 0.75 } as const)[mode];
  const lightAdd = ({ impression: 0.04, construct: 0, film: 0.02, ma: 0.1, collage: 0.03, nocturne: -0.1 } as const)[mode];
  let colors = p.palette.slice(0, 5).map((c) => moodShift(c.hex, warmth, satMul, lightAdd));
  while (colors.length < 5) colors.push(mixHex(colors[colors.length - 1] ?? '#888888', warmth > 0 ? '#e8c38a' : '#9fb3c8', 0.5));
  colors.sort((x, y) => luminance(x) - luminance(y));
  // растягиваем диапазон, чтобы было из чего строить
  if (luminance(colors[4]) - luminance(colors[0]) < 0.4) {
    colors[0] = mixHex(colors[0], warmth > 0 ? '#2a1d14' : '#141a24', 0.55);
    colors[4] = mixHex(colors[4], warmth > 0 ? '#f6e7c9' : '#e6edf3', 0.5);
  }
  const ink = mixHex('#1c1a1d', colors[0], 0.22);
  const sat = (h: string) => rgbToHsl(hexToRgb(h))[1];
  let accent = [...colors.slice(1, 4)].sort((x, y) => sat(y) - sat(x))[0];
  if (mode === 'ma') accent = '#c4442b';
  if (mode === 'construct') {
    const meanHue = rgbToHsl(hexToRgb(colors[2]))[0];
    accent = meanHue > 150 && meanHue < 280 ? '#e0392b' : '#1f4fbf';
  }
  if (mode === 'nocturne') accent = warmth > -0.25 ? '#f2bd57' : '#a9c1e6';
  if (mode === 'film') accent = '#ff7a1f';
  const paperBase = warmth >= 0 ? '#f4ede1' : '#edeef0';
  const paper = mixHex(paperBase, colors[3], 0.05);

  // ——— 4. Ритм и движение ———
  const bpm = a?.bpm ?? 60 + m.energy * 80;
  const beat = 60 / bpm;
  let cutBeats = energy > 0.72 ? 2 : energy > 0.52 ? 4 : energy > 0.3 ? 8 : 16;
  while (cutBeats * beat < 1.4 && cutBeats < 32) cutBeats *= 2;
  while (cutBeats * beat > 11 && cutBeats > 1) cutBeats /= 2;
  const transition = ({ impression: 'paint', construct: 'cut', film: 'slide', ma: 'dissolve', collage: 'pop', nocturne: 'fade' } as const)[mode];
  const motion = clamp(0.15 + 0.6 * energy + (bpm - 100) / 400);
  const grain = mode === 'film' ? clamp(0.5 + 0.35 * nostalgia) : clamp(0.1 + 0.4 * nostalgia + (mode === 'nocturne' ? 0.12 : 0));
  const strokeSize = clamp(0.75 + 0.6 * (1 - energy) + 0.3 * nostalgia, 0.6, 1.8);

  // ——— 5. Частицы («погода внутри») ———
  let particle: ParticleKind = 'none';
  const objKeys = new Set(t.objects.map((o) => o.key));
  if (t.weather.includes('snow') || t.events.some((e) => e.key === 'firstsnow')) particle = 'snow';
  else if (t.weather.includes('rain') || t.weather.includes('storm')) particle = 'rain';
  else if (objKeys.has('bonfire')) particle = 'sparks';
  else if (t.celebration && energy > 0.5) particle = 'confetti';
  else if (t.season === 'autumn' && (t.nature || objKeys.has('leaves'))) particle = 'leaves';
  else if (t.season === 'spring' && t.nature) particle = 'petals';
  else if (t.season === 'summer' && (t.timeOfDay === 'evening' || t.timeOfDay === 'night')) particle = 'fireflies';
  else if (night && (objKeys.has('stars') || t.nature)) particle = 'stars';
  else if (t.weather.includes('sun') || (t.season === 'summer' && !night) || mode === 'impression') particle = 'motes';
  let density = clamp(0.3 + 0.5 * energy) * (mode === 'ma' ? 0.5 : 1) * (particle === 'rain' ? 1.4 : 1);

  // ——— 6. Типографика (шрифты постоянны, меняется начертание) ———
  const title = ({
    impression: { family: 'serif', weight: 500, italic: true, upper: false, tracking: 0 },
    construct: { family: 'sans', weight: 800, italic: false, upper: true, tracking: 0.04 },
    film: { family: 'serif', weight: 600, italic: false, upper: false, tracking: 0.005 },
    ma: { family: 'serif', weight: 400, italic: false, upper: false, tracking: 0.14 },
    collage: { family: 'sans', weight: 800, italic: false, upper: false, tracking: 0 },
    nocturne: { family: 'serif', weight: 400, italic: true, upper: false, tracking: 0.02 },
  } as const)[mode];

  // ——— 7. Голос ———
  const q = energy >= 0.5 ? (valence >= 0 ? 'ep' : 'en') : valence >= -0.05 ? 'cp' : 'cn';
  const voice: VoiceProfile = {
    rate: clamp(0.8 + 0.4 * energy, 0.75, 1.25),
    pitch: clamp(0.9 + 0.2 * ((valence + 1) / 2) - (night ? 0.05 : 0), 0.8, 1.15),
    pauseMs: Math.round(220 + 900 * (1 - energy) * (0.5 + air * 0.5)),
    gender: tension > 0.45 || (t.night && energy > 0.4) ? 'male' : 'female',
    character: { cp: 'тихий и тёплый', ep: 'живой и звонкий', cn: 'медленный, приглушённый', en: 'собранный, отрывистый' }[q],
    musicDuck: clamp(0.22 + 0.25 * energy, 0.2, 0.5),
  };

  // ——— 8. Объяснения ———
  // музыка
  if (a) {
    const tempoWord = bpm < 92 ? 'медленный' : bpm < 126 ? 'средний' : 'быстрый';
    rules.push({ group: 'music', from: `Темп песни ${Math.round(bpm)} BPM — ${tempoWord}`, to: `кадр меняется каждые ${cutBeats} долей ≈ ${(cutBeats * beat).toFixed(1)} с, анимация привязана к долям` });
    rules.push({
      group: 'music',
      from: `Тональность: ${keyName(a.key, a.mode)} (уверенность ${pct(a.modeConfidence)})`,
      to: a.mode === 'minor' ? `больше воздуха на странице (${pct(air)}) и приглушённый цвет (насыщенность ×${satMul.toFixed(2)})` : `цвет чище и светлее (насыщенность ×${satMul.toFixed(2)})`,
    });
    rules.push({ group: 'music', from: `Энергия звука ${pct(a.energy)}: громкость ${pct(a.loudness)}, ${a.onsetRate.toFixed(1)} атак/с, яркость тембра ${pct(a.brightness)}`, to: energy > 0.55 ? 'резкие склейки и пульсация форм в такт' : 'плавные переходы и медленный дрейф кадра' });
  } else {
    rules.push({ group: 'music', from: 'Аудио недоступно — работаем по описанию песни', to: `темп оценён по жанру ≈ ${Math.round(bpm)} BPM` });
  }
  const gp = genrePrior(m.meta.genre);
  if (m.meta.genre || m.meta.year) {
    rules.push({
      group: 'music',
      from: `${m.meta.genre ?? 'Жанр не указан'}${m.meta.year ? `, ${m.meta.year} год` : ''} → ${gp.label}`,
      to: `${m.warmth > 0.2 ? 'тёплый' : m.warmth < -0.2 ? 'холодный' : 'нейтральный'} сдвиг палитры, зерно ${pct(grain)}${m.era > 0.4 ? ' (песня из прошлого)' : ''}`,
    });
  }
  // текст
  if (t.moodWords.length) {
    const ws = [...new Set(t.moodWords.map((w) => w.word))].slice(0, 5).map((w) => `«${w}»`).join(', ');
    rules.push({ group: 'text', from: `Слова настроения: ${ws}`, to: `настроение ${sgn(t.valence)}, напряжение ${sgn(t.arousal)}` });
  }
  const coldOut = t.weather.includes('cold') || t.weather.includes('snow') || t.weather.includes('rain');
  const warmIn = t.objects.some((o) => (o.warmth ?? 0) > 0.5) || t.companions.some((c) => (c.warmth ?? 0) > 0.3);
  if (coldOut && warmIn) {
    const wk = t.weather.includes('cold') ? 'cold' : t.weather.includes('snow') ? 'snow' : 'rain';
    const w1 = `«${t.weatherWords?.[wk] ?? { cold: 'холодно', snow: 'снег', rain: 'дождь' }[wk]}»`;
    const w2 = (t.objects.find((o) => (o.warmth ?? 0) > 0.5) ?? t.companions[0]).nom;
    rules.push({ group: 'text', from: `${w1} и «${w2}» в одном дне`, to: 'холод снаружи, тепло внутри: тёплая палитра кадра, но холодный воздух в частицах и тенях' });
  }
  const timeWords: Record<string, string> = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' };
  const seasonWords: Record<string, string> = { autumn: 'осень', winter: 'зима', spring: 'весна', summer: 'лето' };
  rules.push({
    group: 'text',
    from: `Время: ${t.timeOfDay ? timeWords[t.timeOfDay] : 'не указано'}, сезон: ${seasonWords[t.season ?? 'autumn']}${t.seasonFromText ? '' : ' (по дате)'}`,
    to: particle !== 'none' ? `«погода внутри» — ${PARTICLE_NAMES[particle]}` : 'без частиц — чистый воздух',
  });
  if (t.companions.length || t.solitude) {
    rules.push({
      group: 'text',
      from: t.solitude ? 'День наедине с собой' : `Рядом: ${t.companions.map((c) => c.nom).join(', ')}`,
      to: t.solitude ? 'больше пустоты вокруг кадра' : t.companions.some((c) => c.kind === 'group') ? 'компания — кадры плотнее и живее' : 'двое — близкий, интимный кадр',
    });
  }
  // фото
  rules.push({
    group: 'photo',
    from: `Фото (${p.count}): свет ${pct(p.brightness)}, насыщенность ${pct(p.saturation)}, тепло ${sgn(p.warmth)}`,
    to: `доминирующие цвета фото — основа палитры дня${night ? '; тёмный кадр с огнями → ночная тональность' : ''}`,
  });
  if (p.count >= 3) rules.push({ group: 'photo', from: `${p.count} кадра — много впечатлений`, to: mode === 'collage' ? 'кадры наклеиваются коллажем' : 'кадры сменяют друг друга в ритм песни' });
  // итог
  rules.push({
    group: 'mix',
    from: `Атмосфера дня: настроение ${sgn(valence)}, энергия ${pct(energy)}, тепло ${sgn(warmth)}, ностальгия ${pct(nostalgia)}`,
    to: `приём «${MODES[mode].name}» (${pct(scores[mode] / sum)})${secondary ? ` с примесью «${MODES[secondary].name}»` : ''} — ${MODES[mode].ref}`,
  });

  return {
    mode,
    secondary,
    scores,
    mood: { valence, energy, warmth, nostalgia, tension, air },
    palette: { paper, ink, accent, colors },
    air,
    cutBeats,
    transition,
    motion,
    grain,
    strokeSize,
    saturation: satMul,
    particles: { kind: particle, density },
    title,
    captionSpeed: 9 + 14 * energy,
    seed,
    rules,
    voice,
  };
}

export const PARTICLE_NAMES: Record<ParticleKind, string> = {
  none: 'ничего',
  leaves: 'летящие листья',
  snow: 'снег',
  rain: 'дождь',
  petals: 'лепестки',
  motes: 'пылинки в луче света',
  fireflies: 'светлячки',
  confetti: 'конфетти',
  sparks: 'искры костра',
  stars: 'мерцающие звёзды',
};
