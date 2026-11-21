import type { DayRecord } from './types';
import { hashString } from './color';

// Подсказки «о чём написать» (как reflection prompts в Apple Journal), но сенсорные:
// они вытаскивают из памяти то, что потом лучше всего читает система — свет, звук, запах, погоду, людей.
export const PROMPTS = [
  'Какой был свет сегодня, утром и вечером?',
  'Какой звук ты запомнил из этого дня?',
  'Чем пахло?',
  'Кто был рядом и что он сказал?',
  'Что было тёплым, а что холодным?',
  'Какая мелочь удивила тебя сегодня?',
  'Где ты был, когда день стал самым настоящим?',
  'Какая погода была внутри, не за окном?',
  'Что ты ел или пил, и с кем?',
  'Что бы ты хотел сохранить из этого дня через год?',
  'Какая песня крутилась в голове?',
  'В какой момент ты замедлился?',
  'Что ты увидел впервые?',
  'Какое слово описало бы этот день целиком?',
  'Что было на небе?',
  'Какой цвет у этого дня?',
];

export const PROMPT_STARTERS = ['Свет был…', 'Пахло…', 'Было слышно…', 'Рядом был(а)…', 'Запомнилось, как…', 'Погода внутри…'];

export function dayPrompt(dateISO: string) {
  return PROMPTS[hashString(dateISO) % PROMPTS.length];
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Серия: сколько дней подряд (до сегодня или вчера включительно) есть записи */
export function streak(days: DayRecord[], today = todayISO()) {
  const set = new Set(days.filter((d) => !d.demo).map((d) => d.date));
  let cur = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cur)) {
    n++;
    cur = addDays(cur, -1);
  }
  return { count: n, today: set.has(today) };
}

/** «В этот день»: год назад, месяц назад, неделю назад — или случайное воспоминание */
export function onThisDay(days: DayRecord[], today = todayISO()): { label: string; day: DayRecord } | null {
  if (!days.length) return null;
  const t = new Date(today + 'T12:00:00');
  const near = (iso: string, target: Date, tol: number) => Math.abs(new Date(iso + 'T12:00:00').getTime() - target.getTime()) <= tol * 86400000;
  for (let y = 1; y <= 10; y++) {
    const target = new Date(t);
    target.setFullYear(t.getFullYear() - y);
    const d = days.find((x) => near(x.date, target, 0));
    if (d) return { label: y === 1 ? 'Год назад' : `${y} лет назад`, day: d };
  }
  const month = new Date(t);
  month.setMonth(t.getMonth() - 1);
  const m = days.find((x) => near(x.date, month, 3));
  if (m) return { label: 'Месяц назад', day: m };
  const week = new Date(t);
  week.setDate(t.getDate() - 7);
  const w = days.find((x) => near(x.date, week, 1));
  if (w) return { label: 'Неделю назад', day: w };
  const past = days.filter((x) => x.date < today);
  if (!past.length) return null;
  return { label: 'Из архива', day: past[hashString(today) % past.length] };
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10,
    m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
