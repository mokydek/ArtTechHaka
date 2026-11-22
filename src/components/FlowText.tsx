import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { DiaryFont, PageDeco, PageNote, PageStroke } from '../lib/types';

/**
 * Текст, который обтекает рисунок и надписи на странице (как в референсе Raspberry
 * «Digital Diary that is truly yours»): страница сканируется построчно, в каждой строке
 * ищутся свободные промежутки между нарисованным, и слова раскладываются только в них.
 * Координаты рисунка и надписей — в долях ширины блока (×1000), чтобы не искажались.
 */
const FAMILY: Record<DiaryFont, string> = {
  hand: '500 {s}px Caveat, cursive',
  script: '400 {s}px "Marck Script", cursive',
  print: '400 {s}px "Imprint Text", Georgia, serif',
  type: '400 {s}px "PT Mono", monospace',
};
export const fontSpec = (f: DiaryFont, size: number) => FAMILY[f].replace('{s}', String(Math.round(size * 10) / 10));

type Line = { x: number; y: number; t: string };

let measurer: CanvasRenderingContext2D | null = null;
function ctx2d() {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  return measurer!;
}

/** занятые места: рисунок (с запасом) и прямоугольники надписей, растром в 1/4 */
function obstacleMask(w: number, h: number, strokes: PageStroke[], notes: PageNote[], noteBox: (n: PageNote) => [number, number, number, number], gap: number) {
  const q = 4;
  const cw = Math.max(1, Math.ceil(w / q));
  const ch = Math.max(1, Math.ceil(h / q));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d')!;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = '#000';
  g.fillStyle = '#000';
  const k = w / 1000 / q;
  for (const s of strokes) {
    if (s.p.length < 2) continue;
    g.lineWidth = (s.w * w) / 1000 / q + (gap * 2) / q;
    g.beginPath();
    g.moveTo(s.p[0] * k, s.p[1] * k);
    for (let i = 2; i < s.p.length; i += 2) g.lineTo(s.p[i] * k, s.p[i + 1] * k);
    if (s.p.length === 2) g.lineTo(s.p[0] * k + 0.01, s.p[1] * k);
    g.stroke();
  }
  for (const n of notes) {
    const [x, y, bw, bh] = noteBox(n);
    g.fillRect((x - gap) / q, (y - gap) / q, (bw + gap * 2) / q, (bh + gap * 2) / q);
  }
  const data = g.getImageData(0, 0, cw, ch).data;
  return { cw, ch, q, hit: (cx: number, cy: number) => data[(cy * cw + cx) * 4 + 3] > 16 };
}

export function layoutFlow(text: string, font: DiaryFont, fs: number, lh: number, w: number, h: number, deco?: PageDeco, top = 0): Line[] {
  if (!w || !h) return [];
  const g = ctx2d();
  g.font = fontSpec(font, fs);
  const space = g.measureText(' ').width;
  const strokes = deco?.strokes ?? [];
  const notes = deco?.notes ?? [];
  const box = (n: PageNote) => noteRect(n, w);
  const mask = strokes.length || notes.length ? obstacleMask(w, h, strokes, notes, box, Math.max(6, fs * 0.35)) : null;
  // свободные промежутки строки
  const segments = (y: number): [number, number][] => {
    if (!mask) return [[0, w]];
    const r0 = Math.max(0, Math.floor(y / mask.q));
    const r1 = Math.min(mask.ch - 1, Math.ceil((y + lh) / mask.q));
    const out: [number, number][] = [];
    let start = -1;
    for (let c = 0; c <= mask.cw; c++) {
      let blocked = c === mask.cw;
      if (!blocked) for (let r = r0; r <= r1 && !blocked; r++) blocked = mask.hit(c, r);
      if (!blocked && start < 0) start = c;
      if (blocked && start >= 0) {
        const a = start * mask.q;
        const b = Math.min(w, c * mask.q);
        if (b - a >= Math.max(36, fs * 1.6)) out.push([a, b]);
        start = -1;
      }
    }
    return out;
  };
  const paras = text.replace(/\r/g, '').split('\n');
  const lines: Line[] = [];
  let y = top;
  for (let pi = 0; pi < paras.length && y + lh <= h + 1; pi++) {
    const words = paras[pi].split(/\s+/).filter(Boolean);
    if (!words.length) {
      y += lh;
      continue;
    }
    let wi = 0;
    while (wi < words.length && y + lh <= h + 1) {
      const segs = segments(y);
      for (const [a, b] of segs) {
        if (wi >= words.length) break;
        let x = a;
        const chunk: string[] = [];
        while (wi < words.length) {
          const ww = g.measureText(words[wi]).width;
          const need = (chunk.length ? space : 0) + ww;
          if (x + need > b) {
            // слово длиннее всего промежутка в полную ширину — ставим как есть
            if (!chunk.length && b - a >= w * 0.9) {
              chunk.push(words[wi++]);
            }
            break;
          }
          chunk.push(words[wi++]);
          x += need;
        }
        if (chunk.length) lines.push({ x: a, y, t: chunk.join(' ') });
      }
      y += lh;
    }
  }
  return lines;
}

