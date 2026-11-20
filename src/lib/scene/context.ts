import SunCalc from 'suncalc';
import type { DayRecord, ShotMeta } from '../types';

// Где, когда и куда смотрела камера — из EXIF; небо и погода того часа

export async function readShot(file: Blob): Promise<ShotMeta | null> {
  try {
    const exifr = (await import('exifr')).default;
    const x = await exifr.parse(file, { gps: true, tiff: true, exif: true, reviveValues: false, translateValues: false });
    if (!x) return null;
    const m: ShotMeta = {};
    if (typeof x.latitude === 'number' && typeof x.longitude === 'number' && Math.abs(x.latitude) + Math.abs(x.longitude) > 0.001) {
      m.lat = +x.latitude.toFixed(6);
      m.lon = +x.longitude.toFixed(6);
    }
    const dt: string | undefined = x.DateTimeOriginal ?? x.CreateDate ?? x.DateTime;
    if (typeof dt === 'string') {
      // «2026:11:20 18:42:05» — местное время съёмки
      const mt = dt.match(/(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
      if (mt) m.local = `${mt[1]}-${mt[2]}-${mt[3]}T${mt[4]}:${mt[5]}:${mt[6] ?? '00'}`;
    }
    if (typeof x.OffsetTimeOriginal === 'string') m.offset = x.OffsetTimeOriginal;
    if (typeof x.GPSImgDirection === 'number') m.heading = Math.round(x.GPSImgDirection);
    const f35 = x.FocalLengthIn35mmFormat ?? x.FocalLengthIn35mmFilm;
    if (typeof f35 === 'number' && f35 > 5) m.f35 = f35;
    if (typeof x.GPSAltitude === 'number') m.alt = Math.round(x.GPSAltitude);
    if (x.Make || x.Model) m.camera = [x.Make, x.Model].filter(Boolean).join(' ').trim();
    return Object.keys(m).length ? m : null;
  } catch {
    return null;
  }
}

/** Вертикальный угол обзора (градусы) по эквиваленту 35 мм и ориентации кадра */
export function vfov(meta: ShotMeta | null | undefined, aspect: number) {
  const f = meta?.f35 ?? 26; // типичная основная камера телефона
  // 35-мм кадр 36×24: длинная сторона 36 мм
  const long = 2 * Math.atan(36 / (2 * f));
  const short = 2 * Math.atan(24 / (2 * f));
  const v = aspect >= 1 ? short : long;
  return (v * 180) / Math.PI;
}

export interface HourWeather {
  code: number;
  temp?: number;
  precip: number;
  rain: number;
  snow: number;
  cloud: number; // %
  wind: number; // км/ч
  windDir: number; // откуда дует, градусы
  isDay: boolean;
  utcOffset: number; // секунд
}

/** Погода по часам за день (местное время места): 24 записи */
export async function dayHours(lat: number, lon: number, date: string): Promise<HourWeather[] | null> {
  const vars = 'temperature_2m,precipitation,rain,snowfall,cloud_cover,wind_speed_10m,wind_direction_10m,weather_code,is_day';
  const q = `latitude=${lat}&longitude=${lon}&start_date=${date}&end_date=${date}&hourly=${vars}&timezone=auto`;
  const daysAgo = (Date.now() - new Date(date + 'T12:00:00').getTime()) / 86400000;
  const urls = daysAgo > 80 ? [`https://archive-api.open-meteo.com/v1/archive?${q}`] : [`https://api.open-meteo.com/v1/forecast?${q}`, `https://archive-api.open-meteo.com/v1/archive?${q}`];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const j = await r.json();
      const h = j.hourly;
      if (!h?.time?.length || h.weather_code?.[12] == null) continue;
      return h.time.map((_: string, i: number) => ({
        code: h.weather_code[i] ?? 0,
        temp: h.temperature_2m?.[i] ?? undefined,
        precip: h.precipitation?.[i] ?? 0,
        rain: h.rain?.[i] ?? 0,
        snow: h.snowfall?.[i] ?? 0,
        cloud: h.cloud_cover?.[i] ?? 0,
        wind: h.wind_speed_10m?.[i] ?? 0,
        windDir: h.wind_direction_10m?.[i] ?? 0,
        isDay: !!h.is_day?.[i],
        utcOffset: j.utc_offset_seconds ?? 0,
      }));
    } catch {
      /* следующий источник */
    }
  }
  return null;
}

