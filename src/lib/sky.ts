// Небо того дня: фаза луны (астрономически, без сети) + восход/закат из данных о месте

const SYNODIC = 29.530588853;
const NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14); // опорное новолуние

export interface Moon {
  age: number; // дней от новолуния
  illum: number; // 0..1 освещённая доля
  waxing: boolean;
  name: string;
}

export function moonPhase(dateISO: string, hour = 21): Moon {
  const t = Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10), hour - 5); // вечер по Астане
  let age = ((t - NEW_MOON_2000) / 86400000) % SYNODIC;
  if (age < 0) age += SYNODIC;
  const illum = (1 - Math.cos((2 * Math.PI * age) / SYNODIC)) / 2;
  const waxing = age < SYNODIC / 2;
  const f = age / SYNODIC;
  const name =
    f < 0.034 || f > 0.966
      ? 'новолуние'
      : f < 0.216
        ? 'растущий серп'
        : f < 0.284
          ? 'первая четверть'
          : f < 0.466
            ? 'растущая луна'
            : f < 0.534
              ? 'полнолуние'
              : f < 0.716
                ? 'убывающая луна'
                : f < 0.784
                  ? 'последняя четверть'
                  : 'убывающий серп';
  return { age, illum, waxing, name };
}

/** Луна в нужной фазе: светлая часть + терминатор (эллипс) */
export function drawMoon(g: CanvasRenderingContext2D, x: number, y: number, r: number, m: Pick<Moon, 'illum' | 'waxing'>, light: string, dark: string) {
  g.save();
  g.translate(x, y);
  g.fillStyle = dark;
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = light;
  // освещённый край: справа у растущей, слева у убывающей
  const side = m.waxing ? 1 : -1;
  const k = 1 - 2 * m.illum; // ширина терминатора: 1 = новолуние, -1 = полнолуние
  g.beginPath();
  g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, side < 0);
  g.ellipse(0, 0, Math.max(0.001, Math.abs(k) * r), r, 0, Math.PI / 2, -Math.PI / 2, m.waxing ? k > 0 : k <= 0);
  g.fill();
  g.restore();
}

export function daylightStr(sec?: number) {
  if (sec == null) return '';
  const h = Math.floor(sec / 3600),
    m = Math.round((sec % 3600) / 60);
  return `${h} ч ${m} мин`;
}

/** «Золотой час» — примерно за 45 минут до заката */
export function goldenHour(sunset?: string) {
  if (!sunset) return '';
  const [h, m] = sunset.split(':').map(Number);
  const t = h * 60 + m - 45;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
