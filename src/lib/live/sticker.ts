// «Вклейки»: свои картинки-моменты. Главное вырезается в наклейку с белой кромкой — или вклеивается целиком, как фото на скотче.

import { applyMask, cutout } from './segment';

export type StickerMode = 'cut' | 'whole';

async function loadBitmap(src: Blob, max = 900): Promise<ImageBitmap> {
  const b = await createImageBitmap(src);
  const s = Math.min(1, max / Math.max(b.width, b.height));
  if (s >= 1) return b;
  return createImageBitmap(b, { resizeWidth: Math.round(b.width * s), resizeHeight: Math.round(b.height * s), resizeQuality: 'high' });
}

/** Обрезать прозрачные поля */
function trim(c: HTMLCanvasElement, pad: number): HTMLCanvasElement {
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width,
    y0 = c.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++)
      if (d[(y * c.width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return c;
  const o = document.createElement('canvas');
  o.width = x1 - x0 + 1 + pad * 2;
  o.height = y1 - y0 + 1 + pad * 2;
  o.getContext('2d')!.drawImage(c, x0 - pad, y0 - pad, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

/** Белая вырубная кромка вокруг силуэта */
function dieCut(obj: HTMLCanvasElement, edge: number): HTMLCanvasElement {
  const o = document.createElement('canvas');
  o.width = obj.width + edge * 2;
  o.height = obj.height + edge * 2;
  const g = o.getContext('2d')!;
  // силуэт, раздутый на edge: рисуем по кругу со сдвигами
  const sil = document.createElement('canvas');
  sil.width = obj.width;
  sil.height = obj.height;
  const sg = sil.getContext('2d')!;
  sg.drawImage(obj, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#fffdf6';
  sg.fillRect(0, 0, sil.width, sil.height);
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    g.drawImage(sil, edge + Math.cos(a) * edge, edge + Math.sin(a) * edge);
  }
  g.drawImage(sil, edge, edge);
  g.drawImage(obj, edge, edge);
  return o;
}

export async function makeSticker(file: Blob, mode: StickerMode): Promise<{ canvas: HTMLCanvasElement; blob: Blob }> {
  const bmp = await loadBitmap(file);
  let out: HTMLCanvasElement;
  if (mode === 'cut') {
    const c = await cutout(bmp);
    const obj = trim(applyMask(bmp, c.mask), 2);
    const edge = Math.max(6, Math.round(Math.max(obj.width, obj.height) * 0.025));
    out = dieCut(obj, edge);
  } else {
    // целиком: фото с белыми полями, как отпечаток
    const m = Math.round(Math.max(bmp.width, bmp.height) * 0.035);
    out = document.createElement('canvas');
    out.width = bmp.width + m * 2;
    out.height = bmp.height + m * 2 + Math.round(m * 1.6);
    const g = out.getContext('2d')!;
    g.fillStyle = '#fffdf6';
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(bmp, m, m);
  }
  const blob: Blob = await new Promise((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
  return { canvas: out, blob };
}

/** Где положить новую вклейку: по краям поля, не в центре */
const SPOTS: [number, number, number][] = [
  [840, 300, 0.12],
  [250, 880, -0.1],
  [850, 900, 0.08],
  [240, 300, -0.14],
  [540, 960, 0.04],
  [540, 240, -0.05],
];
export function defaultSpot(i: number) {
  const [x, y, rot] = SPOTS[i % SPOTS.length];
  return { x, y, rot, s: 300 };
}
