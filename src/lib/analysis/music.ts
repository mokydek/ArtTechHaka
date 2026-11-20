import type { AudioFeatures, MusicFeatures, MusicMeta } from '../types';
import { clamp } from '../color';

export interface TrackCandidate {
  trackId: number;
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  year?: number;
  previewUrl?: string;
  artwork?: string;
  serviceUrl?: string;
}

const CLEAN = [
  /\s*[([](official|lyric|lyrics|audio|video|music video|hd|hq|remaster(ed)?|\d{4} remaster(ed)?|live|mv|клип|премьера)[^)\]]*[)\]]/gi,
  /\s*-\s*topic$/i,
  /\s*\|.*$/,
];
const clean = (s: string) => CLEAN.reduce((acc, re) => acc.replace(re, ''), s).replace(/\s{2,}/g, ' ').trim();

/** Пытаемся понять, что за песня по ссылке (oEmbed) */
export async function resolveLink(url: string): Promise<{ query: string; serviceTitle?: string; appleId?: number } | null> {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host.includes('music.apple.com') || host.includes('itunes.apple.com')) {
      const id = Number(u.searchParams.get('i') ?? u.pathname.split('/').pop()?.replace(/\D/g, ''));
      if (id) return { query: '', appleId: id };
    }
    if (host.includes('spotify.com')) {
      const r = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
      if (r.ok) {
        const j = await r.json();
        return { query: clean(j.title ?? ''), serviceTitle: j.title };
      }
    }
    if (host.includes('youtube.com') || host.includes('youtu.be') || host.includes('soundcloud.com') || host.includes('vimeo.com')) {
      const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
      if (r.ok) {
        const j = await r.json();
        if (j.title) {
          const author = clean(String(j.author_name ?? ''));
          const title = clean(String(j.title));
          const q = title.includes(' - ') || title.includes(' — ') ? title : `${author} ${title}`;
          return { query: q.replace(/[—–-]/g, ' '), serviceTitle: j.title };
        }
      }
    }
    if (host.includes('music.yandex') || host.includes('yandex.ru')) {
      return { query: '' }; // у Яндекс Музыки нет открытого oEmbed — попросим название
    }
  } catch {
    /* не ссылка */
  }
  return null;
}

async function itunes(url: string): Promise<TrackCandidate[]> {
  try {
    const r = await fetch(url);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results ?? [])
      .filter((x: { kind?: string; wrapperType?: string }) => x.kind === 'song' || x.wrapperType === 'track')
      .map((x: Record<string, unknown>) => ({
        trackId: x.trackId as number,
        title: String(x.trackName ?? ''),
        artist: String(x.artistName ?? ''),
        album: x.collectionName as string,
        genre: x.primaryGenreName as string,
        year: x.releaseDate ? new Date(String(x.releaseDate)).getFullYear() : undefined,
        previewUrl: x.previewUrl as string,
        artwork: x.artworkUrl100 ? String(x.artworkUrl100).replace('100x100', '300x300') : undefined,
        serviceUrl: x.trackViewUrl as string,
      }));
  } catch {
    return [];
  }
}

// ——— поиск с проверкой совпадения ———
const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'k', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};
/** «Мияги» → «miyagi»: кириллица и латиница сравниваются в одном алфавите */
export const translit = (s: string) => s.toLowerCase().replace(/[а-яёәғқңөұүһі]/g, (c) => TR[c] ?? c);
const words = (s: string) =>
  translit(s)
    .replace(/kh/g, 'h')
    .replace(/x/g, 'ks') // Max = Макс
    .replace(/ph/g, 'f')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
const near = (q: string, w: string) => w === q || (q.length >= 3 && w.startsWith(q)) || (q.length >= 4 && lev(q, w) <= (q.length >= 7 ? 2 : 1));
// версии, которые почти никогда не ищут специально
const JUNK = /karaoke|караоке|instrumental|инструментал|sped ?up|slowed|nightcore|8d audio|tik ?tok|тикток|cover|кавер|made famous|in the style of|tribute|backing track|minus|минус/i;

/** Насколько кандидат похож на то, что искали: 0..1 (+ штраф за караоке и «sped up») */
export function matchScore(query: string, c: { artist: string; title: string }) {
  const q = words(query).filter((w) => w.length > 1 || /\d/.test(w));
  if (!q.length) return 0;
  const cand = words(`${c.artist} ${c.title}`);
  let hit = 0;
  for (const w of q) if (cand.some((x) => near(w, x))) hit++;
  let sc = hit / q.length;
  // название песни должно попасть хотя бы одним словом
  const tw = words(c.title);
  if (!q.some((w) => tw.some((x) => near(w, x))) && q.length > 1) sc *= 0.6;
  if (JUNK.test(`${c.artist} ${c.title}`) && !JUNK.test(query)) sc *= 0.35;
  return sc;
}

export interface Ranked extends TrackCandidate {
  match: number;
}

