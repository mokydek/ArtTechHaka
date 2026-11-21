import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Bunny, { type Pose } from './Bunny';
import { useDiary } from '../App';
import type { DayRecord } from '../lib/types';
import { humanDate } from '../lib/render/engine';
import { MOOD_COLORS, MOOD_WORDS, moods, setMood, todayIso, type Mood } from '../lib/moods';

/**
 * Пуговка — зайчик-компаньон (как питомец в Finch): раз в день спрашивает настроение 1–5,
 * в плохой день показывает самые светлые дни, в хороший — зовёт записать день,
 * иногда спрашивает «А помнишь?..» и подсказывает следующий шаг при записи.
 */
type Talk =
  | { kind: 'ask' }
  | { kind: 'answer'; mood: Mood; i: number }
  | { kind: 'remember'; day: DayRecord }
  | { kind: 'hint'; key: string; text: string }
  | { kind: 'empty' };

const ASKED = 'ottisk:bunny-asked';
const SEEN = 'ottisk:bunny-remember';
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface BunnyHint {
  key: string;
  text: string;
  pose?: Pose;
}
/** подсказка зайчика с любой страницы */
export function bunnySay(h: BunnyHint) {
  dispatchEvent(new CustomEvent<BunnyHint>('ottisk:bunny', { detail: h }));
}

