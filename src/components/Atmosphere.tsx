import { useEffect, useRef, useState } from 'react';
import { MOTIF_NAMES, type Atmos } from '../lib/atmos';
import { AtmosScene } from '../lib/atmosScene';

/** Живой фон за всем сайтом */
export function AtmosBackdrop({ atmos, strength }: { atmos: Atmos; strength: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scene = useRef<AtmosScene | null>(null);
  useEffect(() => {
    const s = new AtmosScene(ref.current!);
    scene.current = s;
    (window as unknown as { __ottiskAtmos: AtmosScene }).__ottiskAtmos = s;
    return () => s.destroy();
  }, []);
  useEffect(() => {
    scene.current?.set(atmos);
  }, [atmos]);
  useEffect(() => {
    if (scene.current) scene.current.strength = strength;
  }, [strength]);
  return <canvas ref={ref} className="atmos" aria-hidden />;
}

/** Цвета сайта следуют за атмосферой (переходы плавные — переменные зарегистрированы в CSS) */
export function useAtmosColors(a: Atmos) {
  useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--paper', a.paper);
    r.setProperty('--paper-2', a.paper2);
    r.setProperty('--accent', a.accent);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.paper);
  }, [a.paper, a.paper2, a.accent]);
}

/** Подпись у логотипа: чем живёт дневник; по нажатию — почему сайт выглядит так */
export function AtmosChip({ atmos }: { atmos: Atmos }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    addEventListener('pointerdown', f);
    return () => removeEventListener('pointerdown', f);
  }, [open]);
  if (!atmos.top.length) return <small>дневник атмосферы</small>;
  return (
    <span className="atmos-chip" ref={box}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        key={atmos.top.join()}
      >
        {atmos.top.map((k, i) => (
          <span key={k} style={{ animationDelay: `${i * 0.12}s` }}>
            {MOTIF_NAMES[k]}
          </span>
        ))}
      </button>
      {open && (
        <span className="atmos-pop" role="dialog">
          <b>Дневник подстроился под ваши дни</b>
          {atmos.top.map((k) => (
            <span key={k} className="atmos-row">
              <i style={{ width: `${Math.round(atmos.weights[k] * 100)}%` }} />
              {MOTIF_NAMES[k]}
              {atmos.counts[k] ? ` — ${atmos.counts[k]} ${days(atmos.counts[k]!)}` : ''}
            </span>
          ))}
          <small>Цвета, небо и мелочи на фоне меняются с каждой новой записью.</small>
        </span>
      )}
    </span>
  );
}

const days = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'дня' : 'дней');
