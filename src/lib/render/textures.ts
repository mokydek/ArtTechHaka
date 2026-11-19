import { hexToRgb, mulberry32 } from '../color';

export type Cnv = HTMLCanvasElement;

export function canvas(w: number, h: number): Cnv {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export const ctx2d = (c: Cnv) => c.getContext('2d', { willReadFrequently: false })!;

/** Бумага: цвет + волокна + шум — постоянный элемент дневника */
export function paperTexture(w: number, h: number, color: string, seed = 1): Cnv {
  const c = canvas(w, h);
  const g = ctx2d(c);
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const rnd = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 9;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // волокна
  g.globalAlpha = 0.05;
  g.strokeStyle = '#5a4a3a';
  g.lineWidth = 0.6;
  for (let i = 0; i < 260; i++) {
    const x = rnd() * w,
      y = rnd() * h,
      a = rnd() * Math.PI,
      l = 6 + rnd() * 26;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * 6, y + Math.sin(a) * l * 0.5 + (rnd() - 0.5) * 6, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // лёгкое затемнение краёв листа
  g.globalAlpha = 1;
  const grd = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(60,40,20,0.09)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  return c;
}

/** Тайлы плёночного зерна */
export function grainTiles(count = 4, size = 256): Cnv[] {
  const out: Cnv[] = [];
  for (let k = 0; k < count; k++) {
    const c = canvas(size, size);
    const g = ctx2d(c);
    const img = g.createImageData(size, size);
    const rnd = mulberry32(100 + k);
    for (let i = 0; i < img.data.length; i += 4) {
      // приблизительно нормальное распределение
      const v = 128 + ((rnd() + rnd() + rnd() - 1.5) / 1.5) * 110;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    out.push(c);
  }
  return out;
}

/** Мягкий шум (туман) — value noise с несколькими октавами */
export function fogTexture(size: number, color: string, seed: number): Cnv {
  const c = canvas(size, size);
  const g = ctx2d(c);
  const [r, gg, b] = hexToRgb(color);
  const img = g.createImageData(size, size);
  const rnd = mulberry32(seed);
  const grids = [4, 8, 16].map((n) => {
    const a = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    // бесшовность
    for (let i = 0; i <= n; i++) {
      a[i * (n + 1) + n] = a[i * (n + 1)];
      a[n * (n + 1) + i] = a[i];
    }
    return { n, a };
  });
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0,
        amp = 0.6,
        tot = 0;
      for (const { n, a } of grids) {
        const fx = (x / size) * n,
          fy = (y / size) * n;
        const x0 = Math.floor(fx),
          y0 = Math.floor(fy);
        const tx = sm(fx - x0),
          ty = sm(fy - y0);
        const i = (yy: number, xx: number) => a[yy * (n + 1) + xx];
        const top = i(y0, x0) * (1 - tx) + i(y0, x0 + 1) * tx;
        const bot = i(y0 + 1, x0) * (1 - tx) + i(y0 + 1, x0 + 1) * tx;
        v += (top * (1 - ty) + bot * ty) * amp;
        tot += amp;
        amp *= 0.5;
      }
      v /= tot;
      const k = (y * size + x) * 4;
      img.data[k] = r;
      img.data[k + 1] = gg;
      img.data[k + 2] = b;
      img.data[k + 3] = Math.max(0, (v - 0.35) * 2.2) * 255;
    }
  g.putImageData(img, 0, 0);
  return c;
}

/** Быстрое размытие уменьшением/увеличением */
export function softBlur(src: CanvasImageSource & { width: number; height: number }, scale = 0.08): Cnv {
  const w = Math.max(2, Math.round(src.width * scale));
  const h = Math.max(2, Math.round(src.height * scale));
  const small = canvas(w, h);
  const sg = ctx2d(small);
  sg.imageSmoothingQuality = 'high';
  // в два шага — мягче
  const mid = canvas(Math.max(2, src.width * scale * 3), Math.max(2, src.height * scale * 3));
  const mg = ctx2d(mid);
  mg.imageSmoothingQuality = 'high';
  mg.drawImage(src, 0, 0, mid.width, mid.height);
  sg.drawImage(mid, 0, 0, w, h);
  const out = canvas(src.width, src.height);
  const og = ctx2d(out);
  og.imageSmoothingQuality = 'high';
  og.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

/** Вписать изображение «cover» в прямоугольник с фокусом */
export function coverCrop(img: CanvasImageSource & { width: number; height: number }, w: number, h: number, fx = 0.5, fy = 0.45): Cnv {
  const c = canvas(w, h);
  const g = ctx2d(c);
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s,
    dh = img.height * s;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (w - dw) * fx, (h - dh) * fy, dw, dh);
  return c;
}
