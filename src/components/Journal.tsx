import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DayRecord, Notebook } from '../lib/types';
import { useDiary } from '../App';
import { useCoverUrl } from './Book';
import { MOOD_COLORS, moods, valenceMood } from '../lib/moods';

/**
 * Дневник как настоящая тетрадь (по мотивам Paper): открывается, листается пальцем или стрелками,
 * на развороте дня слева вклеены фото, справа мысли от руки и песня-билетик.
 */

let ac: AudioContext | null = null;
function rustle() {
  try {
    ac ??= new AudioContext();
    const len = 0.34;
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
    bp.frequency.value = 2600;
    bp.Q.value = 0.5;
    const g = ac.createGain();
    g.gain.value = 0.18;
    src.connect(bp).connect(g).connect(ac.destination);
    src.start();
  } catch {
    /* без звука */
  }
}

const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const dateWords = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return { day: d, month: MON[m - 1], year: y, wd: WD[new Date(y, m - 1, d).getDay()] };
};
/** детерминированный «случай» из id дня: наклоны и скотч не прыгают между открытиями */
function seeded(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/* ——— страницы ——— */

export function PhotoPage({ d, photos }: { d: DayRecord; photos: string[] }) {
  const r = seeded(d.id);
  const list = photos.slice(0, 4);
  const lay = d.layout?.kind ?? (list.length <= 2 ? 'polaroid' : 'collage');
  const tapes = d.design.palette.colors;
  if (!list.length)
    return (
      <div className="jp jp-photos">
        <div className="jp-nophoto" style={{ background: `linear-gradient(160deg, ${tapes[1]}, ${tapes[3]})` }} />
      </div>
    );
  if (lay === 'free' && d.layout?.items?.length)
    return (
      <div className="jp jp-photos">
        {d.layout.items.slice(0, photos.length).map((it, i) => (
          <figure key={i} className="jp-free" style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, width: `${it.w * 100}%`, transform: `translate(-50%, -50%) rotate(${it.rot}deg)`, zIndex: i + 1 }}>
            <img src={photos[i]} alt="" draggable={false} />
            <i className="jp-tape" style={{ background: tapes[(i + 2) % 5] + 'b0' }} />
          </figure>
        ))}
      </div>
    );
  if (lay === 'collage')
    return (
      <div className="jp jp-photos">
        <div className={'jp-collage n' + list.length} style={{ transform: `rotate(${(r() - 0.5) * 2.4}deg)` }}>
          {list.map((u, i) => (
            <img key={i} src={u} alt="" draggable={false} />
          ))}
          <i className="jp-tape" style={{ background: tapes[3] + 'b0', left: '8%', top: '-12px', transform: 'rotate(-6deg)' }} />
          <i className="jp-tape" style={{ background: tapes[2] + 'b0', right: '6%', bottom: '-12px', left: 'auto', top: 'auto', transform: 'rotate(4deg)' }} />
        </div>
        {photos.length > 4 && <span className="jp-more">+{photos.length - 4}</span>}
      </div>
    );
  // полароиды: один — крупно, два — внахлёст
  return (
    <div className="jp jp-photos">
      {list.map((u, i) => {
        const one = list.length === 1;
        const rot = (r() - 0.5) * (one ? 5 : 9);
        const style = one ? { left: '50%', top: '47%', width: '74%' } : i === 0 ? { left: '40%', top: '33%', width: '62%' } : { left: '60%', top: '66%', width: '62%' };
        return (
          <figure key={i} className="jp-pola" style={{ ...style, transform: `translate(-50%, -50%) rotate(${rot}deg)`, zIndex: i + 1 }}>
            <img src={u} alt="" draggable={false} />
            <i className="jp-tape" style={{ background: tapes[(i + 3) % 5] + 'b0', transform: `rotate(${(r() - 0.5) * 14}deg)` }} />
          </figure>
        );
      })}
    </div>
  );
}

function TextPage({ d }: { d: DayRecord }) {
  const w = dateWords(d.date);
  const m = moods()[d.date] ?? valenceMood(d.design.mood.valence);
  const song = [d.music.artist, d.music.title].filter(Boolean).join(' · ');
  return (
    <div className="jp jp-text">
      <div className="jp-head">
        <span className="jp-date">
          <b>{w.day}</b> {w.month}
          <small>{w.wd}</small>
        </span>
        <i className="jp-mood" style={{ background: MOOD_COLORS[m] }} title="настроение дня" />
      </div>
      <h3 className="jp-title">{d.title}</h3>
      {d.text ? <p className="jp-hand">{d.text}</p> : d.hasVoice ? <p className="jp-hand jp-voice">♪ голосовое воспоминание</p> : null}
      <div className="jp-foot">
        {song && (
          <span className="jp-ticket">
            <i>♪</i>
            <span>{song}</span>
          </span>
        )}
        <a className="btn small jp-play" href={`#/day/${encodeURIComponent(d.id)}`}>
          ▶ Воспроизвести
        </a>
      </div>
    </div>
  );
}