/** Поиск по официальному каталогу Apple (30-секундные фрагменты): несколько написаний, свой порядок по совпадению */
export async function searchTracks(query: string): Promise<Ranked[]> {
  const s = query.trim();
  if (!s) return [];
  const variants = [s];
  if (/[а-яё]/i.test(s)) variants.push(translit(s));
  const reqs: Promise<TrackCandidate[]>[] = [];
  for (const v of variants) for (const cc of ['kz', 'us']) reqs.push(itunes(`https://itunes.apple.com/search?term=${encodeURIComponent(v)}&entity=song&limit=25&country=${cc}`));
  const all = (await Promise.all(reqs)).flat();
  const seen = new Set<string>();
  const out: Ranked[] = [];
  all.forEach((c, i) => {
    const k = translit(c.artist + '|' + c.title).replace(/\s+/g, ' ');
    if (seen.has(k) || !c.previewUrl) return;
    seen.add(k);
    // при равном совпадении — порядок каталога (популярность)
    out.push({ ...c, match: matchScore(s, c) - i * 0.0005 });
  });
  out.sort((a, b) => b.match - a.match);
  return out.slice(0, 10);
}

/** Песни под настроение дня: проверенные запросы к каталогу по мотивам атмосферы */
const MOOD_SONGS: Record<string, string[]> = {
  sunset: ['The Neighbourhood Sweater Weather', 'Lana Del Rey Summertime Sadness', 'Кино Звезда по имени Солнце', 'Tame Impala The Less I Know the Better'],
  sea: ['ABBA Dancing Queen', 'Billie Eilish Ocean Eyes', 'Coldplay Yellow', 'Frank Ocean Ivy'],
  love: ['Frank Sinatra Fly Me to the Moon', 'Arctic Monkeys I Wanna Be Yours', 'Billie Eilish Birds of a Feather', 'Ed Sheeran Perfect'],
  snow: ['Frank Sinatra Let It Snow', 'Ryuichi Sakamoto Merry Christmas Mr. Lawrence', 'Coldplay Christmas Lights', 'Massive Attack Teardrop'],
  rain: ['Radiohead No Surprises', 'Massive Attack Teardrop', 'Земфира Хочешь', 'Ryuichi Sakamoto Merry Christmas Mr. Lawrence'],
  night: ['The Weeknd Blinding Lights', 'Arctic Monkeys 505', 'Massive Attack Teardrop', 'Кино Группа крови'],
  city: ['Daft Punk Around the World', 'Max Korzh Жить в кайф', 'The Weeknd Blinding Lights', 'Frank Sinatra New York New York'],
  nature: ['Кино Звезда по имени Солнце', 'Bon Iver Holocene', 'Of Monsters and Men Little Talks', 'Coldplay Viva la Vida'],
  autumn: ['Nat King Cole Autumn Leaves', 'ДДТ Что такое осень', 'Lana Del Rey Video Games', 'Frank Sinatra Fly Me to the Moon'],
  summer: ['Harry Styles Watermelon Sugar', 'Max Korzh Горы по колено', 'Daft Punk Get Lucky', 'Кино Звезда по имени Солнце'],
  party: ['ABBA Dancing Queen', 'Daft Punk Get Lucky', 'Ирина Кайратовна Айдахар', 'Mark Ronson Uptown Funk'],
  cozy: ['Norah Jones Don\'t Know Why', 'Frank Sinatra Fly Me to the Moon', 'Ryuichi Sakamoto Merry Christmas Mr. Lawrence', 'Кино Кукушка'],
  calm: ['Ryuichi Sakamoto Merry Christmas Mr. Lawrence', 'Norah Jones Don\'t Know Why', 'Bon Iver Holocene', 'Radiohead No Surprises'],
  bright: ['Daft Punk Get Lucky', 'Harry Styles Watermelon Sugar', 'ABBA Dancing Queen', 'Max Korzh Горы по колено'],
};
const recCache = new Map<string, Promise<Ranked | null>>();
/** До 6 песен под мотивы/настроение; каждая — лучшее совпадение в каталоге */
export async function recommendSongs(motifs: string[], mood: { valence: number; arousal: number }): Promise<Ranked[]> {
  const qs: string[] = [];
  for (const m of motifs) for (const q of MOOD_SONGS[m] ?? []) if (!qs.includes(q)) qs.push(q);
  for (const q of MOOD_SONGS[mood.arousal > 0.15 || mood.valence > 0.4 ? 'bright' : 'calm']) if (!qs.includes(q)) qs.push(q);
  const pick = qs.slice(0, 6);
  const found = await Promise.all(
    pick.map((q) => {
      if (!recCache.has(q)) recCache.set(q, searchTracks(q).then((l) => (l[0] && l[0].match >= 0.7 ? l[0] : null)).catch(() => null));
      return recCache.get(q)!;
    }),
  );
  const seen = new Set<number>();
  return found.filter((t): t is Ranked => !!t && !seen.has(t.trackId) && !!seen.add(t.trackId));
}

export async function lookupTrack(id: number): Promise<TrackCandidate | null> {
  for (const cc of ['us', 'kz', 'ru']) {
    const r = await itunes(`https://itunes.apple.com/lookup?id=${id}&country=${cc}`);
    if (r[0]) return r[0];
  }
  return null;
}

