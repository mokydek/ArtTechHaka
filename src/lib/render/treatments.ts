import type { DesignSpec } from '../types';
import { clamp, hexToRgb, hslToRgb, mulberry32, rgbToHsl } from '../color';
import { canvas, ctx2d, softBlur, type Cnv } from './textures';

type Src = CanvasImageSource & { width: number; height: number };

// ——— Цветокор через 3D-LUT (64³) ———
type GradeFn = (r: number, g: number, b: number) => [number, number, number];
const LUT_N = 48;
function buildLut(fn: GradeFn): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(LUT_N * LUT_N * LUT_N * 3);
  let k = 0;
  for (let r = 0; r < LUT_N; r++)
    for (let g = 0; g < LUT_N; g++)
      for (let b = 0; b < LUT_N; b++) {
        const o = fn((r * 255) / (LUT_N - 1), (g * 255) / (LUT_N - 1), (b * 255) / (LUT_N - 1));
        lut[k++] = o[0];
        lut[k++] = o[1];
        lut[k++] = o[2];
      }
  return lut;
}
export function applyGrade(src: Cnv, fn: GradeFn): Cnv {
  const lut = buildLut(fn);
  const g = ctx2d(src);
  const img = g.getImageData(0, 0, src.width, src.height);
  const d = img.data;
  const q = (LUT_N - 1) / 255;
  for (let i = 0; i < d.length; i += 4) {
    const k = ((Math.round(d[i] * q) * LUT_N + Math.round(d[i + 1] * q)) * LUT_N + Math.round(d[i + 2] * q)) * 3;
    d[i] = lut[k];
    d[i + 1] = lut[k + 1];
    d[i + 2] = lut[k + 2];
  }
  g.putImageData(img, 0, 0);
  return src;
}

