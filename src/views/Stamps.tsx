import { useMemo } from 'react';
import { useDiary } from '../App';
import { STAMPS, earnedStamps, stampArt } from '../lib/stamps';
import { humanDate } from '../lib/render/engine';
import { plural } from '../lib/prompts';

/** Кляссер: марки за моменты, которые стоит помнить */
export default function Stamps() {
  const { days, capsules } = useDiary();
  const own = days.filter((d) => !d.demo);
  const example = !own.length;
  const earned = useMemo(() => earnedStamps(example ? days : own, example ? [] : capsules), [days, own, capsules, example]);
  const got = new Map(earned.map((e) => [e.def.id, e]));
  return (
    <>
      <div className="sec">
        <b>●</b> {earned.length} из {STAMPS.length} {plural(STAMPS.length, 'марки', 'марок', 'марок')}
        {example && <span className="muted"> · пример на днях команды, ваши марки появятся с первой записью</span>}
      </div>
      <h1 className="h1" style={{ fontSize: 46, marginBottom: 26 }}>
        Альбом марок
      </h1>
      <div className="album">
        {STAMPS.map((def, i) => {
          const e = got.get(def.id);
          return (
            <div key={def.id} className={'stamp' + (e ? '' : ' locked')}>
              <a className="stamp-img" href={e?.day ? `#/day/${encodeURIComponent(e.day.id)}` : undefined} style={{ ['--r' as string]: `${((i * 41) % 9) - 4}deg` }}>
                <img src={stampArt(def, i + 1, !e)} alt={def.title} />
                {e && <span className="postmark">{e.day ? e.day.date.split('-').reverse().join('.') : 'ECHO'}</span>}
              </a>
              <div className="stamp-cap">
                <div className="stamp-title">{e ? def.title : '???'}</div>
                <div className="mono muted">{e ? (e.day ? `${humanDate(e.day.date).split(' · ')[0]} · «${e.day.title}»` : 'получена') : def.hint}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
