import type { TextFeatures } from '../types';
import { mulberry32 } from '../color';

// Скрапбук: вырубные наклейки по предметам дня и узорный васи-скотч

export type StickerKind = 'cup' | 'cake' | 'note' | 'book' | 'star' | 'sun' | 'leaf' | 'snow' | 'flame' | 'heart' | 'moon' | 'camera' | 'cone' | 'wave' | 'dumbbell';

const BY_KEY: Record<string, StickerKind> = {
  cocoa: 'cup', coffee: 'cup', tea: 'cup', mulled: 'cup',
  cake: 'cake', birthday: 'cake', party: 'cake',
  guitar: 'note', songs: 'note', concert: 'note', headphones: 'note', dances: 'note',
  book: 'book', exam: 'book',
  stars: 'star', newyear: 'star', fireworks: 'star', graduation: 'star',
  sunset: 'sun', sunrise: 'sun',
  leaves: 'leaf',
  firstsnow: 'snow',
  bonfire: 'flame', fireplace: 'flame', candles: 'flame', shashlik: 'flame',
  date: 'heart', girlfriend: 'heart', boyfriend: 'heart', wife: 'heart', husband: 'heart', wedding: 'heart',
  trip: 'camera', train: 'camera', airport: 'camera',
  icecream: 'cone',
  sea: 'wave', beach: 'wave', lake: 'wave', river: 'wave', shore: 'wave',
  gym: 'dumbbell', training: 'dumbbell', ring: 'dumbbell', tournament: 'dumbbell',
};

/** Наклейки дня: из предметов, событий, мест, людей и погоды записи */
export function stickersFor(t: TextFeatures, max = 3): StickerKind[] {
  const found: { k: StickerKind; at: number }[] = [];
  for (const p of [...t.objects, ...t.events, ...t.places, ...t.companions]) {
    const k = BY_KEY[p.key];
    if (k) found.push({ k, at: p.firstIndex });
  }
  found.sort((a, b) => a.at - b.at);
  const out: StickerKind[] = [];
  for (const f of found) if (!out.includes(f.k)) out.push(f.k);
  const extra: StickerKind[] = [];
  if (t.weather.includes('snow')) extra.push('snow');
  if (t.weather.includes('sun')) extra.push('sun');
  if (t.season === 'autumn' && t.nature) extra.push('leaf');
  if (t.timeOfDay === 'night' || t.night) extra.push('moon');
  for (const e of extra) if (!out.includes(e)) out.push(e);
  return out.slice(0, max);
}

const STICKER_COLORS: Record<StickerKind, [string, string]> = {
  cup: ['#c8734a', '#f3d9b8'],
  cake: ['#e48aa6', '#fbe7c6'],
  note: ['#2f3f75', '#f2d36b'],
  book: ['#3d6b5a', '#f6efe0'],
  star: ['#f2b632', '#fff3c4'],
  sun: ['#f0a53a', '#ffe08a'],
  leaf: ['#d0632c', '#f2a65a'],
  snow: ['#6f9fd8', '#e8f2ff'],
  flame: ['#e8582c', '#ffcf5a'],
  heart: ['#d8434f', '#ffb3b8'],
  moon: ['#f2e2a0', '#2b3560'],
  camera: ['#2b2b2e', '#9fc3d8'],
  cone: ['#e9a3c0', '#d9a066'],
  wave: ['#2f7fb8', '#bfe3f2'],
  dumbbell: ['#3a3a40', '#c9cbd1'],
};

