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

/** Поиск по официальному каталогу Apple (30-секундные фрагменты) */
export async function searchTracks(query: string): Promise<TrackCandidate[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const [us, kz] = await Promise.all([
    itunes(`https://itunes.apple.com/search?term=${q}&entity=song&limit=8&country=us`),
    itunes(`https://itunes.apple.com/search?term=${q}&entity=song&limit=8&country=kz`),
  ]);
  const seen = new Set<string>();
  const out: TrackCandidate[] = [];
  for (const c of [...us, ...kz]) {
    const k = (c.artist + c.title).toLowerCase();
    if (seen.has(k) || !c.previewUrl) continue;
    seen.add(k);
    out.push(c);
  }
  return out.slice(0, 8);
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
  // спокойные жанры (классика, эмбиент, фолк): быстрый темп почти всегда — удвоение из-за арпеджио
  let audio = audioIn;
  if (audio && gp.energy <= 0.35 && audio.bpm > 115 && audio.bpm / 2 >= 55) audio = { ...audio, bpm: Math.round((audio.bpm / 2) * 10) / 10 };
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
