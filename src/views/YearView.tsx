import { useDiary } from '../App';
import YearPixels from '../components/YearPixels';
import MoodMap from '../components/MoodMap';
import { MODES } from '../lib/design/system';
import { plural, streak } from '../lib/prompts';
import type { ModeId } from '../lib/types';

export default function YearView() {
  const { days, covers } = useDiary();
  const s = streak(days);
  const byMode = days.reduce<Record<string, number>>((a, d) => ((a[d.design.mode] = (a[d.design.mode] ?? 0) + 1), a), {});
  const top = Object.entries(byMode).sort((a, b) => b[1] - a[1]);
  const artists = days.reduce<Record<string, number>>((a, d) => ((a[d.music.artist || d.music.title] = (a[d.music.artist || d.music.title] ?? 0) + 1), a), {});
  const bpms = days.map((d) => d.analysis.music.audio?.bpm).filter((b): b is number => !!b);
  const avgBpm = bpms.length ? Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length) : 0;
  const warm = days.length ? days.filter((d) => d.design.mood.warmth > 0).length / days.length : 0;

  return (
    <>
      <div className="sec">
        <b>●</b> Все тетради · {days.length} {plural(days.length, 'день', 'дня', 'дней')}
      </div>
      <h1 className="h1" style={{ fontSize: 46, marginBottom: 26 }}>
        Год в пикселях
      </h1>
      <div className="year">
        <YearPixels days={days} />
        <div className="stats">
          <div className="stat">
            <b>{s.count}</b>
            <span>{plural(s.count, 'день', 'дня', 'дней')} подряд</span>
          </div>
          <div className="stat">
            <b>{avgBpm}</b>
            <span>средний темп песен дня, BPM</span>
          </div>
          <div className="stat">
            <b>{Math.round(warm * 100)}%</b>
            <span>тёплых дней</span>
          </div>
          <div className="stat-list">
            <div className="mono muted">какими были дни</div>
            {top.map(([m, n]) => (
              <div key={m} className="mbar">
                <span>{MODES[m as ModeId].name}</span>
                <i style={{ width: `${(n / days.length) * 100}%` }} />
                <em>{n}</em>
              </div>
            ))}
          </div>
          <div className="stat-list">
            <div className="mono muted">голоса года</div>
            {Object.entries(artists)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([a, n]) => (
                <div key={a} className="mono">
                  ♪ {a} {n > 1 && <span className="muted">×{n}</span>}
                </div>
              ))}
          </div>
        </div>
      </div>
      <div className="sec" style={{ marginTop: 46 }}>
        Фильмы месяцев
      </div>
      <div className="tabs">
        {Object.entries(days.reduce<Record<string, number>>((a, d) => ((a[d.date.slice(0, 7)] = (a[d.date.slice(0, 7)] ?? 0) + 1), a), {}))
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([m, n]) => (
            <a key={m} className="tab" href={`#/film/m/${m}`}>
              ▶ {['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'][+m.slice(5, 7) - 1]} {m.slice(0, 4)} · {n}
            </a>
          ))}
      </div>
      <div className="sec" style={{ marginTop: 46 }}>
        Карта настроений
      </div>
      <MoodMap days={days} covers={covers} />
    </>
  );
}