function shape(g: CanvasRenderingContext2D, k: StickerKind, s: number) {
  // все фигуры в квадрате [-s, s]
  g.beginPath();
  switch (k) {
    case 'cup':
      g.roundRect(-s * 0.62, -s * 0.2, s * 1.0, s * 0.95, s * 0.16);
      g.moveTo(s * 0.38 + s * 0.42, s * 0.25);
      g.arc(s * 0.38, s * 0.25, s * 0.38, 0, Math.PI * 2);
      break;
    case 'cake':
      g.roundRect(-s * 0.8, s * 0.05, s * 1.6, s * 0.7, s * 0.1);
      g.roundRect(-s * 0.6, -s * 0.38, s * 1.2, s * 0.48, s * 0.1);
      g.rect(-s * 0.06, -s * 0.85, s * 0.12, s * 0.5);
      break;
    case 'note':
      g.ellipse(-s * 0.42, s * 0.55, s * 0.3, s * 0.22, -0.4, 0, Math.PI * 2);
      g.ellipse(s * 0.5, s * 0.38, s * 0.3, s * 0.22, -0.4, 0, Math.PI * 2);
      g.rect(-s * 0.2, -s * 0.7, s * 0.13, s * 1.25);
      g.rect(s * 0.72, -s * 0.88, s * 0.13, s * 1.25);
      g.moveTo(-s * 0.2, -s * 0.7);
      g.lineTo(s * 0.85, -s * 0.88);
      g.lineTo(s * 0.85, -s * 0.6);
      g.lineTo(-s * 0.2, -s * 0.42);
      break;
    case 'book':
      g.moveTo(0, -s * 0.5);
      g.quadraticCurveTo(-s * 0.5, -s * 0.8, -s * 0.95, -s * 0.6);
      g.lineTo(-s * 0.95, s * 0.6);
      g.quadraticCurveTo(-s * 0.5, s * 0.4, 0, s * 0.7);
      g.quadraticCurveTo(s * 0.5, s * 0.4, s * 0.95, s * 0.6);
      g.lineTo(s * 0.95, -s * 0.6);
      g.quadraticCurveTo(s * 0.5, -s * 0.8, 0, -s * 0.5);
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.42 : s * 0.98;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      break;
    case 'sun':
      for (let i = 0; i < 24; i++) {
        const r = i % 2 ? s * 0.62 : s * 0.98;
        const a = (i * Math.PI) / 12;
        if (i) g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        else g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      break;
    case 'leaf': {
      // кленовый лист из 5 лопастей
      const pts = [
        [0, -1], [0.18, -0.55], [0.5, -0.72], [0.4, -0.3], [0.95, -0.25], [0.6, 0.05], [0.75, 0.38], [0.3, 0.3], [0.08, 0.62],
        [0.05, 1], [-0.05, 1], [-0.08, 0.62], [-0.3, 0.3], [-0.75, 0.38], [-0.6, 0.05], [-0.95, -0.25], [-0.4, -0.3], [-0.5, -0.72], [-0.18, -0.55],
      ];
      pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
      break;
    }
    case 'snow':
      for (let i = 0; i < 6; i++) {
        g.save();
        g.rotate((i * Math.PI) / 3);
        g.rect(-s * 0.07, -s * 0.98, s * 0.14, s * 0.98);
        g.moveTo(0, -s * 0.6);
        g.rect(-s * 0.32, -s * 0.66, s * 0.64, s * 0.12);
        g.restore();
      }
      g.moveTo(s * 0.22, 0);
      g.arc(0, 0, s * 0.22, 0, Math.PI * 2);
      break;
    case 'flame':
      g.moveTo(0, -s);
      g.bezierCurveTo(s * 0.35, -s * 0.5, s * 0.85, -s * 0.1, s * 0.7, s * 0.4);
      g.bezierCurveTo(s * 0.55, s * 0.85, -s * 0.55, s * 0.85, -s * 0.7, s * 0.4);
      g.bezierCurveTo(-s * 0.82, 0, -s * 0.35, -s * 0.2, -s * 0.2, -s * 0.55);
      g.quadraticCurveTo(-s * 0.05, -s * 0.2, 0, -s);
      break;
    case 'heart':
      g.moveTo(0, s * 0.85);
      g.bezierCurveTo(-s * 1.2, 0, -s * 0.75, -s * 1.05, 0, -s * 0.45);
      g.bezierCurveTo(s * 0.75, -s * 1.05, s * 1.2, 0, 0, s * 0.85);
      break;
    case 'moon':
      g.arc(0, 0, s * 0.9, Math.PI * 0.3, Math.PI * 1.7, false);
      g.arc(s * 0.38, -s * 0.12, s * 0.72, Math.PI * 1.55, Math.PI * 0.45, true);
      break;
    case 'camera':
      g.roundRect(-s * 0.95, -s * 0.5, s * 1.9, s * 1.2, s * 0.18);
      g.roundRect(-s * 0.35, -s * 0.75, s * 0.7, s * 0.3, s * 0.06);
      break;
    case 'cone':
      g.moveTo(-s * 0.48, -s * 0.05);
      g.lineTo(0, s);
      g.lineTo(s * 0.48, -s * 0.05);
      g.moveTo(s * 0.55, -s * 0.35);
      g.arc(0, -s * 0.35, s * 0.55, 0, Math.PI * 2);
      break;
    case 'wave':
      g.moveTo(-s, s * 0.2);
      for (let i = 0; i <= 20; i++) {
        const x = -s + (i / 20) * 2 * s;
        g.lineTo(x, -s * 0.15 + Math.sin((i / 20) * Math.PI * 3) * s * 0.28);
      }
      g.lineTo(s, s * 0.75);
      g.lineTo(-s, s * 0.75);
      break;
    case 'dumbbell':
      g.roundRect(-s * 0.95, -s * 0.5, s * 0.32, s, s * 0.08);
      g.roundRect(s * 0.63, -s * 0.5, s * 0.32, s, s * 0.08);
      g.rect(-s * 0.65, -s * 0.1, s * 1.3, s * 0.2);
      break;
  }
}

function detail(g: CanvasRenderingContext2D, k: StickerKind, s: number, c2: string) {
  g.fillStyle = c2;
  g.strokeStyle = c2;
  g.lineCap = 'round';
  g.lineWidth = s * 0.09;
  switch (k) {
    case 'cup':
      g.beginPath();
      g.arc(s * 0.38, s * 0.25, s * 0.2, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      for (const dx of [-0.32, 0.05]) {
        g.moveTo(s * dx, -s * 0.32);
        g.bezierCurveTo(s * (dx - 0.15), -s * 0.5, s * (dx + 0.15), -s * 0.62, s * dx, -s * 0.85);
      }
      g.stroke();
      g.fillRect(-s * 0.62, -s * 0.2, s, s * 0.16);
      break;
    case 'cake':
      g.fillRect(-s * 0.8, s * 0.22, s * 1.6, s * 0.12);
      g.fillRect(-s * 0.6, -s * 0.22, s * 1.2, s * 0.1);
      g.beginPath();
      g.ellipse(0, -s * 0.93, s * 0.09, s * 0.14, 0, 0, Math.PI * 2);
      g.fillStyle = '#ffb02e';
      g.fill();
      break;
    case 'book':
      g.beginPath();
      g.moveTo(0, -s * 0.45);
      g.lineTo(0, s * 0.62);
      g.stroke();
      g.lineWidth = s * 0.05;
      g.beginPath();
      for (const y of [-0.3, -0.1, 0.1, 0.3]) {
        g.moveTo(-s * 0.75, s * y);
        g.lineTo(-s * 0.2, s * (y + 0.05));
        g.moveTo(s * 0.2, s * (y + 0.05));
        g.lineTo(s * 0.75, s * y);
      }
      g.stroke();
      break;
    case 'sun':
      g.beginPath();
      g.arc(0, 0, s * 0.5, 0, Math.PI * 2);
      g.fill();
      break;
    case 'leaf':
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.moveTo(0, s * 0.95);
      g.lineTo(0, -s * 0.7);
      g.moveTo(0, -s * 0.05);
      g.lineTo(s * 0.6, -s * 0.15);
      g.moveTo(0, -s * 0.05);
      g.lineTo(-s * 0.6, -s * 0.15);
      g.stroke();
      break;
    case 'flame':
      g.beginPath();
      g.moveTo(0, -s * 0.3);
      g.bezierCurveTo(s * 0.35, 0, s * 0.45, s * 0.35, s * 0.25, s * 0.55);
      g.bezierCurveTo(s * 0.1, s * 0.7, -s * 0.3, s * 0.65, -s * 0.32, s * 0.4);
      g.bezierCurveTo(-s * 0.35, s * 0.1, -s * 0.1, 0, 0, -s * 0.3);
      g.fill();
      break;
    case 'heart':
      g.beginPath();
      g.ellipse(-s * 0.35, -s * 0.35, s * 0.14, s * 0.09, -0.6, 0, Math.PI * 2);
      g.fill();
      break;
    case 'camera':
      g.beginPath();
      g.arc(0, s * 0.1, s * 0.38, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(0, s * 0.1, s * 0.2, 0, Math.PI * 2);
      g.fillStyle = '#2b2b2e';
      g.fill();
      break;
    case 'cone':
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.moveTo(-s * 0.3, s * 0.1);
      g.lineTo(s * 0.12, s * 0.6);
      g.moveTo(s * 0.3, s * 0.1);
      g.lineTo(-s * 0.12, s * 0.6);
      g.stroke();
      break;
    case 'wave':
      g.lineWidth = s * 0.07;
      g.beginPath();
      for (let i = 0; i <= 20; i++) {
        const x = -s + (i / 20) * 2 * s;
        const y = s * 0.3 + Math.sin((i / 20) * Math.PI * 3 + 1) * s * 0.12;
        if (i) g.lineTo(x, y);
        else g.moveTo(x, y);
      }
      g.stroke();
      break;
    case 'star':
      g.beginPath();
      g.arc(-s * 0.15, -s * 0.12, s * 0.1, 0, Math.PI * 2);
      g.fill();
      break;
    case 'note':
    case 'snow':
    case 'moon':
    case 'dumbbell':
      break;
  }
}

/** Вырубная наклейка: белая кромка, тень, лёгкий блик. appear 0..1 — «приклеивается» */
export function drawSticker(g: CanvasRenderingContext2D, k: StickerKind, x: number, y: number, size: number, rot: number, appear = 1) {
  if (appear <= 0) return;
  const [c1, c2] = STICKER_COLORS[k];
  const s = size / 2;
  const back = 1.70158;
  const t = appear - 1;
  const sc = 1 + (back + 1) * t * t * t + back * t * t; // easeOutBack
  g.save();
  g.translate(x, y);
  g.rotate(rot + (1 - appear) * 0.5);
  g.scale(sc, sc);
  g.globalAlpha = Math.min(1, appear * 2);
  g.lineJoin = 'round';
  // кромка с тенью
  g.shadowColor = 'rgba(30,20,10,0.35)';
  g.shadowBlur = size * 0.08;
  g.shadowOffsetY = size * 0.03;
  shape(g, k, s);
  g.strokeStyle = '#fffdf6';
  g.lineWidth = size * 0.14;
  g.stroke();
  g.fillStyle = '#fffdf6';
  g.fill();
  g.shadowColor = 'transparent';
  shape(g, k, s);
  g.fillStyle = c1;
  g.fill();
  if (k === 'note' || k === 'snow' || k === 'dumbbell') {
    // однотонные — только кромка
  }
  detail(g, k, s, c2);
  // блик плёнки
  const grd = g.createLinearGradient(-s, -s, s, s);
  grd.addColorStop(0, 'rgba(255,255,255,0.28)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0)');
  shape(g, k, s);
  g.fillStyle = grd;
  g.fill();
  g.restore();
}

/** Васи-скотч: полупрозрачная лента с узором и рваными краями */
export function drawWashi(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rot: number, color: string, seed: number) {
  const rnd = mulberry32(seed);
  const pattern = Math.floor(rnd() * 4);
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  // рваные края
  g.beginPath();
  const teeth = 7;
  g.moveTo(-w / 2, -h / 2);
  g.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) g.lineTo(w / 2 + (i % 2 ? 3 + rnd() * 3 : -2), -h / 2 + (i * h) / teeth);
  g.lineTo(-w / 2, h / 2);
  for (let i = teeth - 1; i >= 0; i--) g.lineTo(-w / 2 + (i % 2 ? -3 - rnd() * 3 : 2), -h / 2 + (i * h) / teeth);
  g.closePath();
  g.globalAlpha = 0.78;
  g.fillStyle = color;
  g.fill();
  g.clip();
  g.globalAlpha = 0.45;
  g.fillStyle = '#fffdf6';
  g.strokeStyle = '#fffdf6';
  if (pattern === 0) {
    g.lineWidth = h * 0.18;
    for (let xx = -w; xx < w; xx += h * 0.6) {
      g.beginPath();
      g.moveTo(xx, -h);
      g.lineTo(xx + h, h);
      g.stroke();
    }
  } else if (pattern === 1) {
    for (let xx = -w / 2 + 6; xx < w / 2; xx += h * 0.45)
      for (let yy = -h / 2 + 6; yy < h / 2; yy += h * 0.45) {
        g.beginPath();
        g.arc(xx, yy, h * 0.08, 0, Math.PI * 2);
        g.fill();
      }
  } else if (pattern === 2) {
    g.lineWidth = 1.5;
    for (let xx = -w / 2; xx < w / 2; xx += h * 0.3) {
      g.beginPath();
      g.moveTo(xx, -h / 2);
      g.lineTo(xx, h / 2);
      g.stroke();
    }
    for (let yy = -h / 2; yy < h / 2; yy += h * 0.3) {
      g.beginPath();
      g.moveTo(-w / 2, yy);
      g.lineTo(w / 2, yy);
      g.stroke();
    }
  } else {
    g.fillRect(-w / 2, -h * 0.12, w, h * 0.24);
  }
  g.restore();
}
