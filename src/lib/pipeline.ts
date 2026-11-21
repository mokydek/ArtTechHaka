import JSZip from 'jszip';
import type { AudioFeatures, DayMedia, DayRecord, MusicMeta, PhotoFeatures, PlaceInfo } from './types';
import { AMB_NAMES, pickAmbience, renderAmbience } from './ambience';
import { placeLine, tempStr, weatherTags } from './place';
import { stickersFor } from './render/stickers';
import { moonPhase } from './sky';
import { analyzeText, folderName, makeTitle } from './analysis/text';
import { analyzePhoto, loadImage, summarizePhotos } from './analysis/photo';
import { analyzeAudio, bestExcerpt, excerptToWav, keyName } from './analysis/audio';
import { decodeUrl, lookupTrack, musicFeatures, searchTracks, type TrackCandidate } from './analysis/music';

const words = (s: string) => s.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
/** Последние секунды файла не берём: там часто заставка (TikTok, Reels) или обрыв */
export const TAIL = 4;
/** Отрывок 30 с, выбранный человеком, — в пределах файла и без хвоста */
export function fragment(duration: number, start: number) {
  const usable = Math.max(1, duration > TAIL + 8 ? duration - TAIL : duration);
  const dur = Math.min(30, usable);
  return { start: Math.max(0, Math.min(start, usable - dur)), dur };
}
/** Самые плотные 30 секунд (обычно припев), но не заставка в конце */
async function safeExcerpt(full: AudioBuffer) {
  const usable = full.duration > TAIL + 8 ? full.duration - TAIL : full.duration;
  const { start } = await bestExcerpt(full, Math.min(30, usable));
  return fragment(full.duration, start);
}
import { designDay, MODES, PARTICLE_NAMES } from './design/system';
import { MemoryRenderer, type CutoutRt } from './render/engine';
import { newId } from './store';
import { voiceLabel } from './voice';

export type MusicInput =
  | { kind: 'track'; track: TrackCandidate; link?: string }
  | { kind: 'file'; file: File; start?: number } // start — выбранный человеком отрывок (сек)
  | { kind: 'manual'; artist: string; title: string; genre?: string; year?: number; link?: string };

export interface DayInput {
  text: string;
  date: string;
  photos: Blob[];
  photoUrls?: string[];
  music: MusicInput;
  pageNo: number;
  id?: string;
  demo?: boolean;
  place?: PlaceInfo;
}

export interface Step {
  key: 'text' | 'photo' | 'music' | 'design' | 'render';
  label: string;
  detail?: string;
  done?: boolean;
}

export interface BuiltDay {
  record: DayRecord;
  bitmaps: ImageBitmap[];
  audio: AudioBuffer | null;
  excerpt?: Blob;
  photoBlobs: Blob[];
}

const decodeCtx = () => new OfflineAudioContext(2, 44100, 44100);

async function toJpeg(bmp: ImageBitmap, max = 1600, q = 0.86): Promise<Blob> {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: q });
}

