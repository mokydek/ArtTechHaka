import type { CoverStyle } from './types';
import { hashString, mulberry32, withAlpha } from './color';
import { drawRansom } from './render/ransom';

// Обложки тетрадей — процедурные, как настоящие: крафт, мрамор, ткань, узор, кожа, коллаж

export interface CoverInfo {
  id: CoverStyle;
  name: string;
  bg: string; // фон экрана выбора (как в Footnotes)
  ink: string;
}

export const COVERS: CoverInfo[] = [
  { id: 'black', name: 'чёрная', bg: '#2a2730', ink: '#efe9df' },
  { id: 'kraft', name: 'крафт', bg: '#e9dcc6', ink: '#3a2a1a' },
  { id: 'marble', name: 'тетрадь в мрамор', bg: '#e6e2db', ink: '#111111' },
  { id: 'guava', name: 'розовая гуава', bg: '#e8a59b', ink: '#5a1f1a' },
  { id: 'birds', name: 'птицы в синий час', bg: '#3b4a68', ink: '#f0d9a0' },
  { id: 'linen', name: 'льняная', bg: '#efeae0', ink: '#4a4238' },
  { id: 'night', name: 'ночное небо', bg: '#1e2740', ink: '#f2e6c4' },
  { id: 'olive', name: 'оливковая кожа', bg: '#a7ad8a', ink: '#f1ead6' },
  { id: 'ransom', name: 'вырезанные буквы', bg: '#efe2c9', ink: '#1d1b1f' },
  { id: 'collage', name: 'из моих дней', bg: '#d9cfc0', ink: '#1d1b1f' },
];

export const coverInfo = (id: CoverStyle) => COVERS.find((c) => c.id === id) ?? COVERS[0];
/** каталог: всё, кроме своей обложки */
export const CATALOG = COVERS;

const cache = new Map<string, string>();

function noise(g: CanvasRenderingContext2D, w: number, h: number, amt: number, seed: number) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const r = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function label(g: CanvasRenderingContext2D, W: number, H: number, title: string, opts: { y?: number; ink?: string; lined?: boolean } = {}) {
  const lw = W * 0.62,
    lh = H * 0.15,
    x = (W - lw) / 2,
    y = (opts.y ?? 0.2) * H;
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.18)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  g.fillStyle = '#fbf8f1';
  g.beginPath();
  g.roundRect(x, y, lw, lh, 10);
  g.fill();
  g.restore();
  if (opts.lined !== false) {
    g.strokeStyle = 'rgba(80,110,160,0.25)';
    g.lineWidth = 1.5;
    for (let i = 1; i < 3; i++) {
      g.beginPath();
      g.moveTo(x + 12, y + (lh * i) / 3 + 6);
      g.lineTo(x + lw - 12, y + (lh * i) / 3 + 6);
      g.stroke();
    }
  }
  g.fillStyle = opts.ink ?? '#2a2a2a';
  g.textAlign = 'center';
  let size = lh * 0.42;
  g.font = `500 ${size}px Caveat, cursive`;
  while (g.measureText(title).width > lw - 24 && size > 14) {
    size -= 1;
    g.font = `500 ${size}px Caveat, cursive`;
  }
  g.fillText(title, W / 2, y + lh * 0.62);
  g.textAlign = 'left';
}

function bird(g: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(6, -10, 16, -12, 22, -4);
  g.bezierCurveTo(30, -14, 40, -14, 46, -2);
  g.bezierCurveTo(38, -6, 30, -2, 24, 4);
  g.bezierCurveTo(18, 2, 10, 2, 0, 0);
  g.closePath();
  g.fill();
  g.restore();
}

