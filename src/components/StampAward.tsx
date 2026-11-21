import { useEffect } from 'react';
import type { Earned } from '../lib/stamps';
import { STAMPS, stampArt } from '../lib/stamps';
import { stamp } from '../lib/sfx';
import { plural } from '../lib/prompts';

/** Вручение марок: падают по одной и гасятся штемпелем */
export default function StampAward({ list, onClose }: { list: Earned[]; onClose: () => void }) {
  const shown = list.slice(0, 5);
  useEffect(() => {
    const ts = shown.map((_, i) => setTimeout(stamp, 520 + i * 260));
    return () => ts.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  const one = list.length === 1;
  return (
    <div className="award" onClick={onClose}>
      <div className="award-box" onClick={(ev) => ev.stopPropagation()}>
        <div className="mono" style={{ color: '#f3e9c8', opacity: 0.8 }}>
          {one ? 'новая марка в альбоме' : `${list.length} ${plural(list.length, 'новая марка', 'новые марки', 'новых марок')} в альбоме`}
        </div>
        <div className="award-row">
          {shown.map((e, i) => {
            const no = STAMPS.findIndex((s) => s.id === e.def.id) + 1;
            return (
              <div key={e.def.id} className={'award-stamp' + (one ? '' : ' many')} style={{ animationDelay: `${i * 0.26}s`, ['--rot' as string]: `${(i - (shown.length - 1) / 2) * 7 - 3}deg` }}>
                <img src={stampArt(e.def, no)} alt="" />
                <span className={'postmark' + (one ? ' big' : '')} style={{ animationDelay: `${0.55 + i * 0.26}s` }}>
                  {e.day ? e.day.date.split('-').reverse().join('.') : 'ECHO'}
                </span>
              </div>
            );
          })}
        </div>
        <div className="award-title">{one ? list[0].def.title : list.map((e) => e.def.title).join(' · ')}</div>
        {one && list[0].day && <div className="mono" style={{ color: '#f3e9c8', opacity: 0.7 }}>за день «{list[0].day.title}»</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <a className="btn light" href="#/stamps" onClick={onClose}>
            В альбом
          </a>
          <button className="btn ghost light" onClick={onClose}>
            Дальше
          </button>
        </div>
      </div>
    </div>
  );
}
