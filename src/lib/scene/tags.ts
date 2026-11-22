import type { SceneLayers } from './depth';

/**
 * Что вокруг снимка: по цветам и глубине кадра угадываем, где стоял человек —
 * дорога, лес, дома, поле, снег или комната — и в каких красках это продолжать за рамкой.
 */

export type RGB = [number, number, number];
type Pic = CanvasImageSource & { width: number; height: number };

export interface SceneTags {
  kind: 'nature' | 'city' | 'park' | 'indoor';
  bright: number; // средняя яркость кадра
  tex: { ground: HTMLCanvasElement | null; leaf: HTMLCanvasElement | null; plants: HTMLCanvasElement[] }; // куски самого снимка: земля, листва, кусты и цветы
  ground: 'grass' | 'asphalt' | 'snow' | 'sand' | 'soil';
  road: { x: number; width: number } | null; // смещение центра дороги вбок (м) и ширина
  veg: number; // доля зелени в кадре
  vegL: number; // зелень слева / справа — куда сажать деревья
  vegR: number;
  conifer: boolean; // ели (зима, тёмная зелень)
  built: number; // доля построек над горизонтом
  water: boolean;
  colors: {
    ground: RGB;
    road: RGB;
    leaf: RGB;
    wall: RGB;
    skyTop: RGB | null;
    skyLow: RGB | null;
    indoorWall: RGB;
  };
}

function pixels(img: Pic, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const avg = (s: number[], n: number, d: RGB): RGB => (n ? [s[0] / n, s[1] / n, s[2] / n] : d);
/** тени и пересветы на снимке — не цвет материала: яркость приводим к разумной, оттенок сохраняем */
const tame = (c: RGB, lo: number, hi: number): RGB => {
  const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  if (l <= 0.001) return [lo, lo, lo];
  const k = Math.min(hi, Math.max(lo, l)) / l;
  return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)];
};

