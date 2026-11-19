import { useEffect, useRef } from 'react';
import type { DayRecord } from '../lib/types';
import { daylightStr, drawMoon, goldenHour, moonPhase } from '../lib/sky';

export function MoonGlyph({ date, size = 28, light = '#f3e9c8', dark = '#26304a' }: { date: string; size?: number; light?: string; dark?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, size, size);
    drawMoon(g, size / 2, size / 2, size / 2 - 1, moonPhase(date), light, dark);
  }, [date, size, light, dark]);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} aria-hidden />;
}

/** «Небо того дня» — луна, восход и закат, долгота дня */
export default function SkyBox({ rec }: { rec: DayRecord }) {
  const m = moonPhase(rec.date);
  const w = rec.place?.weather;
  return (
    <div className="box sky">
      <div className="sec">Небо того дня</div>
      <div className="sky-row">
        <div className="sky-moon">
          <MoonGlyph date={rec.date} size={64} />
        </div>
        <div className="kv" style={{ flex: 1 }}>
          <span className="k">луна</span>
          <span>
            {m.name}, {Math.round(m.illum * 100)}%
          </span>
          {w?.sunrise && (
            <>
              <span className="k">восход</span>
              <span>{w.sunrise}</span>
              <span className="k">закат</span>
              <span>
                {w.sunset} <span className="muted">· золотой час ≈ {goldenHour(w.sunset)}</span>
              </span>
              <span className="k">день</span>
              <span>{daylightStr(w.daylight)}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
