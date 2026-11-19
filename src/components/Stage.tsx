import { useEffect, useRef, useState } from 'react';
import type { DayRecord } from '../lib/types';
import { makeRenderer } from '../lib/pipeline';
import { MemoryPlayer } from '../lib/render/player';
import { speak, stopSpeaking } from '../lib/voice';

interface Props {
  rec: DayRecord;
  title?: string;
  bitmaps: ImageBitmap[];
  audio: AudioBuffer | null;
  autoplay?: boolean;
  onVideo?: (b: Blob) => void;
  extra?: React.ReactNode;
}

/** Живая страница дня: звук, движение, голос, запись видео */
export default function Stage({ rec, title, bitmaps, audio, autoplay, onVideo, extra }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const player = useRef<MemoryPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState('Проявляю…');
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(30);
  const [voice, setVoice] = useState(false);
  const [rec_, setRec] = useState<number | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await makeRenderer(rec, bitmaps, ref.current!, (s) => !dead && setStep(s));
      if (dead) return;
      const p = new MemoryPlayer(r, audio);
      p.onTime = (x) => setT(x);
      player.current = p;
      setDur(r.duration);
      r.draw(0);
      setReady(true);
      if (autoplay) {
        p.play();
        setPlaying(true);
      } else r.draw(0, { still: true });
    })();
    return () => {
      dead = true;
      stopSpeaking();
      player.current?.destroy();
      player.current = null;
    };
  }, [rec, bitmaps, audio, autoplay]);

  useEffect(() => {
    const p = player.current;
    if (!p || title === undefined) return;
    p.r.setTitle(title);
    if (!p.playing) p.r.draw(p.time, { still: p.time === 0 });
  }, [title, ready]);

  const toggle = () => {
    const p = player.current;
    if (!p) return;
    p.toggle();
    setPlaying(p.playing);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    player.current?.seek(((e.clientX - b.left) / b.width) * dur);
  };

  const listen = () => {
    const p = player.current;
    if (voice) {
      stopSpeaking();
      setVoice(false);
      p?.duck(1);
      return;
    }
    if (p && !p.playing) {
      p.play();
      setPlaying(true);
    }
    p?.duck(rec.design.voice.musicDuck);
    const ok = speak(
      rec.text,
      rec.design.voice,
      () => {
        setVoice(false);
        player.current?.duck(1);
      },
      () => setVoice(true),
    );
    if (!ok) alert('Браузер не поддерживает синтез речи');
  };

  const record = async () => {
    const p = player.current;
    if (!p) return;
    stopSpeaking();
    setVoice(false);
    setRec(0);
    setPlaying(true);
    const blob = await p.record((x) => setRec(x));
    setRec(null);
    setPlaying(false);
    onVideo?.(blob);
  };

  return (
    <div className="stage">
      <div style={{ position: 'relative' }}>
        <canvas ref={ref} width={1080} height={1350} onClick={toggle} style={{ cursor: ready ? 'pointer' : 'wait' }} />
        {!ready && (
          <div className="mono muted" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <span className="blink">{step}</span>
          </div>
        )}
      </div>
      <div className="ctrl">
        <button className="play" onClick={toggle} disabled={!ready || rec_ !== null} aria-label="play">
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="bar" onClick={seek}>
          <i style={{ width: `${(t / dur) * 100}%` }} />
        </div>
        <span className="mono muted" style={{ minWidth: 70, textAlign: 'right' }}>
          {fmt(t)} / {fmt(dur)}
        </span>
      </div>
      <div className="ctrl">
        <button className="btn ghost small" onClick={listen} disabled={!ready || rec_ !== null}>
          {voice ? '■ Остановить голос' : '◉ Слушать запись'}
        </button>
        {onVideo && (
          <button className="btn ghost small" onClick={record} disabled={!ready || rec_ !== null}>
            {rec_ !== null ? `● Запись видео ${Math.round(rec_ * 100)}%` : '● Сохранить видео'}
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
