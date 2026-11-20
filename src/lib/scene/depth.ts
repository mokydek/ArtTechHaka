// Глубина одного кадра и слои сцены: фон с дорисовкой, объект, небо, линия горизонта.
// FastDepth (MIT) + U²-Netp (Apache-2.0) — обе работают в браузере.

import { applyMask, cutout, inpaint, model } from '../live/segment';

type Src = CanvasImageSource & { width: number; height: number };
const D = 224; // вход FastDepth

/** Относительная глубина 0 (близко) … 1 (далеко), сетка gw×gh */
export async function depthMap(src: Src, gw: number, gh: number): Promise<Float32Array> {
  const { ort, session } = await model('/ml/fastdepth.onnx');
  const c = document.createElement('canvas');
  c.width = D;
  c.height = D;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, D, D);
  const px = g.getImageData(0, 0, D, D).data;
  const data = new Float32Array(3 * D * D);
  for (let i = 0, p = 0; i < D * D; i++, p += 4) for (let k = 0; k < 3; k++) data[k * D * D + i] = px[p + k] / 255;
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', data, [1, 3, D, D]) });
  const raw = out[session.outputNames[0]].data as Float32Array;
  // нормировка по перцентилям, чтобы выбросы не сжимали шкалу
  const sorted = Float32Array.from(raw).sort();
  const lo = sorted[Math.floor(sorted.length * 0.02)],
    hi = sorted[Math.floor(sorted.length * 0.98)];
  const k = hi - lo || 1;
  // ресемплинг на сетку + сглаживание
  const res = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const fx = (x / (gw - 1)) * (D - 1),
        fy = (y / (gh - 1)) * (D - 1);
      const x0 = Math.floor(fx),
        y0 = Math.floor(fy),
        x1 = Math.min(D - 1, x0 + 1),
        y1 = Math.min(D - 1, y0 + 1);
      const tx = fx - x0,
        ty = fy - y0;
      const v = (raw[y0 * D + x0] * (1 - tx) + raw[y0 * D + x1] * tx) * (1 - ty) + (raw[y1 * D + x0] * (1 - tx) + raw[y1 * D + x1] * tx) * ty;
      res[y * gw + x] = Math.min(1, Math.max(0, (v - lo) / k));
    }
  return blur(res, gw, gh, 2);
}

function blur(a: Float32Array, w: number, h: number, r: number) {
  const t = new Float32Array(a.length),
    o = new Float32Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0,
        n = 0;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx < 0 || xx >= w) continue;
        s += a[y * w + xx];
        n++;
      }
      t[y * w + x] = s / n;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0,
        n = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy < 0 || yy >= h) continue;
        s += t[yy * w + x];
        n++;
      }
      o[y * w + x] = s / n;
    }
  return o;
}

/** Линия горизонта как самый сильный ровный перепад яркости по всей ширине кадра (море, поле) */
function horizonLine(lum: Float32Array, gw: number, gh: number): number | null {
  const score: number[] = [];
  for (let y = 0; y < gh; y++) {
    if (y < 2 || y > gh - 3 || y < gh * 0.2 || y > gh * 0.75) {
      score.push(0);
      continue;
    }
    let sum = 0,
      on = 0;
    for (let x = 0; x < gw; x++) {
      const d = Math.abs(lum[(y + 1) * gw + x] - lum[(y - 1) * gw + x]);
      sum += d;
      if (d > 0.04) on++;
    }
    score.push((sum / gw) * (on / gw));
  }
  let best = 0,
    by = -1;
  score.forEach((v, y) => {
    if (v > best) {
      best = v;
      by = y;
    }
  });
  const sorted = score.filter((v) => v > 0).sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (by < 0 || best < 0.006 || best < med * 4) return null;
  // линия должна быть ровной: перепад есть почти во всех столбцах
  let on = 0;
  for (let x = 0; x < gw; x++) if (Math.max(...[-1, 0, 1].map((k) => Math.abs(lum[(by + 1 + k) * gw + x] - lum[(by - 1 + k) * gw + x]))) > 0.03) on++;
  return on / gw > 0.7 ? (by + 0.5) / gh : null;
}