/** прямоугольник надписи в пикселях блока */
export function noteRect(n: PageNote, w: number): [number, number, number, number] {
  const g = ctx2d();
  const fs = (n.s * w) / 1000;
  g.font = fontSpec(n.f, fs);
  const tw = Math.max(fs * 2, ...n.t.split('\n').map((l) => g.measureText(l || ' ').width));
  const lines = Math.max(1, n.t.split('\n').length);
  return [(n.x * w) / 1000, (n.y * w) / 1000, tw + fs * 0.4, lines * fs * 1.25];
}

export function strokePath(s: PageStroke, w: number) {
  const k = w / 1000;
  const p = s.p;
  if (p.length < 2) return '';
  let d = `M${(p[0] * k).toFixed(1)} ${(p[1] * k).toFixed(1)}`;
  if (p.length === 2) return d + ` l0.1 0`;
  for (let i = 2; i < p.length; i += 2) d += ` L${(p[i] * k).toFixed(1)} ${(p[i + 1] * k).toFixed(1)}`;
  return d;
}

/** Страница с обтекающим текстом. children — интерактивный слой редактора поверх */
export default function FlowText({ text, font, deco, className, style, children, onSize }: { text: string; font: DiaryFont; deco?: PageDeco; className?: string; style?: CSSProperties; children?: React.ReactNode; onSize?: (w: number, h: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [m, setM] = useState({ w: 0, h: 0, fs: 20, lh: 30, pt: 0 });
  const [fontsOk, setFontsOk] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const read = () => {
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || 20;
      const lh = parseFloat(cs.lineHeight) || fs * 1.3;
      const next = { w: el.clientWidth, h: el.clientHeight, fs, lh, pt: parseFloat(cs.paddingTop) || 0 };
      setM((o) => (o.w === next.w && o.h === next.h && o.fs === next.fs && o.lh === next.lh ? o : next));
      onSize?.(next.w, next.h);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [font]);
  useEffect(() => {
    let dead = false;
    document.fonts?.load(fontSpec(font, 20)).then(() => !dead && setFontsOk((x) => x + 1));
    for (const n of deco?.notes ?? []) document.fonts?.load(fontSpec(n.f, 20)).then(() => !dead && setFontsOk((x) => x + 1));
    return () => {
      dead = true;
    };
  }, [font, deco?.notes]);
  // надписи не выходят за край блока (в дневнике текстовая часть страницы ниже, чем в редакторе)
  const fit = useMemo(() => {
    if (!deco?.notes?.length || !m.w) return deco;
    const notes = deco.notes.map((n) => {
      const [x, y, bw, bh] = noteRect(n, m.w);
      const k = 1000 / m.w;
      return { ...n, x: Math.round(Math.max(0, Math.min(x, m.w - bw)) * k), y: Math.round(Math.max(0, Math.min(y, m.h - bh)) * k) };
    });
    return { ...deco, notes };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deco, m.w, m.h, fontsOk]);
  const lines = useMemo(() => layoutFlow(text, font, m.fs, m.lh, m.w, m.h, fit, 0), [text, font, m, fit, fontsOk]);
  return (
    <div ref={box} className={'flow f-' + font + (className ? ' ' + className : '')} style={style} data-i18n-skip>
      <svg className="flow-ink" width={m.w} height={m.h} aria-hidden>
        {(deco?.strokes ?? []).map((s, i) => (
          <path key={i} d={strokePath(s, m.w)} stroke={s.c} strokeWidth={(s.w * m.w) / 1000} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </svg>
      {lines.map((l, i) => (
        <span key={i} className="flow-l" style={{ left: l.x, top: l.y }}>
          {l.t}
        </span>
      ))}
      {(fit?.notes ?? []).map((n, i) => (
        <span key={'n' + i} className={'flow-note f-' + n.f} style={{ left: (n.x * m.w) / 1000, top: (n.y * m.w) / 1000, fontSize: (n.s * m.w) / 1000, color: n.c, rotate: `${n.r}deg` }}>
          {n.t}
        </span>
      ))}
      {children}
    </div>
  );
}
