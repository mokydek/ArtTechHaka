// Вырезание главного на фото — как у монтажёров: маска объекта, чистые края, дорисованный фон.
// Нейросеть U²-Netp (Apache-2.0) работает в браузере через onnxruntime-web; модель и рантайм лежат на нашем сайте (/ml/).

type Ort = typeof import('onnxruntime-web/wasm');
type Session = import('onnxruntime-web/wasm').InferenceSession;

const S = 320; // вход U²-Netp
const sessions = new Map<string, Promise<{ ort: Ort; session: Session }>>();

/** Сессия onnxruntime для модели с нашего сайта (кэшируется) */
export function model(url: string) {
  let p = sessions.get(url);
  if (!p) {
    p = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.wasmPaths = '/ml/';
      ort.env.wasm.numThreads = 1; // без изоляции страницы потоки недоступны
      ort.env.logLevel = 'error';
      const session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      return { ort, session };
    })();
    p.catch(() => sessions.delete(url));
    sessions.set(url, p);
  }
  return p;
}

const load = () => model('/ml/u2netp.onnx');

export const warmup = () => load().then(() => true);

/** Заранее подгрузить модель дорисовки (28 МБ), пока человек смотрит на страницу */
export const warmupFill = () => model('/ml/migan.onnx').then(() => true);

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
/**
 * Дорисовка фона нейросетью MI-GAN (Picsart, MIT) — как «заливка с учётом содержимого»:
 * на месте вырезанного продолжается то, что было вокруг (небо, трава, стена, вода).
 * Известная часть кадра остаётся пиксель в пиксель; если модель недоступна — мягкая заливка ниже.
 */
export async function fill(img: Src, mask: Src, w = img.width, h = img.height): Promise<HTMLCanvasElement> {
  try {
    const { ort, session } = await model('/ml/migan.onnx');
    const s = Math.min(1, 1024 / Math.max(w, h));
    const W = Math.max(16, Math.round(w * s)),
      H = Math.max(16, Math.round(h * s));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const hole = holeMask(mask, W, H);
    const hd = hole.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const im = new Uint8Array(3 * W * H);
    const mk = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      im[i] = px[i * 4];
      im[W * H + i] = px[i * 4 + 1];
      im[2 * W * H + i] = px[i * 4 + 2];
      mk[i] = hd[i * 4 + 3] > 24 ? 0 : 255; // 255 — известно, 0 — дорисовать
    }
    const out = await session.run({ image: new ort.Tensor('uint8', im, [1, 3, H, W]), mask: new ort.Tensor('uint8', mk, [1, 1, H, W]) });
    const r = out.result;
    const [, , rh, rw] = r.dims as number[];
    const rd = r.data as Uint8Array;
    const oc = document.createElement('canvas');
    oc.width = rw;
    oc.height = rh;
    const og = oc.getContext('2d')!;
    const od = og.createImageData(rw, rh);
    for (let i = 0; i < rw * rh; i++) {
      od.data[i * 4] = rd[i];
      od.data[i * 4 + 1] = rd[rw * rh + i];
      od.data[i * 4 + 2] = rd[2 * rw * rh + i];
      od.data[i * 4 + 3] = 255;
    }
    og.putImageData(od, 0, 0);
    // звёздное небо и прочая «россыпь»: нейросеть рисует звёзды пятнами не того размера —
    // тогда берём от неё только фон, а сами звёзды переносим из этого же снимка, в родном масштабе
    // тёмный кадр: нейросеть любит «досочинять» там вывески и окна — тогда фон ровный, а звёзды и огни — из снимка
    const kind = rw === W && rh === H ? scene(px, hd, W, H) : 'day';
    if (kind === 'dark') og.drawImage(inpaint(c, hole, W, H), 0, 0);
    else if (kind !== 'day') texture(c, kind === 'darkstars' ? null : oc, hd, W, H, inpaint(c, hole, W, H), oc);
    // склейка в полном размере: исходник везде, дорисовка — только в «дыре» с мягким краем
    const res = document.createElement('canvas');
    res.width = w;
    res.height = h;
    const rg = res.getContext('2d')!;
    rg.drawImage(img, 0, 0, w, h);
    const patch = document.createElement('canvas');
    patch.width = w;
    patch.height = h;
    const pg = patch.getContext('2d')!;
    pg.imageSmoothingQuality = 'high';
    pg.drawImage(oc, 0, 0, w, h);
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(hole, 0, 0, w, h);
    rg.drawImage(patch, 0, 0);
    return res;
  } catch (e) {
    console.warn('[Оттиск] дорисовка нейросетью недоступна, мягкая заливка', e);
    return inpaint(img, mask, w, h);
  }
}

/** «Дыра» под дорисовку: маска объекта с запасом, чтобы не тащить в фон его ореол и контур */
function holeMask(mask: Src, W: number, H: number) {
  const m = document.createElement('canvas');
  m.width = W;
  m.height = H;
  const g = m.getContext('2d', { willReadFrequently: true })!;
  g.filter = `blur(${Math.max(3, Math.round(Math.max(W, H) / 60))}px)`;
  for (let k = 0; k < 6; k++) g.drawImage(mask, 0, 0, W, H);
  g.filter = 'none';
  return m;
}

