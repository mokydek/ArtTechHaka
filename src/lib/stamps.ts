import type { Capsule, DayRecord, ModeId } from './types';
import type { StickerKind } from './render/stickers';
import { drawSticker } from './render/stickers';
import { moonPhase } from './sky';
import { streak } from './prompts';

// Альбом марок: почтовые марки за моменты, которые стоит помнить

export interface StampDef {
  id: string;
  title: string;
  hint: string; // как получить
  icon: StickerKind;
  bg: string;
  test: (ctx: StampCtx) => DayRecord | true | null; // день, который принёс марку
}

export interface StampCtx {
  days: DayRecord[]; // по возрастанию даты
  capsules: Capsule[];
}

const first = (days: DayRecord[], f: (d: DayRecord) => boolean) => days.find(f) ?? null;
const has = (d: DayRecord, list: 'places' | 'objects' | 'events' | 'companions', ...keys: string[]) => d.analysis.text[list].some((p) => keys.includes(p.key));
const ALL_MODES: ModeId[] = ['impression', 'construct', 'film', 'ma', 'collage', 'nocturne'];

export const STAMPS: StampDef[] = [
  { id: 'first', title: 'Первая страница', hint: 'записать первый день', icon: 'book', bg: '#d9c7a3', test: ({ days }) => days[0] ?? null },
  { id: 'snow', title: 'Первый снег', hint: 'день, когда шёл снег', icon: 'snow', bg: '#bcd3ea', test: ({ days }) => first(days, (d) => d.analysis.text.weather.includes('snow') || has(d, 'events', 'firstsnow')) },
  { id: 'rain', title: 'Под дождём', hint: 'день под дождём', icon: 'wave', bg: '#a9b8c8', test: ({ days }) => first(days, (d) => d.analysis.text.weather.includes('rain') || d.analysis.text.weather.includes('storm')) },
  { id: 'water', title: 'У воды', hint: 'море, озеро, река или пляж', icon: 'wave', bg: '#9ccbd8', test: ({ days }) => first(days, (d) => has(d, 'places', 'sea', 'beach', 'lake', 'river', 'shore', 'pond')) },
  { id: 'night', title: 'Ночная смена', hint: 'день, который продолжился ночью', icon: 'moon', bg: '#2f3a5e', test: ({ days }) => first(days, (d) => d.analysis.text.night || d.analysis.text.timeOfDay === 'night') },
  { id: 'fullmoon', title: 'Полнолуние', hint: 'запись в ночь полной луны', icon: 'moon', bg: '#1f2740', test: ({ days }) => first(days, (d) => moonPhase(d.date).illum > 0.96) },
  { id: 'dawn', title: 'Ранняя пташка', hint: 'утро, которое запомнилось', icon: 'sun', bg: '#f3cf86', test: ({ days }) => first(days, (d) => d.analysis.text.timeOfDay === 'morning') },
  { id: 'fire', title: 'У огня', hint: 'костёр, камин или свечи', icon: 'flame', bg: '#e9a46b', test: ({ days }) => first(days, (d) => has(d, 'objects', 'bonfire', 'fireplace', 'candles')) },
  { id: 'party', title: 'Праздник', hint: 'день рождения или праздник', icon: 'cake', bg: '#f0b7c6', test: ({ days }) => first(days, (d) => d.analysis.text.celebration) },
  { id: 'together', title: 'Вместе', hint: 'день с компанией', icon: 'heart', bg: '#e8a0a0', test: ({ days }) => first(days, (d) => d.analysis.text.companions.some((c) => c.kind === 'group' || ['friends', 'family', 'team', 'gfriends', 'classmates'].includes(c.key))) },
  { id: 'alone', title: 'Наедине', hint: 'тихий день наедине с собой', icon: 'book', bg: '#cfc8bd', test: ({ days }) => first(days, (d) => d.analysis.text.solitude) },
  { id: 'cup', title: 'Тёплая чашка', hint: 'какао, чай или кофе', icon: 'cup', bg: '#d6a37c', test: ({ days }) => first(days, (d) => has(d, 'objects', 'cocoa', 'tea', 'coffee', 'mulled')) },
  { id: 'sport', title: 'Сила', hint: 'тренировка или турнир', icon: 'dumbbell', bg: '#b9bec8', test: ({ days }) => first(days, (d) => has(d, 'events', 'training', 'tournament') || has(d, 'places', 'gym', 'ring')) },
  { id: 'streak3', title: 'Три дня подряд', hint: 'писать 3 дня подряд', icon: 'star', bg: '#f2d36b', test: ({ days }) => (maxStreak(days) >= 3 ? days[days.length - 1] : null) },
  { id: 'streak7', title: 'Неделя', hint: 'писать 7 дней подряд', icon: 'star', bg: '#e8b33a', test: ({ days }) => (maxStreak(days) >= 7 ? days[days.length - 1] : null) },
  { id: 'modes', title: 'Шесть почерков', hint: 'дни во всех шести приёмах', icon: 'note', bg: '#c6b3e0', test: ({ days }) => (ALL_MODES.every((m) => days.some((d) => d.design.mode === m)) ? days[days.length - 1] : null) },
  { id: 'seasons', title: 'Четыре сезона', hint: 'дни зимой, весной, летом и осенью', icon: 'leaf', bg: '#cfd6a3', test: ({ days }) => (['winter', 'spring', 'summer', 'autumn'].every((s) => days.some((d) => d.analysis.text.season === s)) ? days[days.length - 1] : null) },
  { id: 'songs', title: 'Меломан', hint: '10 разных исполнителей', icon: 'note', bg: '#9fb6e0', test: ({ days }) => (new Set(days.map((d) => d.music.artist || d.music.title)).size >= 10 ? days[days.length - 1] : null) },
  { id: 'places', title: 'Путешественник', hint: 'дни в трёх разных местах', icon: 'camera', bg: '#a8c8b0', test: ({ days }) => (new Set(days.map((d) => d.place?.name).filter(Boolean)).size >= 3 ? days[days.length - 1] : null) },
  { id: 'voice', title: 'Свой голос', hint: 'надиктовать день своим голосом', icon: 'note', bg: '#e0c39f', test: ({ days }) => first(days, (d) => !!d.hasVoice) },
  { id: 'capsule', title: 'Письмо в будущее', hint: 'запечатать письмо себе', icon: 'heart', bg: '#c9a27a', test: ({ capsules }) => (capsules.length ? true : null) },
];