function TitlePage({ nb, count }: { nb: Notebook; count: number }) {
  return (
    <div className="jp jp-titlepage">
      <div className="jp-label">
        <span>{nb.title}</span>
      </div>
      <p className="jp-count">{count ? `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'день' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'дня' : 'дней'}` : 'пока ни одного дня'}</p>
    </div>
  );
}

function NewPage({ nb }: { nb: Notebook }) {
  if (nb.demo)
    return (
      <div className="jp jp-new">
        <p className="jp-hand jp-end">конец тетради</p>
      </div>
    );
  return (
    <div className="jp jp-new">
      <p className="jp-hand">Как прошёл день?</p>
      <a className="btn" href={`#/new/${nb.id}`}>
        + Записать день
      </a>
    </div>
  );
}

const Endpaper = () => <div className="jp jp-endpaper" />;
const Paper = () => <div className="jp" />;

/* ——— книга ——— */

interface Leaf {
  front: ReactNode;
  back: ReactNode;
  cover?: boolean;
}

export default function Journal({ nb, days, ready = true, onPage }: { nb: Notebook; days: DayRecord[]; ready?: boolean; onPage?: (day: DayRecord | null) => void }) {
  const { photos, loadPhotos } = useDiary();
  const cover = useCoverUrl(nb, 900);
  const single = useNarrow();
  const list = useMemo(() => [...days].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)), [days]);
  useEffect(() => loadPhotos(list), [list, loadPhotos]);

  const coverFace = (
    <div className="jp jp-cover">
      {cover ? <img src={cover} alt={nb.title} draggable={false} /> : <div className="book-ph" />}
      <i className="jp-elastic" />
    </div>
  );
  const ph = (d: DayRecord) => photos[d.id] ?? [];

  // листы: лицо и оборот; основа (base) лежит под всеми листами справа
  const { leaves, base, dayAt } = useMemo(() => {
    const L: Leaf[] = [];
    const at: (DayRecord | null)[] = [];
    if (single) {
      L.push({ front: coverFace, back: <Paper />, cover: true });
      at.push(null);
      L.push({ front: <TitlePage nb={nb} count={list.length} />, back: <Paper /> });
      at.push(null);
      for (const d of list) {
        L.push({
          front: (
            <div className="jp jp-single">
              <PhotoPage d={d} photos={ph(d)} />
              <TextPage d={d} />
            </div>
          ),
          back: <Paper />,
        });
        at.push(d);
      }
      return { leaves: L, base: <NewPage nb={nb} />, dayAt: at };
    }
    // разворот k: слева фото дня, справа текст; первый разворот — форзац и титул
    const spreads: [ReactNode, ReactNode, DayRecord | null][] = [[<Endpaper />, <TitlePage nb={nb} count={list.length} />, null], ...list.map((d) => [<PhotoPage d={d} photos={ph(d)} />, <TextPage d={d} />, d] as [ReactNode, ReactNode, DayRecord]), [<Paper />, <NewPage nb={nb} />, null]];
    L.push({ front: coverFace, back: spreads[0][0], cover: true });
    at.push(null);
    for (let k = 1; k < spreads.length; k++) {
      L.push({ front: spreads[k - 1][1], back: spreads[k][0] });
      at.push(spreads[k - 1][2]);
    }
    return { leaves: L, base: spreads[spreads.length - 1][1], dayAt: [...at.slice(1), null] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, list, photos, cover, nb]);

  const n = leaves.length;
  // сколько листов перевёрнуто: 0 — закрыта; открываемся на последнем дне
  const [f, setF] = useState(0);
  const [turning, setTurning] = useState<Set<number>>(new Set());
  const opened = useRef(false);
  const tm = useRef(0);

  const flipTo = useCallback(
    (to: number, riffle = false) => {
      to = Math.max(0, Math.min(n, to));
      setF((cur) => {
        if (to === cur) return cur;
        rustle();
        const lo = Math.min(cur, to),
          hi = Math.max(cur, to);
        const t = new Set<number>();
        for (let k = lo; k < hi; k++) t.add(k);
        setTurning(t);
        clearTimeout(tm.current);
        tm.current = window.setTimeout(() => setTurning(new Set()), riffle ? 900 + (hi - lo) * 70 : 950);
        return to;
      });
    },
    [n],
  );

  // открываем тетрадь сама: обложка откидывается, страницы пролистываются до последнего дня
  const want = useRef(0);
  want.current = Math.min(list.length ? list.length + 1 : 2, n);
  const flipRef = useRef(flipTo);
  flipRef.current = flipTo;
  useEffect(() => {
    if (opened.current || !ready) return;
    opened.current = true;
    window.setTimeout(() => flipRef.current(want.current, true), 650);
  }, [ready]);

  useEffect(() => {
    onPage?.(single ? (f >= 2 && f <= list.length + 1 ? list[f - 2] : null) : f >= 1 ? dayAt[f - 1] ?? null : null);
  }, [f, single, list, dayAt, onPage]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
      if (e.key === 'ArrowRight') flipTo(f + 1);
      if (e.key === 'ArrowLeft') flipTo(f - 1);
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [f, flipTo]);

  // перелистывание пальцем: лист следует за рукой
  const drag = useRef<{ x: number; leaf: number; dir: 1 | -1; w: number } | null>(null);
  const [dragA, setDragA] = useState<{ leaf: number; a: number } | null>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    const box = bookRef.current!.getBoundingClientRect();
    const right = single ? true : e.clientX > box.left + box.width / 2;
    const dir: 1 | -1 = single ? (e.clientX > box.left + box.width * 0.35 ? 1 : -1) : right ? 1 : -1;
    const leaf = dir > 0 ? f : f - 1;
    if (leaf < 0 || leaf >= n) return;
    drag.current = { x: e.clientX, leaf, dir, w: single ? box.width : box.width / 2 };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const p = Math.max(0, Math.min(1, (g.dir > 0 ? -dx : dx) / (g.w * 1.3)));
    if (p > 0.02) setDragA({ leaf: g.leaf, a: g.dir > 0 ? -180 * p : -180 * (1 - p) });
  };
  const onUp = (e: React.PointerEvent) => {
    const g = drag.current;
    drag.current = null;
    if (!g) return;
    const dx = e.clientX - g.x;
    const p = (g.dir > 0 ? -dx : dx) / (g.w * 1.3);
    setDragA(null);
    if (Math.abs(dx) < 6) {
      // простой тап по краю листает
      const box = bookRef.current!.getBoundingClientRect();
      const x = (e.clientX - box.left) / box.width;
      if (single ? x > 0.65 : x > 0.82) flipTo(f + 1);
      else if (single ? x < 0.2 : x < 0.18) flipTo(f - 1);
      return;
    }
    if (p > 0.28) flipTo(f + g.dir);
  };

  const closed = f === 0;
  const shift = single || !closed ? 0 : -25;

  return (
    <div className={'jr' + (single ? ' single' : '')}>
      <div className="jr-stage">
        <div
          ref={bookRef}
          className={'jr-book' + (closed ? ' closed' : '')}
          style={{ transform: `translateX(${shift}%)` }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={() => ((drag.current = null), setDragA(null))}
        >
          {!single && <div className="jr-block left" />}
          <div className="jr-block right" />
          <div className="jr-base">{base}</div>
          {leaves.map((lf, k) => {
            const flipped = k < f;
            const dragging = dragA?.leaf === k;
            const near = Math.abs(k - f) <= 3 || turning.has(k) || k === 0;
            const z = dragging || turning.has(k) ? 500 + (flipped ? k : n - k) : flipped ? k + 1 : n + 2 - k;
            const idx = turning.size > 1 ? [...turning].indexOf(k) : 0;
            return (
              <div
                key={k}
                className={'jr-leaf' + (flipped ? ' flipped' : '') + (turning.has(k) || dragging ? ' turning' : '') + (lf.cover ? ' is-cover' : '')}
                style={{
                  zIndex: z,
                  transform: dragging ? `rotateY(${dragA!.a}deg)` : undefined,
                  transition: dragging ? 'none' : undefined,
                  transitionDelay: idx > 0 ? `${idx * 70}ms` : undefined,
                }}
              >
                <div className="jr-face front">{near ? lf.front : <Paper />}</div>
                <div className="jr-face back">{near ? lf.back : <Paper />}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="jr-nav">
        <button className="jr-arrow" onClick={() => flipTo(f - 1)} disabled={f === 0} aria-label="Назад">
          ‹
        </button>
        <span className="jr-pos">{closed ? 'обложка' : single ? (f === 1 ? 'титул' : f <= list.length + 1 ? `${f - 1} из ${list.length}` : 'новая страница') : f === 1 ? 'титул' : f <= list.length + 1 ? `${f - 1} из ${list.length}` : 'новая страница'}</span>
        <button className="jr-arrow" onClick={() => flipTo(f + 1)} disabled={f >= n} aria-label="Вперёд">
          ›
        </button>
      </div>
    </div>
  );
}

function useNarrow() {
  const q = '(max-width: 760px)';
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}