/** Какой кадр вокруг дыры: обычный, ночной или усыпанный звёздами/огнями */
function scene(px: Uint8ClampedArray, hole: Uint8ClampedArray, W: number, H: number): 'day' | 'stars' | 'darkstars' | 'dark' {
  let n = 0,
    lum = 0,
    sp = 0;
  const L = (i: number) => 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2];
  for (let y = 2; y < H - 2; y += 1)
    for (let x = 2; x < W - 2; x += 1) {
      const i = y * W + x;
      if (hole[i * 4 + 3] > 8) continue;
      const l = L(i);
      n++;
      lum += l;
      // точка ярче всех соседей на расстоянии 2 — «звезда»
      const ring = Math.max(L(i - 2), L(i + 2), L(i - 2 * W), L(i + 2 * W));
      if (l - ring > 35) sp++;
    }
  if (!n) return 'day';
  const m = lum / n;
  if (m < 80 && sp / n > 0.0004) return m < 60 ? 'darkstars' : 'stars';
  return m < 60 ? 'dark' : 'day';
}

/** Крупная форма без мелочи: яркие точки (звёзды, блики) не тянут фон вверх */
function lowpass(cv: HTMLCanvasElement, W: number, H: number) {
  const r = Math.max(3, Math.round(Math.max(W, H) / 110));
  const b1 = document.createElement('canvas');
  b1.width = W;
  b1.height = H;
  const g1 = b1.getContext('2d', { willReadFrequently: true })!;
  g1.filter = `blur(${r}px)`;
  g1.drawImage(cv, 0, 0);
  const bl = g1.getImageData(0, 0, W, H);
  const src = cv.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  // точки ярче окружения заменяем окружением и размываем ещё раз
  const cl = new ImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const l = 0.3 * src[i * 4] + 0.59 * src[i * 4 + 1] + 0.11 * src[i * 4 + 2];
    const lb = 0.3 * bl.data[i * 4] + 0.59 * bl.data[i * 4 + 1] + 0.11 * bl.data[i * 4 + 2];
    const speck = l - lb > 8;
    for (let c = 0; c < 3; c++) cl.data[i * 4 + c] = speck ? bl.data[i * 4 + c] : src[i * 4 + c];
    cl.data[i * 4 + 3] = 255;
  }
  const t = document.createElement('canvas');
  t.width = W;
  t.height = H;
  t.getContext('2d')!.putImageData(cl, 0, 0);
  g1.clearRect(0, 0, W, H);
  g1.drawImage(t, 0, 0);
  return g1.getImageData(0, 0, W, H).data;
}

/**
 * Перенос фактуры: крупную форму берём у нейросети, а мелкие детали — копируем блоками
 * из тех мест снимка, где крупная форма того же цвета (небо → звёзды неба, трава → травинки).
 */
