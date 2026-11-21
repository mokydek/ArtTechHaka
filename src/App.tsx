import { getLang, setLang } from './lib/i18n';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Capsule, DayRecord, Notebook } from './lib/types';
import { getStore, newId, type DiaryStore } from './lib/store';
import { loadDemo } from './lib/demo';
import Mascot from './components/Mascot';
import { play, setSoundOn, soundOn } from './lib/feel';
import Shelf from './views/Shelf';
import JournalHome from './views/JournalHome';
import NotebookView from './views/NotebookView';
import CoverEditor from './views/CoverEditor';
import NewDay from './views/NewDay';
import DayView from './views/DayView';
import SystemPage from './views/SystemPage';
import YearView from './views/YearView';
import Seed from './views/Seed';
import Museum from './views/Museum';
import BeThere from './views/BeThere';
import CapsuleNew from './views/CapsuleNew';
import CapsuleView from './views/CapsuleView';
import Stamps from './views/Stamps';
import FilmView from './views/FilmView';
import PostcardView from './views/PostcardView';
import { AtmosBackdrop, AtmosChip, useAtmosColors } from './components/Atmosphere';
import { computeAtmos, mix, readable, type Motif } from './lib/atmos';
import { earnedStamps } from './lib/stamps';

export const DEMO_NOTEBOOK: Notebook = {
  id: 'demo',
  title: 'Дни команды',
  cover: { style: 'ransom' },
  createdAt: '2026-01-01T00:00:00Z',
  demo: true,
};

