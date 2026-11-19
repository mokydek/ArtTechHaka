import { useEffect } from 'react';
import { useDiary } from '../App';
import { MODES } from '../lib/design/system';
import { moodLabel } from '../lib/pipeline';
import type { DayRecord } from '../lib/types';

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const time = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Лента как в Footnotes: месяцы-разделители, дата слева, полоска фото, подпись машинописью */
export default function Timeline({ days }: { days: DayRecord[] }) {
  const { covers, photos, loadPhotos } = useDiary();
  useEffect(() => loadPhotos(days), [days, loadPhotos]);
  let month = '';
  return (
    <div className="tl">
      {days.map((d) => {
        const dt = new Date(d.date + 'T12:00:00');
        const m = `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
        const sep = m !== month;
        month = m;
        const pics = [covers[d.id], ...(photos[d.id] ?? [])].filter(Boolean) as string[];
        const pal = d.design.palette;
        return (
          <div key={d.id}>
            {sep && <div className="tl-month">{m}</div>}
            <a className="tl-row" href={`#/day/${encodeURIComponent(d.id)}`}>
              <div className="tl-date">
                <b>{dt.getDate()}</b>
                <span>{WD[dt.getDay()]}</span>
              </div>
              <div className="tl-line" style={{ background: pal.accent }} />
              <div className="tl-body">
                <div className="tl-head">
                  <span className="pt">{time(d.createdAt)}</span>
                  <span className="pt">{moodLabel(d)}</span>
                  <span className="tl-mode" style={{ background: pal.colors[1], color: pal.paper }}>
                    {MODES[d.design.mode].name}
                  </span>
                </div>
                <div className="tl-title">{d.title}</div>
                <div className="tl-strip">
                  {pics.slice(0, 5).map((u, i) => (
                    <img key={u + i} src={u} alt="" loading="lazy" className={i === 0 ? 'first' : ''} />
                  ))}
                  {!pics.length && <div className="tl-ph" style={{ background: pal.colors[2] }} />}
                </div>
                <p className="pt tl-text">{d.text.length > 220 ? d.text.slice(0, 220).replace(/\s+\S*$/, '') + '…' : d.text}</p>
                <div className="pt muted">
                  ♪ {[d.music.artist, d.music.title].filter(Boolean).join(' — ')}
                  {d.place && <> · ⌖ {d.place.name}</>}
                </div>
              </div>
            </a>
          </div>
        );
      })}
    </div>
  );
}
