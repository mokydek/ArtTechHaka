/** Настроение дня по шкале 1–5 (быстрый «чек-ин» у зайчика). Хранится на устройстве. */
export type Mood = 1 | 2 | 3 | 4 | 5;

const KEY = 'ottisk:moods';

export const MOOD_WORDS: Record<Mood, string> = {
  1: 'совсем плохо',
  2: 'так себе',
  3: 'нормально',
  4: 'хорошо',
  5: 'отлично',
};
/** цвет клетки «Года в пикселях»: от пасмурного к солнечному */
export const MOOD_COLORS: Record<Mood, string> = {
  1: '#6b7896',
  2: '#a3b2c9',
  3: '#d8cbab',
  4: '#efbd5c',
  5: '#e9845a',
};

export function moods(): Record<string, Mood> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

export function setMood(date: string, m: Mood) {
  const all = moods();
  all[date] = m;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* хранилище недоступно — настроение живёт до перезагрузки */
  }
  dispatchEvent(new CustomEvent('ottisk:mood', { detail: { date, m } }));
}

/** настроение записанного дня (-1..1) → шкала 1–5 */
export function valenceMood(v: number): Mood {
  return v < -0.45 ? 1 : v < -0.12 ? 2 : v < 0.15 ? 3 : v < 0.45 ? 4 : 5;
}

export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
