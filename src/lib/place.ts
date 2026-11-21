import type { PlaceInfo, Weather } from './types';

// Место и погода дня: Open-Meteo (геокодинг + архив погоды), без ключей, CORS открыт

export interface PlaceHit {
  name: string;
  country?: string;
  admin?: string;
  lat: number;
  lon: number;
}

export async function searchPlaces(q: string): Promise<PlaceHit[]> {
  const s = q.trim();
  if (s.length < 2) return [];
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(s)}&count=6&language=ru&format=json`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results ?? []).map((x: { name: string; country?: string; admin1?: string; latitude: number; longitude: number }) => ({ name: x.name, country: x.country, admin: x.admin1, lat: x.latitude, lon: x.longitude }));
}

/** Название места по координатам */
export async function nameAt(lat: number, lon: number): Promise<PlaceHit> {
  let name = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  let country: string | undefined;
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ru`);
    const j = await r.json();
    name = j.city || j.locality || j.principalSubdivision || name;
    country = j.countryName;
  } catch {
    /* остаются координаты */
  }
  return { name, country, lat, lon };
}

/** «Я здесь»: геолокация браузера + название места */
export async function hereNow(): Promise<PlaceHit> {
  const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 }));
  return nameAt(pos.coords.latitude, pos.coords.longitude);
}

// WMO weather codes → подпись и «погода» системы
const WMO: [number[], string, Weather[]][] = [
  [[0], 'ясно', ['sun']],
  [[1], 'почти ясно', ['sun']],
  [[2], 'переменная облачность', ['clouds']],
  [[3], 'пасмурно', ['clouds']],
  [[45, 48], 'туман', ['fog']],
  [[51, 53, 55, 56, 57], 'морось', ['rain']],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'дождь', ['rain']],
  [[71, 73, 75, 77, 85, 86], 'снег', ['snow']],
  [[95, 96, 99], 'гроза', ['storm', 'rain']],
];

export function wmo(code: number): { label: string; tags: Weather[] } {
  const row = WMO.find((w) => w[0].includes(code));
  return row ? { label: row[1], tags: row[2] } : { label: '·', tags: [] };
}

export function weatherTags(p: PlaceInfo): Weather[] {
  const w = p.weather;
  if (!w) return [];
  let tags = [...wmo(w.code).tags];
  // морось почти без осадков — это пасмурно, а не дождь
  if (w.code >= 51 && w.code <= 57 && w.precip != null && w.precip < 1) tags = ['clouds'];
  if (w.tmax != null && w.tmax <= 2) tags.push('cold');
  if (w.tmax != null && w.tmax >= 29) tags.push('hot');
  if (w.wind != null && w.wind >= 30) tags.push('wind');
  return [...new Set(tags)];
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Погода в месте за конкретный день (прошлое — архив, недавнее — прогнозная модель) */
export async function dayWeather(lat: number, lon: number, date: string): Promise<PlaceInfo['weather'] | undefined> {
  const daysAgo = (Date.now() - new Date(date + 'T12:00:00').getTime()) / 86400000;
  const daily = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunrise,sunset,daylight_duration';
  const q = `latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&daily=${daily}&timezone=auto`;
  const urls = daysAgo > 80 ? [`https://archive-api.open-meteo.com/v1/archive?${q}`] : [`https://api.open-meteo.com/v1/forecast?${q}`, `https://archive-api.open-meteo.com/v1/archive?${q}`];
  if (daysAgo < -15) return undefined;
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const j = await r.json();
      const d = j.daily;
      if (!d?.weather_code?.length || d.weather_code[0] == null) continue;
      const code = d.weather_code[0];
      return {
        code,
        label: wmo(code).label,
        tmax: d.temperature_2m_max?.[0] ?? undefined,
        tmin: d.temperature_2m_min?.[0] ?? undefined,
        precip: d.precipitation_sum?.[0] ?? undefined,
        wind: d.wind_speed_10m_max?.[0] ?? undefined,
        sunrise: d.sunrise?.[0]?.slice(11, 16) || undefined,
        sunset: d.sunset?.[0]?.slice(11, 16) || undefined,
        daylight: d.daylight_duration?.[0] ?? undefined,
      };
    } catch {
      /* следующий источник */
    }
  }
  return undefined;
}

export const today = () => iso(new Date());

export function tempStr(w?: PlaceInfo['weather']) {
  if (!w || w.tmax == null) return '';
  const f = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x))}°`;
  return w.tmin != null && Math.round(w.tmin) !== Math.round(w.tmax) ? `${f(w.tmin)}…${f(w.tmax)}` : f(w.tmax);
}

export function placeLine(p?: PlaceInfo) {
  if (!p) return '';
  return [p.name, p.weather ? `${tempStr(p.weather)} ${p.weather.label}`.trim() : ''].filter(Boolean).join(' · ');
}
