import { hereNow, searchPlaces, type PlaceHit } from '../place';
import type { ShotMeta } from '../types';

// Где снят кадр, если в фото нет GPS:
// 1) снимок свежий — человек, скорее всего, ещё там: спрашиваем геолокацию;
// 2) в кадре есть табличка (въезд в село, улица, указатель) — читаем надпись и ищем такое место.

export interface FoundPlace extends PlaceHit {
  via: 'here' | 'sign';
  /** что прочитали на табличке */
  word?: string;
  /** одноимённые места — на выбор */
  others: PlaceHit[];
}

/** Снимок сделан только что (по часам EXIF) — значит, человек ещё рядом */
export function isFresh(meta: ShotMeta | null | undefined, now = new Date()) {
  if (!meta?.local) return false;
  const t = Date.parse(meta.local.slice(0, 16) + ':00Z');
  const n = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes());
  const d = (n - t) / 3600000;
  return d > -0.5 && d < 2.5;
}

export interface Plate {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'white' | 'blue' | 'green';
  /** табличка упирается в край кадра — последняя буква может быть обрезана */
  cut: boolean;
}

/**
 * Таблички в кадре: ровные светлые (или синие, зелёные) прямоугольники с тёмными штрихами букв внутри.
 * Работает на уменьшенной копии — быстро, без нейросетей.
 */
export function plates(img: CanvasImageSource & { width: number; height: number }): Plate[] {
  const W = img.width,
    H = img.height;
  const s = 320 / Math.max(W, H);
  const w = Math.max(8, Math.round(W * s)),
    h = Math.max(8, Math.round(H * s));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const n = w * h;
  const L = new Float32Array(n);
  const masks: Record<Plate['kind'], Uint8Array> = { white: new Uint8Array(n), blue: new Uint8Array(n), green: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    const r = d[i * 4] / 255,
      gg = d[i * 4 + 1] / 255,
      b = d[i * 4 + 2] / 255;
    const mx = Math.max(r, gg, b),
      mn = Math.min(r, gg, b);
    const l = (mx + mn) / 2,
      sat = (mx - mn) / (mx + 1e-5);
    L[i] = l;
    if (l > 0.6 && sat < 0.2) masks.white[i] = 1;
    if (b > r + 0.12 && b > gg + 0.02 && sat > 0.35 && mx > 0.3) masks.blue[i] = 1;
    if (gg > r + 0.1 && gg > b + 0.02 && sat > 0.4 && mx > 0.25 && mx < 0.75) masks.green[i] = 1;
  }
  // морфология прямоугольником: max/min по строкам, потом по столбцам
  const morph = (m: Uint8Array, rx: number, ry: number, dilate: boolean) => {
    const t = new Uint8Array(n),
      o = new Uint8Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = dilate ? 0 : 1;
        for (let k = -rx; k <= rx; k++) {
          const xx = x + k;
          const p = xx < 0 || xx >= w ? 0 : m[y * w + xx];
          if (dilate ? p : !p) {
            v = dilate ? 1 : 0;
            break;
          }
        }
        t[y * w + x] = v;
      }
    for (let x = 0; x < w; x++)
      for (let y = 0; y < h; y++) {
        let v = dilate ? 0 : 1;
        for (let k = -ry; k <= ry; k++) {
          const yy = y + k;
          const p = yy < 0 || yy >= h ? 0 : t[yy * w + x];
          if (dilate ? p : !p) {
            v = dilate ? 1 : 0;
            break;
          }
        }
        o[y * w + x] = v;
      }
    return o;
  };
  const out: Plate[] = [];
  for (const kind of ['white', 'blue', 'green'] as const) {
    const m = masks[kind];
    // закрыть дырки от букв, потом срезать тонкое (столбы, провода)
    let c = morph(morph(m, 2, 2, true), 2, 2, false);
    c = morph(morph(c, 4, 1, false), 4, 1, true);
    const lab = new Int32Array(n).fill(-1);
    const stack: number[] = [];
    let id = 0;
    for (let i0 = 0; i0 < n; i0++) {
      if (!c[i0] || lab[i0] >= 0) continue;
      let x0 = w,
        y0 = h,
        x1 = -1,
        y1 = -1,
        cnt = 0;
      const px: number[] = [];
      lab[i0] = id;
      stack.push(i0);
      while (stack.length) {
        const i = stack.pop()!;
        px.push(i);
        cnt++;
        const x = i % w,
          y = (i / w) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
          if (j >= 0 && c[j] && lab[j] < 0) {
            lab[j] = id;
            stack.push(j);
          }
      }
      id++;
      const bw = x1 - x0 + 1,
        bh = y1 - y0 + 1,
        area = bw * bh;
      if (area < n * 0.002 || area > n * 0.3) continue;
      if (kind === 'white' && y0 <= 1) continue; // светлое небо у верхнего края
      const asp = bw / bh;
      if (asp < 1.2 || asp > 12) continue;
      if (cnt / area < 0.55) continue;
      // яркость самой таблички и доля «букв» на ней
      const own = px.filter((i) => m[i]).map((i) => L[i]).sort((a, b) => a - b);
      const pl = own.length ? own[own.length >> 1] : 0.5;
      let dark = 0;
      for (const i of px) if (kind === 'white' ? L[i] < pl - 0.25 : Math.abs(L[i] - pl) > 0.25) dark++;
      const dr = dark / cnt;
      if (dr < 0.03 || dr > 0.5) continue;
      out.push({ x: x0 / s, y: y0 / s, w: bw / s, h: bh / s, kind, cut: x0 <= 2 || x1 >= w - 3 });
    }
  }
  // крупные — первыми
  return out.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 4);
}