interface Diary {
  store: DiaryStore | null;
  days: DayRecord[];
  notebooks: Notebook[];
  covers: Record<string, string>;
  photos: Record<string, string[]>;
  loading: boolean;
  reload: () => Promise<DayRecord[]>;
  setCover: (id: string, url: string) => void;
  toast: (s: string) => void;
  notebookOf: (d: DayRecord) => string;
  daysOf: (nbId: string) => DayRecord[];
  loadPhotos: (recs: DayRecord[]) => void;
  saveNotebook: (nb: Notebook) => Promise<void>;
  defaultNotebook: string;
  capsules: Capsule[];
  saveCapsule: (c: Capsule) => Promise<void>;
  sealed: DayRecord[]; // запечатанные дни (ещё не вскрытые)
  setDraft: (m: Partial<Record<Motif, number>> | null) => void; // черновик записи: фон подстраивается, пока человек пишет
  setFocus: (f: Focus | null) => void; // открытый день: сайт берёт его цвета и мотивы
}
export interface Focus {
  motifs: Partial<Record<Motif, number>>;
  paper: string;
  accent: string;
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
  const [own, setOwn] = useState<Notebook[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [msg, setMsg] = useState('');
  const asked = useRef(new Set<string>());

  const toast = useCallback((s: string) => {
    play('note');
    setMsg(s);
    setTimeout(() => setMsg(''), 3200);
  }, []);

  const reload = useCallback(async () => {
    const s = await getStore();
    setStore(s);
    (window as unknown as Record<string, unknown>).__ottiskStore = s; // для проверок
    let nbs = await s.listNotebooks().catch(() => [] as Notebook[]);
    if (!nbs.length) {
      const first: Notebook = { id: newId(), title: 'Мой дневник', cover: { style: 'black' }, createdAt: new Date().toISOString() };
      await s.saveNotebook(first).catch(() => {});
      nbs = [first];
    }
    // первая тетрадь по умолчанию теперь чёрная: старую автоматическую крафтовую перекрашиваем один раз
    try {
      const auto = nbs.length === 1 && nbs[0].title === 'Мой дневник' && nbs[0].cover.style === 'kraft' && !localStorage.getItem('ottisk:black');
      localStorage.setItem('ottisk:black', '1');
      if (auto) {
        nbs = [{ ...nbs[0], cover: { style: 'black' } }];
        await s.saveNotebook(nbs[0]).catch(() => {});
      }
    } catch {
      /* без хранилища */
    }
    setOwn(nbs);
    const list = await s.list();
    setMine(list);
    s.listCapsules()
      .then(setCapsules)
      .catch(() => {});
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

  const everything = useMemo(
    () => [...mine, ...demo.filter((d) => !mine.some((m) => m.id === d.id))].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [mine, demo],
  );
  const days = useMemo(() => everything.filter((d) => !d.sealedUntil), [everything]);
  const sealed = useMemo(() => everything.filter((d) => !!d.sealedUntil), [everything]);
  const defaultNotebook = own[0]?.id ?? '';
  const notebooks = useMemo(() => [...own, DEMO_NOTEBOOK], [own]);
  const notebookOf = useCallback((d: DayRecord) => (d.demo ? DEMO_NOTEBOOK.id : d.notebookId && own.some((n) => n.id === d.notebookId) ? d.notebookId : defaultNotebook), [own, defaultNotebook]);
  const daysOf = useCallback((nbId: string) => days.filter((d) => notebookOf(d) === nbId), [days, notebookOf]);
  const setCover = useCallback((id: string, url: string) => setCovers((o) => ({ ...o, [id]: url })), []);

  const loadPhotos = useCallback(
    (recs: DayRecord[]) => {
      if (!store) return;
      const need = recs.filter((r) => !asked.current.has(r.id));
      if (!need.length) return;
      need.forEach((r) => asked.current.add(r.id));
      store.photos(need).then((p) => setPhotos((o) => ({ ...o, ...p })));
    },
    [store],
  );

  const saveNotebook = useCallback(
    async (nb: Notebook) => {
      if (!store) return;
      await store.saveNotebook(nb);
      setOwn((o) => (o.some((x) => x.id === nb.id) ? o.map((x) => (x.id === nb.id ? nb : x)) : [...o, nb]));
    },
    [store],
  );

  // марки копятся в альбоме тихо, без всплывающего окна
  useEffect(() => {
    if (loading) return;
    const e = earnedStamps(days.filter((d) => !d.demo), capsules);
    try {
      localStorage.setItem('ottisk:stamps', JSON.stringify(e.map((x) => x.def.id)));
    } catch {
      /* без хранилища */
    }
  }, [days, capsules, loading]);

  const saveCapsule = useCallback(
    async (c: Capsule) => {
      if (!store) return;
      await store.saveCapsule(c);
      setCapsules((o) => (o.some((x) => x.id === c.id) ? o.map((x) => (x.id === c.id ? c : x)) : [...o, c]));
    },
    [store],
  );

  const route = hash.replace(/^#/, '');
  const parts = route.split('/').filter(Boolean);
  let view = <JournalHome />;
  if (parts[0] === 'shelf') view = <Shelf />;
  else if (parts[0] === 'new') view = <NewDay nb={parts[1]} key={route} />;
  else if (parts[0] === 'day') view = <DayView id={decodeURIComponent(parts[1] ?? '')} key={route} />;
  else if (parts[0] === 'nb' && parts[2] === 'cover') view = <CoverEditor id={parts[1]} key={route} />;
  else if (parts[0] === 'nb' && parts[1] === 'new') view = <CoverEditor key={route} />;
  else if (parts[0] === 'nb') view = <NotebookView id={parts[1]} tab={parts[2] ?? 'timeline'} key={parts[1]} />;
  else if (parts[0] === 'year') view = <YearView />;
  else if (parts[0] === 'museum') view = <Museum />;
  else if (parts[0] === 'stamps') view = <Stamps />;
  else if (parts[0] === 'p') view = <PostcardView token={parts[1]} key={route} />;
  else if (parts[0] === 'film') view = <FilmView kind={parts[1]} id={parts[2]} key={route} />;
  else if (parts[0] === 'capsule' && parts[1] === 'new') view = <CapsuleNew key={route} />;
  else if (parts[0] === 'capsule') view = <CapsuleView id={parts[1]} key={route} />;
  else if (parts[0] === 'there') view = <BeThere dayId={parts[1] ? decodeURIComponent(parts[1]) : undefined} idx={parts[2] ? +parts[2] : 0} key={route} />;
  else if (parts[0] === 'system') view = <SystemPage />;
  else if (parts[0] === 'seed') view = <Seed />;

  // атмосфера: свои дни (а пока их нет — дни-примеры) + черновик, который пишут прямо сейчас
  const [draft, setDraft] = useState<Partial<Record<Motif, number>> | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const ownDays = useMemo(() => days.filter((d) => !d.demo), [days]);
  const atmos = useMemo(() => {
    const base = ownDays.length ? ownDays : days;
    if (draft) return computeAtmos(base, { motifs: draft, weight: ownDays.length ? 0.9 : 3 });
    if (!focus) return computeAtmos(base);
    // открытый день: его мотивы на фоне и цвета его снимков на всём сайте
    const a = computeAtmos(base, { motifs: focus.motifs, weight: 4 });
    return { ...a, paper: mix(a.paper, focus.paper, 0.7), paper2: mix(a.paper2, focus.paper, 0.45), accent: readable(mix(a.accent, focus.accent, 0.75)) };
  }, [ownDays, days, draft, focus]);
  useAtmosColors(atmos);
  const strength = parts[0] === 'day' || parts[0] === 'new' ? 0.7 : 1;

  const on = (p: string) => (p === '/' ? (!parts.length || parts[0] === 'nb' ? 'on' : '') : route.startsWith(p) ? 'on' : '');
  return (
    <Ctx.Provider value={{ store, days, notebooks, covers, photos, loading, reload, setCover, toast, notebookOf, daysOf, loadPhotos, saveNotebook, defaultNotebook, capsules, saveCapsule, sealed, setDraft, setFocus }}>
      <AtmosBackdrop atmos={atmos} strength={strength} />
      <header className="top">
        <span className="brand-wrap">
          <a className="brand" href="#/">
            Echo
          </a>
          <AtmosChip atmos={atmos} />
        </span>
        <nav className="nav">
          <a className={on('/')} href="#/">
            Дневник
          </a>
          <a className={on('/year')} href="#/year">
            Год
          </a>
          <a className={on('/there')} href="#/there">
            Побывать там
          </a>
          <More on={on} />
          <a className={'btn' + (!loading && !ownDays.length && parts[0] !== 'new' ? ' hint' : '')} href="#/new">
            + Записать день
          </a>
        </nav>
      </header>
      {!['there', 'p', 'film'].includes(parts[0]) && <TabBar on={on} hint={!loading && !ownDays.length && parts[0] !== 'new'} />}
      <main className="page">
        <div className={['there', 'p', 'film'].includes(parts[0]) ? undefined : 'page-in'} key={parts[0] ?? 'shelf'}>
          {view}
        </div>
      </main>
      {msg && <div className="toast">{msg}</div>}
      <Mascot route={parts[0] ?? ''} />
    </Ctx.Provider>
  );
}

/** «Ещё»: всё второстепенное — одним меню, чтобы шапка не путала */
const MORE: [string, string, string][] = [
  ['/shelf', 'Тетради и капсулы', 'все тетради, письма себе в будущее'],
  ['/museum', 'Музей мелочей', 'запахи, звуки, свет из всех дней'],
  ['/stamps', 'Альбом марок', 'марки за особенные дни'],
  ['/system', 'Как это устроено', 'правила, по которым день становится страницей'],
];
function More({ on }: { on: (p: string) => string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const f = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const h = () => setOpen(false);
    addEventListener('pointerdown', f);
    addEventListener('hashchange', h);
    return () => {
      removeEventListener('pointerdown', f);
      removeEventListener('hashchange', h);
    };
  }, [open]);
  const act = MORE.some(([p]) => on(p));
  return (
    <span className="more" ref={ref}>
      <button type="button" className={act ? 'on' : ''} onClick={() => setOpen((o) => (play(o ? 'popDown' : 'pop'), !o))} aria-expanded={open} data-sfx="none">
        Ещё ▾
      </button>
      {open && (
        <span className="more-pop">
          {MORE.map(([p, t, d]) => (
            <a key={p} href={'#' + p} className={on(p)}>
              <b>{t}</b>
              <small>{d}</small>
            </a>
          ))}
          <SoundSwitch />
          <LangSwitch />
        </span>
      )}
    </span>
  );
}

/** Телефон: нижняя панель, как в приложениях */
function TabBar({ on, hint }: { on: (p: string) => string; hint: boolean }) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const h = () => setMore(false);
    addEventListener('hashchange', h);
    return () => removeEventListener('hashchange', h);
  }, []);
  const isMore = MORE.some(([p]) => on(p));
  const idx = more ? 4 : on('/') ? 0 : on('/year') ? 1 : on('/there') ? 3 : isMore ? 4 : -1;
  // иконки панели нарисованы в ChatGPT (public/ui/ic-*.webp)
  const I = (n: string) => <img className="tab-ic" src={`/ui/ic-${n}.webp`} alt="" draggable={false} aria-hidden />;
  return (
    <>
      {more && (
        <div className="tab-sheet" onClick={() => (play('popDown'), setMore(false))}>
          <div onClick={(e) => e.stopPropagation()}>
            {MORE.map(([p, t, d]) => (
              <a key={p} href={'#' + p} className={on(p)}>
                <b>{t}</b>
                <small>{d}</small>
              </a>
            ))}
            <SoundSwitch />
          <LangSwitch />
          </div>
        </div>
      )}
      <nav className="tabbar">
        <span className={'tab-blob' + (idx < 0 ? ' off' : '')} style={{ '--i': Math.max(0, idx) } as React.CSSProperties} aria-hidden />
        <a href="#/" className={on('/')}>
          {I('notebook')}
          <span>Дневник</span>
        </a>
        <a href="#/year" className={on('/year')}>
          {I('year')}
          <span>Год</span>
        </a>
        <a href="#/new" className={'tab-new' + (on('/new') ? ' on' : '') + (hint ? ' hint' : '')} aria-label="Записать день">
          <img src="/ui/ic-plus.webp" alt="" draggable={false} />
        </a>
        <a href="#/there" className={on('/there')}>
          {I('there')}
          <span>Побывать</span>
        </a>
        <button type="button" className={MORE.some(([p]) => on(p)) ? 'on' : ''} onClick={() => setMore((m) => (play(m ? 'popDown' : 'pop'), !m))} data-sfx="none">
          {I('more')}
          <span>Ещё</span>
        </button>
      </nav>
    </>
  );
}

