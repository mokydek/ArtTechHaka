import { useEffect, useRef, useState } from 'react';
import type { DayRecord } from '../lib/types';
import { makeRenderer } from '../lib/pipeline';
import { MemoryPlayer } from '../lib/render/player';
import { speak, stopSpeaking } from '../lib/voice';
import { AMB_NAMES, ambBuffer } from '../lib/ambience';

interface Props {
  rec: DayRecord;
  title?: string;
  bitmaps: ImageBitmap[];
  audio: AudioBuffer | null;
  autoplay?: boolean;
  onVideo?: (b: Blob) => void;
  extra?: React.ReactNode;
  voiceUrl?: string; // свой голос вместо синтеза
  develop?: boolean; // проявить как полароид
}

/** Живая страница дня: звук, движение, голос, запись видео */
export default function Stage({ rec, title, bitmaps, audio, autoplay, onVideo, extra, voiceUrl, develop }: Props) {
  const [dev, setDev] = useState<number | null>(develop ? 0 : null);
  const devRef = useRef<number | null>(develop ? 0 : null);
  const [breath, setBreath] = useState(false);
  const mic = useRef<{ stop: () => void } | null>(null);
  const ptr = useRef<{ x: number; y: number; moved: number; down: boolean; lx: number; ly: number }>({ x: 0, y: 0, moved: 0, down: false, lx: 0, ly: 0 });
  const own = useRef<HTMLAudioElement | null>(null);
  const ref = useRef<HTMLCanvasElement>(null);
  const player = useRef<MemoryPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState('Проявляю…');
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(30);
  const [voice, setVoice] = useState(false);
  const [rec_, setRec] = useState<number | null>(null);
  const [amb, setAmb] = useState(true);

  useEffect(() => {
    let dead = false;
    (async () => {
      const r = await makeRenderer(rec, bitmaps, ref.current!, (s) => !dead && setStep(s));
      if (dead) return;
      const p = new MemoryPlayer(r, audio);
      p.onTime = (x) => setT(x);
      if (rec.ambience?.length) {
        const layers = rec.ambience;
        Promise.all(layers.map((l) => ambBuffer(l.kind))).then((bufs) => !dead && p.setAmbience(bufs.map((buffer, i) => ({ buffer, gain: layers[i].gain }))));
      }
      player.current = p;
      (window as unknown as Record<string, unknown>).__ottiskPlayer = p; // для проверок
      setDur(r.duration);
      r.draw(0);
      setReady(true);
      if (autoplay) {
        p.play();
        setPlaying(true);
        // если браузер не дал запустить звук без жеста — покажем паузу и обложку
        setTimeout(() => {
          if (p.blocked()) {
            p.pause();
            p.seek(0);
            r.draw(0, { still: true });
            setPlaying(false);
          }
        }, 600);
      } else r.draw(0, { still: true });
    })();
    return () => {
      dead = true;
      stopSpeaking();
      own.current?.pause();
      player.current?.destroy();
      player.current = null;
    };
  }, [rec, bitmaps, audio, autoplay]);

  // проявка и эффекты: свой цикл, чтобы всё жило и на паузе
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let last = performance.now();
    const tick = () => {
      const p = player.current;
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (p) {
        if (devRef.current != null) {
          devRef.current = Math.min(1, devRef.current + dt / 9);
          p.r.develop = devRef.current;
          if (devRef.current >= 1) {
            devRef.current = null;
            p.r.develop = null;
            setDev(null);
          } else if (Math.random() < 0.1) setDev(devRef.current);
        }
        if (!p.playing && (p.r.fxActive || devRef.current != null)) p.r.draw(p.time, { still: p.time === 0 });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // встряхнуть телефон — проявится быстрее
    const shake = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || devRef.current == null) return;
      const m = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      if (m > 17) devRef.current = Math.min(1, devRef.current + 0.035);
    };
    window.addEventListener('devicemotion', shake);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('devicemotion', shake);
    };
  }, [ready]);

  useEffect(() => () => mic.current?.stop(), []);

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - b.left) / b.width) * 1080, y: ((e.clientY - b.top) / b.height) * 1350 };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = toCanvas(e);
    ptr.current = { x: c.x, y: c.y, moved: 0, down: true, lx: c.x, ly: c.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    // iOS: доступ к датчику движения выдаётся по жесту
    const DM = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (devRef.current != null && DM?.requestPermission) DM.requestPermission().catch(() => {});
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = player.current;
    if (!p) return;
    const c = toCanvas(e);
    const st = ptr.current;
    const d = Math.hypot(c.x - st.lx, c.y - st.ly);
    if (d < 4) return;
    st.lx = c.x;
    st.ly = c.y;
    p.r.touch(c.x, c.y);
    if (st.down) {
      st.moved += d;
      p.r.wipe(c.x, c.y);
      if (devRef.current != null) devRef.current = Math.min(1, devRef.current + d * 0.00025);
    }
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = player.current;
    const st = ptr.current;
    st.down = false;
    p?.r.wipeEnd();
    if (!p) return;
    if (st.moved < 12) {
      const c = toCanvas(e);
      p.r.tap(c.x, c.y);
      toggle();
    }
  };

  const blow = async () => {
    if (mic.current) {
      mic.current.stop();
      mic.current = null;
      setBreath(false);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ac = new AudioContext();
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      ac.createMediaStreamSource(s).connect(an);
      const buf = new Float32Array(an.fftSize);
      const fb = new Uint8Array(an.frequencyBinCount);
      let raf = 0;
      const loop = () => {
        an.getFloatTimeDomainData(buf);
        an.getByteFrequencyData(fb);
        let e = 0;
        for (let i = 0; i < buf.length; i++) e += buf[i] * buf[i];
        const rms = Math.sqrt(e / buf.length);
        // дыхание — широкий шум с упором в низ; речь и музыка — тональные пики
        let lo = 0,
          all = 0;
        for (let i = 1; i < fb.length; i++) {
          all += fb[i];
          if (i < 24) lo += fb[i];
        }
        const flat = all / fb.length;
        if (rms > 0.06 && lo / 23 > flat * 1.4) player.current?.r.blow(Math.min(1, (rms - 0.04) * 6));
        raf = requestAnimationFrame(loop);
      };
      loop();
      mic.current = {
        stop: () => {
          cancelAnimationFrame(raf);
          s.getTracks().forEach((t) => t.stop());
          ac.close();
        },
      };
      setBreath(true);
    } catch {
      alert('Нет доступа к микрофону');
    }
  };

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
      own.current?.pause();
      setVoice(false);
      p?.duck(1);
      return;
    }
    if (p && !p.playing) {
      p.play();
      setPlaying(true);
    }
    p?.duck(rec.design.voice.musicDuck);
    if (voiceUrl) {
      const a = new Audio(voiceUrl);
      own.current = a;
      a.onended = () => {
        setVoice(false);
        player.current?.duck(1);
      };
      a.play().then(() => setVoice(true)).catch(() => player.current?.duck(1));
      return;
    }
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
        <canvas
          ref={ref}
          width={1080}
          height={1350}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => player.current?.r.wipeEnd()}
          style={{ cursor: ready ? (dev != null ? 'grab' : 'pointer') : 'wait', touchAction: 'none' }}
        />
        {ready && dev != null && <div className="dev-hint mono">проявляется… потрите фото{'ontouchstart' in window ? ' или встряхните телефон' : ''}</div>}
        {ready && breath && <div className="dev-hint mono">подуйте в микрофон — стекло запотеет, по нему можно рисовать пальцем</div>}
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
          {voice ? '■ Остановить голос' : voiceUrl ? '◉ Мой голос' : '◉ Слушать запись'}
        </button>
        <button className={'btn small' + (breath ? '' : ' ghost')} onClick={blow} disabled={!ready} title="подуть в микрофон">
          🌬 {breath ? 'Слушаю дыхание' : 'Подуть'}
        </button>
        {!!rec.ambience?.length && (
          <button
            className={'btn small' + (amb ? '' : ' ghost')}
            onClick={() => {
              player.current?.setAmbOn(!amb);
              setAmb(!amb);
            }}
            title={rec.ambience.map((a) => AMB_NAMES[a.kind]).join(' + ')}
            disabled={rec_ !== null}
          >
            ≋ {rec.ambience.map((a) => AMB_NAMES[a.kind]).join(' + ')}
          </button>
        )}
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