/** Табличка → чёрные буквы на белом, высота 200 px: так Tesseract читает уверенно */
function prep(img: CanvasImageSource & { width: number; height: number }, p: Plate): HTMLCanvasElement {
  const W = img.width,
    H = img.height;
  const mx = p.w * 0.04,
    my = p.h * 0.08;
  const sx = Math.max(0, p.x - mx),
    sy = Math.max(0, p.y - my);
  const sw = Math.min(W, p.x + p.w + mx) - sx,
    sh = Math.min(H, p.y + p.h + my) - sy;
  const th = 200;
  const tw = Math.min(1600, Math.max(20, Math.round((sw / sh) * th)));
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
  const im = g.getImageData(0, 0, tw, th);
  const d = im.data;
  const n = tw * th;
  let gray = new Float32Array(n);
  for (let i = 0; i < n; i++) gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  // лёгкое размытие: сетка экрана и шум не должны рваться на «буквы»
  const r = Math.max(1, Math.round((Math.max(W, H) / 900) * (th / sh)));
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float32Array(n);
    for (let y = 0; y < th; y++)
      for (let x = 0; x < tw; x++) {
        let s = 0,
          k = 0;
        for (let q = -r; q <= r; q++) {
          const xx = x + (pass ? 0 : q),
            yy = y + (pass ? q : 0);
          if (xx < 0 || yy < 0 || xx >= tw || yy >= th) continue;
          s += gray[yy * tw + xx];
          k++;
        }
        t[y * tw + x] = s / k;
      }
    gray = t;
  }
  // только середина таблички — без рамки и фона вокруг
  const ix0 = Math.round(tw * 0.03),
    ix1 = Math.round(tw * 0.97),
    iy0 = Math.round(th * 0.14),
    iy1 = Math.round(th * 0.86);
  // порог Оцу
  const hist = new Float64Array(256);
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) hist[Math.max(0, Math.min(255, gray[y * tw + x] | 0))]++;
  let tot = 0,
    sum = 0;
  for (let k = 0; k < 256; k++) (tot += hist[k]), (sum += k * hist[k]);
  let w0 = 0,
    s0 = 0,
    best = -1,
    thr = 128;
  for (let k = 0; k < 256; k++) {
    w0 += hist[k];
    if (!w0 || w0 === tot) continue;
    s0 += k * hist[k];
    const m0 = s0 / w0,
      m1 = (sum - s0) / (tot - w0);
    const v = w0 * (tot - w0) * (m0 - m1) * (m0 - m1);
    if (v > best) (best = v), (thr = k);
  }
  let darkN = 0;
  for (let y = iy0; y < iy1; y++) for (let x = ix0; x < ix1; x++) if (gray[y * tw + x] <= thr) darkN++;
  // буквы должны быть тёмными: на синих и зелёных табличках они светлые
  const inv = darkN > (ix1 - ix0) * (iy1 - iy0) * 0.5;
  const pad = 20;
  const ow = ix1 - ix0 + pad * 2,
    oh = iy1 - iy0 + pad * 2;
  const o = document.createElement('canvas');
  o.width = ow;
  o.height = oh;
  const go = o.getContext('2d')!;
  const od = go.createImageData(ow, oh);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const sxp = x - pad + ix0,
        syp = y - pad + iy0;
      let v = 255;
      if (sxp >= ix0 && sxp < ix1 && syp >= iy0 && syp < iy1) {
        const dk = gray[syp * tw + sxp] <= thr;
        v = dk !== inv ? 0 : 255;
      }
      const i = (y * ow + x) * 4;
      od.data[i] = od.data[i + 1] = od.data[i + 2] = v;
      od.data[i + 3] = 255;
    }
  go.putImageData(od, 0, 0);
  return o;
}