/** звуки интерфейса: включить или выключить */
/** Язык интерфейса: русский / английский */
function LangSwitch() {
  const l = getLang();
  return (
    <button
      type="button"
      className="sound-sw lang-sw"
      data-sfx="none"
      aria-label="Язык / Language"
      onClick={(e) => {
        e.preventDefault();
        setLang(l === 'ru' ? 'en' : 'ru');
      }}
    >
      <span className="lang-ic" aria-hidden>
        {l === 'ru' ? 'Ру' : 'En'}
      </span>
      <span>
        <b>Язык</b>
        <small>
          <i className={l === 'ru' ? 'on' : ''}>RU</i> / <i className={l === 'en' ? 'on' : ''}>EN</i>
        </small>
      </span>
    </button>
  );
}

function SoundSwitch() {
  const [v, setV] = useState(soundOn());
  return (
    <button
      type="button"
      className="sound-sw"
      role="switch"
      aria-checked={v}
      data-sfx="none"
      onClick={(e) => {
        e.preventDefault();
        setSoundOn(!v);
        setV(!v);
      }}
    >
      <img className={'sound-ic' + (v ? '' : ' off')} src="/ui/ic-sound.webp" alt="" aria-hidden draggable={false} />
      <span>
        <b>Звуки</b>
        <small>{v ? 'включены' : 'выключены'}</small>
      </span>
      <i className={'sw' + (v ? ' on' : '')} />
    </button>
  );
}
