import { useEffect, useState } from 'react';
import { crack, unfold } from '../lib/sfx';

export function countdown(iso: string, now = Date.now()) {
  let s = Math.max(0, Math.floor((new Date(iso).getTime() - now) / 1000));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return { done: d + h + m + s === 0, d, text: `${d ? d + ' ' + (d % 10 === 1 && d % 100 !== 11 ? 'день' : d % 10 >= 2 && d % 10 <= 4 && (d % 100 < 12 || d % 100 > 14) ? 'дня' : 'дней') + ' ' : ''}${p(h)}:${p(m)}:${p(s)}` };
}

export function useNow(ms = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

/** Конверт с сургучной печатью. Печать ломается по клику, когда пришло время */
export default function Envelope({ due, label, small, onOpened, tint = '#e7d7bb' }: { due: boolean; label?: string; small?: boolean; onOpened?: () => void; tint?: string }) {
  const [stage, setStage] = useState<'closed' | 'crack' | 'open'>('closed');
  const open = () => {
    if (!due || stage !== 'closed' || !onOpened) return;
    setStage('crack');
    crack();
    setTimeout(() => {
      setStage('open');
      unfold();
    }, 650);
    setTimeout(() => onOpened(), 1900);
  };
  return (
    <div className={`env ${small ? 'small' : ''} ${due ? 'due' : ''} ${stage}`} style={{ ['--env' as string]: tint }} onClick={open} role={due && onOpened ? 'button' : undefined}>
      <div className="env-back" />
      <div className="env-letter">
        <i />
        <i />
        <i />
      </div>
      <div className="env-front" />
      <div className="env-flap" />
      <div className="env-seal" title={due ? 'сломать печать' : 'ещё рано'}>
        <span className="half l" />
        <span className="half r" />
        <b>E</b>
      </div>
      {label && <div className="env-label">{label}</div>}
    </div>
  );
}
