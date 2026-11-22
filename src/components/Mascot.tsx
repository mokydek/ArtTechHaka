import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Bunny, { moodImg, type Pose } from './Bunny';
import { useDiary } from '../App';
import type { DayRecord } from '../lib/types';
import { humanDate } from '../lib/render/engine';
import { MOOD_WORDS, isoAdd, moods, setMood, todayIso, type Mood } from '../lib/moods';
import BackDays from './BackDays';
import { burst, buzz, play } from '../lib/feel';

/**
 * Пуговка — зайчик-компаньон (как питомец в Finch): раз в день спрашивает настроение 1–5,
 * в плохой день показывает самые светлые дни, в хороший — зовёт записать день,
 * иногда спрашивает «А помнишь?..» и подсказывает следующий шаг при записи.
 *
 * Живёт в шапке сайта и не закрывает дневник: разговор открывается отдельным окном,
 * подсказки при записи — короткой репликой под шапкой.
 */
type Talk =
  | { kind: 'ask' }
  | { kind: 'answer'; mood: Mood; i: number }
  | { kind: 'remember'; day: DayRecord }
  | { kind: 'hint'; key: string; text: string }
  | { kind: 'back'; days: string[] }
  | { kind: 'empty' };

const ASKED = 'ottisk:bunny-asked';
const LAST = 'ottisk:last-visit';
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
  // точка на зайчике: «загляни ко мне» — без всплывающих окон поверх дневника
  const [nudge, setNudge] = useState(false);
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

  const dock = useRef<HTMLButtonElement>(null);
  const talkRef = useRef(talk);
  talkRef.current = talk;
  const close = useCallback(() => {
    play('popDown');
    clearTimeout(timer.current);
    const wasWin = !!talkRef.current && talkRef.current.kind !== 'hint';
    setTalk(null);
    rest();
    // фокус возвращается на зайчика в шапке
    if (wasWin) requestAnimationFrame(() => dock.current?.focus({ preventScroll: true }));
  }, [rest]);

  /* вернулся после паузы: «Пока тебя не было» — небо пропущенных дней вместо упрёка.
     ?away=N в адресе — показать, как будто человека не было N дней (для показа) */
  useEffect(() => {
    if (loading || !home || sessionStorage.getItem('ottisk:back-checked')) return;
    sessionStorage.setItem('ottisk:back-checked', '1');
    const prev = localStorage.getItem(LAST);
    localStorage.setItem(LAST, today);
    const away = Number(new URLSearchParams(location.search).get('away') || 0);
    const from = away > 0 ? isoAdd(today, -away - 1) : prev;
    if (!from || from >= today) return;
    const marked = moods();
    const missed: string[] = [];
    for (let d = isoAdd(today, -1); d > from && missed.length < 7; d = isoAdd(d, -1)) {
      if (own.some((r) => r.date === d) || marked[d]) continue;
      missed.unshift(d);
    }
    if (missed.length < 2) return;
    localStorage.setItem(ASKED, today); // вместо обычного вопроса о настроении
    const t = setTimeout(() => {
      setPose('wave');
      setTalk({ kind: 'back', days: missed });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, home]);

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

  /* «А помнишь?..» — раз за визит: зайчик машет и ставит точку, окно — по нажатию */
  useEffect(() => {
    if (loading || !home || !mood || !own.length || sessionStorage.getItem(SEEN)) return;
    const t = setTimeout(() => {
      if (talk) return;
      sessionStorage.setItem(SEEN, '1');
      setNudge(true);
      setPose('wave');
    }, 16000);
    return () => clearTimeout(t);
  }, [loading, home, mood, own.length, talk]);

  /* подсказки со страниц: следующий шаг записи и т.п. */
  const lastHint = useRef('');
  useEffect(() => {
    const on = (e: Event) => {
      const h = (e as CustomEvent<BunnyHint>).detail;
      if (h.key === lastHint.current) return;
      lastHint.current = h.key;
      setPose(h.pose ?? 'point');
      // на телефоне реплика закрыла бы страницу — зайчик только показывает позой
      if (innerWidth < 900) {
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => !talkRef.current && rest(), 4000);
        return;
      }
      setTalk((cur) => (cur && cur.kind !== 'hint' ? cur : { kind: 'hint', key: h.key, text: h.text }));
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setTalk((cur) => (cur?.kind === 'hint' ? null : cur)), 7000);
    };
    addEventListener('ottisk:bunny', on);
    return () => removeEventListener('ottisk:bunny', on);
  }, [rest]);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!talk) rest();
    else if (talk.kind !== 'hint' && !wasOpen.current) play('pop');
    wasOpen.current = !!talk;
  }, [talk, rest]);
  // на действия человека зайчик отвечает позой (если сейчас не разговаривает)
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
  const [squish, setSquish] = useState(0);
  useEffect(() => {
    lastHint.current = '';
    setTalk((cur) => (cur?.kind === 'ask' ? cur : null));
  }, [route]);

  /* окно: Esc закрывает, фокус переходит в окно */
  const win = !!talk && talk.kind !== 'hint';
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!win) return;
    const t = requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', key);
    return () => (cancelAnimationFrame(t), removeEventListener('keydown', key));
  }, [win, close]);

  /* реплика-подсказка висит прямо под зайчиком в шапке */
  const [at, setAt] = useState<{ top: number; right: number; tail: number } | null>(null);
  useLayoutEffect(() => {
    if (talk?.kind !== 'hint') return;
    const place = () => {
      const r = dock.current?.getBoundingClientRect();
      if (!r) return;
      const right = Math.max(10, innerWidth - r.right - 6);
      setAt({ top: r.bottom + 10, right, tail: Math.max(14, innerWidth - right - (r.left + r.width / 2) - 8) });
    };
    place();
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [talk]);

  function remember() {
    setNudge(false);
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
    if (talk && talk.kind !== 'hint') return close();
    if (!mood) {
      setPose('wave');
      return setTalk({ kind: 'ask' });
    }
    if (own.length) return remember();
    setPose('point');
    setTalk({ kind: 'empty' });
  }

  if (['p', 'film', 's', 'join'].includes(route)) return null;

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
  else if (talk?.kind === 'back') {
    // город дневника: место последнего записанного дня
    const city = [...pool].sort((a, b) => b.date.localeCompare(a.date)).find((d) => d.place)?.place ?? null;
    body = (
      <BackDays
        days={talk.days}
        place={city}
        onDone={() => {
          if (moods()[today]) return close();
          setPose('wave');
          setTalk({ kind: 'ask' });
        }}
      />
    );
  } else if (talk?.kind === 'empty')
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

  const still = reduced() ? ' still' : '';
  return (
    <>
      <button
        ref={dock}
        className={'bun-dock' + still + (squish % 2 ? ' sq1' : squish ? ' sq2' : '')}
        onClick={poke}
        aria-label="Зайчик Пуговка, поговорить"
        aria-haspopup="dialog"
        aria-expanded={win}
      >
        <Bunny pose={pose} />
        {(!mood || nudge) && !win && <i className="bun-dot" />}
      </button>
      {win &&
        createPortal(
          <div className={'bun-win' + still} onPointerDown={(e) => e.target === e.currentTarget && close()}>
            <div className="bun-panel" role="dialog" aria-modal="true" aria-label="Зайчик Пуговка" ref={panel} tabIndex={-1}>
              <span className="bun-head">
                <Bunny pose={pose} />
              </span>
              <button className="bun-x" onClick={close} aria-label="Закрыть" data-sfx="none">
                ×
              </button>
              {body}
            </div>
          </div>,
          document.body,
        )}
      {talk?.kind === 'hint' &&
        at &&
        createPortal(
          <div className={'bun-hint' + still} role="status" aria-live="polite" style={{ top: at.top, right: at.right, ['--tail' as string]: at.tail + 'px' }}>
            <p>{talk.text}</p>
            <button className="bun-x" onClick={close} aria-label="Закрыть" data-sfx="none">
              ×
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

/** личико настроения: 1 грустное, 5 сияет (рисунки из ChatGPT) */
function Face({ m }: { m: Mood }) {
  return <img className="mood-face" src={moodImg(m)} alt="" width={40} height={40} draggable={false} />;
}
