import { useCallback, useState } from 'react';
import { useDiary } from '../App';
import Journal from '../components/Journal';
import type { DayRecord } from '../lib/types';

/** Главная: сразу открытая тетрадь. Переключатель тетрадей — сверху, остальное в «Ещё». */
export default function JournalHome() {
  const { notebooks, daysOf, defaultNotebook, loading } = useDiary();
  const [id, setId] = useState(() => {
    try {
      return localStorage.getItem('ottisk:nb') || '';
    } catch {
      return '';
    }
  });
  const nb = notebooks.find((n) => n.id === id) ?? notebooks.find((n) => n.id === defaultNotebook) ?? notebooks[0];
  const pick = useCallback((v: string) => {
    setId(v);
    try {
      localStorage.setItem('ottisk:nb', v);
    } catch {
      /* без хранилища */
    }
  }, []);
  const [, setCur] = useState<DayRecord | null>(null);
  if (!nb) return <p className="muted jr-wait">{loading ? 'Открываю дневник…' : ''}</p>;
  return (
    <div className="jh">
      {notebooks.length > 1 && (
        <div className="jh-nbs" role="tablist" aria-label="Тетради">
          {notebooks.map((n) => (
            <button key={n.id} role="tab" aria-selected={n.id === nb.id} className={'tab' + (n.id === nb.id ? ' on' : '')} onClick={() => pick(n.id)}>
              {n.title}
            </button>
          ))}
          <a className="tab" href="#/shelf">
            Все тетради
          </a>
        </div>
      )}
      <Journal key={nb.id} nb={nb} days={daysOf(nb.id)} ready={!loading} onPage={setCur} />
    </div>
  );
}