/** Небо: светлое/голубое/серое, гладкое, связанное с верхним краем кадра */
export function skyMask(src: Src, gw: number, gh: number, depth: Float32Array): { sky: Uint8Array; horizon: number } {
  const c = document.createElement('canvas');
  c.width = gw;
  c.height = gh;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0, gw, gh);
  const px = g.getImageData(0, 0, gw, gh).data;
  const lum = new Float32Array(gw * gh);
  const cand = new Uint8Array(gw * gh);
  let mean = 0;
  for (let i = 0; i < gw * gh; i++) mean += (0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2]) / 255;
  const darkShot = mean / (gw * gh) < 0.2; // ночной кадр: небо тёмное
  for (let i = 0; i < gw * gh; i++) {
    const r = px[i * 4] / 255,
      gg = px[i * 4 + 1] / 255,
      b = px[i * 4 + 2] / 255;
    lum[i] = 0.3 * r + 0.59 * gg + 0.11 * b;
    const mx = Math.max(r, gg, b),
      mn = Math.min(r, gg, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const blue = b > r * 1.05 && b > 0.35;
    const grey = sat < 0.2 && lum[i] > 0.5;
    const night = darkShot && lum[i] < 0.16 && b >= r; // тёмное ночное небо
    const y = (i / gw) | 0;
    cand[i] = (blue || grey || night) && depth[i] >= 0.58 && y < gh * 0.72 ? 1 : 0;
  }
  // гладкость: небо почти без деталей
  for (let y = 1; y < gh - 1; y++)
    for (let x = 1; x < gw - 1; x++) {
      const i = y * gw + x;
      const gr = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + gw] - lum[i - gw]);
      if (gr > 0.09 || depth[i] < 0.45) cand[i] = 0;
    }
  // заливка от верхнего края
  const sky = new Uint8Array(gw * gh);
  const q: number[] = [];
  for (let x = 0; x < gw; x++)
    if (cand[x]) {
      sky[x] = 1;
      q.push(x);
    }
  while (q.length) {
    const i = q.pop()!;
    const x = i % gw,
      y = (i / gw) | 0;
    const nb = [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1];
    for (const j of nb)
      if (j >= 0 && !sky[j] && cand[j]) {
        sky[j] = 1;
        q.push(j);
      }
  }
  const columns = () => {
    for (let x = 0; x < gw; x++) {
      let open = true;
      for (let y = 0; y < gh; y++) {
        const i = y * gw + x;
        if (!sky[i]) open = false;
        else if (!open) sky[i] = 0;
      }
    }
  };
  columns();
  // горизонт: почти самый низкий край неба (передний план его только заслоняет)
  const bottoms: number[] = [];
  for (let x = 0; x < gw; x++) {
    let b = -1;
    for (let y = 0; y < gh; y++) if (sky[y * gw + x]) b = y;
    if (b >= 0) bottoms.push(b);
  }
  bottoms.sort((a, b) => a - b);
  let horizon = bottoms.length > gw * 0.3 ? (bottoms[Math.floor(bottoms.length * 0.85)] + 1) / gh : 0.45;
  horizon = Math.min(0.62, Math.max(0.28, horizon));
  // ровная линия через весь кадр (море, степь) — сильнее любой догадки по небу
  const line = horizonLine(lum, gw, gh);
  const byLine = !!line && (bottoms.length < gw * 0.5 || line > horizon);
  if (byLine) horizon = Math.min(0.68, line!);
  const limit = Math.min(gh * 0.72, (horizon + 0.02) * gh);
  // дорастить небо по цвету: глубина нейросети снаружи ненадёжна (обучена на комнатах)
  let seed = 0;
  for (let i = 0; i < gw * gh; i++) seed += sky[i];
  if (seed > gw * gh * 0.04) {
    // эталон цвета по строкам: у неба вертикальный градиент
    const ref = new Float32Array(gh * 3).fill(-1);
    for (let y = 0; y < gh; y++) {
      let n = 0,
        r = 0,
        gg = 0,
        b = 0;
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (!sky[i]) continue;
        n++;
        r += px[i * 4];
        gg += px[i * 4 + 1];
        b += px[i * 4 + 2];
      }
      if (n >= 3) ref.set([r / n, gg / n, b / n], y * 3);
      else if (y > 0) ref.set(ref.subarray((y - 1) * 3, y * 3), y * 3);
    }
    const near = (i: number) => {
      const y = (i / gw) | 0;
      if (ref[y * 3] < 0) return false;
      const d = Math.hypot(px[i * 4] - ref[y * 3], px[i * 4 + 1] - ref[y * 3 + 1], px[i * 4 + 2] - ref[y * 3 + 2]) / 255;
      if (d < 0.13) return true;
      // светлая дымка/засветка у солнца: яркое и почти бесцветное
      const r = px[i * 4],
        g = px[i * 4 + 1],
        b = px[i * 4 + 2];
      const mx = Math.max(r, g, b),
        mn = Math.min(r, g, b);
      return lum[i] > 0.62 && (mx - mn) / mx < 0.22 && b >= r * 0.95;
    };
    const smoothAt = (i: number) => {
      const x = i % gw,
        y = (i / gw) | 0;
      if (x < 1 || y < 1 || x >= gw - 1 || y >= gh - 1) return true;
      return Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + gw] - lum[i - gw]) < 0.07;
    };
    const q2: number[] = [];
    for (let i = 0; i < gw * gh; i++) if (sky[i]) q2.push(i);
    while (q2.length) {
      const i = q2.pop()!;
      const x = i % gw,
        y = (i / gw) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < gw - 1 ? i + 1 : -1, y > 0 ? i - gw : -1, y < gh - 1 ? i + gw : -1])
        if (j >= 0 && !sky[j] && (j / gw | 0) < limit && near(j) && smoothAt(j)) {
          sky[j] = 1;
          q2.push(j);
        }
    }
  }
  // над ровной линией моря/степи небо — всё от верха до линии, кроме тёмных силуэтов (мыс, пальмы, люди)
  if (byLine && seed > gw * gh * 0.04) {
    const ly = Math.floor(horizon * gh) - 1;
    for (let x = 0; x < gw; x++)
      for (let y = 0; y < ly; y++) {
        const i = y * gw + x;
        if (lum[i] < 0.2) break;
        sky[i] = 1;
      }
  }
  // небо идёт сплошной полосой от верха в каждом столбце
  columns();
  return { sky, horizon };
}