// слова с табличек, которые не названия мест
const STOP = new Set(
  'стоп выход вход магазин аптека кафе бар такси парковка улица проспект переулок остановка центр банк открыто закрыто продукты ремонт шиномонтаж гостиница отель рынок школа больница музей театр кино почта мойка заправка конец начало осторожно дети тупик объезд stop exit enter open closed sale taxi cafe bar shop market hotel parking street avenue center centre bank pharmacy school museum toilet wc'.split(
    ' ',
  ),
);
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s-]+/g, '');

/** Прочитать таблички. Модель и движок — свои, из /ocr: без внешних CDN */
async function readPlates(img: CanvasImageSource & { width: number; height: number }, ps: Plate[]) {
  const { createWorker } = await import('tesseract.js');
  const abs = (p: string) => new URL(p, location.href).href;
  const crops = ps.map((p) => ({ p, c: prep(img, p) }));
  const lines: { text: string; conf: number; cut: boolean }[] = [];
  const worker = await createWorker('rus', 1, { workerPath: abs('/ocr/worker.min.js'), corePath: abs('/ocr/'), langPath: abs('/ocr'), gzip: true });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: '7' as never });
    for (const { p, c } of crops) {
      const r = await worker.recognize(c);
      lines.push({ text: r.data.text.trim(), conf: r.data.confidence, cut: p.cut });
    }
    // латиница — вторым проходом, только если кириллицы не нашлось
    if (!lines.some((l) => /[а-яё]{4,}/i.test(l.text) && l.conf >= 50)) {
      await worker.reinitialize('eng', 1);
      await worker.setParameters({ tessedit_pageseg_mode: '7' as never });
      for (const { p, c } of crops) {
        const r = await worker.recognize(c);
        lines.push({ text: r.data.text.trim(), conf: r.data.confidence, cut: p.cut });
      }
    }
  } finally {
    await worker.terminate();
  }
  return lines;
}

