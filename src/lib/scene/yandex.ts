// Яндекс Карты (JavaScript API 2.1): настоящие панорамы улиц, карта и геокодер.
// Ключ публичный (как publishable-ключ Supabase) и работает только с адреса сайта.
// Бесплатный тариф — 100 запросов в сутки, поэтому API грузим только когда он правда нужен.

export const YANDEX_KEY = '7557a553-6a1a-4286-adb5-b7a985f6b6a8';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Ymaps = any;
export type YPanorama = any;

let ymapsP: Promise<Ymaps> | null = null;

export function loadYmaps(): Promise<Ymaps> {
  const w = window as unknown as { ymaps?: Ymaps };
  if (ymapsP) return ymapsP;
  ymapsP = new Promise<Ymaps>((res, rej) => {
    const done = () => w.ymaps.ready(() => res(w.ymaps), (e: unknown) => rej(e));
    if (w.ymaps) return done();
    const s = document.createElement('script');
    s.src = `https://api-maps.yandex.ru/2.1/?lang=ru_RU&apikey=${YANDEX_KEY}`;
    s.async = true;
    s.onload = done;
    s.onerror = () => rej(new Error('Яндекс Карты не загрузились'));
    document.head.appendChild(s);
    setTimeout(() => rej(new Error('Яндекс Карты не отвечают')), 20000);
  });
  ymapsP.catch(() => (ymapsP = null));
  return ymapsP;
}

/** Расстояние по земле, метры */
export function meters(a: [number, number], b: [number, number]) {
  const R = 6371000,
    r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r,
    dLon = (b[1] - a[1]) * r;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Направление (азимут) с точки a на точку b, градусы */
export function bearing(a: [number, number], b: [number, number]) {
  const r = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360;
}

export interface PanoHit {
  pano: YPanorama;
  pos: [number, number];
  dist: number; // м от точки снимка
  name: string; // адрес и дата съёмки панорамы
}

/** Ближайшая наземная панорама к точке (или null — панорам рядом нет) */
export async function nearestPano(lat: number, lon: number): Promise<PanoHit | null> {
  const ym = await loadYmaps();
  const ps: YPanorama[] = await ym.panorama.locate([lat, lon], { layer: 'yandex#panorama' });
  if (!ps?.length) return null;
  const p = ps[0];
  const pos = p.getPosition() as number[];
  const at: [number, number] = [pos[0], pos[1]];
  let name = '';
  try {
    name = p.getName?.() ?? '';
  } catch {
    /* без подписи */
  }
  return { pano: p, pos: at, dist: meters([lat, lon], at), name };
}

export interface GeoHit {
  lat: number;
  lon: number;
  address: string;
  /** exact — дом, street — улица, other — район/город */
  precision: 'exact' | 'street' | 'other';
}

/** Адрес → точка (геокодер Яндекса); рядом с near, если знаем город */
export async function geocode(q: string, near?: { lat: number; lon: number }): Promise<GeoHit | null> {
  const ym = await loadYmaps();
  const opts: Record<string, unknown> = { results: 1 };
  if (near) opts.boundedBy = [
    [near.lat - 0.35, near.lon - 0.55],
    [near.lat + 0.35, near.lon + 0.55],
  ];
  const r = await ym.geocode(q, opts);
  const g = r.geoObjects.get(0);
  if (!g) return null;
  const [lat, lon] = g.geometry.getCoordinates();
  const pr = g.properties.get('metaDataProperty.GeocoderMetaData.precision') as string;
  return { lat, lon, address: g.getAddressLine?.() ?? q, precision: pr === 'exact' || pr === 'number' ? 'exact' : pr === 'street' ? 'street' : 'other' };
}

/** Точка → адрес (подпись места на карточке) */
export async function addressAt(lat: number, lon: number): Promise<string | null> {
  const ym = await loadYmaps();
  const r = await ym.geocode([lat, lon], { results: 1, kind: 'house' });
  const g = r.geoObjects.get(0);
  return g ? (g.getAddressLine?.() as string) ?? null : null;
}
