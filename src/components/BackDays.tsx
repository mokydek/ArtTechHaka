import { useEffect, useState } from 'react';
import type { PlaceInfo } from '../lib/types';
import { MOOD_COLORS, MOOD_WORDS, moods, setMood, setWord, words, type Mood } from '../lib/moods';
import { rangeWeather, tempStr } from '../lib/place';
import { moodImg } from './Bunny';
import { play } from '../lib/feel';

/**
 * «Пока тебя не было»: человек вернулся после паузы — никаких «серия сгорела».
 * Пропущенные дни показаны настоящим небом его города (архив погоды),
 * каждый можно отметить одним касанием и, если хочется, одним словом.
 */
type W = NonNullable<PlaceInfo['weather']>;

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dayOf = (iso: string) => new Date(iso + 'T12:00:00');

/** небо дня по коду погоды WMO: сверху небо, снизу свет у горизонта */
export function skyOf(w?: W): string {
  const c = w?.code;
  const g = (a: string, b: string) => `linear-gradient(180deg, ${a}, ${b})`;
  if (c == null) return g('#d9d4e8', '#f4efe6');
  if (c <= 1) return g('#7fb6f0', '#ffe3ad');
  if (c === 2) return g('#a3c1e3', '#f6e4c8');
  if (c === 3) return g('#aeb4bf', '#e2e3e7');
  if (c === 45 || c === 48) return g('#c9cdd1', '#efefef');
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return g('#d6e0ee', '#ffffff');
  if (c >= 95) return g('#59627c', '#a3abc0');
  return g('#8995ab', '#cbd3de'); // морось и дождь
}

export default function BackDays({ days, place, onDone }: { days: string[]; place: PlaceInfo | null; onDone: () => void }) {
  const [wx, setWx] = useState<Record<string, W>>({});
  const [marks, setMarks] = useState<Record<string, Mood>>(() => moods());
  const [said, setSaid] = useState<Record<string, string>>(() => words());
  const [sel, setSel] = useState(days.length - 1);
  useEffect(() => {
    if (!place || !days.length) return;
    let dead = false;
    rangeWeather(place.lat, place.lon, days[0], days[days.length - 1]).then((r) => !dead && setWx(r));
    return () => {
      dead = true;
    };
  }, [place, days]);

  const d = days[sel];
  const pick = (m: Mood) => {
    setMood(d, m);
    play('mood', m);
    setMarks({ ...marks, [d]: m });
  };
  const w = wx[d];
  const dt = dayOf(d);
  return (
    <div className="backdays">
      <p>С возвращением! Пока тебя не было, дни всё равно шли. {place ? 'Вот какое у них было небо:' : 'Вот они:'}</p>
      <div className="back-days" role="listbox" aria-label="Дни, пока тебя не было">
        {days.map((x, i) => {
          const xw = wx[x];
          const m = marks[x];
          return (
            <button key={x} role="option" aria-selected={i === sel} className={'bd' + (i === sel ? ' on' : '')} style={{ background: skyOf(xw) }} onClick={() => setSel(i)}>
              <b>{WD[dayOf(x).getDay()]}</b>
              <span>{dayOf(x).getDate()}</span>
              <small>{xw ? tempStr(xw).split('…').pop() : ''}</small>
              {m && <i className="bd-dot" style={{ background: MOOD_COLORS[m] }} />}
            </button>
          );
        })}
      </div>
      {place?.name && <small className="bd-place">⌖ {place.name}, погода из архива</small>}
      <div className="bd-ask">
        <p className="bd-q">
          <span className="bd-when">
            {dt.getDate()} {MON[dt.getMonth()]}
            {w ? `, ${w.label}, ${tempStr(w)}` : ''}
          </span>
          <span>Каким был этот день?</span>
        </p>
        <div className="bun-moods" role="group" aria-label="Настроение от 1 до 5">
          {([1, 2, 3, 4, 5] as Mood[]).map((m) => (
            <button key={m} className={marks[d] === m ? 'on' : ''} onClick={() => pick(m)} aria-label={`${m}, ${MOOD_WORDS[m]}`} title={MOOD_WORDS[m]}>
              <img className="mood-face" src={moodImg(m)} alt="" width={40} height={40} draggable={false} />
              <small>{m}</small>
            </button>
          ))}
        </div>
        <input
          className="inp bd-word"
          placeholder="одно слово, если хочется"
          maxLength={40}
          value={said[d] ?? ''}
          onChange={(e) => {
            setSaid({ ...said, [d]: e.target.value });
            setWord(d, e.target.value);
          }}
        />
      </div>
      <div className="bun-acts">
        <button className="btn small" onClick={onDone}>
          Готово
        </button>
      </div>
    </div>
  );
}