export async function decodeUrl(url: string, ctx?: BaseAudioContext): Promise<AudioBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('audio ' + r.status);
  const ab = await r.arrayBuffer();
  const c = ctx ?? new OfflineAudioContext(2, 44100, 44100);
  return c.decodeAudioData(ab);
}

// ——— Приоры по жанру (если аудио недоступно — работает только это) ———
interface GenrePrior {
  re: RegExp;
  energy: number;
  valence: number;
  warmth: number;
  electronic?: boolean;
  acoustic?: boolean;
  label: string;
}
const GENRES: GenrePrior[] = [
  { re: /jazz|swing|bossa|джаз/i, energy: 0.35, valence: 0.3, warmth: 0.75, acoustic: true, label: 'джаз — тёплый, ламповый' },
  { re: /vocal|standards|easy listening|lounge|шансон/i, energy: 0.3, valence: 0.3, warmth: 0.6, acoustic: true, label: 'вокальная классика' },
  { re: /blues|блюз/i, energy: 0.4, valence: -0.1, warmth: 0.55, acoustic: true, label: 'блюз' },
  { re: /classical|soundtrack|score|orchestral|piano|классик/i, energy: 0.3, valence: 0.0, warmth: 0.2, acoustic: true, label: 'классика / саундтрек' },
  { re: /ambient|new age|meditat|эмбиент/i, energy: 0.15, valence: 0.0, warmth: -0.25, label: 'эмбиент — воздух и пустота' },
  { re: /techno|house|edm|trance|electro|dance|electronic|drum|dubstep|synth|электрон/i, energy: 0.8, valence: 0.15, warmth: -0.6, electronic: true, label: 'электроника — холодная, ритмичная' },
  { re: /hip-hop|hip hop|rap|trap|рэп/i, energy: 0.7, valence: 0.0, warmth: -0.1, label: 'хип-хоп' },
  { re: /r&b|soul|funk|соул/i, energy: 0.55, valence: 0.35, warmth: 0.55, label: 'соул / R&B — тёплый' },
  { re: /k-pop|j-pop|pop|поп|эстрад/i, energy: 0.65, valence: 0.5, warmth: 0.2, label: 'поп — светлый' },
  { re: /metal|punk|hardcore|hard rock|метал|панк/i, energy: 0.9, valence: -0.3, warmth: -0.2, label: 'тяжёлая музыка — напряжение' },
  { re: /indie|alternative|инди/i, energy: 0.6, valence: 0.15, warmth: 0.15, label: 'инди' },
  { re: /rock|рок/i, energy: 0.72, valence: 0.1, warmth: 0.0, label: 'рок' },
  { re: /folk|singer|songwriter|country|acoustic|бард|фолк/i, energy: 0.35, valence: 0.2, warmth: 0.6, acoustic: true, label: 'фолк / акустика — тёплый' },
  { re: /reggae|latin|salsa|afro/i, energy: 0.6, valence: 0.6, warmth: 0.7, label: 'латино / регги — солнечный' },
  { re: /lo-?fi|chill|лоу-?фай/i, energy: 0.25, valence: 0.1, warmth: 0.3, label: 'lo-fi — уютный' },
];

export function genrePrior(genre?: string): GenrePrior {
  const g = genre ?? '';
  return GENRES.find((x) => x.re.test(g)) ?? { re: /./, energy: 0.5, valence: 0.2, warmth: 0.1, label: 'жанр не определён' };
}

export function musicFeatures(meta: MusicMeta, audioIn: AudioFeatures | null): MusicFeatures {
  const gp = genrePrior(meta.genre);
  // классика, эмбиент, lo-fi: «быстрый» темп почти всегда — удвоение из-за арпеджио
  let audio = audioIn;
  if (audio && /classical|soundtrack|score|orchestral|piano|ambient|new age|lo-?fi|chill|классик|эмбиент/i.test(meta.genre ?? '') && audio.bpm > 115 && audio.bpm / 2 >= 55)
    audio = { ...audio, bpm: Math.round((audio.bpm / 2) * 10) / 10 };
  const era = meta.year ? clamp((2026 - meta.year) / 60) : 0.15;
  let energy = gp.energy,
    valence = gp.valence,
    warmth = gp.warmth;
  if (audio) {
    energy = 0.75 * audio.energy + 0.25 * gp.energy;
    const modeV = (audio.mode === 'major' ? 0.4 : -0.4) * audio.modeConfidence;
    valence = clamp(modeV + gp.valence * 0.45 + (audio.brightness - 0.5) * 0.25, -1, 1);
    warmth = clamp(gp.warmth * 0.55 + (0.45 - audio.brightness) * 0.9 + era * 0.25, -1, 1);
  } else {
    warmth = clamp(warmth + era * 0.25, -1, 1);
  }
  const bpm = audio?.bpm ?? 60 + gp.energy * 80;
  return {
    meta,
    audio,
    energy: clamp(energy),
    valence,
    warmth,
    era,
    electronic: !!gp.electronic,
    acoustic: !!gp.acoustic,
    tempoClass: bpm < 92 ? 'slow' : bpm < 126 ? 'mid' : 'fast',
  };
}