export interface SceneLayers {
  gw: number;
  gh: number;
  depth: Float32Array; // 0..1 по сетке (без объекта — дорисовано)
  depthRaw: Float32Array; // исходная глубина (с объектом) — для рельефа объекта
  sky: Uint8Array; // 1 = небо
  horizon: number; // доля высоты кадра
  bg: HTMLCanvasElement; // фон: объект удалён и дорисован, небо прозрачно
  fg: HTMLCanvasElement | null; // объект с альфой
  fgBox: { x: number; y: number; w: number; h: number } | null; // в долях
  ground: string; // средний цвет земли
  skyImg: HTMLCanvasElement; // небо самого снимка (альфа — маска неба)
  sun: { u: number; v: number } | null; // солнце в кадре, если видно
}

/** Разложить фото на слои для 3D-сцены */
export async function buildLayers(src: Src, onStep?: (s: string) => void): Promise<SceneLayers> {
  const aspect = src.width / src.height;
  const gw = 128,
    gh = Math.max(64, Math.round(128 / aspect));
  onStep?.('оцениваю глубину');
  const depth = await depthMap(src, gw, gh);
  const depthRaw = Float32Array.from(depth);
  onStep?.('ищу главное');
  const cut = await cutout(src);
  const has = cut.area > 0.01 && cut.area < 0.75;
  onStep?.('нахожу небо и горизонт');
  const skm = skyMask(src, gw, gh, depth);
  const sky = skm.sky;
  let horizon = skm.horizon;
  // крупный портрет на фоне ровной стены — это не небо
  const skyArea = sky.reduce((a, v) => a + v, 0) / (gw * gh);
  if (has && cut.area > 0.4 && skyArea < 0.15) {
    sky.fill(0);
    horizon = 0.45;
  }
  for (let y = Math.ceil((horizon + 0.02) * gh); y < gh; y++) sky.fill(0, y * gw, (y + 1) * gw);
  // за объектом над горизонтом — тоже небо (если над ним небо): шагнёшь в сторону — увидишь небо, а не мутное пятно
  if (has && sky.some((v) => v)) {
    const mc = document.createElement('canvas');
    mc.width = gw;
    mc.height = gh;
    const mg = mc.getContext('2d', { willReadFrequently: true })!;
    mg.drawImage(cut.mask, 0, 0, gw, gh);
    const ma = mg.getImageData(0, 0, gw, gh).data;
    const hy = Math.floor(horizon * gh);
    for (let x = 0; x < gw; x++) {
      if (!sky[x]) continue;
      let y = 0;
      while (y < gh && sky[y * gw + x]) y++;
      // сквозь объект (и узкие просветы в его маске) — до горизонта
      let gap = 0;
      const from = y;
      while (y < hy) {
        if (ma[(y * gw + x) * 4 + 3] > 25) gap = 0;
        else if (++gap > 4) break;
        y++;
      }
      if (y - from > gap) for (let k = from; k < y - gap; k++) sky[k * gw + x] = 1;
    }
  }
  onStep?.('дорисовываю фон за объектом');
  // фон без объекта
  const W = Math.min(1600, src.width),
    H = Math.round(W / aspect);
  const bg = has ? inpaint(src, cut.mask, W, H) : (() => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d')!.drawImage(src, 0, 0, W, H);
    return c;
  })();
  // глубина под объектом — по соседям (дорисовка той же пирамидой)
  if (has) {
    const dc = document.createElement('canvas');
    dc.width = gw;
    dc.height = gh;
    const dg = dc.getContext('2d', { willReadFrequently: true })!;
    const im = dg.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) {
      const v = Math.round(depth[i] * 255);
      im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v;
      im.data[i * 4 + 3] = 255;
    }
    dg.putImageData(im, 0, 0);
    const filled = inpaint(dc, cut.mask, gw, gh);
    const fd = filled.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, gw, gh).data;
    for (let i = 0; i < gw * gh; i++) depth[i] = fd[i * 4] / 255;
  }
  // небо прозрачное — вместо него будет настоящее небо того часа
  const sc = document.createElement('canvas');
  sc.width = gw;
  sc.height = gh;
  const sg = sc.getContext('2d')!;
  const sm = sg.createImageData(gw, gh);
  for (let i = 0; i < gw * gh; i++) {
    sm.data[i * 4 + 3] = sky[i] ? 255 : 0;
  }
  sg.putImageData(sm, 0, 0);
  const blurPx = `blur(${Math.max(2, Math.round(W / 220))}px)`;
  // небо самого снимка — отдельным слоем: в минуту съёмки оно остаётся как было, при сдвиге времени тает
  const skyImg = document.createElement('canvas');
  skyImg.width = W;
  skyImg.height = H;
  const skg = skyImg.getContext('2d')!;
  skg.drawImage(bg, 0, 0);
  // маска неба шире, чем вырез фона: под полупрозрачной кромкой фона всегда лежит сам снимок, без просветов
  const wide = document.createElement('canvas');
  wide.width = W;
  wide.height = H;
  const wg = wide.getContext('2d')!;
  wg.filter = `blur(${Math.max(3, Math.round(W / 140))}px)`;
  wg.imageSmoothingQuality = 'high';
  for (let k = 0; k < 5; k++) wg.drawImage(sc, 0, 0, W, H);
  skg.globalCompositeOperation = 'destination-in';
  skg.drawImage(wide, 0, 0);
  const bgg = bg.getContext('2d')!;
  bgg.globalCompositeOperation = 'destination-out';
  bgg.filter = blurPx;
  bgg.imageSmoothingQuality = 'high';
  bgg.drawImage(sc, 0, 0, W, H);
  bgg.filter = 'none';
  bgg.globalCompositeOperation = 'source-over';
  // цвет земли — по нижней полосе кадра
  const gc = document.createElement('canvas');
  gc.width = 16;
  gc.height = 4;
  const gcx = gc.getContext('2d', { willReadFrequently: true })!;
  gcx.drawImage(src, 0, src.height * 0.88, src.width, src.height * 0.12, 0, 0, 16, 4);
  const gd = gcx.getImageData(0, 0, 16, 4).data;
  let r = 0,
    gg = 0,
    b = 0;
  for (let i = 0; i < gd.length; i += 4) {
    r += gd[i];
    gg += gd[i + 1];
    b += gd[i + 2];
  }
  const n = gd.length / 4;
  const ground = `rgb(${Math.round(r / n)},${Math.round(gg / n)},${Math.round(b / n)})`;
  return {
    gw,
    gh,
    depth,
    depthRaw,
    sky,
    horizon,
    bg,
    fg: has ? applyMask(src, cut.mask, W, H) : null,
    fgBox: has ? cut.box : null,
    ground,
    skyImg,
    sun: findSun(src, sky, gw, gh, horizon),
  };
}

