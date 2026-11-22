import { useEffect, useMemo, useRef, useState } from 'react';
import type { DayRecord } from '../lib/types';
import { brightMoment, brightestPhoto, lightSpots, type Light, type Spot } from '../lib/light';

/**
 * «Что было светлым»: серый снимок дня медленно проявляется — цвет возвращается
 * туда, где был тёплый свет. Ниже — то, что было в этом дне хорошего, словами самого человека.
 */
export default function LightBox({ rec, light, bitmaps, audio }: { rec: DayRecord; light: Light; bitmaps: ImageBitmap[] | null; audio: AudioBuffer | null }) {
  const bmp = useMemo(() => (bitmaps?.length ? bitmaps[Math.min(bitmaps.length - 1, brightestPhoto(rec))] : null), [bitmaps, rec]);
  const moment = useMemo(() => (audio ? brightMoment(audio) : null), [audio]);
  // слова появляются вместе с проявкой снимка, а не раньше
  const [go, setGo] = useState(false);
  if (!bmp && !light.bits.length && moment == null) return null;
  return (
    // класс блока не меняем: его анимацию появления ведёт reveal.ts, состояние — в data-атрибуте
    <div className="box lightbox" data-go={go || !bmp ? '1' : undefined}>
      <div className="sec">Что было светлым</div>
      <p className="lb-lead">День был серым, но в нём было:</p>
      {bmp && <Develop bmp={bmp} onStart={() => setGo(true)} />}
      {!!light.bits.length && (
        <ul className="lb-bits">
          {light.bits.map((b) => (
            <li key={b.kind} className={'lb-' + b.kind}>
              <b>{b.label}:</b> {b.text}
            </li>
          ))}
        </ul>
      )}
      {audio && moment != null && <Moment audio={audio} at={moment} />}
    </div>
  );
}

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/** снимок: сначала серый, потом в тёплых местах проступает цвет — как фото в проявителе */
function Develop({ bmp, onStart }: { bmp: ImageBitmap; onStart: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const spots = useMemo<Spot[]>(() => lightSpots(bmp), [bmp]);
  const [run, setRun] = useState(0);
  // проявляем, когда снимок показался на экране
  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setRun((x) => x || 1);
          onStart();
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = cv.current;
    if (!el) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const cssW = el.clientWidth || 320;
    const W = Math.round(cssW * dpr);
    const H = Math.round((W * bmp.height) / bmp.width);
    el.width = W;
    el.height = H;
    const g = el.getContext('2d')!;
    // серая копия считается вручную: фильтры холста есть не во всех браузерах (старый Safari)
    const gray = document.createElement('canvas');
    gray.width = W;
    gray.height = H;
    const gg = gray.getContext('2d', { willReadFrequently: true })!;
    gg.drawImage(bmp, 0, 0, W, H);
    try {
      const im = gg.getImageData(0, 0, W, H);
      const d = im.data;
      for (let i = 0; i < d.length; i += 4) {
        const l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        const v = Math.max(0, Math.min(255, ((l - 0.5) * 1.06 + 0.5) * 0.88 * 255));
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      gg.putImageData(im, 0, 0);
    } catch {
      /* без доступа к пикселям остаётся цветная копия */
    }
    const col = document.createElement('canvas');
    col.width = W;
    col.height = H;
    const cg = col.getContext('2d')!;
    const mask = document.createElement('canvas');
    mask.width = W;
    mask.height = H;
    const mg = mask.getContext('2d')!;
    const diag = Math.hypot(W, H);
    const draw = (t: number) => {
      const k = ease(t);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(gray, 0, 0);
      if (k <= 0) return;
      // где проступает цвет
      mg.clearRect(0, 0, W, H);
      for (const s of spots) {
        const R = s.r * diag * (0.18 + 0.62 * k);
        const gr = mg.createRadialGradient(s.x * W, s.y * H, 0, s.x * W, s.y * H, R);
        gr.addColorStop(0, 'rgba(0,0,0,1)');
        gr.addColorStop(0.45, 'rgba(0,0,0,0.85)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        mg.fillStyle = gr;
        mg.globalCompositeOperation = 'lighter';
        mg.fillRect(0, 0, W, H);
      }
      cg.globalCompositeOperation = 'source-over';
      cg.clearRect(0, 0, W, H);
      cg.drawImage(bmp, 0, 0, W, H);
      cg.globalCompositeOperation = 'destination-in';
      cg.globalAlpha = Math.min(1, k * 1.2);
      cg.drawImage(mask, 0, 0);
      cg.globalAlpha = 1;
      g.drawImage(col, 0, 0);
      // тёплое свечение поверх найденного света
      g.globalCompositeOperation = 'soft-light';
      for (const s of spots) {
        const R = s.r * diag * 0.9;
        const gr = g.createRadialGradient(s.x * W, s.y * H, 0, s.x * W, s.y * H, R);
        gr.addColorStop(0, `rgba(255,196,128,${0.55 * k})`);
        gr.addColorStop(1, 'rgba(255,196,128,0)');
        g.fillStyle = gr;
        g.fillRect(0, 0, W, H);
      }
      g.globalCompositeOperation = 'source-over';
    };
    if (!run) return draw(0);
    if (reduced()) return draw(1);
    let raf = 0;
    const t0 = performance.now() + 500;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / 3200));
      draw(t);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bmp, spots, run]);
  return (
    <button className="lb-photo" onClick={() => setRun((x) => x + 1)} aria-label="Проявить снимок ещё раз" data-sfx="none">
      <canvas ref={cv} />
    </button>
  );
}

/** самый яркий момент песни — по нажатию, 7 секунд с мягким входом и выходом */
let ac: AudioContext | null = null;
function Moment({ audio, at }: { audio: AudioBuffer; at: number }) {
  const [on, setOn] = useState(false);
  const src = useRef<AudioBufferSourceNode | null>(null);
  useEffect(() => () => src.current?.stop(), []);
  const play = async () => {
    if (on) {
      src.current?.stop();
      return;
    }
    // остальная музыка дня замолкает, чтобы не играть поверх
    dispatchEvent(new CustomEvent('ottisk:hush'));
    ac ??= new AudioContext();
    if (ac.state === 'suspended') await ac.resume().catch(() => {});
    const s = ac.createBufferSource();
    const g = ac.createGain();
    s.buffer = audio;
    s.connect(g).connect(ac.destination);
    const t = ac.currentTime,
      len = Math.min(7, audio.duration - at);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1, t + 0.5);
    g.gain.setValueAtTime(1, t + len - 0.9);
    g.gain.linearRampToValueAtTime(0, t + len);
    s.start(t, at, len);
    s.onended = () => {
      setOn(false);
      if (src.current === s) src.current = null;
    };
    src.current = s;
    setOn(true);
  };
  return (
    <button className={'btn ghost small lb-moment' + (on ? ' on' : '')} onClick={play}>
      {on ? '■ Стоп' : '▶ Самый яркий момент песни'}
    </button>
  );
}