function texture(src: HTMLCanvasElement, gen: HTMLCanvasElement | null, hole: Uint8ClampedArray, W: number, H: number, smooth: HTMLCanvasElement, out: HTMLCanvasElement) {
  const so = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  const lo = lowpass(src, W, H);
  const gg = out.getContext('2d', { willReadFrequently: true })!;
  const gi = gg.getImageData(0, 0, W, H);
  const lm = lowpass(gen ?? smooth, W, H);
  // общий тон дыры — как у окружения (нейросеть «засвечивает» небо своими пятнами), форма — её
  const coarse = (cv: HTMLCanvasElement | Uint8ClampedArray) => {
    const t = document.createElement('canvas');
    t.width = W;
    t.height = H;
    const tg = t.getContext('2d', { willReadFrequently: true })!;
    let srcCv: HTMLCanvasElement;
    if (cv instanceof HTMLCanvasElement) srcCv = cv;
    else {
      srcCv = document.createElement('canvas');
      srcCv.width = W;
      srcCv.height = H;
      srcCv.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(cv), W, H), 0, 0);
    }
    tg.filter = `blur(${Math.max(6, Math.round(Math.max(W, H) / 28))}px)`;
    tg.drawImage(srcCv, 0, 0, W, H);
    return tg.getImageData(0, 0, W, H).data;
  };
  if (gen) {
    const cm = coarse(lm),
      cr = coarse(smooth);
    for (let i = 0; i < W * H; i++)
      if (hole[i * 4 + 3] > 8) for (let k = 0; k < 3; k++) lm[i * 4 + k] = Math.max(0, Math.min(255, lm[i * 4 + k] + cr[i * 4 + k] - cm[i * 4 + k]));
  }
  const P = Math.max(10, Math.min(20, Math.round(Math.max(W, H) / 64)));
  const st = P >> 1;
  const inHole = (i: number) => hole[i * 4 + 3] > 8;
  // кандидаты-доноры: блоки целиком из известной части кадра
  const cand: { x: number; y: number; r: number; g: number; b: number }[] = [];
  for (let y = 0; y + P <= H; y += st)
    for (let x = 0; x + P <= W; x += st) {
      let ok = true,
        r = 0,
        g = 0,
        b = 0;
      for (let yy = y; yy < y + P && ok; yy++)
        for (let xx = x; xx < x + P; xx++) {
          const i = yy * W + xx;
          if (inHole(i)) {
            ok = false;
            break;
          }
          r += lo[i * 4];
          g += lo[i * 4 + 1];
          b += lo[i * 4 + 2];
        }
      if (ok) cand.push({ x, y, r: r / (P * P), g: g / (P * P), b: b / (P * P) });
    }
  if (cand.length < 8) return;
  const acc = new Float32Array(W * H * 3);
  const wsum = new Float32Array(W * H);
  const win = new Float32Array(P * P);
  for (let yy = 0; yy < P; yy++)
    for (let xx = 0; xx < P; xx++) win[yy * P + xx] = Math.sin((Math.PI * (xx + 0.5)) / P) ** 2 * Math.sin((Math.PI * (yy + 0.5)) / P) ** 2 + 1e-3;
  const diag = Math.hypot(W, H);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const top: { d: number; c: number }[] = [];
  const used = new Float32Array(cand.length);
  const K = 32;
  for (let y = -st; y < H; y += st)
    for (let x = -st; x < W; x += st) {
      let any = false,
        r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let yy = Math.max(0, y); yy < Math.min(H, y + P); yy++)
        for (let xx = Math.max(0, x); xx < Math.min(W, x + P); xx++) {
          const i = yy * W + xx;
          if (inHole(i)) any = true;
          r += lm[i * 4];
          g += lm[i * 4 + 1];
          b += lm[i * 4 + 2];
          n++;
        }
      if (!any || !n) continue;
      r /= n;
      g /= n;
      b /= n;
      // доноров берём из многих похожих мест и не повторяемся — иначе узор складывается в решётку
      top.length = 0;
      for (let ci = 0; ci < cand.length; ci++) {
        const c = cand[ci];
        const dc = ((c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2) / 65025;
        const d = dc + (((c.x - x) ** 2 + (c.y - y) ** 2) / (diag * diag)) * 0.01 + used[ci] * 0.0015;
        if (top.length < K || d < top[top.length - 1].d) {
          // вставка на место, без полной сортировки
          let j = top.length < K ? top.length : K - 1;
          if (top.length < K) top.push({ d, c: ci });
          while (j > 0 && top[j - 1].d > d) {
            top[j] = top[j - 1];
            j--;
          }
          top[j] = { d, c: ci };
        }
      }
      const pi = top[Math.floor(rnd() * top.length)].c;
      used[pi]++;
      const pick = cand[pi];
      for (let yy = 0; yy < P; yy++)
        for (let xx = 0; xx < P; xx++) {
          const tx = x + xx,
            ty = y + yy;
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          const t = ty * W + tx,
            s2 = (pick.y + yy) * W + pick.x + xx;
          // без усреднения: каждая точка берёт фактуру у одного донора (иначе звезда двоится в четыре тусклых)
          const w = win[yy * P + xx];
          if (w <= wsum[t]) continue;
          acc[t * 3] = so[s2 * 4] - lo[s2 * 4];
          acc[t * 3 + 1] = so[s2 * 4 + 1] - lo[s2 * 4 + 1];
          acc[t * 3 + 2] = so[s2 * 4 + 2] - lo[s2 * 4 + 2];
          wsum[t] = w;
        }
    }
  const d = gi.data;
  for (let i = 0; i < W * H; i++) {
    if (!inHole(i) || !wsum[i]) continue;
    d[i * 4] = lm[i * 4] + acc[i * 3];
    d[i * 4 + 1] = lm[i * 4 + 1] + acc[i * 3 + 1];
    d[i * 4 + 2] = lm[i * 4 + 2] + acc[i * 3 + 2];
  }
  gg.putImageData(gi, 0, 0);
}

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
  mgc.filter = `blur(${Math.max(2, Math.round(W / 50))}px)`;
  for (let k = 0; k < 4; k++) mgc.drawImage(mask, 0, 0, W, H);
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
  // расширенная маска: размытие + многократное наложение = «дилатация», чтобы от объекта не оставалось контура
  const dil = document.createElement('canvas');
  dil.width = w;
  dil.height = h;
  const dg = dil.getContext('2d')!;
  dg.filter = `blur(${Math.max(3, Math.round(w / 70))}px)`;
  for (let k = 0; k < 5; k++) dg.drawImage(mask, 0, 0, w, h);
  dg.filter = 'none';
  const keep = document.createElement('canvas');
  keep.width = w;
  keep.height = h;
  const kg = keep.getContext('2d')!;
  kg.drawImage(img, 0, 0, w, h);
  kg.globalCompositeOperation = 'destination-out';
  kg.drawImage(dil, 0, 0);
  kg.drawImage(dil, 0, 0);
  fg.drawImage(keep, 0, 0);
  return full;
}
