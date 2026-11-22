import type { YPanorama } from './yandex';

// Куда смотрела камера и с какой панорамы снято — сравнением снимка с настоящими панорамами улицы.
// Сравниваем не цвета (сезон и свет другие), а контуры: края домов, столбов, дорог и линию крыш на фоне неба.

const R = Math.PI / 180;
const GW = 72; // ширина «отпечатка» кадра

interface Feat {
  w: number;
  h: number;
  grad: Float32Array; // нормированная карта контуров
  sky: Float32Array | null; // линия неба по столбцам (доля высоты)
}

function gray(d: Uint8ClampedArray, n: number) {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
  return g;
}

function blur(a: Float32Array, w: number, h: number) {
  const t = new Float32Array(a.length),
    o = new Float32Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      t[i] = (a[i] * 2 + a[y * w + Math.max(0, x - 1)] + a[y * w + Math.min(w - 1, x + 1)]) / 4;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      o[i] = (t[i] * 2 + t[Math.max(0, y - 1) * w + x] + t[Math.min(h - 1, y + 1) * w + x]) / 4;
    }
  return o;
}

function norm(a: Float32Array) {
  let m = 0;
  for (const v of a) m += v;
  m /= a.length;
  let s = 0;
  for (const v of a) s += (v - m) * (v - m);
  s = Math.sqrt(s / a.length) || 1;
  const o = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = (a[i] - m) / s;
  return o;
}

/** Контуры и линия неба по RGBA-пикселям кадра w×h */
function features(d: Uint8ClampedArray, w: number, h: number): Feat {
  const n = w * h;
  const g = blur(gray(d, n), w, h);
  const mag = new Float32Array(n);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
      const gy = g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
    }
  // небо: светлое и ровное от верхнего края вниз
  const sky = new Float32Array(w);
  let skyCols = 0;
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h * 0.8) {
      const i = y * w + x;
      if (g[i] < 0.45 || mag[i] > 0.35) break;
      y++;
    }
    sky[x] = y / h;
    if (y > 1) skyCols++;
  }
  return { w, h, grad: norm(blur(mag, w, h)), sky: skyCols > w * 0.3 ? norm(sky) : null };
}

/** Отпечаток самого снимка */
export function photoFeatures(img: CanvasImageSource & { width: number; height: number }): Feat {
  const w = GW,
    h = Math.max(12, Math.round((GW * img.height) / img.width));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  return features(g.getImageData(0, 0, w, h).data, w, h);
}

export interface Equirect {
  data: Uint8ClampedArray;
  W: number;
  H: number;
  // [thetaTop, phiRight, thetaBottom, phiLeft], радианы: theta — высота над горизонтом, phi — азимут от севера по часовой
  bbox: [number, number, number, number];
}

/** Панорама целиком (развёртка) на небольшом уровне детализации */
export async function panoEquirect(p: YPanorama, maxW = 2048): Promise<Equirect> {
  const levels = (p.getTileLevels() as { getImageSize: () => number[]; getTileUrl: (x: number, y: number) => string }[]).map((l) => ({ l, s: l.getImageSize() }));
  levels.sort((a, b) => a.s[0] - b.s[0]);
  const lv = [...levels].reverse().find((x) => x.s[0] <= maxW) ?? levels[0];
  const [W, H] = lv.s;
  const [tw, th] = p.getTileSize() as number[];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const jobs: Promise<void>[] = [];
  for (let ty = 0; ty * th < H; ty++)
    for (let tx = 0; tx * tw < W; tx++)
      jobs.push(
        new Promise<void>((res) => {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.onload = () => {
            g.drawImage(im, tx * tw, ty * th);
            res();
          };
          im.onerror = () => res();
          im.src = lv.l.getTileUrl(tx, ty);
        }),
      );
  await Promise.all(jobs);
  return { data: g.getImageData(0, 0, W, H).data, W, H, bbox: p.getAngularBBox() as [number, number, number, number] };
}