export async function buildDay(input: DayInput, onStep: (s: Step) => void): Promise<BuiltDay> {
  // 1. Текст
  onStep({ key: 'text', label: 'Читаю запись' });
  const text = analyzeText(input.text, input.date);
  // погода из записи главнее: данные о погоде добавляются, только если в тексте её нет совсем
  const fromData = input.place && !text.weather.length ? weatherTags(input.place) : [];
  text.weather.push(...fromData);
  const found = [
    ...text.places.slice(0, 2).map((p) => p.nom),
    ...text.companions.slice(0, 2).map((p) => p.nom),
    ...text.objects.slice(0, 3).map((p) => p.nom),
    ...text.weather.map((w) => ({ rain: 'дождь', snow: 'снег', sun: 'солнце', fog: 'туман', wind: 'ветер', cold: 'холод', hot: 'жара', storm: 'гроза', clouds: 'пасмурно' })[w]),
  ];
  onStep({ key: 'text', label: 'Запись прочитана', detail: found.length ? found.join(' · ') : 'без явных мест и людей', done: true });

  // 2. Фото
  onStep({ key: 'photo', label: 'Смотрю на фото' });
  const bitmaps: ImageBitmap[] = [];
  const photoBlobs: Blob[] = [];
  const srcs: (Blob | string)[] = input.photos.length ? input.photos : (input.photoUrls ?? []);
  for (const s of srcs) {
    const b = await loadImage(s, 1600);
    bitmaps.push(b);
    if (!input.demo) photoBlobs.push(await toJpeg(b));
  }
  const photoList: PhotoFeatures[] = bitmaps.map((b) => analyzePhoto(b));
  const photos = summarizePhotos(photoList);
  onStep({ key: 'photo', label: `Фото: ${bitmaps.length}`, detail: photos.palette.map((c) => c.hex).join(' '), done: true });

  // 3. Музыка
  onStep({ key: 'music', label: 'Слушаю песню' });
  let meta: MusicMeta;
  let audio: AudioBuffer | null = null;
  let feats: AudioFeatures | null = null;
  let excerpt: Blob | undefined;
  const mi = input.music;
  if (mi.kind === 'track') {
    const t = mi.track;
    meta = { source: 'itunes', title: t.title, artist: t.artist, genre: t.genre, year: t.year, trackId: t.trackId, previewUrl: t.previewUrl, artwork: t.artwork, serviceUrl: t.serviceUrl, link: mi.link };
    try {
      audio = await decodeUrl(t.previewUrl!, decodeCtx());
    } catch {
      const fresh = await lookupTrack(t.trackId);
      if (fresh?.previewUrl) {
        meta.previewUrl = fresh.previewUrl;
        audio = await decodeUrl(fresh.previewUrl, decodeCtx()).catch(() => null);
      }
    }
  } else if (mi.kind === 'file') {
    const name = mi.file.name.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ');
    const [artist, title] = name.includes(' - ') ? name.split(' - ', 2) : ['', name];
    meta = { source: 'file', title: title.trim(), artist: artist.trim(), fileName: mi.file.name };
    const full = await decodeCtx().decodeAudioData(await mi.file.arrayBuffer());
    const { start, dur } = mi.start != null ? fragment(full.duration, mi.start) : await safeExcerpt(full);
    excerpt = await excerptToWav(full, start, dur);
    audio = await decodeCtx().decodeAudioData(await excerpt.arrayBuffer());
    // жанр и год — из каталога, только если название файла точно совпало с песней (а не «video_1234»)
    const found2 = words(name).length >= 2 ? await searchTracks(name).catch(() => []) : [];
    if (found2[0] && found2[0].match >= 0.85) {
      meta.genre = found2[0].genre;
      meta.year = found2[0].year;
      if (!meta.artist) meta.artist = found2[0].artist;
    }
  } else {
    meta = { source: 'link', title: mi.title, artist: mi.artist, genre: mi.genre, year: mi.year, link: mi.link };
  }
  if (audio) feats = await analyzeAudio(audio);
  const music = musicFeatures(meta, feats);
  onStep({
    key: 'music',
    label: `${meta.artist ? meta.artist + ' · ' : ''}${meta.title}`,
    detail: feats ? `${Math.round(feats.bpm)} BPM · ${keyName(feats.key, feats.mode)} · энергия ${Math.round(feats.energy * 100)}%` : `${meta.genre ?? 'жанр по описанию'}${meta.year ? ', ' + meta.year : ''}`,
    done: true,
  });

  // 4. Система
  onStep({ key: 'design', label: 'Подбираю форму' });
  const analysis = { text, photos, photoList, music };
  const design = designDay(analysis, input.date, input.text);
  const { title, pattern } = makeTitle(text, input.date, design.mood.energy, design.mood.valence);
  if (input.place?.weather) {
    const w = input.place.weather;
    design.rules.unshift({ group: 'mix', from: `Место и погода: ${input.place.name}, ${tempStr(w)} ${w.label} (Open-Meteo за ${input.date})`, to: fromData.length ? `в записи погоды нет, взята из данных: ${fromData.map((x) => ({ rain: 'дождь', snow: 'снег', sun: 'солнце', fog: 'туман', wind: 'ветер', cold: 'холод', hot: 'жара', storm: 'гроза', clouds: 'облака' })[x]).join(', ')}, это видно в частицах, свете и звуке` : 'в записи своя погода, она главнее, данные только для штампа места' });
  }
  const ambience = pickAmbience(analysis, design, input.place);
  if (ambience.length) design.rules.push({ group: 'mix', from: `Звуки дня: ${ambience.map((a) => a.why).join('; ')}`, to: `под песней тихо звучит ${ambience.map((a) => AMB_NAMES[a.kind]).join(' + ')} (синтез на устройстве)` });
  onStep({ key: 'design', label: `${MODES[design.mode].name}, ${MODES[design.mode].ref}`, detail: `папка «${title}»`, done: true });

  const record: DayRecord = {
    id: input.id ?? newId(),
    createdAt: new Date().toISOString(),
    date: input.date,
    title,
    titlePattern: pattern,
    folder: folderName(input.date, title),
    text: input.text,
    music: meta,
    analysis,
    design,
    photoCount: bitmaps.length,
    pageNo: input.pageNo,
    demo: input.demo,
    hasExcerpt: !!excerpt,
    photoUrls: input.photoUrls,
    place: input.place,
    ambience,
  };
  return { record, bitmaps, audio, excerpt, photoBlobs };
}

