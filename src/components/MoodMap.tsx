import type { DayRecord } from '../lib/types';

/** Карта настроений (как Mood Meter): по горизонтали — приятность дня, по вертикали — энергия */
export default function MoodMap({ days, covers }: { days: DayRecord[]; covers: Record<string, string> }) {
  return (
    <div>
      <div className="map">
        <span className="q q1">спокойно и светло</span>
        <span className="q q2">ярко и радостно</span>
        <span className="q q3">тихо и грустно</span>
        <span className="q q4">тревожно и быстро</span>
        <span className="ax" style={{ left: 14, top: '50%' }}>
          ← тяжелее
        </span>
        <span className="ax" style={{ right: 14, top: '50%' }}>
          светлее →
        </span>
        <span className="ax" style={{ left: '50%', top: 10 }}>
          ↑ энергия
        </span>
        <span className="ax" style={{ left: '50%', bottom: 10 }}>
          ↓ тишина
        </span>
        {days.map((d, i) => {
          const v = d.design.mood.valence; // -1..1
          const x = 50 + v * 40 + ((i % 3) - 1) * 1.6;
          const y = 50 - (d.design.mood.energy * 2 - 1) * 38;
          return (
            <a key={d.id} className="dot" href={`#/day/${encodeURIComponent(d.id)}`} style={{ left: `${x}%`, top: `${y}%` }} title={d.title}>
              {covers[d.id] ? <img src={covers[d.id]} alt="" /> : <div style={{ width: 92, height: 115, background: d.design.palette.colors[2] }} />}
              <span>{d.title}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