/** Погода в конкретный час (местное время места) */
export async function hourWeather(lat: number, lon: number, date: string, hour: number): Promise<HourWeather | null> {
  const d = await dayHours(lat, lon, date);
  return d ? d[Math.max(0, Math.min(d.length - 1, hour))] : null;
}

export interface SkyState {
  sunAz: number; // компасный азимут, градусы
  sunAlt: number; // высота, градусы
  moonAz: number;
  moonAlt: number;
  moonFrac: number;
  moonPhase: number; // 0..1
}

/** Солнце и луна в момент UTC для точки */
export function skyAt(utc: Date, lat: number, lon: number): SkyState {
  const s = SunCalc.getPosition(utc, lat, lon);
  const m = SunCalc.getMoonPosition(utc, lat, lon);
  const il = SunCalc.getMoonIllumination(utc);
  const az = (a: number) => (((a * 180) / Math.PI + 180) % 360 + 360) % 360; // suncalc: от юга на запад
  return { sunAz: az(s.azimuth), sunAlt: (s.altitude * 180) / Math.PI, moonAz: az(m.azimuth), moonAlt: (m.altitude * 180) / Math.PI, moonFrac: il.fraction, moonPhase: il.phase };
}

const TIME_HOUR: Record<string, number> = { morning: 9, day: 14, evening: 19, night: 23 };

export interface ShotContext {
  lat: number;
  lon: number;
  place: string;
  local: string; // «2026-11-20T18:40»
  hour: number;
  heading: number; // куда смотрела камера (0 — север)
  source: { place: 'gps' | 'day' | 'default'; time: 'exif' | 'text' | 'default'; heading: 'exif' | 'guess' };
  fovV: number;
}

/** Собрать «момент кадра»: из EXIF, а чего нет — из записи дня */
export function shotContext(rec: DayRecord | null, meta: ShotMeta | null | undefined, aspect: number, fallbackPlace?: { name: string; lat: number; lon: number }): ShotContext {
  let lat = 51.1694,
    lon = 71.4491,
    place = 'Астана',
    ps: ShotContext['source']['place'] = 'default';
  if (meta?.lat != null && meta.lon != null) {
    lat = meta.lat;
    lon = meta.lon;
    place = rec?.place && Math.hypot(rec.place.lat - lat, rec.place.lon - lon) < 0.3 ? rec.place.name : `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    ps = 'gps';
  } else if (rec?.place) {
    ({ lat, lon } = rec.place);
    place = rec.place.name;
    ps = 'day';
  } else if (fallbackPlace) {
    ({ lat, lon, name: place } = fallbackPlace);
    ps = 'day';
  }
  let local: string,
    ts: ShotContext['source']['time'] = 'default';
  if (meta?.local) {
    local = meta.local.slice(0, 16);
    ts = 'exif';
  } else {
    const date = rec?.date ?? new Date().toISOString().slice(0, 10);
    const h = TIME_HOUR[rec?.analysis.text.timeOfDay ?? ''] ?? 15;
    local = `${date}T${String(h).padStart(2, '0')}:00`;
    ts = rec?.analysis.text.timeOfDay ? 'text' : 'default';
  }
  return {
    lat,
    lon,
    place,
    local,
    hour: +local.slice(11, 13),
    heading: meta?.heading ?? 180,
    source: { place: ps, time: ts, heading: meta?.heading != null ? 'exif' : 'guess' },
    fovV: vfov(meta, aspect),
  };
}

/** Местное время места → UTC (по смещению из погоды или EXIF) */
export function toUtc(local: string, offsetSec?: number, exifOffset?: string) {
  let off = offsetSec;
  if (off == null && exifOffset) {
    const m = exifOffset.match(/([+-])(\d{2}):?(\d{2})/);
    if (m) off = (m[1] === '-' ? -1 : 1) * (+m[2] * 3600 + +m[3] * 60);
  }
  const base = Date.parse(local + ':00Z');
  return new Date(base - (off ?? 5 * 3600) * 1000);
}