export function readScene(L: SceneLayers, photo: Pic, opts: { month: number; south: boolean; temp?: number; sunUp: boolean; snowing?: boolean }): SceneTags {
  const { gw, gh } = L;
  const px = pixels(photo, gw, gh);
  const fg = L.fg ? pixels(L.fg, gw, gh) : null;
  const hy = Math.round(Math.min(0.8, Math.max(0.15, L.horizon)) * gh);
  const isFg = (i: number) => !!fg && fg[i * 4 + 3] > 60;
  let lumAll = 0;
  for (let i = 0; i < gw * gh; i++) lumAll += (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  lumAll /= gw * gh;

  const cls = (i: number) => {
    const r = px[i * 4] / 255,
      g = px[i * 4 + 1] / 255,
      b = px[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (g >= r * 0.92 && g > b * 1.08 && sat > 0.14 && mx > 0.07) return 'veg';
    if (r > g * 1.05 && g > b * 1.25 && sat > 0.35 && r > 0.35 && mx < 0.85 && lum < 0.7) return 'veg'; // осенняя листва
    if (lum > Math.max(0.55, lumAll * 1.3) && sat < 0.3) return 'snow';
    if (b > r * 1.12 && b >= g * 0.98 && sat > 0.18) return 'water';
    if ((sat < 0.16 || mx - mn < 0.05) && lum > 0.06 && lum < 0.75) return 'asphalt';
    if (r >= g && g >= b && sat > 0.18 && sat < 0.55 && lum > 0.42) return 'sand';
    return 'soil';
  };

  // небо, которое маска могла пропустить (облака, сумерки): заливка от верхнего края по ровным светлым пикселям
  const lumA = new Float32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) lumA[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  const grad = (i: number) => {
    const x = i % gw,
      y = (i / gw) | 0;
    const gx = x > 0 && x < gw - 1 ? Math.abs(lumA[i + 1] - lumA[i - 1]) : 0,
      gy = y > 0 && y < gh - 1 ? Math.abs(lumA[i + gw] - lumA[i - gw]) : 0;
    return Math.max(gx, gy);
  };
  const skyX = Uint8Array.from(L.sky);
  {
    const ok = (i: number) => lumA[i] > 0.28 && grad(i) < 0.12 && cls(i) !== 'veg';
    const q: number[] = [];
    for (let x = 0; x < gw; x++) if (ok(x)) (skyX[x] = 1), q.push(x);
    const lim = Math.min(gh, hy + Math.round(gh * 0.1));
    while (q.length) {
      const i = q.pop()!;
      const x = i % gw,
        y = (i / gw) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < lim - 1 ? i + gw : -1]) {
        if (j < 0 || skyX[j] || !ok(j)) continue;
        let dm = 0;
        for (let k = 0; k < 3; k++) dm = Math.max(dm, Math.abs(px[j * 4 + k] - px[i * 4 + k]) / 255);
        if (dm > 0.09) continue;
        skyX[j] = 1;
        q.push(j);
      }
    }
  }

  // земля — нижняя часть кадра, без неба и без главного объекта
  const g0 = Math.max(hy + Math.round(gh * 0.06), Math.round(gh * 0.62));
  const cnt: Record<string, number> = { veg: 0, snow: 0, water: 0, asphalt: 0, sand: 0, soil: 0 };
  const sums: Record<string, number[]> = { veg: [0, 0, 0], snow: [0, 0, 0], water: [0, 0, 0], asphalt: [0, 0, 0], sand: [0, 0, 0], soil: [0, 0, 0] };
  const colAsph = new Float32Array(gw),
    colN = new Float32Array(gw);
  let nG = 0;
  for (let y = g0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (skyX[i] || isFg(i)) continue;
      const c = cls(i);
      cnt[c]++;
      for (let k = 0; k < 3; k++) sums[c][k] += px[i * 4 + k] / 255;
      colN[x]++;
      if (c === 'asphalt') colAsph[x]++;
      nG++;
    }
  const share = (c: string) => (nG ? cnt[c] / nG : 0);

  // дорога: полоса серого посреди земли, по бокам — не серое
  let road: SceneTags['road'] = null as SceneTags['road'];
  const asphShare = share('asphalt');
  if (asphShare > 0.18) {
    const f = Array.from(colAsph, (v, x) => (colN[x] ? v / colN[x] : 0));
    let best = { a: 0, b: -1 };
    let a = -1;
    for (let x = 0; x <= gw; x++) {
      const on = x < gw && f[x] > 0.5;
      if (on && a < 0) a = x;
      if (!on && a >= 0) {
        if (x - a > best.b - best.a) best = { a, b: x };
        a = -1;
      }
    }
    const w = (best.b - best.a) / gw;
    if (w > 0.14) {
      const uc = (best.a + best.b) / 2 / gw;
      road = { x: (uc * 2 - 1) * 2.5, width: asphShare > 0.8 ? 12 : Math.min(14, Math.max(6, w * 14)) };
    }
  }

  // зелень по сторонам и постройки над горизонтом
  let veg = 0,
    vegL = 0,
    vegR = 0,
    nL = 0,
    nR = 0,
    built = 0,
    nUp = 0,
    skyN = 0;
  const leafS = [0, 0, 0],
    wallS = [0, 0, 0],
    topS = [0, 0, 0],
    lowS = [0, 0, 0],
    allS = [0, 0, 0];
  let leafN = 0,
    wallN = 0,
    topN = 0,
    lowN = 0,
    dark = 0;
  let skyBottom = 0;
  for (let i = 0; i < gw * gh; i++) if (skyX[i]) skyBottom = Math.max(skyBottom, Math.floor(i / gw));
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      for (let k = 0; k < 3; k++) allS[k] += px[i * 4 + k] / 255;
      if (skyX[i]) {
        skyN++;
        const t = y < Math.max(2, skyBottom * 0.3) ? topS : y > skyBottom * 0.7 ? lowS : null;
        if (t) {
          for (let k = 0; k < 3; k++) t[k] += px[i * 4 + k] / 255;
          if (t === topS) topN++;
          else lowN++;
        }
        continue;
      }
      if (isFg(i)) continue;
      const c = cls(i);
      const left = x < gw / 2;
      if (left) nL++;
      else nR++;
      if (c === 'veg') {
        veg++;
        if (left) vegL++;
        else vegR++;
        if (leafN < 1e9) for (let k = 0; k < 3; k++) leafS[k] += px[i * 4 + k] / 255;
        leafN++;
        const r = px[i * 4] / 255,
          g = px[i * 4 + 1] / 255;
        if (g < 0.32 && r < 0.25) dark++;
      }
      if (y < hy) {
        nUp++;
        if (c !== 'veg') {
          // тёмные силуэты и облака, не попавшие в маску неба, — не дома
          const r = px[i * 4] / 255,
            g = px[i * 4 + 1] / 255,
            b = px[i * 4 + 2] / 255;
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;
          const mx = Math.max(r, g, b),
            sat = mx ? (mx - Math.min(r, g, b)) / mx : 0;
          const L2 = (j: number) => (0.299 * px[j * 4] + 0.587 * px[j * 4 + 1] + 0.114 * px[j * 4 + 2]) / 255;
          const gx = x > 0 && x < gw - 1 ? Math.abs(L2(i + 1) - L2(i - 1)) : 0,
            gy = y > 0 && y < gh - 1 ? Math.abs(L2(i + gw) - L2(i - gw)) : 0;
          const cloud = lum > 0.42 && sat < 0.32 && Math.max(gx, gy) < 0.05;
          // яркое насыщенное (цветы, закатное небо) — тоже не стены
          // голубое и самое дальнее — это небо, которое маска не поймала
          const bluish = b > r * 1.08 && b > g && sat > 0.12;
          if (lum < 0.1 || cloud || sat > 0.5 || bluish || L.depthRaw[i] > 0.9) nUp--;
          else {
            built++;
            for (let k = 0; k < 3; k++) wallS[k] += r * (k === 0 ? 1 : 0) + g * (k === 1 ? 1 : 0) + b * (k === 2 ? 1 : 0);
            wallN++;
          }
        }
      }
    }
  const N = gw * gh;
  const vegShare = veg / N;
  const builtShare = nUp ? built / nUp : 0;
  const skyShare = skyN / N;
  const winter = opts.south ? opts.month >= 6 && opts.month <= 8 : opts.month === 12 || opts.month <= 2;
  const autumn = opts.south ? opts.month >= 3 && opts.month <= 5 : opts.month >= 9 && opts.month <= 11;

  // средний цвет земли зелёный — трава (даже если пиксели «шумят», как на снимке экрана)
  const greenGround = () => {
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let y = g0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (skyX[i] || isFg(i)) continue;
        r += px[i * 4];
        g += px[i * 4 + 1];
        b += px[i * 4 + 2];
        n++;
      }
    return n > 0 && g > r * 1.04 && g > b * 1.12;
  };
  const vegShareAll = () => {
    let v = 0;
    for (let i = 0; i < gw * gh; i++) if (!skyX[i] && cls(i) === 'veg') v++;
    return v / (gw * gh);
  };
  let ground: SceneTags['ground'] = 'soil';
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0][0];
  // снег — только если ему есть откуда взяться: зима, мороз или снегопад; и не там, где всё зелёное
  // (светлый гравий, указатель или блик экрана — не снег)
  const snowOk = (winter || (opts.temp ?? 10) <= 1 || !!opts.snowing) && !greenGround() && vegShareAll() < 0.35;
  if (snowOk && (share('snow') > 0.3 || (winter && (opts.temp ?? 5) <= 0 && share('snow') > 0.12))) ground = 'snow';
  else if (top === 'veg' || share('veg') > 0.35 || greenGround()) ground = 'grass';
  else if (top === 'asphalt') ground = 'asphalt';
  else if (top === 'sand') ground = 'sand';
  else if (snowOk && winter && (opts.temp ?? 5) <= -3) ground = 'snow';

  // комната: днём не видно неба и почти нет зелени, а земля не похожа на улицу
  // комната: на снимке нет настоящего неба и зелени, а кадр — крупный план или светлый интерьер
  const realSky = L.sky.reduce((a, v) => a + v, 0) / N;
  const fgArea = L.fgBox ? L.fgBox.w * L.fgBox.h : 0;
  const indoor = ground !== 'snow' && ((realSky < 0.02 && vegShare < 0.06 && (fgArea > 0.25 || lumAll > 0.38)) || (fgArea > 0.35 && realSky < 0.08 && vegShare < 0.25));
  void skyShare;
  const kind: SceneTags['kind'] = indoor ? 'indoor' : builtShare > 0.45 && vegShare < 0.3 ? 'city' : builtShare > 0.25 ? 'park' : 'nature';

  // в городе под ногами почти всегда улица: если низ кадра не трава и не снег — продолжаем дорогу вперёд
  if (!road && !indoor && (kind === 'city' || kind === 'park') && ground !== 'grass') {
    let bv = 0,
      bn = 0;
    for (let y = Math.round(gh * 0.8); y < gh; y++)
      for (let x = Math.round(gw * 0.3); x < gw * 0.7; x++) {
        const i = y * gw + x;
        if (skyX[i]) continue;
        bn++;
        if (cls(i) === 'veg') bv++;
      }
    if (!bn || bv / bn < 0.3) road = { x: 0, width: kind === 'city' ? 10 : 6 };
  }
  const defLeaf: RGB = winter ? [0.16, 0.24, 0.18] : autumn ? [0.62, 0.42, 0.16] : [0.3, 0.46, 0.2];
  const leaf = avg(leafS, leafN, defLeaf);
  const groundCol: RGB =
    ground === 'snow'
      ? avg(sums.snow, cnt.snow, [0.86, 0.88, 0.92])
      : ground === 'grass'
        ? avg(sums.veg, cnt.veg, [0.3, 0.42, 0.2])
        : ground === 'asphalt'
          ? avg(sums.asphalt, cnt.asphalt, [0.36, 0.36, 0.37])
          : ground === 'sand'
            ? avg(sums.sand, cnt.sand, [0.72, 0.62, 0.45])
            : avg(sums.soil, cnt.soil, [0.42, 0.36, 0.28]);
  // текстуры из самого снимка: земля у ног и листва — продолжение будет из того же материала
  const want = ground === 'grass' ? 'veg' : ground === 'snow' ? 'snow' : ground === 'asphalt' ? 'asphalt' : ground === 'sand' ? 'sand' : 'soil';
  const texGround = swatch(photo, gw, gh, (i) => !skyX[i] && !isFg(i) && cls(i) === want, Math.max(g0, Math.round(gh * 0.68)), gh, 0.2);
  // листва деревьев — зелёная и выше горизонта (не цветы и не трава под ногами)
  const green = (i: number) => px[i * 4 + 1] >= px[i * 4] && cls(i) === 'veg';
  const texLeaf = leafN > gw * gh * 0.04 ? swatch(photo, gw, gh, (i) => !skyX[i] && !isFg(i) && green(i), 0, Math.round(gh * 0.75), 0.12) : null;
  // заросли под ногами (поле подсолнухов, высокая трава, кусты) — вырезаем куски и потом рассаживаем вокруг
  const plants: HTMLCanvasElement[] = [];
  if (kind !== 'indoor' && cnt.veg / Math.max(1, nG) > 0.35) {
    const used: [number, number][] = [];
    const ws = Math.round(gw * 0.16);
    for (let k = 0; k < 4; k++) {
      let best = -1,
        bx = 0,
        by = 0;
      for (let y = Math.max(hy, Math.round(gh * 0.45)); y + ws <= gh; y += 3)
        for (let x = 0; x + ws <= gw; x += 3) {
          if (used.some(([ux, uy]) => Math.abs(ux - x) < ws && Math.abs(uy - y) < ws)) continue;
          let v = 0;
          for (let yy = y; yy < y + ws; yy += 2) for (let xx = x; xx < x + ws; xx += 2) if (!skyX[yy * gw + xx] && !isFg(yy * gw + xx) && cls(yy * gw + xx) === 'veg') v++;
          if (v > best) (best = v), (bx = x), (by = y);
        }
      if (best < (ws * ws) / 4 * 0.45) break;
      used.push([bx, by]);
      plants.push(clump(photo, (bx / gw) * photo.width, (by / gh) * photo.height, (ws / gw) * photo.width, (ws / gh) * photo.height, k));
    }
  }
  return {
    kind,
    bright: lumAll,
    tex: { ground: kind === 'indoor' ? null : texGround, leaf: texLeaf, plants },
    ground,
    road: kind === 'indoor' ? null : road,
    veg: vegShare,
    vegL: nL ? vegL / nL : 0,
    vegR: nR ? vegR / nR : 0,
    conifer: winter || (leafN > 0 && dark / leafN > 0.75),
    built: builtShare,
    water: share('water') > 0.25,
    colors: {
      // яркость — в пределах того, что есть на самом снимке: ночной кадр остаётся ночным
      ground: tame(ground === 'snow' ? groundCol : kind === 'city' && ground !== 'grass' ? mix3(groundCol, [0.55, 0.54, 0.52], 0.5) : groundCol, lumAll * 0.55, Math.min(0.95, lumAll * (ground === 'snow' ? 2.4 : 1.6))),
      road: tame(avg(sums.asphalt, cnt.asphalt, [0.33, 0.33, 0.35]), lumAll * 0.5, lumAll * 1.2),
      leaf: tame(leaf, lumAll * 0.45, lumAll * 1.3),
      wall: tame(avg(wallS, wallN, [0.62, 0.56, 0.5]), lumAll * 0.8, Math.min(0.85, lumAll * 2)),
      skyTop: topN > 20 ? avg(topS, topN, [0, 0, 0]) : null,
      skyLow: lowN > 20 ? avg(lowS, lowN, [0, 0, 0]) : null,
      indoorWall: tame(avg(allS, N, [0.6, 0.56, 0.5]), lumAll * 0.9, Math.min(0.85, lumAll * 1.8)),
    },
  };
}