/** Пересчитать название/форму при правке названия — без повторного анализа */
export function retitle(rec: DayRecord, title: string): DayRecord {
  const t = title.trim().replace(/\s+/g, ' ');
  return { ...rec, title: t, folder: folderName(rec.date, t) };
}

/** Загрузка медиа дня для просмотра */
export async function loadAssets(rec: DayRecord, media: DayMedia): Promise<{ bitmaps: ImageBitmap[]; audio: AudioBuffer | null }> {
  const urls = media.photos.length ? media.photos : (rec.photoUrls ?? []);
  const bitmaps = await Promise.all(urls.map((u) => loadImage(u, 1600)));
  let audio: AudioBuffer | null = null;
  try {
    if (media.excerpt) audio = await decodeUrl(media.excerpt, decodeCtx());
    else if (rec.music.previewUrl) audio = await decodeUrl(rec.music.previewUrl, decodeCtx());
  } catch {
    if (rec.music.trackId) {
      const fresh = await lookupTrack(rec.music.trackId);
      if (fresh?.previewUrl) audio = await decodeUrl(fresh.previewUrl, decodeCtx()).catch(() => null);
    }
  }
  return { bitmaps, audio };
}

export async function makeRenderer(rec: DayRecord, bitmaps: ImageBitmap[], target?: HTMLCanvasElement, onStep?: (s: string) => void) {
  const r = new MemoryRenderer(target ?? document.createElement('canvas'), {
    spec: rec.design,
    photos: bitmaps,
    title: rec.title,
    caption: rec.analysis.text.caption,
    date: rec.date,
    pageNo: rec.pageNo,
    music: rec.music,
    audio: rec.analysis.music.audio,
    label: moodLabel(rec),
    stickers: stickersFor(rec.analysis.text),
    moon: moonPhase(rec.date),
    place: rec.place ? [rec.place.name, tempStr(rec.place.weather)].filter(Boolean).join(' ') : undefined,
  });
  await r.prepare(onStep);
  return r;
}

const SEASON_W: Record<string, string> = { autumn: 'осень', winter: 'зима', spring: 'весна', summer: 'лето' };
const TIME_W: Record<string, string> = { morning: 'утро', day: 'день', evening: 'вечер', night: 'ночь' };
const WEATHER_W: Record<string, string> = { rain: 'дождь', snow: 'снег', sun: 'солнце', fog: 'туман', wind: 'ветер', cold: 'холод', hot: 'жара', storm: 'гроза', clouds: 'пасмурно' };
export function moodLabel(rec: DayRecord) {
  const t = rec.analysis.text;
  return [t.season ? SEASON_W[t.season] : '', t.timeOfDay ? TIME_W[t.timeOfDay] : '', t.weather[0] ? WEATHER_W[t.weather[0]] : ''].filter(Boolean).join(' · ');
}

