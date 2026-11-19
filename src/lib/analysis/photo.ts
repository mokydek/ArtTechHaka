import type { PhotoFeatures, PhotosSummary } from '../types';
import { clamp, labToRgb, rgbToHex, rgbToLab, mulberry32 } from '../color';

/** Анализ фото на устройстве: доминирующие цвета (k-means в Lab), свет, тепло, контраст, детали */
export function analyzePhoto(img: CanvasImageSource & { width: number; height: number }): PhotoFeatures {
  const W = 96;
  const H = Math.max(1, Math.round((W * img.height) / img.width));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, W, H);
  const d = g.getImageData(0, 0, W, H).data;
  const n = W * H;
  const labs: [number, number, number][] = new Array(n);
  const lum = new Float32Array(n);
  let sumL = 0,
    sumC = 0,
    sumWarm = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4],
      gg = d[i * 4 + 1],
      b = d[i * 4 + 2];
    const lab = rgbToLab([r, gg, b]);
    labs[i] = lab;
    lum[i] = lab[0] / 100;
    sumL += lab[0];
    const chroma = Math.hypot(lab[1], lab[2]);
    sumC += chroma;
    // тепло: b* (жёлтый/синий) + немного a* (красный/зелёный), с весом по насыщенности
    sumWarm += lab[2] * 0.8 + lab[1] * 0.35;
  }
  const brightness = sumL / n / 100;
  const saturation = clamp(sumC / n / 45);
  const warmth = clamp(sumWarm / n / 22, -1, 1);
  let varL = 0;
  for (let i = 0; i < n; i++) varL += (lum[i] - brightness) ** 2;
  const contrast = clamp(Math.sqrt(varL / n) / 0.3);

  // детали (собель)
  let edge = 0;
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const gx = lum[i + 1] - lum[i - 1] + 0.5 * (lum[i - W + 1] - lum[i - W - 1] + lum[i + W + 1] - lum[i + W - 1]);
      const gy = lum[i + W] - lum[i - W] + 0.5 * (lum[i + W - 1] - lum[i - W - 1] + lum[i + W + 1] - lum[i - W + 1]);
      edge += Math.hypot(gx, gy);
    }
  const edges = clamp(edge / ((W - 2) * (H - 2)) / 0.22);

  // небо: голубые/светлые пиксели в верхней трети
  let sky = 0;
  const top = Math.floor(H / 3);
  for (let y = 0; y < top; y++)
    for (let x = 0; x < W; x++) {
      const [L, a, b] = labs[y * W + x];
      if ((L > 55 && b < -6 && a < 8) || (L > 80 && Math.abs(a) < 6 && Math.abs(b) < 10)) sky++;
    }
  sky = sky / (top * W);

  // огни: доля ярких точек в тёмном кадре
  let bright = 0;
  for (let i = 0; i < n; i++) if (lum[i] > 0.75) bright++;
  const lights = brightness < 0.38 ? clamp((bright / n) * 12) : 0;

  const palette = kmeansPalette(labs, 5);
  return { palette, brightness, saturation, warmth, contrast, edges, sky, lights, width: img.width, height: img.height };
}

function kmeansPalette(labs: [number, number, number][], k: number) {
  const rnd = mulberry32(7);
  // выборка для скорости
  const pts = labs.filter((_, i) => i % 2 === 0);
  // k-means++ инициализация
  const cents: [number, number, number][] = [pts[Math.floor(rnd() * pts.length)]];
  while (cents.length < k) {
    const dists = pts.map((p) => Math.min(...cents.map((c) => dist2(p, c))));
    const sum = dists.reduce((a, b) => a + b, 0);
    let r = rnd() * sum;
    let idx = 0;
    for (; idx < dists.length - 1 && r > dists[idx]; idx++) r -= dists[idx];
    cents.push([...pts[idx]] as [number, number, number]);
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < 12; it++) {
    for (let i = 0; i < pts.length; i++) {
      let bi = 0,
        bd = Infinity;
      for (let j = 0; j < k; j++) {
        const dd = dist2(pts[i], cents[j]);
        if (dd < bd) {
          bd = dd;
          bi = j;
        }
      }
      assign[i] = bi;
    }
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      const a = acc[assign[i]];
      a[0] += pts[i][0];
      a[1] += pts[i][1];
      a[2] += pts[i][2];
      a[3]++;
    }
    acc.forEach((a, j) => {
      if (a[3]) cents[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
    });
  }
  const counts = new Array(k).fill(0);
  for (let i = 0; i < pts.length; i++) counts[assign[i]]++;
  return cents
    .map((c, j) => ({ hex: rgbToHex(labToRgb(c)), weight: counts[j] / pts.length, L: c[0] }))
    .filter((c) => c.weight > 0.005)
    .sort((a, b) => b.weight - a.weight)
    .map(({ hex, weight }) => ({ hex, weight }));
}

const dist2 = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export function summarizePhotos(list: PhotoFeatures[]): PhotosSummary {
  const n = Math.max(1, list.length);
  const avg = (f: (p: PhotoFeatures) => number) => list.reduce((s, p) => s + f(p), 0) / n;
  // общая палитра: объединяем, сливаем близкие
  const all = list.flatMap((p) => p.palette.map((c) => ({ ...c, weight: c.weight / n })));
  all.sort((a, b) => b.weight - a.weight);
  const merged: { hex: string; weight: number; lab: [number, number, number] }[] = [];
  for (const c of all) {
    const lab = rgbToLab(hexToRgbLocal(c.hex));
    const near = merged.find((m) => dist2(m.lab, lab) < 140);
    if (near) near.weight += c.weight;
    else merged.push({ hex: c.hex, weight: c.weight, lab });
  }
  merged.sort((a, b) => b.weight - a.weight);
  return {
    count: list.length,
    palette: merged.slice(0, 6).map(({ hex, weight }) => ({ hex, weight })),
    brightness: avg((p) => p.brightness),
    saturation: avg((p) => p.saturation),
    warmth: avg((p) => p.warmth),
    contrast: avg((p) => p.contrast),
    edges: avg((p) => p.edges),
    sky: avg((p) => p.sky),
    lights: avg((p) => p.lights),
  };
}

function hexToRgbLocal(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Загрузка файла/URL в ImageBitmap с ограничением размера */
export async function loadImage(src: Blob | string, maxSide = 1600): Promise<ImageBitmap> {
  let blob: Blob;
  if (typeof src === 'string') {
    const r = await fetch(src);
    blob = await r.blob();
  } else blob = src;
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (s >= 1) return bmp;
  const out = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high' });
  bmp.close();
  return out;
}