function maxStreak(days: DayRecord[]) {
  let best = 0;
  const dates = [...new Set(days.map((d) => d.date))].sort();
  let run = 0;
  let prev = '';
  for (const d of dates) {
    const p = new Date(d + 'T12:00:00');
    p.setDate(p.getDate() - 1);
    const y = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
    run = prev === y ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return Math.max(best, streak(days).count);
}

export interface Earned {
  def: StampDef;
  day: DayRecord | null;
}

export function earnedStamps(days: DayRecord[], capsules: Capsule[]): Earned[] {
  const ctx = { days: [...days].sort((a, b) => a.date.localeCompare(b.date)), capsules };
  const out: Earned[] = [];
  for (const def of STAMPS) {
    const r = def.test(ctx);
    if (r) out.push({ def, day: r === true ? null : r });
  }
  return out;
}

const cache = new Map<string, string>();

/** Марка: перфорация, рамка, рисунок-наклейка, надписи */
export function stampArt(def: StampDef, no: number, locked = false): string {
  const key = def.id + no + locked;
  if (cache.has(key)) return cache.get(key)!;
  const W = 300,
    H = 360;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // зубцы перфорации
  g.fillStyle = locked ? '#ece6dc' : '#fbf8f1';
  g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'destination-out';
  const r = 9,
    step = 24;
  for (let x = step / 2; x < W; x += step) {
    g.beginPath();
    g.arc(x, 0, r, 0, Math.PI * 2);
    g.arc(x, H, r, 0, Math.PI * 2);
    g.fill();
  }
  for (let y = step / 2; y < H; y += step) {
    g.beginPath();
    g.arc(0, y, r, 0, Math.PI * 2);
    g.arc(W, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const m = 26;
  if (locked) {
    g.strokeStyle = 'rgba(40,30,20,0.25)';
    g.setLineDash([6, 6]);
    g.lineWidth = 2;
    g.strokeRect(m, m, W - m * 2, H - m * 2);
    g.setLineDash([]);
    g.fillStyle = 'rgba(40,30,20,0.25)';
    g.font = 'italic 500 120px Ottisk, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('?', W / 2, H / 2 - 6);
  } else {
    g.fillStyle = def.bg;
    g.fillRect(m, m, W - m * 2, H - m * 2);
    // гравюрные линии
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    for (let y = m + 6; y < H - m; y += 7) {
      g.beginPath();
      g.moveTo(m, y);
      g.lineTo(W - m, y);
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    g.strokeRect(m + 8, m + 8, W - m * 2 - 16, H - m * 2 - 16);
    drawSticker(g, def.icon, W / 2, H / 2 - 14, 140, -0.08, 1);
    const dark = ['#2f3a5e', '#1f2740'].includes(def.bg);
    g.fillStyle = dark ? '#f3e9c8' : '#2a2320';
    g.textAlign = 'left';
    g.font = '500 15px "JetBrains Mono", monospace';
    g.letterSpacing = '3px';
    g.fillText('ОТТИСК', m + 18, m + 32);
    g.textAlign = 'right';
    g.fillText(String(no).padStart(2, '0'), W - m - 18, m + 32);
    g.letterSpacing = '0px';
    g.textAlign = 'center';
    g.font = 'italic 500 30px Ottisk, serif';
    g.fillText(def.title, W / 2, H - m - 26);
  }
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
