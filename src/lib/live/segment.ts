// Вырезание главного на фото — как у монтажёров: маска объекта, чистые края, дорисованный фон.
// Нейросеть U²-Netp (Apache-2.0) работает в браузере через onnxruntime-web; модель и рантайм лежат на нашем сайте (/ml/).

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const S = 320; // вход U²-Netp
let loading: Promise<{ ort: Ort; session: Session }> | null = null;

function load() {
  if (!loading)
    loading = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.wasmPaths = '/ml/';
      ort.env.wasm.numThreads = 1; // без изоляции страницы потоки недоступны
      ort.env.logLevel = 'error';
      const session = await ort.InferenceSession.create('/ml/u2netp.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, session };
    })();
  loading.catch(() => (loading = null));
  return loading;
}

export const warmup = () => load().then(() => true);

type Src = CanvasImageSource & { width: number; height: number };

/** Карта «главного» 320×320, 0..1 */
export async function saliency(src: Src): Promise<Float32Array> {
  const { ort, session } = await load();
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, S, S);
  const px = g.getImageData(0, 0, S, S).data;
  let max = 1;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
  const mean = [0.485, 0.456, 0.406],
    std = [0.229, 0.224, 0.225];
  const data = new Float32Array(3 * S * S);
  for (let i = 0, p = 0; i < S * S; i++, p += 4)
    for (let k = 0; k < 3; k++) data[k * S * S + i] = (px[p + k] / max - mean[k]) / std[k];
  const input = new ort.Tensor('float32', data, [1, 3, S, S]);
  const out = await session.run({ [session.inputNames[0]]: input });
  const d = out[session.outputNames[0]].data as Float32Array;
  let mi = Infinity,
    ma = -Infinity;
  for (const v of d) {
    if (v < mi) mi = v;
    if (v > ma) ma = v;
  }
  const res = new Float32Array(S * S);
  const k = ma - mi || 1;
  for (let i = 0; i < res.length; i++) res[i] = (d[i] - mi) / k;
  return res;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export interface Cutout {
  mask: HTMLCanvasElement; // размер исходника, альфа = объект
  area: number; // доля кадра
  box: { x: number; y: number; w: number; h: number }; // в долях
}

/** Маска главного объекта в размере исходника: мягкий порог + перо по краю */
export async function cutout(src: Src): Promise<Cutout> {
  const sal = await saliency(src);
  // 320×320 → картинка с альфой
  const small = document.createElement('canvas');
  small.width = S;
  small.height = S;
  const sg = small.getContext('2d')!;
  const im = sg.createImageData(S, S);
  let area = 0,
    x0 = S,
    y0 = S,
    x1 = 0,
    y1 = 0;
  for (let i = 0; i < S * S; i++) {
    const a = smooth(0.32, 0.62, sal[i]);
    im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = 255;
    im.data[i * 4 + 3] = Math.round(a * 255);
    if (a > 0.5) {
      area++;
      const x = i % S,
        y = (i / S) | 0;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  sg.putImageData(im, 0, 0);
  const mask = document.createElement('canvas');
  mask.width = src.width;
  mask.height = src.height;
  const mg = mask.getContext('2d')!;
  mg.imageSmoothingQuality = 'high';
  mg.filter = `blur(${Math.max(1, Math.round(Math.max(src.width, src.height) / 600))}px)`;
  mg.drawImage(small, 0, 0, src.width, src.height);
  mg.filter = 'none';
  return { mask, area: area / (S * S), box: area ? { x: x0 / S, y: y0 / S, w: (x1 - x0 + 1) / S, h: (y1 - y0 + 1) / S } : { x: 0, y: 0, w: 1, h: 1 } };
}

/** Объект без фона (альфа из маски) */
export function applyMask(img: Src, mask: Src, w = img.width, h = img.height): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, 0, 0, w, h);
  return c;
}

/**
 * Дорисовать фон под объектом: «push-pull» по пирамиде — дыру заполняют
 * усреднённые цвета соседей с каждого уровня. Для параллакса этого достаточно:
 * открывается лишь узкая полоска вокруг объекта.
 */
