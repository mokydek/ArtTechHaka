import { useMemo, useState } from 'react';
import { useDiary } from '../App';
import { MODES } from '../lib/design/system';
import { humanDate } from '../lib/render/engine';
import type { DayRecord } from '../lib/types';

export default function Archive({ map }: { map?: boolean }) {
  const { days, covers, loading, store } = useDiary();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<string>('all');

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return days.filter((d) => (mode === 'all' || d.design.mode === mode) && (!s || (d.title + ' ' + d.text + ' ' + d.music.artist + ' ' + d.music.title).toLowerCase().includes(s)));
  }, [days, q, mode]);

  const modesPresent = [...new Set(days.map((d) => d.design.mode))];

  return (
    <>
      <section className="hero">
        <div>
          <div className="sec">
            <b>●</b> {days.length ? `${days.length} ${plural(days.length, 'день', 'дня', 'дней')} в дневнике` : 'дневник пуст'}
            {store && <span className="muted"> · {store.kind === 'cloud' ? 'облако' : 'локально на устройстве'}</span>}
          </div>
          <h1 className="h1">
            Фото помнят, как выглядел день. <em>Оттиск</em> — как он ощущался.
          </h1>
        </div>
        <div>
          <p className="muted">
            Напишите пару строк о дне, добавьте фото и песню. Система прочитает настроение, свет и музыку и проявит день как живую страницу дневника — со своей палитрой, ритмом, погодой и голосом. Каждая страница лежит в папке с названием, которое система придумала по записи.
          </p>
          <p style={{ marginTop: 18 }}>
            <a className="btn" href="#/new">
              + Записать сегодняшний день
            </a>
          </p>
        </div>
      </section>

      <div className="tabs">
        <a className={'tab' + (!map ? ' on' : '')} href="#/">
          Лента
        </a>
        <a className={'tab' + (map ? ' on' : '')} href="#/map">
          Карта настроений
        </a>
        {!map && (
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
            <input className="search" placeholder="найти день: «какао», «ночь», «Синатра»…" value={q} onChange={(e) => setQ(e.target.value)} />
          </>
        )}
      </div>

      {map ? (
        <MoodMap days={days} covers={covers} />
      ) : (
        <div className="grid">
          {list.map((d) => (
            <Card key={d.id} d={d} cover={covers[d.id]} />
          ))}
          {!list.length && !loading && <p className="muted">Ничего не нашлось.</p>}
        </div>
      )}
    </>
  );
}

function Card({ d, cover }: { d: DayRecord; cover?: string }) {
  return (
    <a className="card" href={`#/day/${encodeURIComponent(d.id)}`}>
      <div className="cv">{cover ? <img src={cover} alt={d.title} loading="lazy" /> : <div className="ph blink">проявляется…</div>}</div>
      <div className="ttl">
        <span className="folder-ic" />
        <span className="name">{d.title}</span>
      </div>
      <div className="meta">
        <span className="mono muted">{humanDate(d.date).split(' · ')[0]}</span>
        <span className="badge">{MODES[d.design.mode].name}</span>
      </div>
    </a>
  );
}

function MoodMap({ days, covers }: { days: DayRecord[]; covers: Record<string, string> }) {
  return (
    <div>
      <div className="map">
        <span className="ax" style={{ left: 14, top: '50%', transform: 'translateY(-130%)' }}>
          ← холоднее
        </span>
        <span className="ax" style={{ right: 14, top: '50%', transform: 'translateY(-130%)' }}>
          теплее →
        </span>
        <span className="ax" style={{ left: '50%', top: 10, transform: 'translateX(8px)' }}>
          ↑ насыщеннее
        </span>
        <span className="ax" style={{ left: '50%', bottom: 10, transform: 'translateX(8px)' }}>
          ↓ тише
        </span>
        {days.map((d, i) => {
          const x = 50 + d.design.mood.warmth * 42 + ((i % 3) - 1) * 1.5;
          const y = 50 - (d.design.mood.energy * 2 - 1) * 40;
          return (
            <a key={d.id} className="dot" href={`#/day/${encodeURIComponent(d.id)}`} style={{ left: `${x}%`, top: `${y}%` }} title={d.title}>
              {covers[d.id] ? <img src={covers[d.id]} alt="" /> : <div style={{ width: 92, height: 115, background: d.design.palette.colors[2] }} />}
              <span>{d.title}</span>
            </a>
          );
        })}
      </div>
      <p className="hint">Каждый день стоит там, где его поставила система: по горизонтали — тепло (фото, слова, песня), по вертикали — энергия. Так можно найти «все тихие тёплые вечера» без поиска по словам.</p>
    </div>
  );
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10,
    m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
