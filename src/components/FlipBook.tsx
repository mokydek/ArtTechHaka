import { useCallback, useEffect, useRef, useState } from 'react';
import type { DayRecord, Notebook } from '../lib/types';
import { useDiary } from '../App';
import { useCoverUrl } from './Book';
import { humanDate } from '../lib/render/engine';
import { MODES } from '../lib/design/system';

// Шелест страницы — короткий отфильтрованный шум, без файлов
let ac: AudioContext | null = null;
function rustle() {
  try {
    ac ??= new AudioContext();
    const len = 0.32;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const t = i / d.length;
      d[i] = (Math.random() * 2 - 1) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.6)), 2) * (1 - t);
    }
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.6;
    const g = ac.createGain();
    g.gain.value = 0.22;
    src.connect(bp).connect(g).connect(ac.destination);
    src.start();
  } catch {
    /* без звука */
  }
}

function TextPage({ d }: { d: DayRecord }) {
  const { photos } = useDiary();
  const ph = photos[d.id]?.[0];
  const pal = d.design.palette;
  return (
    <div className="fb-text">
      <div className="pt muted">{humanDate(d.date)}</div>
      <div className="fb-title">{d.title}</div>
      {ph && (
        <div className="fb-polaroid">
          <img src={ph} alt="" />
          <i className="tape" style={{ background: pal.colors[3] + 'aa' }} />
        </div>
      )}
      <p className="fb-hand">{d.text}</p>
      <div className="fb-foot pt">
        <span>♪ {[d.music.artist, d.music.title].filter(Boolean).join(' — ')}</span>
        <span style={{ color: pal.accent }}>{MODES[d.design.mode].name}</span>
      </div>
    </div>
  );
}

export default function FlipBook({ nb, days }: { nb: Notebook; days: DayRecord[] }) {
  const { covers, loadPhotos } = useDiary();
  const cover = useCoverUrl(nb, 700);
  const list = [...days].reverse(); // в книге — от первого дня к последнему
  const n = list.length;
  const [f, setF] = useState(0); // сколько листов перевёрнуто
  const [turning, setTurning] = useState(-1);
  const tm = useRef(0);
  const touch = useRef<number | null>(null);
  useEffect(() => loadPhotos(days), [days, loadPhotos]);

  const go = useCallback(
    (dir: 1 | -1) => {
      const y = Math.max(0, Math.min(n + 1, f + dir));
      if (y === f) return;
      rustle();
      setTurning(dir > 0 ? f : y);
      setF(y);
      clearTimeout(tm.current);
      tm.current = window.setTimeout(() => setTurning(-1), 950);
    },
    [f, n],
  );
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [go]);

  // лист k: лицо = (k==0 ? обложка : картинка дня k-1), оборот = (k<n ? текст дня k : форзац)
  const leaves = Array.from({ length: n + 1 }, (_, k) => k);
  const shift = f === 0 ? -25 : f === n + 1 ? 25 : 0;
  const cur = f >= 1 && f <= n ? list[f - 1] : null;

  return (
    <div className="fb-wrap">
      <div
        className="fb"
        style={{ transform: `translateX(${shift}%)` }}
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          if (dx < -30) go(1);
          if (dx > 30) go(-1);
          touch.current = null;
        }}
      >
        <div className="fb-half left" onClick={() => go(-1)} />
        <div className="fb-half right" onClick={() => go(1)} />
        {leaves.map((k) => {
          const flipped = k < f;
          return (
            <div key={k} className={'fb-leaf' + (flipped ? ' flipped' : '')} style={{ zIndex: k === turning ? 999 : flipped ? k + 1 : n + 2 - k }}>
              <div className="fb-face front">
                {k === 0 ? cover ? <img src={cover} alt={nb.title} /> : <div className="book-ph" /> : covers[list[k - 1].id] ? <img src={covers[list[k - 1].id]} alt={list[k - 1].title} /> : <div className="book-ph" />}
                {k > 0 && <div className="fb-num pt">{k}</div>}
              </div>
              <div className="fb-face back">{k < n ? <TextPage d={list[k]} /> : <div className="fb-end pt">конец тетради · {n} {n === 1 ? 'день' : n < 5 ? 'дня' : 'дней'}</div>}</div>
            </div>
          );
        })}
      </div>
      <div className="fb-nav">
        <button className="btn ghost small" onClick={() => go(-1)} disabled={f === 0}>
          ←
        </button>
        <span className="pt">{f === 0 ? 'обложка' : f === n + 1 ? 'задняя обложка' : `${f} / ${n}`}</span>
        <button className="btn ghost small" onClick={() => go(1)} disabled={f === n + 1}>
          →
        </button>
        {cur && (
          <a className="btn small" href={`#/day/${encodeURIComponent(cur.id)}`}>
            ▶ оживить страницу
          </a>
        )}
      </div>
    </div>
  );
}