export function inpaint(img: Src, mask: Src, w = img.width, h = img.height): HTMLCanvasElement {
  const W = Math.max(8, Math.round(w / 2)),
    H = Math.max(8, Math.round(h / 2));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, W, H);
  const col = g.getImageData(0, 0, W, H).data;
  // маска с запасом: расширяем объект, чтобы не тащить в фон его ореол
  const m = document.createElement('canvas');
  m.width = W;
  m.height = H;
  const mgc = m.getContext('2d', { willReadFrequently: true })!;
  mgc.filter = `blur(${Math.max(2, Math.round(W / 90))}px)`;
  mgc.drawImage(mask, 0, 0, W, H);
  const ma = mgc.getImageData(0, 0, W, H).data;
  // уровень 0: известные пиксели (вес = 1 - маска)
  type L = { w: number; h: number; r: Float32Array; g: Float32Array; b: Float32Array; a: Float32Array };
  const lv: L[] = [];
  const base: L = { w: W, h: H, r: new Float32Array(W * H), g: new Float32Array(W * H), b: new Float32Array(W * H), a: new Float32Array(W * H) };
  for (let i = 0; i < W * H; i++) {
    const known = ma[i * 4 + 3] > 8 ? 0 : 1;
    base.a[i] = known;
    base.r[i] = col[i * 4] * known;
    base.g[i] = col[i * 4 + 1] * known;
    base.b[i] = col[i * 4 + 2] * known;
  }
  lv.push(base);
  // push: вниз по пирамиде
  while (lv[lv.length - 1].w > 2 && lv[lv.length - 1].h > 2) {
    const p = lv[lv.length - 1];
    const w2 = Math.ceil(p.w / 2),
      h2 = Math.ceil(p.h / 2);
    const q: L = { w: w2, h: h2, r: new Float32Array(w2 * h2), g: new Float32Array(w2 * h2), b: new Float32Array(w2 * h2), a: new Float32Array(w2 * h2) };
    for (let y = 0; y < h2; y++)
      for (let x = 0; x < w2; x++) {
        let r = 0,
          gg = 0,
          b = 0,
          a = 0;
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const sx = Math.min(p.w - 1, x * 2 + dx),
              sy = Math.min(p.h - 1, y * 2 + dy);
            const j = sy * p.w + sx;
            r += p.r[j];
            gg += p.g[j];
            b += p.b[j];
            a += p.a[j];
          }
        const j = y * w2 + x;
        // премультиплицированные цвета, вес насыщаем до 1
        const k = a > 1 ? 1 / a : 1;
        q.r[j] = r * k;
        q.g[j] = gg * k;
        q.b[j] = b * k;
        q.a[j] = Math.min(1, a);
      }
    lv.push(q);
  }
  // pull: вверх, заполняя недостающее
  for (let l = lv.length - 2; l >= 0; l--) {
    const p = lv[l],
      q = lv[l + 1];
    for (let y = 0; y < p.h; y++)
      for (let x = 0; x < p.w; x++) {
        const j = y * p.w + x;
        const a = p.a[j];
        if (a >= 0.999) continue;
        // билинейно из грубого уровня
        const fx = Math.min(q.w - 1, Math.max(0, x / 2 - 0.25)),
          fy = Math.min(q.h - 1, Math.max(0, y / 2 - 0.25));
        const xa = Math.floor(fx),
          ya = Math.floor(fy),
          xb = Math.min(q.w - 1, xa + 1),
          yb = Math.min(q.h - 1, ya + 1);
        const tx = fx - xa,
          ty = fy - ya;
        const bi = (arr: Float32Array) => (arr[ya * q.w + xa] * (1 - tx) + arr[ya * q.w + xb] * tx) * (1 - ty) + (arr[yb * q.w + xa] * (1 - tx) + arr[yb * q.w + xb] * tx) * ty;
        const qa = Math.max(1e-6, bi(q.a));
        const fill = 1 - a;
        p.r[j] += (bi(q.r) / qa) * fill;
        p.g[j] += (bi(q.g) / qa) * fill;
        p.b[j] += (bi(q.b) / qa) * fill;
        p.a[j] = 1;
      }
  }
  const out = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    out.data[i * 4] = base.r[i];
    out.data[i * 4 + 1] = base.g[i];
    out.data[i * 4 + 2] = base.b[i];
    out.data[i * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  // фон в полном размере: дорисовка под маской, оригинал вокруг
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const fg = full.getContext('2d')!;
  fg.imageSmoothingQuality = 'high';
  fg.filter = 'blur(1.5px)';
  fg.drawImage(c, 0, 0, w, h);
  fg.filter = 'none';
  const keep = document.createElement('canvas');
  keep.width = w;
  keep.height = h;
  const kg = keep.getContext('2d')!;
  kg.drawImage(img, 0, 0, w, h);
  kg.globalCompositeOperation = 'destination-out';
  kg.filter = `blur(${Math.max(2, Math.round(w / 120))}px)`;
  kg.drawImage(mask, 0, 0, w, h);
  kg.drawImage(mask, 0, 0, w, h);
  fg.drawImage(keep, 0, 0);
  return full;
}
