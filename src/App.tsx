import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { DayRecord } from './lib/types';
import { getStore, type DiaryStore } from './lib/store';
import { loadDemo } from './lib/demo';
import Archive from './views/Archive';
import NewDay from './views/NewDay';
import DayView from './views/DayView';
import SystemPage from './views/SystemPage';
import Seed from './views/Seed';

interface Diary {
  store: DiaryStore | null;
  days: DayRecord[];
  covers: Record<string, string>;
  loading: boolean;
  reload: () => Promise<DayRecord[]>;
  setCover: (id: string, url: string) => void;
  toast: (s: string) => void;
}
const Ctx = createContext<Diary>(null!);
export const useDiary = () => useContext(Ctx);

function useHash() {
  const [h, setH] = useState(location.hash || '#/');
  useEffect(() => {
    const f = () => {
      setH(location.hash || '#/');
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

export default function App() {
  const hash = useHash();
  const [store, setStore] = useState<DiaryStore | null>(null);
  const [mine, setMine] = useState<DayRecord[]>([]);
  const [demo, setDemo] = useState<DayRecord[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const toast = useCallback((s: string) => {
    setMsg(s);
    setTimeout(() => setMsg(''), 3200);
  }, []);

  const reload = useCallback(async () => {
    const s = await getStore();
    setStore(s);
    const list = await s.list();
    setMine(list);
    const c = await s.covers(list);
    setCovers((old) => ({ ...old, ...c }));
    return list;
  }, []);

  useEffect(() => {
    (async () => {
      const list = await reload().catch((e) => {
        console.error(e);
        return [] as DayRecord[];
      });
      setLoading(false);
      if (list.some((d) => d.demo)) return; // демо-дни уже лежат в облаке
      const d = await loadDemo((rec, c) => {
        setDemo((old) => (old.some((x) => x.id === rec.id) ? old : [...old, rec]));
        if (c) setCovers((old) => ({ ...old, [rec.id]: c }));
      });
      setDemo(d.days);
      setCovers((old) => ({ ...old, ...d.covers }));
    })();
  }, [reload]);

  const days = useMemo(
    () => [...mine, ...demo.filter((d) => !mine.some((m) => m.id === d.id))].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [mine, demo],
  );
  const setCover = useCallback((id: string, url: string) => setCovers((o) => ({ ...o, [id]: url })), []);

  const route = hash.replace(/^#/, '');
  let view = <Archive />;
  if (route.startsWith('/new')) view = <NewDay />;
  else if (route.startsWith('/day/')) view = <DayView id={decodeURIComponent(route.slice(5))} key={route} />;
  else if (route.startsWith('/system')) view = <SystemPage />;
  else if (route.startsWith('/map')) view = <Archive map />;
  else if (route.startsWith('/seed')) view = <Seed />;

  const on = (p: string) => (route === p || (p !== '/' && route.startsWith(p)) ? 'on' : '');
  return (
    <Ctx.Provider value={{ store, days, covers, loading, reload, setCover, toast }}>
      <header className="top">
        <a className="brand" href="#/">
          Оттиск<small>дневник атмосферы</small>
        </a>
        <nav className="nav">
          <a className={on('/') && !route.startsWith('/map') ? 'on' : ''} href="#/">
            Лента
          </a>
          <a className={on('/map')} href="#/map">
            Карта настроений
          </a>
          <a className={on('/system')} href="#/system">
            Визуальная система
          </a>
          <a className="btn" href="#/new">
            + Записать день
          </a>
        </nav>
      </header>
      <main className="page">{view}</main>
      {msg && <div className="toast">{msg}</div>}
    </Ctx.Provider>
  );
}