/** Солнце в кадре: маленькое ярчайшее пятно у неба. По нему восстанавливаем направление камеры и время */
export function findSun(src: Src, sky: Uint8Array, gw: number, gh: number, horizon: number): { u: number; v: number } | null {
  const w = 96,
    h = Math.max(32, Math.round((96 * src.height) / src.width));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h);
  let mx = 0;
  for (let i = 0; i < w * h; i++) {
    lum[i] = (0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2]) / 255;
    if (lum[i] > mx) mx = lum[i];
  }
  if (mx < 0.88) return null;
  const t = Math.max(0.86, mx - 0.04);
  let n = 0,
    sx = 0,
    sy = 0,
    x0 = w,
    x1 = 0,
    y0 = h,
    y1 = 0;
  for (let i = 0; i < w * h; i++) {
    if (lum[i] < t) continue;
    const x = i % w,
      y = (i / w) | 0;
    n++;
    sx += x;
    sy += y;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  // засвеченное небо или белая стена — это не солнце (дорожка бликов на воде под солнцем — можно)
  if (n / (w * h) > 0.025 || (x1 - x0) / w > 0.22) return null;
  // само солнце — верх пятна (ниже может тянуться отражение)
  let tx = 0,
    ty = 0,
    tn = 0;
  for (let i = 0; i < w * h; i++) {
    if (lum[i] < t) continue;
    const y = (i / w) | 0;
    if (y > y0 + h * 0.04) continue;
    tx += i % w;
    ty += y;
    tn++;
  }
  const u = (tx / tn + 0.5) / w,
    v = (ty / tn + 0.5) / h;
  void sx;
  void sy;
  if (v > horizon + 0.04) return null;
  // рядом должно быть небо — или солнце прямо у линии горизонта
  const gx = Math.min(gw - 1, Math.floor(u * gw));
  let near = Math.abs(v - horizon) < 0.06;
  for (let y = Math.max(0, Math.floor(v * gh) - 4); y <= Math.min(gh - 1, Math.floor(v * gh)); y++) if (sky[y * gw + gx]) near = true;
  return near ? { u, v } : null;
}