/** Базовый цветокор дня: тон к теплу/холоду, насыщенность, подтяжка к палитре */
export function moodGrade(spec: DesignSpec, extra?: { lift?: number; contrast?: number; light?: number; satMul?: number }): GradeFn {
  const w = spec.mood.warmth;
  const target = w >= 0 ? 32 : 215;
  const k = Math.abs(w) * 0.22;
  const sat = spec.saturation * (extra?.satMul ?? 1);
  const pal = spec.palette.colors.map((h) => hexToRgb(h));
  const lift = extra?.lift ?? 0;
  const con = extra?.contrast ?? 1;
  const light = extra?.light ?? 0;
  return (r, g, b) => {
    let [h, s, l] = rgbToHsl([r, g, b]);
    const dh = ((target - h + 540) % 360) - 180;
    h += dh * k * (0.4 + s);
    s = clamp(s * sat);
    l = clamp((l - 0.5) * con + 0.5 + light);
    l = lift + l * (1 - lift);
    let [R, G, B] = hslToRgb(h, s, l);
    // лёгкое притяжение к ближайшему цвету палитры
    let best = pal[0],
      bd = Infinity;
    for (const p of pal) {
      const d = (p[0] - R) ** 2 + (p[1] - G) ** 2 + (p[2] - B) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    const t = 0.12;
    return [R + (best[0] - R) * t, G + (best[1] - G) * t, B + (best[2] - B) * t];
  };
}

// ——— Импрессия: мазки ———
export interface Stroke {
  pts: number[]; // x0,y0,x1,y1,...
  w: number;
  c: string;
  a: number;
}

export function paintStrokes(src: Cnv, spec: DesignSpec, seed: number): Stroke[] {
  const W = src.width,
    H = src.height;
  const d = ctx2d(src).getImageData(0, 0, W, H).data;
  // интегральные изображения RGB и яркости
  const S = W + 1;
  const ir = new Float64Array(S * (H + 1));
  const ig = new Float64Array(S * (H + 1));
  const ib = new Float64Array(S * (H + 1));
  const il = new Float64Array(S * (H + 1));
  for (let y = 1; y <= H; y++) {
    let rr = 0,
      gg = 0,
      bb = 0,
      ll = 0;
    for (let x = 1; x <= W; x++) {
      const k = ((y - 1) * W + (x - 1)) * 4;
      rr += d[k];
      gg += d[k + 1];
      bb += d[k + 2];
      ll += 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2];
      const o = y * S + x;
      ir[o] = ir[o - S] + rr;
      ig[o] = ig[o - S] + gg;
      ib[o] = ib[o - S] + bb;
      il[o] = il[o - S] + ll;
    }
  }
  const box = (I: Float64Array, x: number, y: number, r: number) => {
    const x0 = clamp(Math.floor(x - r), 0, W),
      x1 = clamp(Math.ceil(x + r), 0, W);
    const y0 = clamp(Math.floor(y - r), 0, H),
      y1 = clamp(Math.ceil(y + r), 0, H);
    const a = (x1 - x0) * (y1 - y0) || 1;
    return (I[y1 * S + x1] - I[y0 * S + x1] - I[y1 * S + x0] + I[y0 * S + x0]) / a;
  };
  const grad = (x: number, y: number, r: number) => {
    const gx = box(il, x + r, y, r) - box(il, x - r, y, r);
    const gy = box(il, x, y + r, r) - box(il, x, y - r, r);
    return [gx, gy];
  };
  const rnd = mulberry32(seed);
  const accent = rgbToHsl(hexToRgb(spec.palette.accent));
  const sz = spec.strokeSize * (W / 936);
  // мельче, чем было: предмет на фото должен узнаваться, а не тонуть в кирпичах мазков
  const layers = [22, 11, 5.5].map((r) => r * sz);
  const out: Stroke[] = [];
  const globalAng = (rnd() - 0.5) * 0.8 - 0.4;
  layers.forEach((R, li) => {
    const step = R * 0.78;
    const layer: Stroke[] = [];
    for (let y = step / 2; y < H; y += step)
      for (let x = step / 2; x < W; x += step) {
        const px = x + (rnd() - 0.5) * step,
          py = y + (rnd() - 0.5) * step;
        const [gx, gy] = grad(px, py, Math.max(2, R * 0.35));
        const mag = Math.hypot(gx, gy);
        if (li === 1 && mag < 6 && rnd() < 0.55) continue;
        if (li === 2 && mag < 9 && rnd() < 0.85) continue;
        // кривой мазок вдоль изофот
        const pts = [px, py];
        let cx = px,
          cy = py;
        let dx = 0,
          dy = 0;
        const L = R * (1.1 + rnd() * 1.6);
        const segs = 3;
        for (let s = 0; s < segs; s++) {
          const [ggx, ggy] = grad(cx, cy, Math.max(2, R * 0.35));
          let nx = -ggy,
            ny = ggx;
          const m = Math.hypot(nx, ny);
          if (m < 2.5) {
            // поле течения: мазки «закручиваются», а не лежат кирпичами
            const fa = globalAng + 1.3 * Math.sin(cx * 0.0042 + cy * 0.0021 + seed) + 0.9 * Math.sin(cy * 0.0063 - cx * 0.0031 + li) + (rnd() - 0.5) * 0.7;
            nx = Math.cos(fa);
            ny = Math.sin(fa);
          } else {
            nx /= m;
            ny /= m;
          }
          if (s > 0 && nx * dx + ny * dy < 0) {
            nx = -nx;
            ny = -ny;
          }
          // инерция
          if (s > 0) {
            nx = nx * 0.6 + dx * 0.4;
            ny = ny * 0.6 + dy * 0.4;
            const mm = Math.hypot(nx, ny) || 1;
            nx /= mm;
            ny /= mm;
          }
          dx = nx;
          dy = ny;
          cx += nx * (L / segs);
          cy += ny * (L / segs);
          pts.push(cx, cy);
        }
        const r = box(ir, px, py, R * 0.5),
          g = box(ig, px, py, R * 0.5),
          b = box(ib, px, py, R * 0.5);
        let [h, s, l] = rgbToHsl([r, g, b]);
        h += (rnd() - 0.5) * 10 * s;
        l = clamp(l + (rnd() - 0.5) * 0.05 + 0.01);
        s = clamp(s * (0.97 + rnd() * 0.12));
        if (s > 0.25 && rnd() < 0.04) {
          // раздельный мазок: редкое вкрапление цвета-акцента — только там, где и так есть цвет
          h = h + (((accent[0] - h + 540) % 360) - 180) * 0.25;
          s = clamp(s + 0.08);
        }
        const [R2, G2, B2] = hslToRgb(h, s, l);
        layer.push({ pts, w: R * (0.7 + rnd() * 0.35), c: `rgb(${R2 | 0},${G2 | 0},${B2 | 0})`, a: li === 0 ? 0.9 : 0.85 });
      }
    // перемешиваем внутри слоя
    for (let i = layer.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [layer[i], layer[j]] = [layer[j], layer[i]];
    }
    out.push(...layer);
  });
  return out;
}