/** Надпись → населённые пункты с таким названием */
async function lookup(lines: { text: string; conf: number; cut: boolean }[]): Promise<{ hit: PlaceHit; word: string; others: PlaceHit[] } | null> {
  // pr — насколько верим варианту: прочитанное целиком или досказанное за обрезанную букву
  type Q = { q: string; word: string; pr: number };
  const qs: Q[] = [];
  for (const l of lines) {
    if (l.conf < 50) continue;
    const raw = l.text.split(/\s+/).filter(Boolean);
    // хвост вроде «ХРЕНОВО:» — край буквы, обрезанной кадром
    const tailCut = /[a-zа-яё][^a-zа-яё\s]+$/i.test(l.text);
    const words = raw.map((t) => t.replace(/^[^a-zа-яё]+|[^a-zа-яё-]+$/gi, '')).filter((t) => /^[a-zа-яё][a-zа-яё-]*$/i.test(t) && t.length >= 3);
    const keep = words.filter((t) => !STOP.has(t.toLowerCase().replace(/ё/g, 'е')));
    if (!keep.length) continue;
    const cap = (t: string) => t[0].toUpperCase() + t.slice(1).toLowerCase();
    // хвост от буквы виден — слово точно длиннее прочитанного
    const raw0 = tailCut ? 2 : 3;
    if (keep.length > 1) qs.push({ q: keep.map(cap).join(' '), word: keep.join(' '), pr: raw0 });
    for (const t of keep) if (t.length >= 4) qs.push({ q: cap(t), word: t, pr: raw0 });
    const last = keep[keep.length - 1];
    if ((l.cut || tailCut) && last.length >= 4) {
      const cyr = /[а-яё]/i.test(last);
      for (const e of cyr ? ['е', 'о', 'а', 'й', 'и', 'к', 'ь', 'я', 'ы', 'н', 'в', 'ое', 'ий', 'ск'] : ['e', 'a', 'o', 'i', 'k', 'n', 's', 'y'])
        qs.push({ q: cap(last) + e, word: last + e.toUpperCase(), pr: e.length > 1 ? 1 : tailCut ? 3 : 2 });
    }
  }
  if (!qs.length) return null;
  const seen = new Set<string>();
  const uniq = qs.filter((q) => !seen.has(q.q) && seen.add(q.q)).slice(0, 24);
  const res = await Promise.all(uniq.map((q) => searchPlaces(q.q, 10).then((hs) => ({ q, hs: hs.filter((h) => norm(h.name) === norm(q.q) && (h.code ?? 'PPL').startsWith('PPL')) })).catch(() => ({ q, hs: [] as PlaceHit[] }))));
  const ok = res.filter((r) => r.hs.length);
  if (!ok.length) return null;
  // прочитанное целиком — надёжнее досказанного; длиннее — надёжнее короткого
  ok.sort((a, b) => b.q.pr - a.q.pr || b.q.q.length - a.q.q.length || Math.max(...b.hs.map((h) => h.pop ?? 0)) - Math.max(...a.hs.map((h) => h.pop ?? 0)));
  const top = ok[0];
  const hs = [...top.hs].sort((a, b) => (b.pop ?? 0) - (a.pop ?? 0) || +(b.code !== 'PPL') - +(a.code !== 'PPL'));
  return { hit: hs[0], word: top.q.word.toUpperCase(), others: hs };
}

/** Найти место кадра: свежий снимок — геолокация, иначе — надпись на табличке */
export async function findPlace(img: CanvasImageSource & { width: number; height: number }, meta: ShotMeta | null | undefined, onStep?: (s: string) => void): Promise<FoundPlace | null> {
  if (isFresh(meta) && 'geolocation' in navigator) {
    try {
      onStep?.('снимок свежий — спрашиваю, где вы');
      const p = await hereNow();
      return { ...p, via: 'here', others: [] };
    } catch {
      /* не дали геолокацию — ищем по кадру */
    }
  }
  const ps = plates(img);
  if (!ps.length) return null;
  onStep?.('читаю надписи в кадре');
  const lines = await readPlates(img, ps);
  // для проверки: что нашли и прочитали
  (globalThis as { __ottiskWhere?: unknown }).__ottiskWhere = { ps, lines };
  const f = await lookup(lines);
  return f ? { ...f.hit, via: 'sign', word: f.word, others: f.others } : null;
}