export default function Mascot({ route }: { route: string }) {
  const { days, covers, loading } = useDiary();
  const today = todayIso();
  const [talk, setTalk] = useState<Talk | null>(null);
  const [pose, setPose] = useState<Pose>('idle');
  const [mood, setM] = useState<Mood | undefined>(() => moods()[today]);
  const timer = useRef<number>(0);
  const home = route === '' || route === 'shelf';

  const own = useMemo(() => days.filter((d) => !d.demo), [days]);
  const pool = own.length ? own : days;
  const bright = useMemo(
    () => [...pool].sort((a, b) => b.design.mood.valence + b.design.mood.energy * 0.3 - (a.design.mood.valence + a.design.mood.energy * 0.3)).slice(0, 5),
    [pool],
  );

  const night = () => {
    const h = new Date().getHours();
    return h >= 23 || h < 6;
  };
  const rest = useCallback(() => setPose(night() ? 'sleep' : 'idle'), []);
  useEffect(rest, [rest]);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    setTalk(null);
    rest();
  }, [rest]);

  /* раз в день сам спрашивает, как ты — на главной, когда дневник загрузился */
  useEffect(() => {
    if (loading || !home || mood || localStorage.getItem(ASKED) === today) return;
    const t = setTimeout(() => {
      localStorage.setItem(ASKED, today);
      setPose('wave');
      setTalk({ kind: 'ask' });
    }, 1400);
    return () => clearTimeout(t);
  }, [loading, home, mood, today]);

  /* «А помнишь?..» — раз за визит, если настроение уже известно */
  useEffect(() => {
    if (loading || !home || !mood || !own.length || sessionStorage.getItem(SEEN)) return;
    const t = setTimeout(() => {
      if (talk) return;
      sessionStorage.setItem(SEEN, '1');
      remember();
    }, 16000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, home, mood, own.length, talk]);

  /* подсказки со страниц: следующий шаг записи и т.п. */
  const lastHint = useRef('');
  useEffect(() => {
    const on = (e: Event) => {
      const h = (e as CustomEvent<BunnyHint>).detail;
      if (h.key === lastHint.current) return;
      lastHint.current = h.key;
      setTalk((cur) => (cur && cur.kind !== 'hint' ? cur : { kind: 'hint', key: h.key, text: h.text }));
      setPose(h.pose ?? 'point');
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setTalk((cur) => (cur?.kind === 'hint' ? null : cur)), 7000);
    };
    addEventListener('ottisk:bunny', on);
    return () => removeEventListener('ottisk:bunny', on);
  }, []);
  useEffect(() => {
    if (!talk) rest();
  }, [talk, rest]);
  useEffect(() => {
    lastHint.current = '';
    setTalk((cur) => (cur?.kind === 'ask' ? cur : null));
  }, [route]);

  function remember() {
    const older = own.filter((d) => d.date < today);
    const list = older.length ? older : own;
    if (!list.length) return setTalk({ kind: 'empty' });
    // чаще вспоминаются светлые дни
    const w = list.map((d) => 1.2 + d.design.mood.valence);
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    const day = list.find((_, i) => (r -= w[i]) <= 0) ?? list[0];
    setPose('think');
    setTalk({ kind: 'remember', day });
  }

  function pick(m: Mood) {
    setMood(today, m);
    setM(m);
    setPose(m <= 2 ? 'sad' : m === 3 ? 'think' : 'happy');
    setTalk({ kind: 'answer', mood: m, i: 0 });
  }

  function poke() {
    if (talk) return close();
    if (!mood) {
      setPose('wave');
      return setTalk({ kind: 'ask' });
    }
    if (own.length) return remember();
    setPose('point');
    setTalk({ kind: 'empty' });
  }

  if (['there', 'p', 'film'].includes(route)) return null;

  const card = (d: DayRecord) => (
    <a className="bun-card" href={`#/day/${encodeURIComponent(d.id)}`} onClick={close}>
      {covers[d.id] ? <img src={covers[d.id]} alt="" /> : <span className="bun-ph" style={{ background: `linear-gradient(135deg, ${d.design.palette.colors[1]}, ${d.design.palette.colors[3]})` }} />}
      <span>
        <b>{d.title}</b>
        <small>{humanDate(d.date)}</small>
      </span>
    </a>
  );

  let body: React.ReactNode = null;
  if (talk?.kind === 'ask')
    body = (
      <>
        <p>Привет! Какое у тебя сегодня настроение?</p>
        <div className="bun-moods" role="group" aria-label="Настроение от 1 до 5">
          {([1, 2, 3, 4, 5] as Mood[]).map((m) => (
            <button key={m} onClick={() => pick(m)} aria-label={`${m}, ${MOOD_WORDS[m]}`} title={MOOD_WORDS[m]}>
              <Face m={m} />
              <small>{m}</small>
            </button>
          ))}
        </div>
      </>
    );
  else if (talk?.kind === 'answer') {
    const m = talk.mood;
    const show = bright[talk.i % Math.max(1, bright.length)];
    body =
      m <= 2 ? (
        <>
          <p>{bright.length ? 'Обнимаю. Смотри, какой светлый день у тебя был:' : 'Обнимаю. Я рядом. Запиши даже маленькую хорошую вещь, я потом тебе её напомню.'}</p>
          {show && card(show)}
          <div className="bun-acts">
            {bright.length > 1 && (
              <button className="btn small" onClick={() => setTalk({ ...talk, i: talk.i + 1 })}>
                Ещё хороший момент
              </button>
            )}
            <a className="btn ghost small" href="#/new" onClick={close}>
              Записать день
            </a>
          </div>
        </>
      ) : m === 3 ? (
        <>
          <p>Обычный день тоже стоит запомнить. Расскажешь в двух словах?</p>
          <div className="bun-acts">
            <a className="btn small" href="#/new" onClick={close}>
              Записать день
            </a>
            {!!own.length && (
              <button className="btn ghost small" onClick={remember}>
                Покажи хорошее
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p>Ура! Такой день стоит сохранить, пока он тёплый.</p>
          <div className="bun-acts">
            <a className="btn small" href="#/new" onClick={close}>
              Записать день
            </a>
            {!!own.length && (
              <button className="btn ghost small" onClick={remember}>
                А помнишь…
              </button>
            )}
          </div>
        </>
      );
  } else if (talk?.kind === 'remember')
    body = (
      <>
        <p>А помнишь тот момент?</p>
        {card(talk.day)}
        <div className="bun-acts">
          <button className="btn ghost small" onClick={remember}>
            Другой
          </button>
        </div>
      </>
    );
  else if (talk?.kind === 'empty')
    body = (
      <>
        <p>Здесь пока пусто. Запиши первый день, и я буду напоминать тебе о хорошем.</p>
        <div className="bun-acts">
          <a className="btn small" href="#/new" onClick={close}>
            Записать день
          </a>
        </div>
      </>
    );
  else if (talk?.kind === 'hint') body = <p>{talk.text}</p>;

  return (
    <div className={'bun' + (talk ? ' open' : '') + (reduced() ? ' still' : '')}>
      {talk && (
        <div className={'bun-say' + (talk.kind === 'hint' ? ' hint' : '')} role="dialog" aria-live="polite" aria-label="Зайчик Пуговка">
          <button className="bun-x" onClick={close} aria-label="Закрыть">
            ×
          </button>
          {body}
        </div>
      )}
      <button className="bun-me" onClick={poke} aria-label="Зайчик Пуговка, поговорить">
        <Bunny pose={pose} size={84} />
        {!mood && !talk && <i className="bun-dot" />}
      </button>
    </div>
  );
}

/** личико настроения: 1 — грустное, 5 — сияет */
function Face({ m }: { m: Mood }) {
  const mouth = ['M9 19 Q14 14.5 19 19', 'M9.5 18.5 Q14 16 18.5 18.5', 'M9.5 17.5 H18.5', 'M9 16.5 Q14 20.5 19 16.5', 'M8.5 15.5 Q14 23 19.5 15.5 Z'][m - 1];
  return (
    <svg viewBox="0 0 28 28" width="34" height="34" aria-hidden>
      <circle cx="14" cy="14" r="12.5" fill={MOOD_COLORS[m]} stroke="#4f3f99" strokeWidth="1.6" />
      {m === 5 ? (
        <>
          <path d="M8.5 11.5 Q10.5 9 12.5 11.5 M15.5 11.5 Q17.5 9 19.5 11.5" fill="none" stroke="#2b211c" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="10.3" cy="11.3" r="1.5" fill="#2b211c" />
          <circle cx="17.7" cy="11.3" r="1.5" fill="#2b211c" />
        </>
      )}
      <path d={mouth} fill={m === 5 ? '#fff' : 'none'} stroke="#2b211c" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
