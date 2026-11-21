import type { DayRecord } from './types';
import { buildDay, renderCover } from './pipeline';
import { searchTracks } from './analysis/music';
import { LocalStore } from './store/local';
import { dayWeather } from './place';

// Демо-дни: вымышленные записи + фото со свободной лицензией + официальные 30-секундные фрагменты песен.
// Всё оформление строится тем же конвейером, что и у пользователя.
export interface DemoInput {
  id: string;
  date: string;
  text: string;
  photos: string[];
  song: string; // поисковый запрос в каталоге
  place?: { name: string; lat: number; lon: number };
}

const ASTANA = { name: 'Астана', lat: 51.1694, lon: 71.4491 };
const ALMATY = { name: 'Алматы', lat: 43.2389, lon: 76.8897 };

const U = (id: string) => `https://images.unsplash.com/${id}?w=1600&q=80&fm=jpg`;

// фото: Unsplash (Unsplash License), песни: официальные 30-секундные фрагменты Apple Music
export const DEMO_INPUTS: DemoInput[] = [
  {
    id: '9b1f6d2a-0c01-4e0a-9a11-0000000000a1',
    place: ASTANA,
    date: '2026-10-17',
    text: 'Гуляли с Аней по парку, всё в жёлтых листьях. Было холодно, пальцы мёрзли, но мы взяли какао в ларьке у входа и долго разговаривали на скамейке. Солнце было низкое, светило сквозь клёны, листья под ногами шуршали. Пахло мокрой листвой и шоколадом. Так спокойно и тепло давно не было.',
    photos: [U('photo-1572006898744-cc8b10586eb0'), U('photo-1637572815755-c4b80092dce1'), U('photo-1633719999728-6dfb43ca8a0c')],
    song: 'frank sinatra fly me to the moon',
  },
  {
    id: '9b1f6d2a-0c01-4e0a-9a11-0000000000a2',
    place: ASTANA,
    date: '2026-11-12',
    text: 'Срочная сдача проекта. Сидели в офисе всю ночь, мониторы светились синим, кофе уже не помогал. Баги вылезали один за другим, нервы на пределе, в наушниках долбила электроника. В четвёртом часу всё наконец собралось, и мы просто молча смотрели на огни ночного города.',
    photos: [U('photo-1605379399642-870262d3d051'), U('photo-1555066931-4365d14bab8c'), U('photo-1507981919056-e4804b83d74e')],
    song: 'daft punk around the world',
  },
  {
    id: '9b1f6d2a-0c01-4e0a-9a11-0000000000a3',
    place: ALMATY,
    date: '2026-11-02',
    text: 'Весь день шёл дождь. Никуда не пошёл, сидел дома один у окна с чаем и книгой. Капли стекали по стеклу, где-то далеко шуршали машины. Немного грустно, но тихо и как-то правильно — давно не было такого медленного дня.',
    photos: [U('photo-1630905894459-0b92f1b87c3f'), U('photo-1759464999169-728ec2ca387c')],
    song: 'ryuichi sakamoto merry christmas mr lawrence',
  },
  {
    id: '9b1f6d2a-0c01-4e0a-9a11-0000000000a4',
    place: { name: 'Актау', lat: 43.6532, lon: 51.1975 },
    date: '2026-07-14',
    text: 'День рождения у моря! Друзья приехали с самого утра, весь день купались, а вечером был торт со свечками прямо на пляже. Закат был розовый, кто-то включил ABBA, и мы танцевали босиком по песку до утра. Было жарко, громко и очень весело!',
    photos: [U('photo-1545696563-af8f6ec2295a'), U('photo-1559494007-9f5847c49d94'), U('photo-1783804374375-794afb6167b6')],
    song: 'abba dancing queen',
  },
  {
    id: '9b1f6d2a-0c01-4e0a-9a11-0000000000a5',
    place: { name: 'Боровое', lat: 53.0833, lon: 70.3 },
    date: '2026-07-26',
    text: 'Выходные на даче с друзьями, как в детстве. Жарили шашлыки, вечером жгли костёр, пели под гитару и вспоминали школьные истории. Пахло дымом и скошенной травой, в поле стрекотали кузнечики. Смеялись так, что болели щёки.',
    photos: [U('photo-1751112592731-94fec093c6b8'), U('photo-1589979812000-4eab44f02c30'), U('photo-1786658054436-5d3495ddeb4f')],
    song: 'кино звезда по имени солнце',
  },
  {
    id: '9b1f6d2a-0c01-4e0a-9a11-0000000000a6',
    place: ASTANA,
    date: '2026-01-20',
    text: 'После тренировки по боксу шли с братом пешком через весь город. Шёл снег, фонари светились жёлтым, под ногами хрустело. Мы почти не говорили, просто шли, и было немного грустно и очень спокойно. Ночной город совсем другой — тихий и пустой.',
    photos: [U('photo-1669326220646-1a5a67d11b92'), U('photo-1700870138663-b59a4d228a44'), U('photo-1609650793481-55b352ac866a')],
    song: 'massive attack teardrop',
  },
];

const local = new LocalStore();

/** Готовые демо (если собраны заранее) лежат в /demo/days.json + /demo/covers/<id>.jpg */
/** Сборка одного демо-дня тем же конвейером */
export async function buildDemoDay(inp: DemoInput, pageNo: number) {
  const tracks = await searchTracks(inp.song);
  const place = inp.place ? { ...inp.place, weather: await dayWeather(inp.place.lat, inp.place.lon, inp.date).catch(() => undefined) } : undefined;
  const built = await buildDay(
    { id: inp.id, text: inp.text, date: inp.date, photos: [], photoUrls: inp.photos, music: tracks[0] ? { kind: 'track', track: tracks[0] } : { kind: 'manual', artist: '', title: inp.song }, pageNo, demo: true, place },
    () => {},
  );
  const cover = await renderCover(built.record, built.bitmaps);
  return { record: built.record, cover };
}

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
  const ordered = [...DEMO_INPUTS].sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 0; i < ordered.length; i++) {
    const inp = ordered[i];
    let rec = await local.get(inp.id);
    if (!rec) {
      try {
        const b = await buildDemoDay(inp, i + 1);
        rec = b.record;
        await local.save(rec, { photos: [], cover: b.cover });
      } catch (e) {
        console.warn('[Echo] демо-день не собрался', inp.id, e);
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