/** Нарисовать обложку. images — обложки дней (для «из моих дней») */
export async function renderCover(style: CoverStyle, title: string, images: CanvasImageSource[] = [], W = 600, H = 800, extra: { label?: boolean; key?: string } = {}): Promise<string> {
  const key = `${style}|${title}|${images.length}|${W}|${extra.key ?? ''}|${extra.label ?? ''}`;
  if (cache.has(key) && style !== 'collage') return cache.get(key)!;
  await document.fonts.ready;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  const seed = hashString(title + style);
  const rnd = mulberry32(seed);
  const info = coverInfo(style);
  switch (style) {
    case 'black': {
      // классическая чёрная тетрадь: мелкая фактура, светлая наклейка
      g.fillStyle = '#1c1a1f';
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 14, seed);
      const gl = g.createLinearGradient(0, 0, W, H);
      gl.addColorStop(0, 'rgba(255,255,255,0.06)');
      gl.addColorStop(0.5, 'rgba(255,255,255,0)');
      gl.addColorStop(1, 'rgba(0,0,0,0.18)');
      g.fillStyle = gl;
      g.fillRect(0, 0, W, H);
      label(g, W, H, title, { y: 0.16 });
      break;
    }
    case 'custom': {
      const im = images[0] as (CanvasImageSource & { width: number; height: number }) | undefined;
      if (im) {
        const r = Math.max(W / im.width, H / im.height);
        g.drawImage(im, (W - im.width * r) / 2, (H - im.height * r) / 2, im.width * r, im.height * r);
      } else {
        g.fillStyle = '#1c1a1f';
        g.fillRect(0, 0, W, H);
      }
      if (extra.label !== false) label(g, W, H, title, { y: 0.16 });
      break;
    }
    case 'kraft': {
      g.fillStyle = '#b48a5a';
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 26, seed);
      g.globalAlpha = 0.18;
      g.strokeStyle = '#5a3a1a';
      for (let i = 0; i < 400; i++) {
        const x = rnd() * W,
          y = rnd() * H,
          l = 5 + rnd() * 20,
          a = rnd() * 3;
        g.lineWidth = 0.6;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
        g.stroke();
      }
      g.globalAlpha = 1;
      label(g, W, H, title, { y: 0.16 });
      break;
    }
    case 'marble': {
      g.fillStyle = '#f2f0ea';
      g.fillRect(0, 0, W, H);
      // пятна «мрамора» композиционной тетради
      for (let i = 0; i < 2600; i++) {
        const x = rnd() * W,
          y = rnd() * H,
          r = 2 + rnd() * rnd() * 22;
        g.fillStyle = rnd() < 0.62 ? '#151515' : '#f2f0ea';
        g.beginPath();
        g.ellipse(x, y, r * (0.6 + rnd()), r * (0.4 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#121212';
      g.fillRect(0, 0, W * 0.12, H);
      label(g, W, H, title, { y: 0.14 });
      break;
    }
    case 'guava': {
      const grd = g.createLinearGradient(0, 0, W, H);
      grd.addColorStop(0, '#d9786d');
      grd.addColorStop(1, '#c9625a');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 18, seed);
      // потёртые края
      g.strokeStyle = 'rgba(255,235,220,0.35)';
      g.lineWidth = 10;
      g.strokeRect(8, 8, W - 16, H - 16);
      g.fillStyle = '#5a1f1a';
      g.font = `600 ${W * 0.07}px "Echo Serif", serif`;
      g.textAlign = 'center';
      g.fillText(title.toLowerCase(), W / 2, H * 0.86);
      g.textAlign = 'left';
      break;
    }
    case 'birds': {
      g.fillStyle = '#2f3f63';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#e9c97a';
      for (let y = -20; y < H + 40; y += 70)
        for (let x = -30 + ((y / 70) % 2) * 40; x < W + 40; x += 90) bird(g, x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 10, 0.9 + rnd() * 0.5, (rnd() - 0.5) * 0.8);
      noise(g, W, H, 14, seed);
      g.fillStyle = 'rgba(47,63,99,0.85)';
      g.fillRect(W * 0.14, H * 0.74, W * 0.72, H * 0.13);
      g.fillStyle = '#f0d9a0';
      g.font = `500 ${W * 0.06}px "PT Mono", monospace`;
      g.textAlign = 'center';
      g.fillText(title.toLowerCase(), W / 2, H * 0.825);
      g.textAlign = 'left';
      break;
    }
    case 'linen': {
      g.fillStyle = '#e9e2d4';
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.12;
      for (let y = 0; y < H; y += 3) {
        g.fillStyle = y % 6 ? '#8a7a64' : '#ffffff';
        g.fillRect(0, y, W, 1);
      }
      for (let x = 0; x < W; x += 3) {
        g.fillStyle = x % 6 ? '#8a7a64' : '#ffffff';
        g.fillRect(x, 0, 1, H);
      }
      g.globalAlpha = 1;
      noise(g, W, H, 10, seed);
      // тиснение
      g.textAlign = 'center';
      g.font = `italic 500 ${W * 0.085}px "Echo Serif", serif`;
      g.fillStyle = 'rgba(255,255,255,0.6)';
      g.fillText(title, W / 2 + 1.5, H * 0.46 + 1.5);
      g.fillStyle = 'rgba(80,66,50,0.75)';
      g.fillText(title, W / 2, H * 0.46);
      g.textAlign = 'left';
      break;
    }
    case 'night': {
      const grd = g.createLinearGradient(0, 0, 0, H);
      grd.addColorStop(0, '#141b33');
      grd.addColorStop(1, '#27345a');
      g.fillStyle = grd;
      g.fillRect(0, 0, W, H);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = withAlpha('#fff6dc', 0.3 + rnd() * 0.7);
        g.beginPath();
        g.arc(rnd() * W, rnd() * H, rnd() * rnd() * 2.8 + 0.4, 0, 6.3);
        g.fill();
      }
      g.fillStyle = '#f2e6c4';
      g.beginPath();
      g.arc(W * 0.72, H * 0.24, W * 0.09, 0, 6.3);
      g.fill();
      g.fillStyle = '#141b33';
      g.beginPath();
      g.arc(W * 0.75, H * 0.22, W * 0.085, 0, 6.3);
      g.fill();
      g.fillStyle = '#f2e6c4';
      g.font = `italic 500 ${W * 0.08}px "Echo Serif", serif`;
      g.textAlign = 'center';
      g.fillText(title, W / 2, H * 0.8);
      g.textAlign = 'left';
      break;
    }
    case 'olive': {
      g.fillStyle = '#6f7552';
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 30, seed);
      // строчка по краю
      g.setLineDash([10, 8]);
      g.strokeStyle = 'rgba(241,234,214,0.7)';
      g.lineWidth = 3;
      g.strokeRect(26, 26, W - 52, H - 52);
      g.setLineDash([]);
      g.fillStyle = 'rgba(30,30,20,0.35)';
      g.font = `600 ${W * 0.07}px "Echo Serif", serif`;
      g.textAlign = 'center';
      g.fillText(title.toUpperCase(), W / 2 + 1, H * 0.5 + 2);
      g.fillStyle = '#e8dcb8';
      g.fillText(title.toUpperCase(), W / 2, H * 0.5);
      g.textAlign = 'left';
      break;
    }
    case 'ransom':
    case 'collage': {
      g.fillStyle = style === 'ransom' ? '#efe2c9' : '#d9cfc0';
      g.fillRect(0, 0, W, H);
      noise(g, W, H, 16, seed);
      // клетка тетради
      g.strokeStyle = 'rgba(90,120,170,0.18)';
      g.lineWidth = 1;
      for (let x = 0; x < W; x += 24) {
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x, H);
        g.stroke();
      }
      for (let y = 0; y < H; y += 24) {
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(W, y);
        g.stroke();
      }
      // наклеенные кадры дней
      const imgs = images.slice(0, 4);
      imgs.forEach((im, i) => {
        const iw = W * (0.5 + rnd() * 0.12);
        const ih = iw * 1.25;
        const x = W * (0.1 + (i % 2) * 0.38) + (rnd() - 0.5) * 30,
          y = H * (0.36 + Math.floor(i / 2) * 0.27) + (rnd() - 0.5) * 20;
        g.save();
        g.translate(x + iw / 2, y + ih / 2);
        g.rotate((rnd() - 0.5) * 0.3);
        g.shadowColor = 'rgba(0,0,0,0.3)';
        g.shadowBlur = 12;
        g.shadowOffsetY = 4;
        g.fillStyle = '#fbf8f1';
        g.fillRect(-iw / 2 - 8, -ih / 2 - 8, iw + 16, ih + 16);
        g.shadowColor = 'transparent';
        g.drawImage(im, -iw / 2, -ih / 2, iw, ih);
        g.fillStyle = 'rgba(238,226,196,0.7)';
        g.rotate(-0.5);
        g.fillRect(-40, -ih / 2 - 30, 80, 22);
        g.restore();
      });
      if (!imgs.length) {
        // звёзды и марка
        g.fillStyle = '#d9a441';
        for (let i = 0; i < 5; i++) {
          const x = W * (0.15 + rnd() * 0.7),
            y = H * (0.5 + rnd() * 0.4),
            r = 14 + rnd() * 20;
          g.beginPath();
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
            const rr = k % 2 ? r * 0.45 : r;
            k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          g.closePath();
          g.fill();
        }
      }
      drawRansom(g, title, { x: W * 0.08, y: H * 0.15, size: W * 0.085, maxWidth: W * 0.84, seed, palette: ['#fbf8f1', '#f2d36b', '#e8a59b', '#a9c1e6', '#cfe0b4', '#ffffff'], align: 'center' });
      break;
    }
  }
  // корешок и тень, общие для всех
  const sh = g.createLinearGradient(0, 0, W * 0.08, 0);
  sh.addColorStop(0, 'rgba(0,0,0,0.25)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = sh;
  g.fillRect(0, 0, W * 0.08, H);
  const url = c.toDataURL('image/jpeg', 0.88);
  cache.set(key, url);
  void info;
  return url;
}
