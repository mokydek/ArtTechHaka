import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { play } from '../lib/feel';

/**
 * Интро сайта по эскизу Raspberry: раскрытый дневник крупным планом, страницы быстро
 * пролистываются, камера отъезжает, дневник закрывается — и мы видим закрытый чёрный
 * дневник рядом с «Твой личный цифровой дневник» и кнопкой «Начать».
 * «Начать» раскрывает дневник, страницы летят, камера ныряет в страницу — и открывается главная.
 */
type Phase = 'flip' | 'pull' | 'rest' | 'open';
const LEAVES = 9;

const LINES = [
  ['12 июня', 'Утро у моря, ветер и кофе.', 'Смеялись до слёз.', 'Хочу запомнить этот свет.'],
  ['3 марта', 'Первый тёплый день.', 'Шли пешком через весь город.', 'Купила новую тетрадь.'],
  ['28 октября', 'Дождь весь день.', 'Чай, плед и любимая песня.', 'Тихо и хорошо.'],
];
const PHOTOS = ['sunset', 'sea', 'forest', 'city', 'field', 'rose'];

function Page({ n }: { n: number }) {
  const kind = n % 5;
  const ph = (k: number) => `in-ph in-ph-${PHOTOS[(n + k) % PHOTOS.length]}`;
  const lines = LINES[n % LINES.length];
  if (kind === 0)
    return (
      <div className="in-pg in-pg-lines">
        <b>{lines[0]}</b>
        {lines.slice(1).map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
    );
  if (kind === 1)
    return (
      <div className="in-pg">
        <div className="in-pola" style={{ left: '9%', top: '8%', rotate: '-6deg' }}>
          <i className={ph(0)} />
          <small>{lines[0]}</small>
        </div>
        <div className="in-pola" style={{ right: '8%', top: '44%', rotate: '5deg' }}>
          <i className={ph(2)} />
          <small>{lines[2].replace('.', '')}</small>
        </div>
        <u className="in-tape" style={{ left: '18%', top: '6%' }} />
        <u className="in-tape" style={{ right: '16%', top: '42%', rotate: '12deg' }} />
      </div>
    );
  if (kind === 2)
    return (
      <div className="in-pg in-pg-lines">
        <svg className="in-heart" viewBox="0 0 40 36" aria-hidden>
          <path d="M20 33C6 23 2 16 3 10c1-5 6-8 10-7 3 1 6 3 7 6 1-3 4-5 7-6 4-1 9 2 10 7 1 6-3 13-17 23z" />
        </svg>
        <span>{lines[1]}</span>
        <span>{lines[3]}</span>
      </div>
    );
  if (kind === 3)
    return (
      <div className="in-pg in-grid">
        <i className={ph(1)} />
        <i className={ph(3)} />
        <i className={ph(4)} />
        <i className={ph(5)} />
      </div>
    );
  return (
    <div className="in-pg">
      <div className="in-pola in-pola-big" style={{ left: '14%', top: '10%', rotate: '3deg' }}>
        <i className={ph(4)} />
        <small>{lines[1].replace('.', '')}</small>
      </div>
      <u className="in-tape" style={{ left: '40%', top: '7%', rotate: '-4deg' }} />
      <svg className="in-star" viewBox="0 0 24 24" aria-hidden>
        <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.2l7.1-.6z" />
      </svg>
    </div>
  );
}

export default function Intro({ onDone }: { onDone: () => void }) {
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [phase, setPhase] = useState<Phase>(reduce ? 'rest' : 'flip');
  const timers = useRef<number[]>([]);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    try {
      sessionStorage.setItem('imprint:intro', '1');
    } catch {
      /* приватный режим */
    }
    onDone();
  };

  useEffect(() => {
    const later = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    if (phase === 'flip') {
      later(150, () => play('page'));
      later(700, () => play('page'));
      later(1250, () => play('page'));
      later(1750, () => setPhase('pull'));
    } else if (phase === 'pull') later(1550, () => setPhase('rest'));
    else if (phase === 'open') {
      later(120, () => play('page'));
      later(650, () => play('page'));
      later(1950, finish);
    }
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    document.documentElement.classList.add('in-lock');
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish();
    };
    addEventListener('keydown', key);
    return () => {
      document.documentElement.classList.remove('in-lock');
      removeEventListener('keydown', key);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    if (phase !== 'rest') return;
    play('press');
    if (reduce) return finish();
    setPhase('open');
  };

  return (
    <div className={`intro ph-${phase}`} onClick={() => (phase === 'flip' || phase === 'pull') && setPhase('rest')} role="dialog" aria-label="Imprint">
      <div className="in-cam">
        <div className="in-book">
          <div className="in-back" />
          <div className="in-face in-last">
            <Page n={5} />
          </div>
          {Array.from({ length: LEAVES }, (_, i) => (
            <div className="in-leaf" key={i} style={{ '--i': i, '--j': LEAVES - 1 - i, '--z': `${(LEAVES - i) * 0.6}px` } as CSSProperties}>
              <div className="in-face in-front">
                <Page n={i * 2} />
              </div>
              <div className="in-face in-backface">
                <Page n={i * 2 + 1} />
              </div>
            </div>
          ))}
          <div className="in-cover">
            <div className="in-face in-cover-front">
              <span className="in-band" />
              <div className="in-label">
                <b>Imprint</b>
                <small>личный дневник</small>
              </div>
            </div>
            <div className="in-face in-cover-back" />
          </div>
          <span className="in-ribbon" />
          <div className="in-doodles" aria-hidden>
            <svg className="in-d in-d1" viewBox="0 0 40 36">
              <path d="M20 33C6 23 2 16 3 10c1-5 6-8 10-7 3 1 6 3 7 6 1-3 4-5 7-6 4-1 9 2 10 7 1 6-3 13-17 23z" />
            </svg>
            <svg className="in-d in-d2" viewBox="0 0 24 24">
              <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.8-6.2 3.8 1.6-7L2 9.2l7.1-.6z" />
            </svg>
            <svg className="in-d in-d3" viewBox="0 0 40 40">
              <g>
                <circle cx="20" cy="9" r="7.5" />
                <circle cx="31" cy="20" r="7.5" />
                <circle cx="20" cy="31" r="7.5" />
                <circle cx="9" cy="20" r="7.5" />
              </g>
              <circle className="in-d-mid" cx="20" cy="20" r="6" />
            </svg>
          </div>
        </div>
      </div>
      <div className="in-copy">
        <h1>Твой личный цифровой дневник</h1>
        <p>Фото, слова и песня дня на одной странице.</p>
        <button className="btn in-go" onClick={start}>
          Начать
        </button>
      </div>
    </div>
  );
}
