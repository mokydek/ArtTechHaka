import { useEffect, useState } from 'react';
import { useDiary } from '../App';
import Book from '../components/Book';
import { dayPrompt, onThisDay, plural, streak, todayISO } from '../lib/prompts';
import { humanDate } from '../lib/render/engine';
import Envelope, { countdown, useNow } from '../components/Envelope';
import Rewind from '../components/Rewind';
import type { DayRecord } from '../lib/types';

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
  const { notebooks, daysOf, days, covers, store, capsules, sealed, defaultNotebook, loading } = useDiary();
  const now = useNow(1000);
  const [rw, setRw] = useState<DayRecord | null>(null);
  const travel = () => {
    const past = days.filter((d) => d.date < today);
    const pool = past.length ? past : days;
    if (!pool.length) return;
    // старые дни выпадают чаще: о них легче забыть
    const w = pool.map((d) => 1 + (Date.now() - new Date(d.date).getTime()) / (86400000 * 30));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    let i = 0;
    while (r > w[i] && i < w.length - 1) r -= w[i++];
    setRw(pool[i]);
  };
  const letters = [...capsules].sort((a, b) => Number(!!a.openedAt) - Number(!!b.openedAt) || a.openAt.localeCompare(b.openAt));
  const perRow = usePerRow();
  const today = todayISO();
  const s = streak(days, today);
  const otd = onThisDay(days.filter((d) => d.date !== today), today);
  const own = days.filter((d) => !d.demo);
  const recent = [...own].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  const items = [...notebooks.map((nb) => ({ nb })), { nb: null }];
  const rows: (typeof items)[] = [];
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow));

  return (
    <>
      {rw && <Rewind to={rw} onDone={() => (location.hash = `#/day/${encodeURIComponent(rw.id)}`)} />}
      <section className="today">
        <div className="today-main">
          <div className="today-stamp">
            <Dater date={today} />
            {store && <span className="muted">{store.kind === 'cloud' ? 'хранится в облаке' : 'хранится на этом устройстве'}</span>}
          </div>
          {own.length ? (
            <h1 className="h1">{greeting()}</h1>
          ) : (
            <h1 className="h1">
              Фото помнят, как выглядел день. <em>Echo</em> помнит, как он ощущался.
            </h1>
          )}
          <div className="prompt-card">
            <div className="mono muted">о чём написать сегодня</div>
            <div className="prompt">{dayPrompt(today)}</div>
            <div className="today-actions">
              <a className="btn" href="#/new">
                {s.today ? '+ Ещё один день' : '+ Записать сегодняшний день'}
              </a>
              {days.length > 1 && (
                <button className="btn ghost" onClick={travel}>
                  ⟲ Перенеси меня
                </button>
              )}
              {s.count > 0 && <span className="streak" title="дней подряд с записью">
                <span className="streak-n">{s.count}</span> {plural(s.count, 'день', 'дня', 'дней')} подряд
              </span>}
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

      {recent.length > 0 ? (
        <section className="recent">
          <div className="recent-head">
            <h2 className="h2">Недавние дни</h2>
            {defaultNotebook && (
              <a className="recent-all" href={`#/nb/${defaultNotebook}`}>
                Все дни
              </a>
            )}
          </div>
          <div className="recent-row">
            {recent.map((d) => (
              <a key={d.id} className="recent-card" href={`#/day/${encodeURIComponent(d.id)}`}>
                {covers[d.id] ? (
                  <img src={covers[d.id]} alt="" loading="lazy" />
                ) : (
                  <span className="recent-ph" style={{ background: `linear-gradient(160deg, ${d.design.palette.colors[1]}, ${d.design.palette.colors[3]})` }} />
                )}
                <b>{d.title}</b>
                <small>{humanDate(d.date)}</small>
              </a>
            ))}
          </div>
        </section>
      ) : (
        !loading && (
          <section className="how">
            <h2 className="h2">Как это работает</h2>
            <ol>
              <li>
                <b>1</b>
                <span>Напиши пару строк о дне, как близкому другу.</span>
              </li>
              <li>
                <b>2</b>
                <span>Добавь фото и песню, которые были в этот день.</span>
              </li>
              <li>
                <b>3</b>
                <span>Echo проявит живую страницу: цвета, движение и звук дня.</span>
              </li>
            </ol>
          </section>
        )
      )}

      <h2 className="h2 home-h">
        Тетради <small>{notebooks.length}</small>
      </h2>
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

      <h2 className="h2 home-h">Капсулы времени</h2>
      <div className="caps">
        {sealed.map((d) => {
          const cd = countdown(d.sealedUntil!, now);
          return (
            <a key={d.id} className="cap" href={`#/day/${encodeURIComponent(d.id)}`}>
              <Envelope small due={cd.done} tint="#d8c3a0" />
              <div className="cap-cap">
                <div className="cap-t">Запечатанный день</div>
                <div className="mono muted">{cd.done ? 'можно вскрыть' : cd.text}</div>
              </div>
            </a>
          );
        })}
        {letters.map((c) => {
          const cd = countdown(c.openAt, now);
          return (
            <a key={c.id} className={'cap' + (c.openedAt ? ' opened' : '')} href={`#/capsule/${c.id}`}>
              <Envelope small due={cd.done && !c.openedAt} />
              <div className="cap-cap">
                <div className="cap-t">{c.openedAt ? 'Письмо из прошлого' : 'Письмо себе'}</div>
                <div className="mono muted">{c.openedAt ? 'вскрыто' : cd.done ? 'можно вскрыть' : cd.text}</div>
              </div>
            </a>
          );
        })}
        <a className="cap cap-add" href="#/capsule/new">
          <span>+ письмо себе в будущее</span>
        </a>
      </div>
    </>
  );
}

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер';
}

const MON = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН', 'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
/** Сегодняшняя дата — оттиск штемпеля-датера: сам Echo начинается с печати */
function Dater({ date }: { date: string }) {
  const [y, m, d] = date.split('-').map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return (
    <span className="dater" role="img" aria-label={`${d} ${MON[m - 1].toLowerCase()} ${y}, ${wd}`}>
      <small>{wd}</small>
      <b>
        {String(d).padStart(2, '0')} {MON[m - 1]} {y}
      </b>
    </span>
  );
}
