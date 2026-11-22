import type { DayRecord } from './types';
import { hashString } from './color';

// Вопросы дня, как в бумажном личном дневнике: отвечаешь на один, остальное пишется само
export const PROMPTS = [
  'Как прошёл день?',
  'Что сегодня порадовало?',
  'О чём ты думаешь прямо сейчас?',
  'Что хочется запомнить из этого дня?',
  'Кто был рядом сегодня?',
  'Что было самым сложным?',
  'За что ты благодарен сегодня?',
  'Что нового ты попробовал?',
  'Что бы ты сказал себе утром?',
  'Какой момент хочется прожить ещё раз?',
  'Что тебя удивило?',
  'Чего ты ждёшь завтра?',
];

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