export function drawStrokes(g: CanvasRenderingContext2D, strokes: Stroke[], from: number, to: number) {
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = from; i < to && i < strokes.length; i++) {
    const s = strokes[i];
    const p = s.pts;
    g.globalAlpha = s.a;
    g.strokeStyle = s.c;
    g.lineWidth = s.w;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    if (p.length >= 8) {
      g.bezierCurveTo(p[2], p[3], p[4], p[5], p[6], p[7]);
    } else {
      for (let k = 2; k < p.length; k += 2) g.lineTo(p[k], p[k + 1]);
    }
    g.stroke();
  }
  g.globalAlpha = 1;
}

/** Холст под мазками: размытая подмалёвка */
export function underpainting(src: Cnv): Cnv {
  return softBlur(src, 0.1);
}

/** Текстура холста (переплетение нитей) */
export function canvasWeave(w: number, h: number): Cnv {
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.18;
  for (let y = 0; y < h; y += 3) {
    g.fillStyle = y % 6 ? '#9a9a9a' : '#666666';
    g.fillRect(0, y, w, 1);
  }
  for (let x = 0; x < w; x += 3) {
    g.fillStyle = x % 6 ? '#9a9a9a' : '#6a6a6a';
    g.fillRect(x, 0, 1, h);
  }
  return c;
}

// ——— Конструкция: постеризация в 4 тона + контур ———
export function posterize(src: Cnv, spec: DesignSpec): Cnv {
  const W = src.width,
    H = src.height;
  const g = ctx2d(src);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  // пороги по квантилям, чтобы все 4 тона присутствовали
  const sorted = Float32Array.from(lum).sort();
  const q = [0.22, 0.5, 0.78].map((p) => sorted[Math.floor(p * (sorted.length - 1))]);
  const c = spec.palette.colors;
  const tones = [hexToRgb(spec.palette.ink), hexToRgb(c[1]), hexToRgb(c[3]), hexToRgb(spec.palette.paper)];
  for (let i = 0; i < W * H; i++) {
    const L = lum[i];
    const t = L < q[0] ? 0 : L < q[1] ? 1 : L < q[2] ? 2 : 3;
    let [r, gg, b] = tones[t];
    // контур
    const x = i % W,
      y = (i / W) | 0;
    if (x > 0 && y > 0 && x < W - 1 && y < H - 1) {
      const e = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + W] - lum[i - W]);
      if (e > 0.22) [r, gg, b] = tones[0];
    }
    d[i * 4] = r;
    d[i * 4 + 1] = gg;
    d[i * 4 + 2] = b;
  }
  g.putImageData(img, 0, 0);
  return src;
}

// ——— Плёнка: цветокор + ореол ———
export function filmGrade(src: Cnv, spec: DesignSpec): { img: Cnv; halation: Cnv } {
  const base = moodGrade(spec, { lift: 0.07, contrast: 1.08, satMul: 0.95 });
  applyGrade(src, (r, g, b) => {
    let [R, G, B] = base(r, g, b);
    const l = (R + G + B) / 765;
    // тени чуть в зелень/бирюзу, света в тёплое
    R += (l - 0.5) * 18;
    B -= (l - 0.5) * 22;
    G += (0.5 - l) * 6;
    return [R, G, B];
  });
  // ореол: светлые места, размытые и окрашенные в красно-оранжевый
  const hl = canvas(src.width, src.height);
  const hg = ctx2d(hl);
  hg.drawImage(src, 0, 0);
  const id = hg.getImageData(0, 0, hl.width, hl.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 765;
    const k = clamp((l - 0.72) / 0.2);
    d[i] = 255 * k;
    d[i + 1] = 90 * k;
    d[i + 2] = 40 * k;
  }
  hg.putImageData(id, 0, 0);
  return { img: src, halation: softBlur(hl, 0.05) };
}