export async function renderCover(rec: DayRecord, bitmaps: ImageBitmap[], w = 720, cutouts: CutoutRt[] = []): Promise<Blob> {
  const r = await makeRenderer(rec, bitmaps);
  r.setCutouts(cutouts);
  r.draw(0, { still: true });
  const c = new OffscreenCanvas(w, Math.round((w * r.canvas.height) / r.canvas.width));
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(r.canvas, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
}

/** «Папка дня» одним архивом: текст, фото, песня, воспоминание, озвучка, объяснение */
export async function folderZip(rec: DayRecord, media: DayMedia, video?: Blob): Promise<Blob> {
  const zip = new JSZip();
  const f = zip.folder(rec.folder)!;
  f.file('запись.txt', `${rec.title}\n${rec.date}${rec.place ? '\n' + placeLine(rec.place) : ''}\n\n${rec.text}\n`);
  const photos = media.photos.length ? media.photos : (rec.photoUrls ?? []);
  const pf = f.folder('фото')!;
  await Promise.all(
    photos.map(async (u, i) => {
      const b = await (await fetch(u)).blob();
      pf.file(`${String(i + 1).padStart(2, '0')}.jpg`, b);
    }),
  );
  const m = rec.music;
  const a = rec.analysis.music.audio;
  f.file(
    'песня.txt',
    [
      `${m.artist}, ${m.title}`,
      m.genre ? `Жанр: ${m.genre}` : '',
      m.year ? `Год: ${m.year}` : '',
      a ? `Темп: ${Math.round(a.bpm)} BPM, ${keyName(a.key, a.mode)}, энергия ${Math.round(a.energy * 100)}%` : '',
      m.link ? `Ссылка: ${m.link}` : '',
      m.serviceUrl ? `Apple Music: ${m.serviceUrl}` : '',
      m.source === 'itunes' ? 'Звучит официальный 30-секундный фрагмент из каталога Apple, песня целиком не хранится.' : '',
      m.source === 'file' ? 'Из файла сохранены только 30 секунд (самый плотный фрагмент), песня целиком не хранится.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
  );
  if (media.excerpt) f.file('фрагмент песни.wav', await (await fetch(media.excerpt)).blob());
  if (rec.ambience?.length) {
    const amb = await renderAmbience(rec.ambience, 30).catch(() => null);
    if (amb) f.file('звуки дня.wav', await excerptToWav(amb, 0, amb.duration));
  }
  const vid = video ?? (media.video ? await (await fetch(media.video)).blob() : undefined);
  if (vid) f.file(`воспоминание.${vid.type.includes('mp4') ? 'mp4' : 'webm'}`, vid);
  const cuts = Object.entries(media.cutouts ?? {});
  if (cuts.length) {
    const cf = f.folder('вклейки')!;
    await Promise.all(cuts.map(async ([id, u], i) => cf.file(`${String(i + 1).padStart(2, '0')}-${id.slice(0, 6)}.png`, await (await fetch(u)).blob())));
  }
  if (media.voice) {
    const vb = await (await fetch(media.voice)).blob();
    f.file(`мой голос.${vb.type.includes('mp4') ? 'm4a' : 'webm'}`, vb);
  }
  if (media.cover) f.file('обложка.jpg', await (await fetch(media.cover)).blob());
  f.file('озвучка.txt', `Голос: ${voiceLabel(rec.design.voice)}\nВысота ×${rec.design.voice.pitch.toFixed(2)}\nОзвучка синтезируется на устройстве по этому профилю (кнопка «Слушать запись» в дневнике).\n\nТекст:\n${rec.text}\n`);
  const d = rec.design;
  f.file(
    'почему так.txt',
    [
      `Приём: ${MODES[d.mode].name}, ${MODES[d.mode].ref}`,
      `Техника: ${MODES[d.mode].technique}`,
      `Почему: ${MODES[d.mode].why}`,
      `Погода внутри: ${PARTICLE_NAMES[d.particles.kind]}`,
      `Палитра: ${d.palette.colors.join(' ')} · акцент ${d.palette.accent}`,
      '',
      ...d.rules.map((r) => `• ${r.from} → ${r.to}`),
    ].join('\n'),
  );
  f.file('анализ.json', JSON.stringify({ analysis: rec.analysis, design: rec.design }, null, 2));
  return zip.generateAsync({ type: 'blob' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
}

/** Сторис 9:16: страница дня на размытом фоне своей же палитры */
export async function renderStory(rec: DayRecord, bitmaps: ImageBitmap[], t?: number, cutouts: CutoutRt[] = []): Promise<Blob> {
  const r = await makeRenderer(rec, bitmaps);
  r.setCutouts(cutouts);
  if (t != null) r.draw(t);
  else r.draw(0, { still: true });
  const W = 1080,
    H = 1920;
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d')!;
  const pal = rec.design.palette;
  // фон: та же страница, сильно размытая и затемнённая палитрой
  g.filter = 'blur(60px) saturate(1.2)';
  const bs = H / r.canvas.height;
  g.drawImage(r.canvas, (W - r.canvas.width * bs) / 2, 0, r.canvas.width * bs, H);
  g.filter = 'none';
  g.fillStyle = pal.colors[0] + '66';
  g.fillRect(0, 0, W, H);
  // страница
  const pw = 960,
    ph = (pw * r.canvas.height) / r.canvas.width;
  const px = (W - pw) / 2,
    py = (H - ph) / 2 - 20;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 60;
  g.shadowOffsetY = 24;
  g.fillStyle = pal.paper;
  g.fillRect(px, py, pw, ph);
  g.restore();
  g.imageSmoothingQuality = 'high';
  g.drawImage(r.canvas, px, py, pw, ph);
  return c.convertToBlob({ type: 'image/png' });
}
