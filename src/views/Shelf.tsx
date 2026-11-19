import { useEffect, useState } from 'react';
import { useDiary } from '../App';
import Book from '../components/Book';
import { dayPrompt, onThisDay, plural, streak, todayISO } from '../lib/prompts';
import { humanDate } from '../lib/render/engine';

function usePerRow() {
  const calc = () => (window.innerWidth < 600 ? 2 : window.innerWidth < 1000 ? 3 : window.innerWidth < 1300 ? 4 : 5);
  const [n, setN] = useState(calc);
  useEffect(() => {
    const f = () => setN(calc());
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return n;
}

export default function Shelf() {
  const { notebooks, daysOf, days, covers, store } = useDiary();
  const perRow = usePerRow();
  const today = todayISO();
  const s = streak(days, today);
  const otd = onThisDay(days.filter((d) => d.date !== today), today);
  const items = [...notebooks.map((nb) => ({ nb })), { nb: null }];
  const rows: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));

  return (
    <>
      <section className="today">
        <div className="today-main">
          <div className="sec">
            <b>●</b> {humanDate(today)}
            {store && <span className="muted"> · {store.kind === 'cloud' ? 'облако' : 'на устройстве'}</span>}
          </div>
          <h1 className="h1">
            Фото помнят, как выглядел день. <em>Оттиск</em> — как он ощущался.
          </h1>
          <div className="prompt-card">
            <div className="mono muted">о чём написать сегодня</div>
            <div className="prompt">{dayPrompt(today)}</div>
            <div className="today-actions">
              <a className="btn" href="#/new">
                {s.today ? '+ Ещё один день' : '+ Записать сегодняшний день'}
              </a>
              <span className="streak" title="дней подряд с записью">
                <span className="streak-n">{s.count}</span> {plural(s.count, 'день', 'дня', 'дней')} подряд
              </span>
            </div>
          </div>
        </div>
        {otd && (
          <a className="otd" href={`#/day/${otd.day.id}`}>
            <div className="mono" style={{ color: 'var(--accent)' }}>
              ↺ {otd.label}
            </div>
            {covers[otd.day.id] && <img src={covers[otd.day.id]} alt="" />}
            <div className="otd-title">{otd.day.title}</div>
            <div className="mono muted">{humanDate(otd.day.date)}</div>
          </a>
        )}
      </section>

      <div className="sec" style={{ marginTop: 38 }}>
        Полка · {notebooks.length} {plural(notebooks.length, 'тетрадь', 'тетради', 'тетрадей')}
      </div>
      <div className="shelf">
        {rows.map((row, i) => (
          <div className="shelf-row" key={i} style={{ gridTemplateColumns: `repeat(${perRow}, 1fr)` }}>
            {row.map((it, j) =>
              it.nb ? (
                <Book key={it.nb.id} nb={it.nb} count={daysOf(it.nb.id).length} />
              ) : (
                <a key={'new' + j} className="book book-new" href="#/nb/new">
                  <div className="book-cover">
                    <span>+ новая тетрадь</span>
                  </div>
                  <div className="ledge" />
                </a>
              ),
            )}
          </div>
        ))}
      </div>
    </>
  );
}