// ——— Ма: приглушить, высветлить ———
export function maGrade(src: Cnv, spec: DesignSpec): Cnv {
  return applyGrade(src, moodGrade(spec, { lift: 0.1, contrast: 0.85, light: 0.06 }));
}

// ——— Ноктюрн: тональная карта + свечение ———
export function nocturneGrade(src: Cnv, spec: DesignSpec): { img: Cnv; bloom: Cnv } {
  const deep = hexToRgb(spec.mood.warmth > 0.2 ? '#14122a' : '#0a1428');
  const mid = hexToRgb(spec.palette.colors[1]);
  const steel = [72, 96, 140] as const;
  const lamp = hexToRgb(spec.palette.accent);
  applyGrade(src, (r, g, b) => {
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const L = Math.pow(l, 1.25);
    let R, G, B;
    if (L < 0.35) {
      const t = L / 0.35;
      R = deep[0] + (mid[0] * 0.5 - deep[0]) * t * 0.6;
      G = deep[1] + (mid[1] * 0.5 - deep[1]) * t * 0.6;
      B = deep[2] + (mid[2] * 0.5 - deep[2]) * t * 0.6;
      R = R + (steel[0] - R) * t * 0.5;
      G = G + (steel[1] - G) * t * 0.5;
      B = B + (steel[2] - B) * t * 0.5;
    } else if (L < 0.72) {
      const t = (L - 0.35) / 0.37;
      R = steel[0] + (150 - steel[0]) * t;
      G = steel[1] + (165 - steel[1]) * t;
      B = steel[2] + (190 - steel[2]) * t;
    } else {
      const t = clamp((L - 0.72) / 0.28);
      R = 150 + (lamp[0] - 150) * t;
      G = 165 + (lamp[1] - 165) * t;
      B = 190 + (lamp[2] - 190) * t;
    }
    // немного родного цвета в светах — огни остаются огнями
    const keep = clamp((l - 0.5) / 0.35) * 0.75;
    return [R + (r - R) * keep, G + (g - G) * keep, B + (b - B) * keep];
  });
  const hl = canvas(src.width, src.height);
  const hg = ctx2d(hl);
  hg.drawImage(src, 0, 0);
  const id = hg.getImageData(0, 0, hl.width, hl.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (d[i] + d[i + 1] + d[i + 2]) / 765;
    const k = clamp((l - 0.45) / 0.3);
    d[i] *= k;
    d[i + 1] *= k;
    d[i + 2] *= k;
  }
  hg.putImageData(id, 0, 0);
  return { img: src, bloom: softBlur(hl, 0.06) };
}

// ——— Коллаж: рваный край ———
export function tornPiece(src: Src, w: number, h: number, seed: number, spec: DesignSpec): Cnv {
  const rnd = mulberry32(seed);
  const pad = 14;
  const c = canvas(w + pad * 2, h + pad * 2);
  const g = ctx2d(c);
  const edge = (inset: number, amp: number) => {
    const pts: [number, number][] = [];
    const walk = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(2, Math.floor(len / 7));
      const nx = -(y1 - y0) / len,
        ny = (x1 - x0) / len;
      let off = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        off = off * 0.6 + (rnd() - 0.5) * amp;
        pts.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]);
      }
    };
    const a = pad + inset,
      b = pad + w - inset,
      cTop = pad + inset,
      d = pad + h - inset;
    walk(a, cTop, b, cTop);
    walk(b, cTop, b, d);
    walk(b, d, a, d);
    walk(a, d, a, cTop);
    return pts;
  };
  const path = (pts: [number, number][]) => {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  };
  // белый бумажный край
  path(edge(0, 7));
  g.fillStyle = '#fbf8f1';
  g.fill();
  // фото
  g.save();
  path(edge(7, 5));
  g.clip();
  const s = Math.max(w / src.width, h / src.height);
  g.drawImage(src, pad + (w - src.width * s) / 2, pad + (h - src.height * s) / 2, src.width * s, src.height * s);
  g.restore();
  applyGrade(c, (r, gg, b) => {
    // белый край не трогаем
    if (r > 245 && gg > 240 && b > 230) return [r, gg, b];
    return moodGrade(spec, { satMul: 1.1, contrast: 1.05 })(r, gg, b);
  });
  return c;
}

