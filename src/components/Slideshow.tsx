import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DayRecord } from '../lib/types';

/**
 * Слайдшоу воспоминания (как «Воспоминания» в Фото на iPhone и шаблоны CapCut):
 * титр, фото с плавным наездом, фразы из записи, песня и свой голос поверх неё.
 */
export type ShowStyle = 'soft' | 'film' | 'polaroid' | 'beat';
export const SHOW_STYLES: [ShowStyle, string][] = [
  ['soft', 'Мягко'],
  ['film', 'Плёнка'],
  ['polaroid', 'Полароиды'],
  ['beat', 'В ритм'],
];

const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const KB = ['kb-in-l', 'kb-in-r', 'kb-out', 'kb-up', 'kb-in-c'];

/** стиль по настроению дня: энергичный — в ритм, ностальгия — плёнка, остальное — мягко */
export function autoStyle(rec: DayRecord): ShowStyle {
  const m = rec.design.mood;
  if (m.energy > 0.66) return 'beat';
  if (m.nostalgia > 0.5 || rec.design.mode === 'film') return 'film';
  if (rec.photoCount >= 3 && m.valence > 0.2) return 'polaroid';
  return 'soft';
}

interface Slide {
  kind: 'title' | 'photo' | 'end';
  src?: string;
  line?: string;
  kb: string;
  n: number;
}

