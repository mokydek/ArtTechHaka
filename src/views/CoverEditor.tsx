import { useEffect, useRef, useState } from 'react';
import { useDiary } from '../App';
import { COVERS } from '../lib/covers';
import { useCoverUrl } from '../components/Book';
import { newId } from '../lib/store';
import type { CoverStyle, Notebook } from '../lib/types';

function Slide({ style, title, nbId, pos, onClick }: { style: CoverStyle; title: string; nbId: string; pos: number; onClick: () => void }) {
  const url = useCoverUrl({ id: nbId, title: title || ' ', cover: { style } }, 520);
  const a = Math.abs(pos);
  return (
    <button
      className="ce-slide"
      onClick={onClick}
      style={{
        transform: `translateX(${pos * 62}%) scale(${a ? 0.72 : 1}) rotateY(${-pos * 8}deg)`,
        opacity: a > 2 ? 0 : a ? 0.75 : 1,
        zIndex: 10 - a,
        pointerEvents: a > 2 ? 'none' : 'auto',
      }}
      tabIndex={a ? -1 : 0}
      aria-label={COVERS.find((c) => c.id === style)?.name}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <div className="book-ph" />}
    </button>
  );
}

export default function CoverEditor({ id }: { id?: string }) {
  const { notebooks, saveNotebook, toast } = useDiary();
  const existing = notebooks.find((n) => n.id === id && !n.demo);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [i, setI] = useState(Math.max(0, COVERS.findIndex((c) => c.id === (existing?.cover.style ?? 'kraft'))));
  const [busy, setBusy] = useState(false);
  const nbId = useRef(existing?.id ?? newId()).current;
  const touch = useRef<number | null>(null);
  const cur = COVERS[i];

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') setI((x) => Math.min(COVERS.length - 1, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, []);

  useEffect(() => {
    document.body.style.setProperty('--ce-bg', cur.bg);
    document.body.style.setProperty('--ce-ink', cur.ink);
    document.body.classList.add('ce-mode');
    return () => document.body.classList.remove('ce-mode');
  }, [cur.bg, cur.ink]);

  const save = async () => {
    setBusy(true);
    const nb: Notebook = { id: nbId, title: title.trim() || 'Без названия', cover: { style: cur.id }, createdAt: existing?.createdAt ?? new Date().toISOString() };
    try {
      await saveNotebook(nb);
      toast(existing ? 'Обложка обновлена' : `Тетрадь «${nb.title}» на полке`);
      location.hash = `#/nb/${nb.id}`;
    } catch (e) {
      console.error(e);
      toast('Не сохранилось');
      setBusy(false);
    }
  };

  return (
    <div className="ce">
      <div className="ce-top">
        <a className="mono" href={existing ? `#/nb/${existing.id}` : '#/'}>
          ← {existing ? 'к тетради' : 'на полку'}
        </a>
      </div>
      <input className="ce-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название тетради" maxLength={40} autoFocus={!existing} />
      <div
        className="ce-stage"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          if (dx < -40) setI((x) => Math.min(COVERS.length - 1, x + 1));
          if (dx > 40) setI((x) => Math.max(0, x - 1));
          touch.current = null;
        }}
      >
        {COVERS.map((c, j) => (
          <Slide key={c.id} style={c.id} title={title} nbId={nbId} pos={j - i} onClick={() => setI(j)} />
        ))}
      </div>
      <div className="ce-name">{cur.name}</div>
      <div className="ce-dots">
        {COVERS.map((c, j) => (
          <button key={c.id} className={j === i ? 'on' : ''} onClick={() => setI(j)} aria-label={c.name} />
        ))}
      </div>
      <button className="btn ce-save" onClick={save} disabled={busy}>
        {busy ? 'Сохраняю…' : existing ? 'Сохранить' : 'Поставить на полку'}
      </button>
    </div>
  );
}
