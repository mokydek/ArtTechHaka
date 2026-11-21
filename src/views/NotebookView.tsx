import { useEffect, useMemo, useState } from 'react';
import { useDiary } from '../App';
import { useCoverUrl } from '../components/Book';
import Timeline from '../components/Timeline';
import Journal from '../components/Journal';
import YearPixels from '../components/YearPixels';
import MoodMap from '../components/MoodMap';
import { MODES } from '../lib/design/system';
import { plural } from '../lib/prompts';
import type { DayRecord } from '../lib/types';
import ShareLink from '../components/ShareLink';
import Members from '../components/Members';

const TABS: [string, string][] = [
  ['timeline', 'Лента'],
  ['book', 'Листать'],
  ['photos', 'Фото'],
  ['year', 'Год'],
  ['map', 'Настроения'],
];

export default function NotebookView({ id, tab }: { id: string; tab: string }) {
  const { notebooks, daysOf, covers, loading, sealed, notebookOf } = useDiary();
  const nb = notebooks.find((n) => n.id === id);
  const all = nb ? daysOf(nb.id) : [];
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('all');
  const [share, setShare] = useState(false);
  const [people, setPeople] = useState(false);
  const days = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((d) => (mode === 'all' || d.design.mode === mode) && (!s || (d.title + ' ' + d.text + ' ' + d.music.artist + ' ' + d.music.title + ' ' + (d.place?.name ?? '')).toLowerCase().includes(s)));
  }, [all, q, mode]);
  const cover = useCoverUrl(nb ?? { id: '-', title: ' ', cover: { style: 'kraft' } }, 300);

  if (!nb) return <p className="muted">{loading ? 'Открываю тетрадь…' : 'Тетрадь не найдена.'}</p>;
  const modesPresent = [...new Set(all.map((d) => d.design.mode))];
  const filterable = tab === 'timeline' || tab === 'photos';

  return (
    <>
      <section className="nb-head">
        <a href={nb.demo || nb.shared ? undefined : `#/nb/${nb.id}/cover`} className="nb-cover">
          {cover && <img src={cover} alt="" />}
        </a>
        <div className="nb-info">
          <a className="mono muted" href="#/">
            ← полка
          </a>
          <h1 className="h1" style={{ fontSize: 46, margin: '6px 0 4px' }}>
            {nb.title}
          </h1>
          <div className="mono muted">
            {all.length} {plural(all.length, 'запись', 'записи', 'записей')}
            {all.length > 0 && ` · ${all[all.length - 1].date.slice(0, 7).split('-').reverse().join('.')}, ${all[0].date.slice(0, 7).split('-').reverse().join('.')}`}
            {(nb.shared || nb.inviteCode) && <span className="nb-shared">общая</span>}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            {!nb.demo && (
              <>
                <a className="btn" href={`#/new/${nb.id}`}>
                  + Записать день
                </a>
                {!nb.shared && (
                  <a className="btn ghost" href={`#/nb/${nb.id}/cover`}>
                    Обложка и название
                  </a>
                )}
                <button className="btn ghost" onClick={() => setPeople(true)}>
                  👥 {nb.shared ? 'Участники' : 'Общий доступ'}
                </button>
              </>
            )}
            {all.length >= 2 && (
              <a className="btn ghost" href={`#/film/nb/${nb.id}`}>
                ▶ Фильм тетради
              </a>
            )}
            {all.length > 0 && (
              <button className="btn ghost" onClick={() => setShare(true)}>
                ⤴ Поделиться ссылкой
              </button>
            )}
          </div>
        </div>
      </section>

      {people && <Members nb={nb} onClose={() => setPeople(false)} />}
      {share && <ShareLink title={nb.title} days={all.filter((d) => !d.sealedUntil)} onClose={() => setShare(false)} />}
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <a key={k} className={'tab' + (tab === k ? ' on' : '')} href={`#/nb/${nb.id}/${k}`}>
            {label}
          </a>
        ))}
        {filterable && all.length > 1 && (
          <>
            <span style={{ width: 14 }} />
            <button className={'tab' + (mode === 'all' ? ' on' : '')} onClick={() => setMode('all')}>
              все
            </button>
            {modesPresent.map((m) => (
              <button key={m} className={'tab' + (mode === m ? ' on' : '')} onClick={() => setMode(m)}>
                {MODES[m].name}
              </button>
            ))}
            <input className="search" placeholder="найти: «какао», «ночь», «Синатра»…" value={q} onChange={(e) => setQ(e.target.value)} />
          </>
        )}
      </div>

      {!all.length ? (
        <div className="empty">
          <p className="muted">В тетради пока пусто.</p>
          {!nb.demo && (
            <a className="btn" href={`#/new/${nb.id}`}>
              + Записать первый день
            </a>
          )}
        </div>
      ) : tab === 'book' ? (
        <Journal nb={nb} days={all} />
      ) : tab === 'photos' ? (
        <PhotoWall days={days} />
      ) : tab === 'year' ? (
        <YearPixels days={all} />
      ) : tab === 'map' ? (
        <MoodMap days={all} covers={covers} />
      ) : (
        <Timeline days={days} sealed={sealed.filter((d) => notebookOf(d) === id)} />
      )}
    </>
  );
}

function PhotoWall({ days }: { days: DayRecord[] }) {
  const { photos, covers, loadPhotos } = useDiary();
  useEffect(() => loadPhotos(days), [days, loadPhotos]);
  const items = days.flatMap((d) => {
    const p = photos[d.id];
    return (p?.length ? p : covers[d.id] ? [covers[d.id]] : []).map((u, i) => ({ d, u, i }));
  });
  return (
    <div className="pw">
      {items.map(({ d, u, i }) => (
        <a key={d.id + i} href={`#/day/${encodeURIComponent(d.id)}`} title={d.title}>
          <img src={u} alt="" loading="lazy" />
        </a>
      ))}
    </div>
  );
}
