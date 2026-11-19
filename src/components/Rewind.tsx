import { useEffect, useState } from 'react';
import type { DayRecord } from '../lib/types';
import { humanDate } from '../lib/render/engine';

function whir(sec: number) {
  try {
    const ac = new AudioContext();
    const o = ac.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(900, ac.currentTime);
    o.frequency.exponentialRampToValueAtTime(140, ac.currentTime + sec);
    const f = ac.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1400;
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, ac.currentTime);
    g.gain.linearRampToValueAtTime(0.06, ac.currentTime + 0.15);
    g.gain.setValueAtTime(0.06, ac.currentTime + sec - 0.2);
    g.gain.linearRampToValueAtTime(0.0001, ac.currentTime + sec);
    o.connect(f).connect(g).connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + sec + 0.05);
    setTimeout(() => ac.close(), (sec + 0.3) * 1000);
  } catch {
    /* */
  }
}

const DUR = 1.9;

/** «Перенеси меня»: перемотка назад, как на видеокассете, к случайному дню */
export default function Rewind({ to, onDone }: { to: DayRecord; onDone: () => void }) {
  const [label, setLabel] = useState(humanDate(new Date().toISOString().slice(0, 10)));
  useEffect(() => {
    whir(DUR);
    const from = Date.now();
    const target = new Date(to.date + 'T12:00:00').getTime();
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / (DUR * 1000));
      const e = 1 - Math.pow(1 - k, 3);
      const d = new Date(from + (target - from) * e);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      setLabel(humanDate(iso));
      if (k < 1) raf = requestAnimationFrame(tick);
      else setTimeout(onDone, 250);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to.id]);
  return (
    <div className="rewind">
      <div className="rw-lines" />
      <div className="rw-play mono">◀◀ ПЕРЕМОТКА</div>
      <div className="rw-date">{label}</div>
      <div className="rw-noise" />
    </div>
  );
}
