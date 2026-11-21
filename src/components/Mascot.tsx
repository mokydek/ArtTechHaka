import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Bunny, { moodImg, type Pose } from './Bunny';
import { useDiary } from '../App';
import type { DayRecord } from '../lib/types';
import { humanDate } from '../lib/render/engine';
import { MOOD_WORDS, moods, setMood, todayIso, type Mood } from '../lib/moods';
import { burst, buzz, play } from '../lib/feel';

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
    play('popDown');
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
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!talk) rest();
    else if (talk.kind !== 'hint' && !wasOpen.current) play('pop');
    wasOpen.current = !!talk;
  }, [talk, rest]);
  // на действия человека зайчик отвечает позой (если сейчас не разговаривает)
  const talkRef = useRef(talk);
  talkRef.current = talk;
  useEffect(() => {
    let t = 0;
    const on = (e: Event) => {
      const { pose, ms } = (e as CustomEvent<{ pose: Pose; ms: number }>).detail;
      if (talkRef.current && talkRef.current.kind !== 'hint') return;
      setPose(pose);
      clearTimeout(t);
      t = window.setTimeout(() => !talkRef.current && rest(), ms);
    };
    addEventListener('ottisk:bunny-react', on);
    return () => (removeEventListener('ottisk:bunny-react', on), clearTimeout(t));
  }, [rest]);
  // глаза следят за курсором
  const me = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced()) return;
    let raf = 0;
    const mv = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = me.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2),
          dy = e.clientY - (r.top + r.height * 0.42);
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 260);
        el.style.setProperty('--ex', ((dx / d) * 4.2 * k).toFixed(2));
        el.style.setProperty('--ey', ((dy / d) * 3.2 * k).toFixed(2));
      });
    };
    addEventListener('pointermove', mv, { passive: true });
    return () => removeEventListener('pointermove', mv);
  }, []);
  const [squish, setSquish] = useState(0);
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

  function pick(m: Mood, el?: HTMLElement) {
    setMood(today, m);
    setM(m);
    play('mood', m);
    buzz(m >= 4 ? 18 : 10);
    const r = el?.getBoundingClientRect();
    if (r) burst(r.left + r.width / 2, r.top + r.height / 2, m >= 4 ? 'hearts' : m === 3 ? 'sparks' : 'drops', m >= 4 ? 10 : 6);
    setPose(m <= 2 ? 'sad' : m === 3 ? 'think' : 'happy');
    setTalk({ kind: 'answer', mood: m, i: 0 });
  }

  function poke() {
    play('boing');
    buzz(8);
    setSquish((x) => x + 1);
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
            <button key={m} onClick={(e) => pick(m, e.currentTarget)} aria-label={`${m}, ${MOOD_WORDS[m]}`} title={MOOD_WORDS[m]}>
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
    <div className={'bun' + (talk ? ' open' : '') + (reduced() ? ' still' : '')} ref={me}>
      {talk && (
        <div className={'bun-say' + (talk.kind === 'hint' ? ' hint' : '')} role="dialog" aria-live="polite" aria-label="Зайчик Пуговка">
          <button className="bun-x" onClick={close} aria-label="Закрыть" data-sfx="none">
            ×
          </button>
          {body}
        </div>
      )}
      <button className={'bun-me' + (squish % 2 ? ' sq1' : squish ? ' sq2' : '')} onClick={poke} aria-label="Зайчик Пуговка, поговорить">
        <Bunny pose={pose} size={84} />
        {!mood && !talk && <i className="bun-dot" />}
      </button>
    </div>
  );
}

/** личико настроения: 1 грустное, 5 сияет (рисунки из ChatGPT) */
function Face({ m }: { m: Mood }) {
  return <img className="mood-face" src={moodImg(m)} alt="" width={40} height={40} draggable={false} />;
}
