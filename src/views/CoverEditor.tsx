import { useEffect, useMemo, useRef, useState } from 'react';
import { useDiary } from '../App';
import { COVERS, coverInfo } from '../lib/covers';
import { useCoverUrl } from '../components/Book';
import { newId } from '../lib/store';
import CutoutPicker from '../components/CutoutPicker';
import type { CoverStyle, Notebook } from '../lib/types';

type Cover = Notebook['cover'];

function Slide({ cover, title, nbId, pos, onClick }: { cover: Cover; title: string; nbId: string; pos: number; onClick: () => void }) {
  const url = useCoverUrl({ id: nbId, title: title || ' ', cover }, 520);
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
      aria-label={cover.style === 'custom' ? 'своя обложка' : coverInfo(cover.style).name}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <div className="book-ph" />}
    </button>
  );
}

/**
 * Обложка тетради: первая — чёрная, рядом две из каталога, дальше окошко
 * «каталог» или «своя» (картинка, PDF или цвет + узор + свои фото и стикеры).
 */
export default function CoverEditor({ id }: { id?: string }) {
  const { notebooks, saveNotebook, toast } = useDiary();
  const existing = notebooks.find((n) => n.id === id && !n.demo);
  const [title, setTitle] = useState(existing?.title ?? '');
  const start: Cover[] = useMemo(() => {
    const base: Cover[] = [{ style: 'black' }, { style: 'kraft' }, { style: 'guava' }];
    if (!existing) return base;
    const cur = existing.cover;
    return [cur, ...base.filter((b) => b.style !== cur.style)].slice(0, 3);
  }, [existing]);
  const [slides, setSlides] = useState<Cover[]>(start);
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<'pick' | 'catalog' | 'custom'>('pick');
  const [busy, setBusy] = useState(false);
  const nbId = useRef(existing?.id ?? newId()).current;
  const touch = useRef<number | null>(null);
  const last = slides.length; // последний «слайд» — окошко выбора
  const cur = i < last ? slides[i] : null;
  const info = cur && cur.style !== 'custom' ? coverInfo(cur.style) : { bg: '#2a2730', ink: '#efe9df' };

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || mode !== 'pick') return;
      if (e.key === 'ArrowRight') setI((x) => Math.min(last, x + 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [last, mode]);

  useEffect(() => {
    for (const el of [document.body, document.documentElement]) {
      el.style.setProperty('--ce-bg', info.bg);
      el.style.setProperty('--ce-ink', info.ink);
    }
    document.body.classList.add('ce-mode');
    return () => document.body.classList.remove('ce-mode');
  }, [info.bg, info.ink]);

  const choose = (c: Cover) => {
    // выбранная из каталога или своя встаёт второй, чтобы её сразу было видно
    const rest = slides.filter((s) => s.style !== c.style && s.style !== 'custom');
    const next = [rest[0], c, ...rest.slice(1)].slice(0, 3);
    setSlides(next);
    setI(1);
    setMode('pick');
  };

  const save = async () => {
    if (!cur) return;
    setBusy(true);
    const nb: Notebook = { id: nbId, title: title.trim() || 'Без названия', cover: cur, createdAt: existing?.createdAt ?? new Date().toISOString() };
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

  if (mode === 'custom') return <CustomCover title={title || 'Мой дневник'} onCancel={() => setMode('pick')} onDone={(c) => choose(c)} />;

  return (
    <div className="ce">
      <div className="ce-top">
        <a href={existing ? `#/nb/${existing.id}` : '#/'}>← {existing ? 'к тетради' : 'назад'}</a>
      </div>
      <input className="ce-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название тетради" maxLength={40} autoFocus={!existing} />
      <div
        className="ce-stage"
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          if (dx < -40) setI((x) => Math.min(last, x + 1));
          if (dx > 40) setI((x) => Math.max(0, x - 1));
          touch.current = null;
        }}
      >
        {slides.map((c, j) => (
          <Slide key={c.style + j} cover={c} title={title} nbId={nbId} pos={j - i} onClick={() => setI(j)} />
        ))}
        <div
          className="ce-slide ce-more"
          style={{
            transform: `translateX(${(last - i) * 62}%) scale(${last - i ? 0.72 : 1}) rotateY(${-(last - i) * 8}deg)`,
            opacity: Math.abs(last - i) > 2 ? 0 : last - i ? 0.75 : 1,
            zIndex: 10 - Math.abs(last - i),
          }}
          onClick={() => i !== last && setI(last)}
        >
          <b>Другая обложка</b>
          <button className="btn" onClick={() => setMode('catalog')} tabIndex={i === last ? 0 : -1}>
            Каталог обложек
          </button>
          <button className="btn ghost" onClick={() => setMode('custom')} tabIndex={i === last ? 0 : -1}>
            Создать свою
          </button>
        </div>
      </div>
      <div className="ce-name">{cur ? (cur.style === 'custom' ? 'своя' : coverInfo(cur.style).name) : ' '}</div>
      <div className="ce-dots">
        {[...slides, null].map((c, j) => (
          <button key={j} className={j === i ? 'on' : ''} onClick={() => setI(j)} aria-label={c ? (c.style === 'custom' ? 'своя' : coverInfo(c.style).name) : 'другая обложка'} />
        ))}
      </div>
      <button className="btn ce-save" onClick={save} disabled={busy || !cur}>
        {busy ? 'Сохраняю…' : existing ? 'Сохранить' : 'Поставить на полку'}
      </button>
      {mode === 'catalog' && (
        <div className="ce-catalog" role="dialog" aria-label="Каталог обложек" onClick={() => setMode('pick')}>
          <div onClick={(e) => e.stopPropagation()}>
            <div className="ce-cat-head">
              <b>Каталог обложек</b>
              <button className="bun-x" onClick={() => setMode('pick')} aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="ce-grid">
              {COVERS.map((c) => (
                <CatalogItem key={c.id} style={c.id} title={title} nbId={nbId} onPick={() => choose({ style: c.id })} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CatalogItem({ style, title, nbId, onPick }: { style: CoverStyle; title: string; nbId: string; onPick: () => void }) {
  const url = useCoverUrl({ id: nbId, title: title || ' ', cover: { style } }, 260);
  return (
    <button className="ce-item" onClick={onPick}>
      {url ? <img src={url} alt="" /> : <span className="book-ph" />}
      <small>{coverInfo(style).name}</small>
    </button>
  );
}

/* ——— своя обложка ——— */

type Pattern = 'none' | 'dots' | 'check' | 'stripes';
const PATTERNS: [Pattern, string][] = [
  ['none', 'Без узора'],
  ['dots', 'Горошек'],
  ['check', 'Клетка'],
  ['stripes', 'Полоска'],
];
const SWATCHES = ['#1c1a1f', '#2f3f75', '#4f3f99', '#c8402f', '#e8a59b', '#f2d36b', '#a7ad8a', '#efe6d6'];
interface Sticker {
  img: CanvasImageSource & { width: number; height: number };
  x: number;
  y: number;
  s: number;
  rot: number;
}

function CustomCover({ title, onDone, onCancel }: { title: string; onDone: (c: Cover) => void; onCancel: () => void }) {
  const [color, setColor] = useState('#2f3f75');
  const [pattern, setPattern] = useState<Pattern>('dots');
  const [pcolor, setPcolor] = useState('#f2d36b');
  const [bg, setBg] = useState<(CanvasImageSource & { width: number; height: number }) | null>(null);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [sel, setSel] = useState(-1);
  const [label, setLabel] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const drag = useRef<{ i: number; x: number; y: number; ox: number; oy: number } | null>(null);

  const paint = (g: CanvasRenderingContext2D, W: number, H: number, withLabel: boolean) => {
    g.clearRect(0, 0, W, H);
    if (bg) {
      const r = Math.max(W / bg.width, H / bg.height);
      g.drawImage(bg, (W - bg.width * r) / 2, (H - bg.height * r) / 2, bg.width * r, bg.height * r);
    } else {
      g.fillStyle = color;
      g.fillRect(0, 0, W, H);
      g.fillStyle = pcolor;
      g.strokeStyle = pcolor;
      const u = W / 12;
      if (pattern === 'dots') for (let y = 0, row = 0; y < H + u; y += u, row++) for (let x = row % 2 ? u / 2 : 0; x < W + u; x += u) g.beginPath(), g.arc(x, y, u * 0.16, 0, Math.PI * 2), g.fill();
      if (pattern === 'check') {
        g.globalAlpha = 0.35;
        for (let x = 0; x < W; x += u * 2) g.fillRect(x, 0, u, H);
        for (let y = 0; y < H; y += u * 2) g.fillRect(0, y, W, u);
        g.globalAlpha = 1;
      }
      if (pattern === 'stripes') for (let x = 0; x < W; x += u * 1.6) g.fillRect(x, 0, u * 0.6, H);
    }
    stickers.forEach((s) => {
      const w = s.s * W,
        h = (w * s.img.height) / s.img.width;
      g.save();
      g.translate(s.x * W, s.y * H);
      g.rotate((s.rot * Math.PI) / 180);
      g.shadowColor = 'rgba(0,0,0,.3)';
      g.shadowBlur = W * 0.02;
      g.shadowOffsetY = W * 0.006;
      g.drawImage(s.img, -w / 2, -h / 2, w, h);
      g.restore();
    });
    if (withLabel && label) {
      // подпись как на настоящей тетради — для предпросмотра
      const lw = W * 0.62,
        lh = H * 0.15,
        x = (W - lw) / 2,
        y = H * 0.16;
      g.fillStyle = '#fbf8f1';
      g.beginPath();
      g.roundRect(x, y, lw, lh, W * 0.017);
      g.fill();
      g.fillStyle = '#2a2a2a';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `500 ${lh * 0.42}px Caveat, cursive`;
      g.fillText(title, W / 2, y + lh / 2 + 2, lw - 20);
    }
  };

  useEffect(() => {
    const c = cv.current!;
    paint(c.getContext('2d')!, c.width, c.height, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, pattern, pcolor, bg, stickers, label, title]);

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setErr('');
    try {
      if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const doc = await pdfjs.getDocument({ data: await f.arrayBuffer() }).promise;
        const page = await doc.getPage(1);
        const vp = page.getViewport({ scale: 1 });
        const sc = 1400 / Math.max(vp.width, vp.height);
        const v = page.getViewport({ scale: sc });
        const c = document.createElement('canvas');
        c.width = Math.round(v.width);
        c.height = Math.round(v.height);
        await page.render({ canvasContext: c.getContext('2d')!, viewport: v }).promise;
        setBg(c);
      } else setBg(await createImageBitmap(f));
    } catch (e) {
      console.error(e);
      setErr('Не получилось открыть файл. Попробуй PNG, JPG или PDF.');
    }
  };

  const hit = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width,
      py = (e.clientY - r.top) / r.height;
    for (let k = stickers.length - 1; k >= 0; k--) {
      const s = stickers[k];
      const hw = s.s / 2,
        hh = ((s.s * s.img.height) / s.img.width / 2) * (r.width / r.height);
      if (Math.abs(px - s.x) < hw && Math.abs(py - s.y) < hh) return { k, px, py };
    }
    return { k: -1, px, py };
  };
  const set = (k: number, p: Partial<Sticker>) => setStickers((list) => list.map((s, j) => (j === k ? { ...s, ...p } : s)));

  const done = async () => {
    setBusy(true);
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 800;
    paint(c.getContext('2d')!, 600, 800, false);
    onDone({ style: 'custom', image: c.toDataURL('image/jpeg', 0.86), label });
  };

  return (
    <div className="cc">
      <div className="ce-top">
        <button className="cc-back" onClick={onCancel}>
          ← к обложкам
        </button>
      </div>
      <div className="cc-body">
        <div className="cc-preview">
          <canvas
            ref={cv}
            width={480}
            height={640}
            onPointerDown={(e) => {
              const h = hit(e);
              setSel(h.k);
              if (h.k < 0) return;
              drag.current = { i: h.k, x: h.px, y: h.py, ox: stickers[h.k].x, oy: stickers[h.k].y };
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const g = drag.current;
              if (!g) return;
              const r = cv.current!.getBoundingClientRect();
              set(g.i, { x: Math.max(0, Math.min(1, g.ox + (e.clientX - r.left) / r.width - g.x)), y: Math.max(0, Math.min(1, g.oy + (e.clientY - r.top) / r.height - g.y)) });
            }}
            onPointerUp={() => (drag.current = null)}
          />
          {sel >= 0 && stickers[sel] && (
            <div className="fr-tools cc-tools">
              <button onClick={() => set(sel, { rot: stickers[sel].rot - 10 })} aria-label="Повернуть влево">
                ⟲
              </button>
              <button onClick={() => set(sel, { rot: stickers[sel].rot + 10 })} aria-label="Повернуть вправо">
                ⟳
              </button>
              <button onClick={() => set(sel, { s: Math.max(0.12, stickers[sel].s - 0.06) })} aria-label="Меньше">
                −
              </button>
              <button onClick={() => set(sel, { s: Math.min(1, stickers[sel].s + 0.06) })} aria-label="Больше">
                +
              </button>
              <button
                onClick={() => {
                  setStickers((l) => l.filter((_, j) => j !== sel));
                  setSel(-1);
                }}
                aria-label="Убрать"
              >
                ×
              </button>
            </div>
          )}
        </div>
        <div className="cc-ctl">
          <h3>Готовая картинка</h3>
          <p className="muted">Нарисовала в Ibis Paint или Фотошопе? Загрузи PNG, JPG или PDF.</p>
          <div className="cc-row">
            <button className="btn ghost small" onClick={() => file.current?.click()}>
              Загрузить файл
            </button>
            {bg && (
              <button className="tab" onClick={() => setBg(null)}>
                Убрать картинку
              </button>
            )}
            <input ref={file} type="file" accept="image/*,application/pdf,.pdf" hidden onChange={(e) => void upload(e.target.files?.[0])} />
          </div>
          {err && <p className="hint">{err}</p>}

          <h3>Или собрать самой</h3>
          <div className="cc-label">Цвет</div>
          <div className="cc-row">
            {SWATCHES.map((c) => (
              <button key={c} className={'cc-sw' + (color === c ? ' on' : '')} style={{ background: c }} onClick={() => (setColor(c), setBg(null))} aria-label={c} />
            ))}
            <input type="color" value={color} onChange={(e) => (setColor(e.target.value), setBg(null))} aria-label="Свой цвет" />
          </div>
          <div className="cc-label">Узор</div>
          <div className="cc-row">
            {PATTERNS.map(([k, label]) => (
              <button key={k} className={'tab' + (pattern === k ? ' on' : '')} onClick={() => (setPattern(k), setBg(null))}>
                {label}
              </button>
            ))}
            {pattern !== 'none' && <input type="color" value={pcolor} onChange={(e) => setPcolor(e.target.value)} aria-label="Цвет узора" />}
          </div>
          <div className="cc-label">Свои фото и стикеры</div>
          <CutoutPicker count={stickers.length} onAdded={(c) => setStickers((l) => [...l, { img: c.rt.img, x: 0.5, y: 0.6, s: 0.5, rot: (Math.random() - 0.5) * 16 }])} />
          <label className="cc-check">
            <input type="checkbox" checked={label} onChange={(e) => setLabel(e.target.checked)} /> Подпись с названием
          </label>
          <button className="btn" onClick={done} disabled={busy}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
