import type { DayRecord } from './types';
import { buildDay, renderCover } from './pipeline';
import { searchTracks } from './analysis/music';
import { LocalStore } from './store/local';

// Демо-дни: вымышленные записи + фото со свободной лицензией + официальные 30-секундные фрагменты песен.
// Всё оформление строится тем же конвейером, что и у пользователя.
export interface DemoInput {
  id: string;
  date: string;
  text: string;
  photos: string[];
  song: string; // поисковый запрос в каталоге
}

export const DEMO_INPUTS: DemoInput[] = [];

const local = new LocalStore();

/** Готовые демо (если собраны заранее) лежат в /demo/days.json + /demo/covers/<id>.jpg */
export async function loadDemo(onDay?: (r: DayRecord, cover: string) => void): Promise<{ days: DayRecord[]; covers: Record<string, string> }> {
  const days: DayRecord[] = [];
  const covers: Record<string, string> = {};
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}demo/days.json`, { cache: 'no-cache' });
    if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) {
      const list = (await r.json()) as DayRecord[];
      for (const d of list) {
        days.push({ ...d, demo: true });
        covers[d.id] = `${import.meta.env.BASE_URL}demo/covers/${d.id}.jpg`;
      }
      return { days, covers };
    }
  } catch {
    /* нет готовых — соберём */
  }
  // собираем в браузере и кешируем
  for (let i = 0; i < DEMO_INPUTS.length; i++) {
    const inp = DEMO_INPUTS[i];
    let rec = await local.get(inp.id);
    if (!rec) {
      try {
        const tracks = await searchTracks(inp.song);
        const built = await buildDay(
          { id: inp.id, text: inp.text, date: inp.date, photos: [], photoUrls: inp.photos, music: tracks[0] ? { kind: 'track', track: tracks[0] } : { kind: 'manual', artist: '', title: inp.song }, pageNo: i + 1, demo: true },
          () => {},
        );
        rec = built.record;
        const cover = await renderCover(rec, built.bitmaps);
        await local.save(rec, { photos: [], cover });
      } catch (e) {
        console.warn('[Оттиск] демо-день не собрался', inp.id, e);
        continue;
      }
    }
    const c = (await local.covers([rec]))[rec.id];
    days.push(rec);
    if (c) covers[rec.id] = c;
    onDay?.(rec, c);
  }
  return { days, covers };
}