export default function Slideshow({ rec, photos, audio, voiceUrl, style, onStyle }: { rec: DayRecord; photos: string[]; audio: AudioBuffer | null; voiceUrl?: string; style: ShowStyle; onStyle: (s: ShowStyle) => void }) {
  const bpm = rec.analysis.music.audio?.bpm ?? 0;
  const slot = style === 'beat' && bpm ? Math.max(1.6, Math.min(3.2, (60 / bpm) * 4)) : style === 'film' ? 3.8 : style === 'polaroid' ? 3.4 : 4.4;
  const slides = useMemo<Slide[]>(() => {
    const lines = rec.text
      .split(/(?<=[.!?…])\s+|\n+/)
      .map((x) => x.trim())
      .filter((x) => x.length > 2);
    const n = Math.max(photos.length, Math.min(4, Math.max(3, lines.length)));
    const out: Slide[] = [{ kind: 'title', kb: 'kb-in-c', n: 0 }];
    for (let i = 0; i < n; i++) out.push({ kind: 'photo', src: photos[i % Math.max(1, photos.length)], line: lines[i], kb: KB[(i + rec.pageNo) % KB.length], n: i + 1 });
    out.push({ kind: 'end', kb: 'kb-out', n: n + 1 });
    return out;
  }, [rec.text, rec.pageNo, photos]);
  const durOf = (s: Slide) => (s.kind === 'title' ? 3.2 : s.kind === 'end' ? 3.4 : slot);
  const starts = useMemo(() => {
    const st: number[] = [];
    let acc = 0;
    for (const s of slides) {
      st.push(acc);
      acc += durOf(s);
    }
    return { st, total: acc };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides, slot]);

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [prog, setProg] = useState(0);
  const ac = useRef<AudioContext | null>(null);
  const src = useRef<AudioBufferSourceNode | null>(null);
  const gain = useRef<GainNode | null>(null);
  const voice = useRef<HTMLAudioElement | null>(null);
  const clock = useRef({ base: 0, at: 0 }); // секунды показа на момент at (performance.now)
  const raf = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const now = () => (playing ? clock.current.base + (performance.now() - clock.current.at) / 1000 : clock.current.base);

  const stopAudio = () => {
    try {
      src.current?.stop();
    } catch {
      /* уже остановлен */
    }
    src.current = null;
    voice.current?.pause();
  };

  const startAudio = useCallback(
    async (from: number) => {
      ac.current ??= new AudioContext();
      const c = ac.current;
      if (c.state === 'suspended') await c.resume().catch(() => {});
      if (c.state !== 'running') throw new Error('blocked');
      if (!gain.current) {
        gain.current = c.createGain();
        gain.current.connect(c.destination);
      }
      const g = gain.current;
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(0, c.currentTime);
      g.gain.linearRampToValueAtTime(voiceUrl ? 0.32 : 1, c.currentTime + 1.2);
      if (audio) {
        const s = c.createBufferSource();
        s.buffer = audio;
        s.loop = true;
        s.connect(g);
        s.start(0, from % audio.duration);
        src.current = s;
      }
      if (voiceUrl) {
        const v = (voice.current ??= new Audio(voiceUrl));
        if (from < (v.duration || 1e9)) {
          v.currentTime = Math.max(0, from - 0.8);
          v.onended = () => g.gain.setTargetAtTime(1, c.currentTime, 0.5);
          await v.play().catch(() => {});
        }
      }
    },
    [audio, voiceUrl],
  );

  const play = useCallback(async () => {
    const from = clock.current.base >= starts.total ? 0 : clock.current.base;
    try {
      await startAudio(from);
    } catch {
      setBlocked(true);
      return;
    }
    setBlocked(false);
    clock.current = { base: from, at: performance.now() };
    setPlaying(true);
  }, [startAudio, starts.total]);

  const pause = useCallback(() => {
    clock.current = { base: now(), at: performance.now() };
    stopAudio();
    setPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // автостарт; если браузер не даёт звук без касания — покажем кнопку
  useEffect(() => {
    const t = setTimeout(() => void play(), 300);
    return () => {
      clearTimeout(t);
      stopAudio();
      ac.current?.close().catch(() => {});
      ac.current = null;
      gain.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // смена стиля — с начала
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    stopAudio();
    clock.current = { base: 0, at: performance.now() };
    setIdx(0);
    if (playing) void startAudio(0).catch(() => setBlocked(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const t = now();
      if (t >= starts.total) {
        clock.current = { base: starts.total, at: performance.now() };
        stopAudio();
        setPlaying(false);
        setProg(1);
        return;
      }
      let i = starts.st.length - 1;
      while (i > 0 && starts.st[i] > t) i--;
      setIdx((cur) => (cur === i ? cur : i));
      setProg(t / starts.total);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, starts]);

  const jump = (i: number) => {
    const was = playing;
    stopAudio();
    clock.current = { base: starts.st[i], at: performance.now() };
    setIdx(i);
    if (was) void startAudio(starts.st[i]).catch(() => {});
  };

  const [y, m, d] = rec.date.split('-').map(Number);
  const song = [rec.music.artist, rec.music.title].filter(Boolean).join(' · ');
  const stamp = `'${String(y).slice(2)} ${String(m).padStart(2, '0')} ${String(d).padStart(2, '0')}`;
  const pal = rec.design.palette;

  return (
    <div className={'ss ss-' + style} ref={box} style={{ ['--slot' as string]: slot + 's', ['--bg' as string]: pal.colors[0], ['--paperc' as string]: pal.paper }}>
      <div className="ss-screen" onClick={() => (playing ? pause() : void play())}>
        {slides.map((s, i) => {
          const on = i === idx;
          const past = i < idx;
          if (s.kind === 'title')
            return (
              <div key={'t' + style} className={'ss-slide ss-title' + (on ? ' on' : past ? ' past' : '')}>
                {photos[0] && <img className="ss-bgimg" src={photos[0]} alt="" />}
                <div className="ss-tcard">
                  <small>
                    {d} {MON[m - 1]} {y}
                  </small>
                  <h2>{rec.title}</h2>
                </div>
              </div>
            );
          if (s.kind === 'end')
            return (
              <div key={'e' + style} className={'ss-slide ss-end' + (on ? ' on' : '')}>
                <div className="ss-tcard">
                  <h2>{rec.title}</h2>
                  {song && <small>♪ {song}</small>}
                </div>
              </div>
            );
          return (
            <div key={i + style} className={'ss-slide ss-photo' + (on ? ' on' : past ? ' past' : '')} style={{ ['--rot' as string]: `${((i * 37) % 9) - 4}deg` }}>
              {on || past || i === idx + 1 ? (
                <>
                  <div className={'ss-frame ' + (on ? s.kb : '')}>
                    <img src={s.src} alt="" draggable={false} />
                    {style === 'film' && <span className="ss-stamp">{stamp}</span>}
                  </div>
                  {s.line && on && <p className="ss-line">{s.line}</p>}
                </>
              ) : null}
            </div>
          );
        })}
        {style === 'film' && <div className="ss-grain" />}
        {!playing && (
          <button className="ss-big" onClick={(e) => (e.stopPropagation(), void play())} aria-label="Воспроизвести">
            ▶
          </button>
        )}
        {blocked && <span className="ss-tap">нажми, чтобы включить звук</span>}
      </div>
      <div className="ss-bars" aria-hidden>
        {slides.map((s, i) => (
          <i key={i} onClick={() => jump(i)}>
            <b style={{ transform: `scaleX(${i < idx ? 1 : i > idx ? 0 : Math.min(1, Math.max(0, (prog * starts.total - starts.st[i]) / durOf(s)))})` }} />
          </i>
        ))}
      </div>
      <div className="ss-ctl">
        <div className="ss-styles" role="radiogroup" aria-label="Стиль слайдшоу">
          {SHOW_STYLES.map(([k, label]) => (
            <button key={k} role="radio" aria-checked={style === k} className={'tab' + (style === k ? ' on' : '')} onClick={() => onStyle(k)}>
              {label}
            </button>
          ))}
        </div>
        <button className="tab" onClick={() => box.current?.requestFullscreen?.().catch(() => {})} aria-label="На весь экран">
          ⛶
        </button>
      </div>
    </div>
  );
}