/** Кадр из развёртки: камера смотрит на heading/pitch (градусы), поле зрения fovH×fovV */
export function render(e: Equirect, heading: number, pitch: number, fovH: number, fovV: number, w: number, h: number) {
  const out = new Uint8ClampedArray(w * h * 4);
  const [tTop, pRight, tBot, pLeft] = e.bbox;
  const pSpan = pRight - pLeft,
    tSpan = tTop - tBot;
  const B = heading * R,
    P = pitch * R;
  const f = [Math.cos(P) * Math.sin(B), Math.sin(P), Math.cos(P) * Math.cos(B)];
  const r = [Math.cos(B), 0, -Math.sin(B)];
  const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
  const tx = Math.tan((fovH / 2) * R),
    ty = Math.tan((fovV / 2) * R);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = ((x + 0.5) / w) * 2 - 1,
        sy = 1 - ((y + 0.5) / h) * 2;
      const dx = f[0] + r[0] * sx * tx + u[0] * sy * ty,
        dy = f[1] + r[1] * sx * tx + u[1] * sy * ty,
        dz = f[2] + r[2] * sx * tx + u[2] * sy * ty;
      const az = Math.atan2(dx, dz); // от севера по часовой
      const el = Math.atan2(dy, Math.hypot(dx, dz));
      let px = (((az - pLeft) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      px = Math.floor((px / pSpan) * e.W);
      const py = Math.floor(((tTop - el) / tSpan) * e.H);
      const o = (y * w + x) * 4;
      if (px < 0 || px >= e.W || py < 0 || py >= e.H) continue;
      const i = (py * e.W + px) * 4;
      out[o] = e.data[i];
      out[o + 1] = e.data[i + 1];
      out[o + 2] = e.data[i + 2];
      out[o + 3] = 255;
    }
  return out;
}

const ncc = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s / a.length;
};

export interface AlignResult {
  heading: number;
  pitch: number;
  score: number;
  /** насколько лучший вариант выделяется среди остальных */
  sure: number;
}

/** Перебрать направления и найти, куда смотрела камера: сначала грубо (через 6°), потом точнее (через 1°) */
export function alignOn(e: Equirect, ph: Feat, fovH: number, fovV: number): AlignResult {
  const { w, h } = ph;
  type C = { heading: number; pitch: number; scale: number; score: number };
  const score = (heading: number, pitch: number, scale: number): C => {
    const f = features(render(e, heading, pitch, fovH * scale, fovV * scale, w, h), w, h);
    let s = ncc(ph.grad, f.grad);
    if (ph.sky && f.sky) s = s * 0.65 + ncc(ph.sky, f.sky) * 0.35;
    return { heading: ((heading % 360) + 360) % 360, pitch, scale, score: s };
  };
  const coarse: C[] = [];
  for (const scale of [0.9, 1.12]) for (const pitch of [-5, 0, 5]) for (let hd = 0; hd < 360; hd += 6) coarse.push(score(hd, pitch, scale));
  coarse.sort((a, b) => b.score - a.score);
  const fine: C[] = [];
  for (const c of coarse.slice(0, 4)) for (let d = -5; d <= 5; d++) fine.push(score(c.heading + d, c.pitch, c.scale));
  fine.sort((a, b) => b.score - a.score);
  const best = fine[0].score >= coarse[0].score ? fine[0] : coarse[0];
  // соперник — лучший вариант, смотрящий в другую сторону (дальше 25°)
  const rival = coarse.find((a) => Math.abs(((((a.heading - best.heading) % 360) + 540) % 360) - 180) > 25) ?? coarse[1];
  const mean = coarse.reduce((s, a) => s + a.score, 0) / coarse.length;
  const sd = Math.sqrt(coarse.reduce((s, a) => s + (a.score - mean) ** 2, 0) / coarse.length) || 1;
  return { heading: best.heading, pitch: best.pitch, score: best.score, sure: (best.score - rival.score) / sd };
}
