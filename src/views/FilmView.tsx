import { useEffect, useRef, useState } from 'react';
import { useDiary } from '../App';
import { FilmEngine, type FilmClip } from '../lib/film';
import { download, loadAssets, makeRenderer } from '../lib/pipeline';
import { plural } from '../lib/prompts';
import type { DayMedia, DayRecord } from '../lib/types';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

/** Выбираем до 10 дней равномерно, по порядку */
function pick(days: DayRecord[], max = 10) {
  const s = [...days].sort((a, b) => a.date.localeCompare(b.date));
  if (s.length <= max) return s;
  return Array.from({ length: max }, (_, i) => s[Math.round((i * (s.length - 1)) / (max - 1))]);
}

export default function FilmView({ kind, id }: { kind: string; id: string }) {
  const { days, notebooks, daysOf, store, covers, loading } = useDiary();
  const box = useRef<HTMLDivElement>(null);
  const eng = useRef<FilmEngine | null>(null);
  const [step, setStep] = useState('');
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(1);
  const [rec, setRec] = useState<number | null>(null);

  const nb = kind === 'nb' ? notebooks.find((n) => n.id === id) : null;
  const list = kind === 'nb' ? (nb ? daysOf(nb.id) : []) : days.filter((d) => d.date.startsWith(id));
  const title = kind === 'nb' ? (nb?.title ?? '') : `${MONTHS[+id.slice(5, 7) - 1]} ${id.slice(0, 4)}`;
  const chosen = pick(list);
  const key = chosen.map((d) => d.id).join(',');

  useEffect(() => {
    if (!store || !chosen.length) return;
    let dead = false;
    // ждём, пока список дней перестанет меняться (демо-дни подгружаются постепенно)
    const timer = setTimeout(async () => {
      const clips: FilmClip[] = [];
      for (let i = 0; i < chosen.length; i++) {
        const d = chosen[i];
        setStep(`Проявляю день ${i + 1} из ${chosen.length} · ${d.title}`);
        try {
          const m: DayMedia = d.demo ? { photos: [], cover: covers[d.id] } : await store.media(d);
          const a = await loadAssets(d, m);
          const r = await makeRenderer(d, a.bitmaps);
          let cover: HTMLImageElement | undefined;
          if (covers[d.id]) {
            cover = new Image();
            cover.crossOrigin = 'anonymous';
            cover.src = covers[d.id];
            await cover.decode().catch(() => (cover = undefined));
          }
          clips.push({ rec: d, r, audio: a.audio, cover });
        } catch (e) {
          console.warn('[Оттиск] день не попал в фильм', d.id, e);
        }
        if (dead) return;
      }
      if (!clips.length) return setStep('Не удалось собрать фильм');
      const songs = new Set(clips.map((c) => c.rec.music.artist || c.rec.music.title)).size;
      const e = new FilmEngine(clips, title, `${clips.length} ${plural(clips.length, 'день', 'дня', 'дней')} · ${songs} ${plural(songs, 'песня', 'песни', 'песен')}`);
      e.onTime = (x) => setT(x);
      e.onEnd = () => setPlaying(false);
      eng.current = e;
      e.canvas.className = 'film-canvas';
      e.canvas.onclick = () => toggle();
      box.current?.replaceChildren(e.canvas);
      e.draw(0.01);
      setDur(e.duration);
      setReady(true);
      setStep('');
    }, 700);
    return () => {
      clearTimeout(timer);
      dead = true;
      eng.current?.destroy();
      eng.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, store]);

  const toggle = () => {
    const e = eng.current;
    if (!e) return;
    if (e.playing) {
      e.pause();
      setPlaying(false);
    } else e.play().then(() => setPlaying(true));
  };

  const save = async () => {
    const e = eng.current;
    if (!e) return;
    setRec(0);
    setPlaying(true);
    const b = await e.record((x) => setRec(x));
    setRec(null);
    setPlaying(false);
    download(b, `${title} — фильм.${b.type.includes('mp4') ? 'mp4' : 'webm'}`);
  };

  if (!loading && !chosen.length) return <p className="muted">Здесь пока нет дней для фильма.</p>;
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="film">
      <div className="film-head">
        <a className="mono muted" href={nb ? `#/nb/${nb.id}` : '#/year'} style={{ textDecoration: 'none' }}>
          ← {nb ? nb.title : 'год'}
        </a>
        <h1 className="h1" style={{ fontSize: 42, margin: '6px 0 4px' }}>
          Фильм: {title}
        </h1>
        <div className="mono muted">
          {chosen.length} {plural(chosen.length, 'день', 'дня', 'дней')} · каждый со своей песней, формой и звуками
        </div>
      </div>
      <div className="stage film-stage">
        <div className="film-box">
          <div ref={box} className="film-holder" />
          {!ready && <div className="mono muted film-wait blink">{step || 'Готовлю плёнку…'}</div>}
        </div>
        <div className="ctrl">
          <button className="play" onClick={toggle} disabled={!ready || rec !== null}>
            {playing ? '❚❚' : '▶'}
          </button>
          <div className="bar" onClick={(ev) => {
            const b = ev.currentTarget.getBoundingClientRect();
            eng.current?.seek(((ev.clientX - b.left) / b.width) * dur);
          }}>
            <i style={{ width: `${(t / dur) * 100}%` }} />
          </div>
          <span className="mono muted" style={{ minWidth: 70, textAlign: 'right' }}>
            {fmt(t)} / {fmt(dur)}
          </span>
        </div>
        <div className="ctrl">
          <button className="btn ghost small" onClick={save} disabled={!ready || rec !== null}>
            {rec !== null ? `● Запись фильма ${Math.round(rec * 100)}%` : '● Сохранить фильм'}
          </button>
        </div>
      </div>
    </div>
  );
}
