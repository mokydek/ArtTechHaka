import { useMemo, useState } from 'react';
import type { DayRecord, ModeId } from '../lib/types';
import { MODES } from '../lib/design/system';
import { MOOD_COLORS, MOOD_WORDS, moods, valenceMood, words, type Mood } from '../lib/moods';

const M = ['Я', 'Ф', 'М', 'А', 'М', 'И', 'И', 'А', 'С', 'О', 'Н', 'Д'];
export const MODE_COLOR: Record<ModeId, string> = {
  impression: '#d9a441',
  construct: '#c8402f',
  film: '#e07a3f',
  ma: '#8a8f99',
  collage: '#d96a9a',
  nocturne: '#2f3f75',
};

/** «Год в пикселях» (как Daylio): каждая клетка — день, цвет — режим, который выбрала система */
export default function YearPixels({ days }: { days: DayRecord[] }) {
  const years = useMemo(() => [...new Set(days.map((d) => +d.date.slice(0, 4)))].sort((a, b) => b - a), [days]);
  const [year, setYear] = useState(years[0] ?? new Date().getFullYear());
  const [by, setBy] = useState<By>('palette');
  const checks = useMemo(() => moods(), []);
  const map = useMemo(() => {
    const m = new Map<string, DayRecord>();
    for (const d of days) if (+d.date.slice(0, 4) === year && !m.has(d.date)) m.set(d.date, d);
    return m;
  }, [days, year]);
  const count = map.size;
  const modes = [...new Set([...map.values()].map((d) => d.design.mode))];

  return (
    <div className="yp">
      <div className="yp-bar">
        {years.map((y) => (
          <button key={y} className={'tab' + (y === year ? ' on' : '')} onClick={() => setYear(y)}>
            {y}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className={'tab' + (by === 'palette' ? ' on' : '')} onClick={() => setBy('palette')}>
          цвет дня
        </button>
        <button className={'tab' + (by === 'mode' ? ' on' : '')} onClick={() => setBy('mode')}>
          режим
        </button>
        <button className={'tab' + (by === 'mood' ? ' on' : '')} onClick={() => setBy('mood')}>
          настроение
        </button>
      </div>
      <div className="yp-grid">
        <span />
        {M.map((m, i) => (
          <span key={i} className="yp-m pt">
            {m}
          </span>
        ))}
        {Array.from({ length: 31 }, (_, di) => (
          <Row key={di} di={di} year={year} map={map} by={by} checks={checks} />
        ))}
      </div>
      <div className="yp-legend pt">
        <span>
          {count} из {new Date(year, 1, 29).getMonth() === 1 ? 366 : 365}
        </span>
        {by === 'mood'
          ? ([5, 4, 3, 2, 1] as Mood[]).map((m) => (
              <span key={m}>
                <i style={{ background: MOOD_COLORS[m] }} /> {MOOD_WORDS[m]}
              </span>
            ))
          : modes.map((m) => (
              <span key={m}>
                <i style={{ background: MODE_COLOR[m] }} /> {MODES[m].name}
              </span>
            ))}
      </div>
    </div>
  );
}

type By = 'mode' | 'palette' | 'mood';
const said = () => words();
function Row({ di, year, map, by, checks }: { di: number; year: number; map: Map<string, DayRecord>; by: By; checks: Record<string, Mood> }) {
  const w = useMemo(said, []);
  return (
    <>
      <span className="yp-d pt">{di + 1}</span>
      {Array.from({ length: 12 }, (_, mi) => {
        const exists = new Date(year, mi, di + 1).getMonth() === mi;
        const iso = `${year}-${String(mi + 1).padStart(2, '0')}-${String(di + 1).padStart(2, '0')}`;
        const d = map.get(iso);
        if (!exists) return <span key={mi} className="yp-c none" />;
        // настроение: отмеченное у зайчика, иначе — по записанному дню
        const m = checks[iso] ?? (d ? valenceMood(d.design.mood.valence) : undefined);
        if (!d) return by === 'mood' && m ? <span key={mi} className="yp-c on" title={`${iso} · ${MOOD_WORDS[m]}${w[iso] ? ` · «${w[iso]}»` : ''}`} style={{ background: MOOD_COLORS[m] }} /> : <span key={mi} className="yp-c" />;
        const bg = by === 'mode' ? MODE_COLOR[d.design.mode] : by === 'mood' ? MOOD_COLORS[m!] : d.design.palette.colors[2];
        return <a key={mi} className="yp-c on" href={`#/day/${encodeURIComponent(d.id)}`} title={`${iso} · ${d.title}`} style={{ background: bg }} />;
      })}
    </>
  );
}