/**
 * Кусок снимка, где больше всего нужного (травы, снега, асфальта, листвы), — бесшовная плитка 512×512
 * (зеркально сложена из четырёх копий, чтобы края совпадали).
 */
function swatch(photo: Pic, gw: number, gh: number, hit: (i: number) => boolean, y0: number, y1: number, frac: number): HTMLCanvasElement | null {
  const ws = Math.max(6, Math.round(gw * frac));
  if (y1 - y0 < ws) y0 = Math.max(0, y1 - ws);
  // интегральная картинка попаданий
  const I = new Float32Array((gw + 1) * (gh + 1));
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) I[(y + 1) * (gw + 1) + x + 1] = (hit(y * gw + x) ? 1 : 0) + I[y * (gw + 1) + x + 1] + I[(y + 1) * (gw + 1) + x] - I[y * (gw + 1) + x];
  const sum = (x: number, y: number) => I[(y + ws) * (gw + 1) + x + ws] - I[y * (gw + 1) + x + ws] - I[(y + ws) * (gw + 1) + x] + I[y * (gw + 1) + x];
  let best = -1,
    bx = 0,
    by = 0;
  for (let y = y0; y + ws <= y1; y += 2)
    for (let x = 0; x + ws <= gw; x += 2) {
      // чуть предпочитаем середину кадра — там резче
      const v = sum(x, y) * (1 - Math.abs((x + ws / 2) / gw - 0.5) * 0.3);
      if (v > best) (best = v), (bx = x), (by = y);
    }
  if (best < ws * ws * 0.42) return null;
  const W = photo.width,
    H = photo.height;
  const sx = (bx / gw) * W,
    sy = (by / gh) * H,
    sw = (ws / gw) * W,
    sh = (ws / gh) * H;
  // бесшовная плитка: под кадром — он же, сдвинутый на полплитки; сверху сам кадр, края которого растворяются
  const S = 512;
  const A = document.createElement('canvas');
  A.width = A.height = S;
  const ga = A.getContext('2d')!;
  ga.imageSmoothingQuality = 'high';
  ga.drawImage(photo, sx, sy, sw, sh, 0, 0, S, S);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  for (const [ox, oy] of [
    [-S / 2, -S / 2],
    [S / 2, -S / 2],
    [-S / 2, S / 2],
    [S / 2, S / 2],
  ])
    g.drawImage(A, ox, oy);
  const M = document.createElement('canvas');
  M.width = M.height = S;
  const gm = M.getContext('2d')!;
  gm.drawImage(A, 0, 0);
  gm.globalCompositeOperation = 'destination-in';
  const rg = gm.createRadialGradient(S / 2, S / 2, S * 0.22, S / 2, S / 2, S * 0.5);
  rg.addColorStop(0, 'rgba(0,0,0,1)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  gm.fillStyle = rg;
  gm.fillRect(0, 0, S, S);
  g.drawImage(M, 0, 0);
  return c;
}

/** куст из куска снимка: силуэт — несколько круглых «шапок» листвы, плотнее снизу; внутри — пиксели самого фото */
function clump(photo: Pic, sx: number, sy: number, sw: number, sh: number, seed: number): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(photo, sx, sy, sw, sh, 0, 0, S, S);
  const im = g.getImageData(0, 0, S, S);
  const d = im.data;
  let st = seed * 9301 + 49297;
  const rnd = () => ((st = (st * 9301 + 49297) % 233280) / 233280);
  // силуэт куста: круги разного размера, центры — в нижней половине
  const blobs: [number, number, number][] = [];
  for (let k = 0; k < 7; k++) blobs.push([S * (0.2 + rnd() * 0.6), S * (0.45 + rnd() * 0.35), S * (0.16 + rnd() * 0.16)]);
  blobs.push([S * 0.5, S * 0.8, S * 0.3]);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      let m = 0;
      for (const [bx, by, br] of blobs) {
        const q = 1 - Math.hypot(x - bx, y - by) / br;
        if (q > m) m = q;
      }
      d[i + 3] = m > 0 ? 255 : 0;
    }
  g.putImageData(im, 0, 0);
  return c;
}
