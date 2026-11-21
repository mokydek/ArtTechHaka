import { mulberry32 } from '../color';

// «Вырезанные буквы» как в скрапбуке: каждая буква — свой кусочек бумаги, шрифт, цвет и наклон

const FAMS = ['Ottisk, serif', 'Manrope, sans-serif', '"JetBrains Mono", monospace', 'Caveat, cursive', '"PT Mono", monospace'];
const WEIGHTS = ['600', '800', '500', '500', '400'];

export interface RansomOpts {
  x: number;
  y: number; // базовая линия
  size: number;
  maxWidth: number;
  seed: number;
  palette: string[]; // фоны кусочков
  ink?: string;
  align?: 'left' | 'center';
  appear?: number; // 0..1 — сколько букв уже наклеено
}

/** Рисует заголовок вырезанными буквами, возвращает высоту блока */
export function drawRansom(g: CanvasRenderingContext2D, text: string, o: RansomOpts): number {
  const rnd = mulberry32(o.seed);
  const chars = [...text];
  // раскладка по словам с переносом
  type Glyph = { ch: string; fam: number; size: number; w: number; bg: string; fg: string; rot: number; dy: number; pad: number; shape: number };
  const glyphs: Glyph[] = chars.map((ch) => {
    const fam = Math.floor(rnd() * FAMS.length);
    const size = o.size * (0.82 + rnd() * 0.36);
    g.font = `${WEIGHTS[fam]} ${size}px ${FAMS[fam]}`;
    const upper = rnd() < 0.55;
    const c = upper ? ch.toUpperCase() : ch.toLowerCase();
    const w = g.measureText(c).width;
    const dark = rnd() < 0.3;
    const bg = dark ? '#1d1b1f' : o.palette[Math.floor(rnd() * o.palette.length)];
    const fg = dark ? '#fbf8f1' : rnd() < 0.2 ? '#b23a2a' : (o.ink ?? '#1d1b1f');
    return { ch: c, fam, size, w, bg, fg, rot: (rnd() - 0.5) * 0.22, dy: (rnd() - 0.5) * size * 0.12, pad: size * (0.1 + rnd() * 0.1), shape: Math.floor(rnd() * 3) };
  });
  // строки
  const lines: Glyph[][] = [[]];
  let lw = 0;
  const space = o.size * 0.42;
  let word: Glyph[] = [];
  let ww = 0;
  const flush = () => {
    if (!word.length) return;
    if (lw + ww > o.maxWidth && lines[lines.length - 1].length) {
      lines.push([]);
      lw = 0;
    }
    lines[lines.length - 1].push(...word);
    lw += ww + space;
    word = [];
    ww = 0;
  };
  glyphs.forEach((gl) => {
    if (gl.ch === ' ') {
      flush();
      lines[lines.length - 1].push({ ...gl, w: space });
      return;
    }
    word.push(gl);
    ww += gl.w + gl.pad * 2 + 2;
  });
  flush();
  const lineH = o.size * 1.28;
  let shown = Math.floor((o.appear ?? 1) * glyphs.length + 0.001);
  lines.forEach((ln, li) => {
    const total = ln.reduce((s, gl) => s + (gl.ch === ' ' ? gl.w : gl.w + gl.pad * 2 + 2), 0);
    let x = o.align === 'center' ? o.x + (o.maxWidth - total) / 2 : o.x;
    const y = o.y + li * lineH;
    for (const gl of ln) {
      if (gl.ch === ' ') {
        x += gl.w;
        shown--;
        continue;
      }
      if (shown-- <= 0) return;
      const bw = gl.w + gl.pad * 2,
        bh = gl.size * 1.08;
      g.save();
      g.translate(x + bw / 2, y - gl.size * 0.34 + gl.dy);
      g.rotate(gl.rot);
      g.shadowColor = 'rgba(40,25,10,0.25)';
      g.shadowBlur = 3;
      g.shadowOffsetY = 1.5;
      g.fillStyle = gl.bg;
      g.beginPath();
      if (gl.shape === 0) g.rect(-bw / 2, -bh / 2, bw, bh);
      else if (gl.shape === 1) {
        // неровно вырезанный кусочек
        const j = gl.size * 0.06;
        g.moveTo(-bw / 2 + j, -bh / 2);
        g.lineTo(bw / 2, -bh / 2 + j);
        g.lineTo(bw / 2 - j, bh / 2);
        g.lineTo(-bw / 2, bh / 2 - j);
      } else g.ellipse(0, 0, bw / 2 + 2, bh / 2, 0, 0, Math.PI * 2);
      g.closePath();
      g.fill();
      g.shadowColor = 'transparent';
      g.fillStyle = gl.fg;
      g.font = `${WEIGHTS[gl.fam]} ${gl.size}px ${FAMS[gl.fam]}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(gl.ch, 0, gl.size * 0.04);
      g.restore();
      x += bw + 2;
    }
  });
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  return lines.length * lineH;
}