/** Вырезанная форма в духе Матисса: водоросль, звезда, лист или клякса */
export function cutoutPath(g: CanvasRenderingContext2D, kind: number, R: number, seed: number) {
  const rnd = mulberry32(seed);
  g.beginPath();
  if (kind === 0) {
    // звезда-клякса
    const k = 5 + Math.floor(rnd() * 4);
    const N = 90;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = R * (0.62 + 0.38 * Math.pow(Math.abs(Math.cos((a * k) / 2)), 0.6) + (rnd() - 0.5) * 0.04);
      const x = Math.cos(a) * r,
        y = Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  } else if (kind === 1) {
    // водоросль: стебель с лопастями
    const lobes = 4 + Math.floor(rnd() * 3);
    const left: [number, number][] = [],
      right: [number, number][] = [];
    for (let i = 0; i <= lobes * 6; i++) {
      const t = i / (lobes * 6);
      const y = -R + t * 2 * R;
      const wv = R * 0.18 + R * 0.32 * Math.pow(Math.abs(Math.sin(t * Math.PI * lobes)), 0.8) * Math.sin(t * Math.PI);
      const bend = Math.sin(t * 2.4) * R * 0.15;
      left.push([bend - wv, y]);
      right.push([bend + wv * (0.8 + 0.4 * Math.sin(t * 9)), y]);
    }
    [...left, ...right.reverse()].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  } else if (kind === 2) {
    // лист
    g.moveTo(0, -R);
    g.bezierCurveTo(R * 0.7, -R * 0.5, R * 0.6, R * 0.5, 0, R);
    g.bezierCurveTo(-R * 0.6, R * 0.5, -R * 0.7, -R * 0.5, 0, -R);
  } else {
    // клякса
    const N = 70;
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = R * (0.8 + 0.12 * Math.sin(a * 2 + ph[0]) + 0.08 * Math.sin(a * 3 + ph[1]) + 0.05 * Math.sin(a * 5 + ph[2]));
      const x = Math.cos(a) * r,
        y = Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
  }
  g.closePath();
}

// ——— Ма: тушевой круг энсо (сухая кисть) ———
export interface Enso {
  dabs: { x: number; y: number; r: number; a: number }[];
}
export function makeEnso(cx: number, cy: number, R: number, seed: number): Enso {
  const rnd = mulberry32(seed);
  const start = -Math.PI * 0.6 + rnd() * 0.4;
  const sweep = Math.PI * 2 * (0.86 + rnd() * 0.08);
  const dabs: Enso['dabs'] = [];
  const N = 900;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    const a = start + sweep * t;
    const press = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)), 0.7) * (1 - t * 0.55);
    const w = R * 0.11 * press + 1;
    const wob = Math.sin(t * 7 + seed) * R * 0.015;
    const rr = R + wob;
    // щетинки
    const bristles = 5;
    for (let b = 0; b < bristles; b++) {
      const o = (b / (bristles - 1) - 0.5) * w;
      if (t > 0.7 && rnd() < (t - 0.7) * 2.2) continue; // сухой конец
      dabs.push({ x: cx + Math.cos(a) * (rr + o), y: cy + Math.sin(a) * (rr + o), r: Math.max(0.8, (w / bristles) * (0.9 + rnd() * 0.6)), a: 0.5 + rnd() * 0.4 });
    }
  }
  return { dabs };
}
