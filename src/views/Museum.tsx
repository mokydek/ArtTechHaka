import { useMemo, useState } from 'react';
import { useDiary } from '../App';
import { DETAIL_KINDS, museum, type DetailKind } from '../lib/details';
import { plural } from '../lib/prompts';
import { humanDate } from '../lib/render/engine';

/** Музей мелочей: все запахи, звуки, свет, вкусы и сказанные слова из дневника */
export default function Museum() {
  const { days, covers } = useDiary();
  const all = useMemo(() => museum(days), [days]);
  const [only, setOnly] = useState<DetailKind | 'all'>('all');
  const total = DETAIL_KINDS.reduce((s, k) => s + all[k.id].length, 0);
  let no = 0;
  return (
    <>
      <div className="sec">
        <b>●</b> {total} {plural(total, 'экспонат', 'экспоната', 'экспонатов')} · {days.length} {plural(days.length, 'день', 'дня', 'дней')}
      </div>
      <h1 className="h1" style={{ fontSize: 46, marginBottom: 8 }}>
        Музей мелочей
      </h1>
      <p className="muted" style={{ maxWidth: 640, marginTop: 0 }}>
        Фото помнят, как выглядело. Здесь собрано то, что фото не сохраняет: чем пахло, что было слышно, какой был свет, что ели и что сказали.
      </p>
      <div className="tabs" style={{ marginTop: 18 }}>
        <button className={'tab' + (only === 'all' ? ' on' : '')} onClick={() => setOnly('all')}>
          все залы
        </button>
        {DETAIL_KINDS.filter((k) => all[k.id].length).map((k) => (
          <button key={k.id} className={'tab' + (only === k.id ? ' on' : '')} onClick={() => setOnly(k.id)}>
            {k.title} · {all[k.id].length}
          </button>
        ))}
      </div>
      {DETAIL_KINDS.filter((k) => all[k.id].length && (only === 'all' || only === k.id)).map((k) => (
        <section key={k.id} className="hall">
          <div className="hall-head">
            <span className="hall-mark">{k.mark}</span>
            <h2 className="h2" style={{ margin: 0 }}>
              {k.title}
            </h2>
            <span className="mono muted">{k.hint}</span>
          </div>
          <div className="exhibits">
            {all[k.id].map((x, i) => {
              no++;
              return (
                <a key={x.day.id + i} className="exhibit" href={`#/day/${encodeURIComponent(x.day.id)}`} style={{ ['--tilt' as string]: `${((no * 37) % 7) - 3}deg` }}>
                  <div className="exhibit-text">{k.id === 'said' ? `«${x.text}»` : x.text}</div>
                  <div className="exhibit-label">
                    {covers[x.day.id] && <img src={covers[x.day.id]} alt="" />}
                    <div>
                      <div className="mono">экспонат № {String(no).padStart(3, '0')}</div>
                      <div className="exhibit-day">{x.day.title}</div>
                      <div className="mono muted">{humanDate(x.day.date).split(' · ')[0]}</div>
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      ))}
      {!total && <p className="muted">Пока пусто — напишите, чем пахло и что было слышно, и здесь появятся первые экспонаты.</p>}
    </>
  );
}
