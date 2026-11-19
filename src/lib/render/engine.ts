import type { AudioFeatures, DesignSpec, MusicMeta } from '../types';
import { drawRansom } from './ransom';
import { drawSticker, drawWashi, type StickerKind } from './stickers';
import { clamp, mixHex, mulberry32, withAlpha } from '../color';
import { keyName } from '../analysis/audio';
import { MODES } from '../design/system';
import { Particles } from './particles';
import { canvas, coverCrop, ctx2d, fogTexture, grainTiles, paperTexture, type Cnv } from './textures';
import {
  canvasWeave,
  cutoutPath,
  drawStrokes,
  filmGrade,
  maGrade,
  makeEnso,
  moodGrade,
  applyGrade,
  nocturneGrade,
  paintStrokes,
  posterize,
  tornPiece,
  underpainting,
  type Enso,
  type Stroke,
} from './treatments';

export const PAGE_W = 1080;
export const PAGE_H = 1350;
export const FIELD = { x: 72, y: 128, w: 936, h: 872 };

export const FONTS = {
  serif: '"Cormorant Garamond", Georgia, serif',
  sans: 'Manrope, "Helvetica Neue", Arial, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
  hand: 'Caveat, cursive',
};

export interface RenderInput {
  spec: DesignSpec;
  photos: ImageBitmap[];
  title: string;
  caption: string;
  date: string;
  pageNo: number;
  music: MusicMeta;
  audio: AudioFeatures | null;
  label?: string; // «осень · вечер · дождь»
  place?: string; // «Астана −8°»
  stickers?: StickerKind[]; // наклейки по предметам дня (коллаж, плёнка)
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function humanDate(iso: string) {
  const d = new Date(iso + 'T12:00:00');
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()} · ${WEEKDAYS[d.getDay()]}`;
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

interface Timing {
  t: number;
  slot: number;
  local: number;
  cur: number;
  next: number;
  tr: number; // 0..1 прогресс перехода, -1 если нет
  beatIdx: number;
  beatPhase: number;
  pulse: number;
  level: number;
  intro: number; // 0..1
}

export class MemoryRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly input: RenderInput;
  readonly spec: DesignSpec;
  duration = 24;
  bpm = 100;
  beat = 0.6;
  beatOffset = 0;
  photoDur = 6;
  trDur = 1;
  introDur = 2.5;
  private paper!: Cnv;
  private grains!: Cnv[];
  private imgs: Cnv[] = [];
  // импрессия
  private strokes: Stroke[][] = [];
  private painted: Cnv[] = [];
  private under: Cnv | null = null;
  private work: Cnv | null = null;
  private workKey = '';
  private workCount = 0;
  private weave: Cnv | null = null;
  // плёнка / ноктюрн
  private halation: Cnv[] = [];
  private bloom: Cnv[] = [];
  private fog: Cnv[] = [];
  // коллаж
  private pieces: Cnv[] = [];
  // ма
  private enso: Enso | null = null;
  private maRect = { x: 0, y: 0, w: 0, h: 0 };
  private particles: Particles;
  private lastT = 0;
  private rnd: () => number;
  ready = false;

  constructor(target: HTMLCanvasElement, input: RenderInput) {
    this.canvas = target;
    target.width = PAGE_W;
    target.height = PAGE_H;
    this.g = target.getContext('2d')!;
    this.input = input;
    this.spec = input.spec;
    this.rnd = mulberry32(this.spec.seed);
    const a = input.audio;
    this.bpm = a?.bpm ?? 100;
    this.beat = 60 / this.bpm;
    this.beatOffset = a?.beatOffset ?? 0;
    this.duration = a ? Math.min(30, a.duration) : 24;
    this.photoDur = this.spec.cutBeats * this.beat;
    const n = input.photos.length;
    const trBy: Record<string, number> = { paint: 0.45, cut: 0, fade: 0.35, dissolve: 0.5, slide: 0.12, pop: 0.08 };
    this.trDur = n > 1 ? Math.min(3, this.photoDur * trBy[this.spec.transition]) : 0;
    this.introDur = clamp(this.photoDur * 0.7, 1.6, 3.6);
    const fieldRect = this.spec.mode === 'ma' ? FIELD : FIELD;
    this.particles = new Particles(this.spec.particles.kind, this.spec.particles.density, fieldRect, this.spec.palette.colors, this.spec.palette.accent, this.spec.seed, this.spec.mode === 'ma' ? this.spec.palette.ink : null);
  }

  async prepare(onStep?: (s: string) => void) {
    const { spec, photos } = this.input;
    const yieldUI = () => new Promise((r) => setTimeout(r, 0));
    this.paper = paperTexture(PAGE_W, PAGE_H, spec.palette.paper, spec.seed % 1000);
    this.grains = grainTiles(4);
    const W = FIELD.w,
      H = FIELD.h;
    const mode = spec.mode;
    for (let i = 0; i < photos.length; i++) {
      onStep?.(`Обрабатываю фото ${i + 1} из ${photos.length}`);
      await yieldUI();
      const ph = photos[i];
      if (mode === 'impression') {
        const base = coverCrop(ph, W, H);
        applyGrade(base, moodGrade(spec, { contrast: 0.95, light: 0.03 }));
        const strokes = paintStrokes(base, spec, spec.seed + i * 17);
        this.strokes.push(strokes);
        const p = canvas(W, H);
        const pg = ctx2d(p);
        pg.drawImage(underpainting(base), 0, 0);
        drawStrokes(pg, strokes, 0, strokes.length);
        this.painted.push(p);
        if (i === 0) this.under = underpainting(base);
      } else if (mode === 'construct') {
        const base = coverCrop(ph, W, H);
        applyGrade(base, moodGrade(spec, { contrast: 1.15 }));
        this.imgs.push(posterize(base, spec));
      } else if (mode === 'film') {
        const fw = 760,
          fh = H - 2 * 58 - 2 * 14;
        const base = coverCrop(ph, fw, fh);
        const { img, halation } = filmGrade(base, spec);
        this.imgs.push(img);
        this.halation.push(halation);
      } else if (mode === 'ma') {
        const aspect = clamp(ph.height / ph.width, 0.75, 1.3);
        const pw = W * (0.6 - 0.2 * spec.air);
        const phh = Math.min(H * 0.7, pw * aspect);
        if (i === 0) {
          const left = this.rnd() < 0.5;
          this.maRect = { x: FIELD.x + (left ? W * 0.08 : W * 0.92 - pw), y: FIELD.y + H * 0.12, w: pw, h: phh };
          const ex = left ? FIELD.x + W * 0.72 : FIELD.x + W * 0.28;
          this.enso = makeEnso(ex, FIELD.y + H * 0.66, W * 0.19, spec.seed);
        }
        const base = coverCrop(ph, this.maRect.w, this.maRect.h);
        this.imgs.push(maGrade(base, spec));
      } else if (mode === 'collage') {
        const aspect = clamp(ph.height / ph.width, 0.7, 1.35);
        const pw = 560;
        this.pieces.push(tornPiece(ph, pw, pw * aspect, spec.seed + i * 31, spec));
      } else if (mode === 'nocturne') {
        const base = coverCrop(ph, W, H);
        const { img, bloom } = nocturneGrade(base, spec);
        this.imgs.push(img);
        this.bloom.push(bloom);
      }
    }
    if (mode === 'impression') {
      this.work = canvas(W, H);
      this.weave = canvasWeave(256, 256);
    }
    if (mode === 'nocturne') {
      this.fog = [fogTexture(256, '#b9c6dd', spec.seed), fogTexture(256, '#8fa3c4', spec.seed + 9)];
    }
    onStep?.('Собираю страницу');
    await document.fonts.ready;
    this.ready = true;
  }

  setTitle(t: string) {
    this.input.title = t;
  }

  // ——— Время ———
  timing(t: number, level?: number): Timing {
    const n = this.input.photos.length;
    const slot = Math.max(0, Math.floor(t / this.photoDur));
    const local = t - slot * this.photoDur;
    const cur = slot % n;
    const next = (slot + 1) % n;
    let tr = -1;
    if (n > 1 && this.trDur > 0 && local > this.photoDur - this.trDur) tr = (local - (this.photoDur - this.trDur)) / this.trDur;
    const bt = (t - this.beatOffset) / this.beat;
    const beatIdx = Math.floor(bt);
    const beatPhase = bt - beatIdx;
    const pulse = t < this.beatOffset ? 0 : Math.exp(-beatPhase * 5.5);
    let lv = level;
    if (lv === undefined) {
      const env = this.input.audio?.envelope;
      lv = env && env.length ? env[Math.min(env.length - 1, Math.floor(t * 4))] : 0.5;
    }
    return { t, slot, local, cur, next, tr, beatIdx, beatPhase, pulse, level: lv, intro: clamp(t / this.introDur) };
  }

  /** Отрисовать кадр. still — статичная обложка без анимаций появления */
  draw(t: number, opts: { level?: number; still?: boolean } = {}) {
    if (!this.ready) return;
    const g = this.g;
    const still = !!opts.still;
    const tm = this.timing(still ? this.introDur + 0.2 : t, opts.level);
    if (still) {
      tm.intro = 1;
      tm.tr = -1;
      tm.pulse = 0.3;
    }
    const dt = Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;

    g.save();
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.paper, 0, 0);

    // ——— Поле фото ———
    g.save();
    const pad = this.spec.mode === 'collage' ? 18 : 0;
    g.beginPath();
    g.rect(FIELD.x - pad, FIELD.y - pad, FIELD.w + pad * 2, FIELD.h + pad * 2);
    g.clip();
    switch (this.spec.mode) {
      case 'impression':
        this.drawImpression(tm, still);
        break;
      case 'construct':
        this.drawConstruct(tm, still);
        break;
      case 'film':
        this.drawFilm(tm, still);
        break;
      case 'ma':
        this.drawMa(tm, still);
        break;
      case 'collage':
        this.drawCollage(tm, still);
        break;
      case 'nocturne':
        this.drawNocturne(tm, still);
        break;
    }
    // погода внутри
    if (!still) this.particles.update(dt, tm.t, tm.level * 0.6 + tm.pulse * 0.2);
    this.particles.draw(g, tm.t, tm.level, tm.pulse);
    // зерно
    const gr = this.spec.grain * (this.spec.mode === 'film' ? 0.75 : 0.45);
    if (gr > 0.02) {
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = gr;
      const tile = this.grains[still ? 0 : Math.floor(tm.t * 24) % this.grains.length];
      const ox = still ? 0 : Math.floor(this.rnd() * 256),
        oy = still ? 0 : Math.floor(this.rnd() * 256);
      for (let y = FIELD.y - 256 + (oy % 256); y < FIELD.y + FIELD.h; y += 256)
        for (let x = FIELD.x - 256 + (ox % 256); x < FIELD.x + FIELD.w; x += 256) g.drawImage(tile, x, y);
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
    }
    g.restore();

    this.drawChrome(tm, still);
    g.restore();
    this.drawFx();
  }

  // ——— Живое касание: круги от пальца, запотевшее стекло, проявка ———
  develop: number | null = null; // 0..1 — полароид проявляется
  private ripples: { x: number; y: number; t: number }[] = [];
  private breath: OffscreenCanvas | null = null;
  private breathG: OffscreenCanvasRenderingContext2D | null = null;
  private fogAmt = 0;
  private wipeLast: { x: number; y: number } | null = null;
  private wall = performance.now();

  touch(x: number, y: number) {
    this.particles.poke(x, y, 0.6);
  }
  tap(x: number, y: number) {
    this.ripples.push({ x, y, t: performance.now() });
    this.particles.poke(x, y, 2.2);
  }
  blow(level: number) {
    this.particles.gust(level);
    this.breathe(level);
  }
  /** дыхание оседает на «стекле» над страницей */
  private lastBreath = 0;
  breathe(a: number) {
    const now = performance.now();
    if (now - this.lastBreath < 90 || this.fogAmt > 0.9) return;
    this.lastBreath = now;
    if (!this.breath) {
      this.breath = new OffscreenCanvas(this.canvas.width, this.canvas.height);
      this.breathG = this.breath.getContext('2d')!;
    }
    const f = this.breathG!;
    const W = this.canvas.width,
      H = this.canvas.height;
    for (let i = 0; i < 3; i++) {
      const cx = W * (0.3 + this.rnd() * 0.4),
        cy = H * (0.45 + this.rnd() * 0.4);
      const r = 260 + this.rnd() * 360;
      const grd = f.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, `rgba(236,240,242,${0.07 * a})`);
      grd.addColorStop(0.6, `rgba(236,240,242,${0.04 * a})`);
      grd.addColorStop(1, 'rgba(236,240,242,0)');
      f.fillStyle = grd;
      f.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    this.fogAmt = Math.min(1, this.fogAmt + a * 0.04);
  }
  /** провести пальцем по запотевшему стеклу */
  wipe(x: number, y: number) {
    if (!this.breathG || this.fogAmt < 0.02) return;
    const f = this.breathG;
    f.save();
    f.globalCompositeOperation = 'destination-out';
    f.strokeStyle = 'rgba(0,0,0,0.9)';
    f.lineWidth = 46;
    f.lineCap = 'round';
    f.lineJoin = 'round';
    f.beginPath();
    const a = this.wipeLast ?? { x, y };
    f.moveTo(a.x, a.y);
    f.lineTo(x + 0.01, y);
    f.stroke();
    f.restore();
    this.wipeLast = { x, y };
  }
  wipeEnd() {
    this.wipeLast = null;
  }
  get fxActive() {
    return this.ripples.length > 0 || this.fogAmt > 0.01 || (this.develop != null && this.develop < 1);
  }

  private drawFx() {
    const g = this.g;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.wall) / 1000);
    this.wall = now;
    const W = this.canvas.width,
      H = this.canvas.height;
    // круги на воде
    this.ripples = this.ripples.filter((r) => now - r.t < 1300);
    for (const r of this.ripples) {
      const a = (now - r.t) / 1300;
      for (let k = 0; k < 2; k++) {
        const aa = a - k * 0.18;
        if (aa <= 0) continue;
        g.strokeStyle = withAlpha(this.spec.palette.paper, (1 - aa) * 0.75);
        g.lineWidth = 4 * (1 - aa) + 0.5;
        g.beginPath();
        g.arc(r.x, r.y, 14 + aa * 240, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // запотевшее стекло испаряется за ~20 с
    if (this.breath && this.fogAmt > 0.005) {
      const f = this.breathG!;
      f.save();
      f.globalCompositeOperation = 'destination-out';
      f.fillStyle = `rgba(0,0,0,${dt * 0.05})`;
      f.fillRect(0, 0, W, H);
      f.restore();
      this.fogAmt = Math.max(0, this.fogAmt - dt * 0.05);
      g.globalAlpha = 0.88;
      g.drawImage(this.breath, 0, 0);
      g.globalAlpha = 1;
    }
    // проявка полароида: сначала серо-синяя вуаль, потом свет, потом цвет
    if (this.develop != null && this.develop < 1) {
      const d = this.develop;
      const sm = (a: number, b: number) => {
        const x = clamp((d - a) / (b - a));
        return x * x * (3 - 2 * x);
      };
      const light = sm(0, 0.7),
        color = sm(0.3, 1);
      g.save();
      g.globalCompositeOperation = 'saturation';
      g.globalAlpha = 1 - color;
      g.fillStyle = '#808080';
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = (1 - light) * 0.97;
      g.fillStyle = '#5d6a66';
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'soft-light';
      g.globalAlpha = Math.sin(Math.PI * d) * 0.5;
      g.fillStyle = '#d9b98a';
      g.fillRect(0, 0, W, H);
      g.restore();
    }
  }

  // ——— Импрессия: кадры «перекрашиваются» мазками ———
  private drawImpression(tm: Timing, still: boolean) {
    const g = this.g;
    const { x, y, w, h } = FIELD;
    let src: Cnv;
    if (still) src = this.painted[0];
    else if (tm.slot === 0 && tm.local < this.introDur) {
      const total = this.strokes[0].length;
      const k = Math.floor(easeInOut(clamp(tm.local / this.introDur)) * total);
      this.ensureWork('intro', this.under!, 0, k);
      src = this.work!;
    } else if (tm.tr >= 0) {
      const total = this.strokes[tm.next].length;
      const k = Math.floor(easeInOut(tm.tr) * total);
      this.ensureWork(`s${tm.slot}`, this.painted[tm.cur], tm.next, k);
      src = this.work!;
    } else src = this.painted[tm.cur];
    const s = 1.0 + 0.035 * this.spec.motion * ((tm.t % (this.photoDur * 2)) / (this.photoDur * 2));
    g.drawImage(src, x - (w * (s - 1)) / 2, y - (h * (s - 1)) / 2, w * s, h * s);
    // фактура холста
    if (this.weave) {
      g.globalCompositeOperation = 'overlay';
      g.globalAlpha = 0.22;
      for (let yy = y; yy < y + h; yy += 256) for (let xx = x; xx < x + w; xx += 256) g.drawImage(this.weave, xx, yy);
    }
    // дрожащий свет
    g.globalCompositeOperation = 'soft-light';
    for (let i = 0; i < 2; i++) {
      const cx = x + w * (0.3 + 0.4 * Math.sin(tm.t * 0.13 + i * 2)),
        cy = y + h * (0.35 + 0.3 * Math.cos(tm.t * 0.11 + i));
      const r = w * 0.5;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, withAlpha('#fff3d6', 0.35 + tm.level * 0.25));
      grd.addColorStop(1, 'rgba(255,243,214,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }

  private ensureWork(key: string, base: Cnv, strokeIdx: number, count: number) {
    const wg = ctx2d(this.work!);
    const full = key + ':' + strokeIdx;
    if (this.workKey !== full || count < this.workCount) {
      wg.globalAlpha = 1;
      wg.globalCompositeOperation = 'source-over';
      if (key === 'intro') {
        wg.fillStyle = this.spec.palette.paper;
        wg.fillRect(0, 0, FIELD.w, FIELD.h);
        wg.globalAlpha = 0.35;
      }
      wg.drawImage(base, 0, 0);
      wg.globalAlpha = 1;
      this.workKey = full;
      this.workCount = 0;
    }
    if (count > this.workCount) {
      drawStrokes(wg, this.strokes[strokeIdx], this.workCount, count);
      this.workCount = count;
    }
  }

  // ——— Конструкция: Кандинский ———
  private drawConstruct(tm: Timing, still: boolean) {
    const g = this.g;
    const { x, y, w, h } = FIELD;
    const sp = this.spec;
    const pal = sp.palette;
    const rnd = mulberry32(sp.seed);
    const vertical = rnd() < 0.5;
    const gut = 10;
    const big = 0.62;
    // ячейки сетки
    const A = vertical ? { x, y, w: w * big - gut / 2, h } : { x, y, w, h: h * big - gut / 2 };
    const restX = vertical ? x + w * big + gut / 2 : x;
    const restY = vertical ? y : y + h * big + gut / 2;
    const restW = vertical ? w * (1 - big) - gut / 2 : w;
    const restH = vertical ? h : h * (1 - big) - gut / 2;
    const B = vertical ? { x: restX, y: restY, w: restW, h: restH * 0.42 - gut / 2 } : { x: restX, y: restY, w: restW * 0.42 - gut / 2, h: restH };
    const C = vertical ? { x: restX, y: restY + restH * 0.42 + gut / 2, w: restW, h: restH * 0.58 - gut / 2 } : { x: restX + restW * 0.42 + gut / 2, y: restY, w: restW * 0.58 - gut / 2, h: restH };
    const n = this.imgs.length;
    const slot = tm.slot;
    const img = this.imgs[tm.cur];
    // A: основной кадр, резкий сдвиг кадрирования на каждой склейке
    const jitter = still ? 0 : ((slot * 37) % 7) / 7 - 0.5;
    const z = 1.08 + 0.05 * Math.abs(jitter);
    this.drawCrop(img, A, 0.5 + jitter * 0.15, 0.5, z);
    // B: деталь (следующий кадр или крупно тот же)
    const imgB = this.imgs[n > 1 ? tm.next : tm.cur];
    this.drawCrop(imgB, B, 0.3 + (((slot * 13) % 5) / 5) * 0.4, 0.4, 2.2);
    // C: цветной блок с концентрическими кругами
    g.fillStyle = slot % 2 ? pal.colors[1] : pal.accent;
    g.fillRect(C.x, C.y, C.w, C.h);
    const ccx = C.x + C.w / 2,
      ccy = C.y + C.h / 2;
    const rings = [pal.colors[3], pal.ink, pal.paper, slot % 2 ? pal.accent : pal.colors[2]];
    const R0 = Math.min(C.w, C.h) * 0.42 * (1 + tm.pulse * 0.06);
    rings.forEach((c, i) => {
      g.fillStyle = c;
      g.beginPath();
      g.arc(ccx, ccy, R0 * (1 - i * 0.22), 0, 6.283);
      g.fill();
    });
    // геометрия поверх
    const intro = still ? 1 : easeInOut(tm.intro);
    g.lineCap = 'butt';
    // линии
    g.strokeStyle = pal.ink;
    for (let i = 0; i < 5; i++) {
      const ang = -0.9 + rnd() * 1.8;
      const px = x + rnd() * w,
        py = y + rnd() * h;
      const L = w * (0.6 + rnd() * 0.8) * intro;
      g.lineWidth = i === 0 ? 7 : 1.5 + rnd() * 2.5;
      g.beginPath();
      g.moveTo(px - (Math.cos(ang) * L) / 2, py - (Math.sin(ang) * L) / 2);
      g.lineTo(px + (Math.cos(ang) * L) / 2, py + (Math.sin(ang) * L) / 2);
      g.stroke();
    }
    // большой круг
    const bx = A.x + A.w * (0.25 + rnd() * 0.5),
      by = A.y + A.h * (0.2 + rnd() * 0.3);
    const br = (90 + 40 * tm.level + 18 * tm.pulse) * intro;
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = pal.accent;
    g.beginPath();
    g.arc(bx, by, br, 0, 6.283);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.lineWidth = 5;
    g.strokeStyle = pal.ink;
    g.beginPath();
    g.arc(bx + 14, by - 10, br * 1.08, 0, 6.283);
    g.stroke();
    // маленькие круги загораются по долям
    for (let i = 0; i < 8; i++) {
      const cx = x + rnd() * w,
        cy = y + rnd() * h;
      const r = 8 + rnd() * 26;
      const on = still ? 1 : (tm.beatIdx - i) % 8 === 0 ? 1 + tm.pulse * 0.6 : 1;
      g.fillStyle = [pal.colors[1], pal.colors[2], pal.accent, pal.ink, pal.colors[3]][i % 5];
      g.beginPath();
      g.arc(cx, cy, r * on * intro, 0, 6.283);
      g.fill();
    }
    // клин, медленно вращается
    const wx = x + w * (0.15 + rnd() * 0.7),
      wy = y + h * (0.55 + rnd() * 0.35);
    g.save();
    g.translate(wx, wy);
    g.rotate(rnd() * 6 + tm.t * 0.15 * sp.motion);
    g.fillStyle = pal.ink;
    g.beginPath();
    g.moveTo(0, -60 * intro);
    g.lineTo(26 * intro, 50 * intro);
    g.lineTo(-26 * intro, 50 * intro);
    g.closePath();
    g.fill();
    g.restore();
    // полукруг-дуга
    g.lineWidth = 3;
    g.strokeStyle = pal.ink;
    g.beginPath();
    g.arc(x + w * (0.2 + rnd() * 0.6), y + h * (0.3 + rnd() * 0.5), 70 + rnd() * 60, Math.PI, Math.PI * (1 + intro));
    g.stroke();
    // шахматная полоса
    const sx = B.x,
      sy = B.y + B.h - 22;
    for (let i = 0; i < B.w / 22; i++) {
      g.fillStyle = (i + (still ? 0 : tm.beatIdx)) % 2 ? pal.ink : pal.paper;
      g.fillRect(sx + i * 22, sy, 22, 22);
    }
    // вспышка на склейке
    if (!still && tm.local < 0.08) {
      g.fillStyle = withAlpha(pal.paper, 0.5 * (1 - tm.local / 0.08));
      g.fillRect(x, y, w, h);
    }
  }

  private drawCrop(img: Cnv, r: { x: number; y: number; w: number; h: number }, fx: number, fy: number, zoom: number) {
    const sw = img.width / zoom,
      sh = (sw * r.h) / r.w;
    const sh2 = Math.min(sh, img.height);
    const sw2 = (sh2 * r.w) / r.h;
    const sx = clamp((img.width - sw2) * fx, 0, img.width - sw2);
    const sy = clamp((img.height - sh2) * fy, 0, img.height - sh2);
    this.g.drawImage(img, sx, sy, sw2, sh2, r.x, r.y, r.w, r.h);
  }

  // ——— Плёнка ———
  private drawFilm(tm: Timing, still: boolean) {
    const g = this.g;
    const { x, y, w, h } = FIELD;
    const band = 58;
    g.fillStyle = '#17120e';
    g.fillRect(x, y, w, h);
    const fw = 760,
      fh = h - 2 * band - 2 * 14,
      gap = 34;
    const n = this.imgs.length;
    const slide = tm.tr >= 0 ? easeInOut(tm.tr) : 0;
    const pos = tm.slot + slide;
    const cx = x + w / 2 - fw / 2;
    const weaveX = still ? 0 : Math.sin(tm.t * 9.1) * 1.2,
      weaveY = still ? 0 : Math.cos(tm.t * 7.3) * 1.4;
    const fy = y + band + 14 + weaveY;
    for (let k = Math.floor(pos) - 1; k <= Math.floor(pos) + 2; k++) {
      const fx = cx + (k - pos) * (fw + gap) + weaveX;
      if (fx > x + w || fx + fw < x) continue;
      const i = ((k % n) + n) % n;
      const z = 1 + 0.03 * this.spec.motion * (still ? 0 : (tm.local / this.photoDur));
      g.save();
      g.beginPath();
      g.rect(fx, fy, fw, fh);
      g.clip();
      g.drawImage(this.imgs[i], fx - (fw * (z - 1)) / 2, fy - (fh * (z - 1)) / 2, fw * z, fh * z);
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = 0.55 + tm.level * 0.25;
      g.drawImage(this.halation[i], fx, fy, fw, fh);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      // виньетка кадра
      const vg = g.createRadialGradient(fx + fw / 2, fy + fh / 2, fh * 0.35, fx + fw / 2, fy + fh / 2, fw * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(20,10,0,0.45)');
      g.fillStyle = vg;
      g.fillRect(fx, fy, fw, fh);
      // дата на кадре
      if (k === Math.round(pos)) {
        const d = new Date(this.input.date + 'T12:00:00');
        const stamp = `’${String(d.getFullYear()).slice(2)} ${String(d.getMonth() + 1).padStart(2, ' ')} ${String(d.getDate()).padStart(2, ' ')}`;
        g.font = `500 30px ${FONTS.mono}`;
        g.textAlign = 'right';
        g.shadowColor = 'rgba(255,120,30,0.9)';
        g.shadowBlur = 10;
        g.fillStyle = '#ff9a3c';
        g.fillText(stamp, fx + fw - 30, fy + fh - 28);
        g.shadowBlur = 0;
      }
      g.restore();
      // номер кадра на кромке
      g.font = `500 12px ${FONTS.mono}`;
      g.textAlign = 'left';
      g.fillStyle = '#e8873a';
      g.fillText(`${(k + 14) % 40}  ▸  ${(k + 14) % 40}A`, fx + 10, y + h - 3);
      g.textAlign = 'right';
      g.fillText('ОТТИСК 400', fx + fw - 10, y + h - 3);
    }
    // перфорация
    const step = 46;
    const off = ((pos * (fw + gap)) % step) - weaveX;
    g.fillStyle = mixHex(this.spec.palette.paper, '#ffffff', 0.3);
    for (let px = x - step - off; px < x + w + step; px += step) {
      for (const py of [y + 14, y + h - band + 10]) {
        g.beginPath();
        g.roundRect(px, py, 22, 30, 4);
        g.fill();
      }
    }
    // засветка
    if (!still) {
      const cyc = (tm.t % (this.beat * 16)) / (this.beat * 16);
      const a = Math.max(0, Math.sin(cyc * Math.PI * 2 - 1)) * 0.45 * (0.5 + this.spec.mood.nostalgia);
      if (a > 0.01) {
        const left = Math.floor(tm.t / (this.beat * 16)) % 2 === 0;
        const lx = left ? x : x + w;
        const grd = g.createRadialGradient(lx, y + h * 0.4, 0, lx, y + h * 0.4, w * 0.7);
        grd.addColorStop(0, `rgba(255,110,40,${a})`);
        grd.addColorStop(0.5, `rgba(255,170,60,${a * 0.4})`);
        grd.addColorStop(1, 'rgba(255,170,60,0)');
        g.globalCompositeOperation = 'screen';
        g.fillStyle = grd;
        g.fillRect(x, y, w, h);
        g.globalCompositeOperation = 'source-over';
      }
      // мерцание
      g.fillStyle = `rgba(0,0,0,${0.03 + 0.03 * Math.sin(tm.t * 31)})`;
      g.fillRect(x, y, w, h);
    }
    this.drawStickers(tm, still, [
      [x + w - 64, y + 70, 118, 0.22],
      [x + 62, y + h - 74, 112, -0.18],
    ]);
  }

  // ——— Ма ———
  private drawMa(tm: Timing, still: boolean) {
    const g = this.g;
    const r = this.maRect;
    const sp = this.spec;
    // энсо
    if (this.enso) {
      const dabs = this.enso.dabs;
      const k = still ? dabs.length : Math.floor(dabs.length * clamp((tm.t - 0.3) / (this.introDur * 1.2)));
      g.fillStyle = sp.palette.ink;
      for (let i = 0; i < k; i++) {
        const d = dabs[i];
        g.globalAlpha = d.a * (0.75 + 0.1 * tm.level);
        g.beginPath();
        g.arc(d.x, d.y, d.r, 0, 6.283);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    // фото растворяется в фото
    const appear = still ? 1 : easeInOut(clamp((tm.t - 0.6) / (this.introDur * 0.9)));
    const drift = still ? 0 : (tm.t / this.duration) * 10;
    g.globalAlpha = appear;
    g.drawImage(this.imgs[tm.cur], r.x, r.y - drift, r.w, r.h);
    if (tm.tr >= 0) {
      g.globalAlpha = appear * easeInOut(tm.tr);
      g.drawImage(this.imgs[tm.next], r.x, r.y - drift, r.w, r.h);
    }
    g.globalAlpha = 1;
    // печать ханко
    const sealT = still ? 1 : clamp((tm.t - this.introDur * 0.9) / 0.25);
    if (sealT > 0) {
      const s = 1 + (1 - easeOutBack(sealT)) * 0.4;
      const size = 74;
      const left = r.x + r.w / 2 < FIELD.x + FIELD.w / 2;
      const sx = left ? r.x + r.w + 26 : r.x - 26 - size,
        sy = r.y + r.h - size;
      g.save();
      g.translate(sx + size / 2, sy + size / 2);
      g.scale(s, s);
      g.rotate(-0.04);
      g.globalAlpha = 0.92 * sealT;
      g.fillStyle = sp.palette.accent;
      g.beginPath();
      g.roundRect(-size / 2, -size / 2, size, size, 6);
      g.fill();
      const d = new Date(this.input.date + 'T12:00:00');
      g.fillStyle = sp.palette.paper;
      g.textAlign = 'center';
      g.font = `600 30px ${FONTS.serif}`;
      g.fillText(String(d.getDate()), 0, -4);
      g.font = `600 20px ${FONTS.serif}`;
      g.fillText(ROMAN[d.getMonth()], 0, 24);
      g.restore();
    }
    // вертикальная строка: сезон, время, погода
    if (this.input.label) {
      const label = this.input.label.toUpperCase();
      g.save();
      g.translate(FIELD.x + FIELD.w - 8, FIELD.y + 10);
      g.rotate(Math.PI / 2);
      g.font = `500 16px ${FONTS.mono}`;
      g.fillStyle = withAlpha(sp.palette.ink, 0.55 * (still ? 1 : clamp(tm.t - 1)));
      g.textAlign = 'left';
      g.letterSpacing = '6px';
      g.fillText(label, 0, 0);
      g.restore();
    }
  }

  // ——— Коллаж ———
  private drawCollage(tm: Timing, still: boolean) {
    const g = this.g;
    const { x, y, w, h } = FIELD;
    const sp = this.spec;
    const pal = sp.palette;
    const rnd = mulberry32(sp.seed + 3);
    g.fillStyle = mixHex(pal.paper, pal.colors[3], 0.3);
    g.fillRect(x - 18, y - 18, w + 36, h + 36);
    // полутоновые точки
    g.fillStyle = withAlpha(pal.colors[1], 0.35);
    const hx = x + w * (0.1 + rnd() * 0.5),
      hy = y + h * (0.1 + rnd() * 0.5);
    for (let yy = 0; yy < 260; yy += 14) for (let xx = 0; xx < 360; xx += 14) {
      g.beginPath();
      g.arc(hx + xx, hy + yy, 2.6 + 2 * Math.sin((xx + yy) * 0.02), 0, 6.283);
      g.fill();
    }
    // вырезки Матисса
    const cols = [pal.accent, pal.colors[1], pal.colors[2], pal.ink, mixHex(pal.accent, pal.colors[3], 0.5)];
    for (let i = 0; i < 7; i++) {
      const sx = x + rnd() * w,
        sy = y + rnd() * h;
      const R = 60 + rnd() * 110;
      const kind = Math.floor(rnd() * 4);
      const rot0 = rnd() * 6;
      const hit = still ? 0 : (tm.beatIdx - i) % 4 === 0 ? tm.pulse : 0;
      g.save();
      g.translate(sx, sy);
      g.rotate(rot0 + (still ? 0 : Math.sin(tm.t * 0.4 + i) * 0.08));
      const sc = (still ? 1 : easeOutBack(clamp(tm.t * 1.4 - i * 0.12))) * (1 + hit * 0.08);
      g.scale(sc, sc);
      cutoutPath(g, kind, R, sp.seed + i * 7);
      g.fillStyle = cols[i % cols.length];
      g.fill();
      g.restore();
    }
    // наклеенные фото
    const n = this.pieces.length;
    const anchors = [
      { ax: 0.5, ay: 0.46, s: 1.0 },
      { ax: 0.28, ay: 0.3, s: 0.62 },
      { ax: 0.74, ay: 0.68, s: 0.66 },
      { ax: 0.7, ay: 0.26, s: 0.55 },
    ];
    const visible = Math.min(n, 3);
    for (let j = visible - 1; j >= 0; j--) {
      const s = tm.slot - j;
      if (s < 0) continue;
      const i = ((s % n) + n) % n;
      const pr = mulberry32(sp.seed + s * 101);
      const an = anchors[j === 0 ? 0 : 1 + (s % 3)];
      const piece = this.pieces[i];
      const popT = j === 0 && !still ? clamp(tm.local / 0.45) : 1;
      const scale = an.s * (j === 0 ? 1 : 0.9) * (0.75 + 0.25 * easeOutBack(popT)) * (1 + (still ? 0 : tm.pulse * 0.012));
      const pw = piece.width * scale,
        ph = piece.height * scale;
      const cx = x + w * an.ax + (pr() - 0.5) * 60,
        cy = y + h * an.ay + (pr() - 0.5) * 50;
      g.save();
      g.translate(cx, cy);
      g.rotate((pr() - 0.5) * 0.22);
      g.globalAlpha = popT < 1 ? clamp(popT * 3) : 1;
      g.shadowColor = 'rgba(30,20,10,0.32)';
      g.shadowBlur = 22;
      g.shadowOffsetX = 6;
      g.shadowOffsetY = 9;
      g.drawImage(piece, -pw / 2, -ph / 2, pw, ph);
      g.shadowColor = 'transparent';
      // васи-скотч
      const tc = [pal.accent, pal.colors[3], pal.colors[2], mixHex(pal.accent, '#ffffff', 0.4)];
      drawWashi(g, -pw / 2 + 34, -ph / 2 + 10, 110, 30, -0.62, tc[s % tc.length], sp.seed + s * 13);
      drawWashi(g, pw / 2 - 34, -ph / 2 + 10, 110, 30, 0.58, tc[(s + 1) % tc.length], sp.seed + s * 17);
      g.restore();
    }
    g.globalAlpha = 1;
    this.drawStickers(tm, still, [
      [x + w * 0.13, y + h * 0.86, 150, -0.2],
      [x + w * 0.88, y + h * 0.13, 130, 0.25],
      [x + w * 0.9, y + h * 0.88, 120, 0.1],
    ]);
  }

  /** Наклейки дня приклеиваются одна за другой и чуть покачиваются в долю */
  private drawStickers(tm: Timing, still: boolean, spots: [number, number, number, number][]) {
    const list = this.input.stickers ?? [];
    list.slice(0, spots.length).forEach((k, i) => {
      const [sx, sy, size, rot] = spots[i];
      const a = still ? 1 : Math.max(0, Math.min(1, (tm.t - this.introDur * 0.7 - i * 0.45) / 0.5));
      const wob = still ? 0 : Math.sin(tm.t * 1.3 + i * 2) * 0.03 + ((tm.beatIdx + i) % 2 === 0 ? tm.pulse * 0.04 : 0);
      drawSticker(this.g, k, sx, sy, size, rot + wob, a);
    });
  }

  // ——— Ноктюрн ———
  private drawNocturne(tm: Timing, still: boolean) {
    const g = this.g;
    const { x, y, w, h } = FIELD;
    g.fillStyle = '#0a1226';
    g.fillRect(x, y, w, h);
    const up = still ? 1 : easeInOut(clamp(tm.t / (this.introDur * 1.3)));
    const z = 1.02 + 0.05 * this.spec.motion * (still ? 0.3 : (tm.t % (this.photoDur * 2)) / (this.photoDur * 2));
    const drawImg = (i: number, a: number) => {
      g.globalAlpha = a * up;
      g.drawImage(this.imgs[i], x - (w * (z - 1)) / 2, y - (h * (z - 1)) / 2, w * z, h * z);
      g.globalCompositeOperation = 'screen';
      g.globalAlpha = a * up * (0.45 + tm.level * 0.45 + tm.pulse * 0.15);
      g.drawImage(this.bloom[i], x - (w * (z - 1)) / 2, y - (h * (z - 1)) / 2, w * z, h * z);
      g.globalCompositeOperation = 'source-over';
    };
    drawImg(tm.cur, 1);
    if (tm.tr >= 0) drawImg(tm.next, easeInOut(tm.tr));
    g.globalAlpha = 1;
    // туман: бесшовные тайлы дрейфуют по горизонтали
    g.globalCompositeOperation = 'screen';
    this.fog.forEach((f, i) => {
      g.globalAlpha = 0.14 + 0.06 * i;
      const S = h * (1.1 + i * 0.4);
      const off = -((tm.t * (9 + i * 6)) % S);
      for (let xx = x + off; xx < x + w; xx += S) for (let yy = y - S * 0.3 * i; yy < y + h; yy += S) g.drawImage(f, xx, yy, S, S);
    });
    // боке
    const rnd = mulberry32(this.spec.seed + 11);
    for (let i = 0; i < 7; i++) {
      const bx = x + ((rnd() * w + tm.t * (4 + i)) % w),
        by = y + rnd() * h;
      const br = 18 + rnd() * 36;
      const grd = g.createRadialGradient(bx, by, 0, bx, by, br);
      grd.addColorStop(0, withAlpha(this.spec.palette.accent, 0.22 * up));
      grd.addColorStop(1, withAlpha(this.spec.palette.accent, 0));
      g.globalAlpha = 1;
      g.fillStyle = grd;
      g.beginPath();
      g.arc(bx, by, br, 0, 6.283);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    // виньетка
    const vg = g.createRadialGradient(x + w / 2, y + h / 2, h * 0.3, x + w / 2, y + h / 2, h * 0.8);
    vg.addColorStop(0, 'rgba(5,8,20,0)');
    vg.addColorStop(1, 'rgba(5,8,20,0.6)');
    g.fillStyle = vg;
    g.fillRect(x, y, w, h);
  }

  // ——— Постоянные элементы страницы ———
  private drawChrome(tm: Timing, still: boolean) {
    const g = this.g;
    const sp = this.spec;
    const pal = sp.palette;
    const inp = this.input;
    const L = FIELD.x,
      R = FIELD.x + FIELD.w;
    g.textBaseline = 'alphabetic';
    g.letterSpacing = '0px';
    // шапка
    g.fillStyle = withAlpha(pal.ink, 0.78);
    g.font = `500 19px ${FONTS.mono}`;
    g.letterSpacing = '3px';
    g.textAlign = 'left';
    g.fillText(`№ ${String(inp.pageNo).padStart(3, '0')}${inp.place ? '  ·  ' + inp.place.toUpperCase().slice(0, 22) : ''}`, L, 74);
    g.textAlign = 'right';
    g.fillText(humanDate(inp.date).toUpperCase(), R, 74);
    g.letterSpacing = '0px';
    g.fillStyle = withAlpha(pal.ink, 0.22);
    g.fillRect(L, 96, FIELD.w, 1.2);

    // название
    const tA = still ? 1 : clamp((tm.t - 0.5) / 1.1);
    this.drawTitle(inp.title, tA, tm, still);

    // рукописная подпись
    if (inp.caption) {
      const start = still ? 0 : this.introDur * 0.8;
      const chars = still ? 1e9 : Math.max(0, (tm.t - start) * sp.captionSpeed);
      g.font = `500 40px ${FONTS.hand}`;
      g.fillStyle = mixHex(pal.ink, pal.accent, 0.35);
      g.textAlign = 'left';
      const lines = wrap(g, `«${inp.caption}»`, FIELD.w, 2);
      let shown = chars;
      lines.forEach((ln, i) => {
        if (shown <= 0) return;
        const sub = ln.slice(0, Math.floor(shown));
        shown -= ln.length;
        const yy = 1170 + i * 42;
        if (sub.length >= ln.length) g.fillText(ln, L, yy);
        else {
          const wFull = g.measureText(sub).width;
          const frac = shown + ln.length - Math.floor(shown + ln.length);
          const extra = g.measureText(ln.charAt(sub.length)).width * frac;
          g.save();
          g.beginPath();
          g.rect(L - 4, yy - 44, wFull + extra + 4, 60);
          g.clip();
          g.fillText(ln, L, yy);
          g.restore();
        }
      });
    }

    // дорожка песни
    const peaks = inp.audio?.peaks ?? fakePeaks(sp.seed);
    const bars = 112;
    const bw = 4,
      bg = 2;
    const sy = 1262;
    const prog = still ? 1 : clamp(tm.t / this.duration);
    for (let i = 0; i < bars; i++) {
      const v = peaks[Math.floor((i / bars) * peaks.length)] ?? 0.3;
      const bh = 4 + v * 34 * (still ? 1 : 1 + (i / bars < prog && i / bars > prog - 0.03 ? tm.level * 0.3 : 0));
      const played = i / bars <= prog;
      g.fillStyle = played ? pal.colors[Math.min(4, Math.floor((i / bars) * 4) + (still ? 0 : 0))] : withAlpha(pal.ink, 0.18);
      if (played && still) g.fillStyle = withAlpha(pal.colors[Math.floor((i / bars) * 4)], 0.85);
      g.fillRect(L + i * (bw + bg), sy - bh / 2, bw, bh);
    }
    const stripEnd = L + bars * (bw + bg);
    // палитра дня
    pal.colors.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect(stripEnd + 26 + i * 28, sy - 11, 22, 22);
    });
    g.strokeStyle = withAlpha(pal.ink, 0.25);
    g.lineWidth = 1;
    g.strokeRect(stripEnd + 26 - 0.5, sy - 11.5, 5 * 28 - 6 + 1, 23);
    // печать настроения: x — тепло, y — энергия
    const cx = R - 32,
      cy = sy;
    g.strokeStyle = withAlpha(pal.ink, 0.8);
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(cx, cy, 30, 0, 6.283);
    g.stroke();
    g.strokeStyle = withAlpha(pal.ink, 0.25);
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(cx - 30, cy);
    g.lineTo(cx + 30, cy);
    g.moveTo(cx, cy - 30);
    g.lineTo(cx, cy + 30);
    g.stroke();
    const dx = cx + sp.mood.warmth * 22,
      dy = cy - (sp.mood.energy * 2 - 1) * 22;
    g.fillStyle = pal.accent;
    g.beginPath();
    g.arc(dx, dy, 5.5 + (still ? 0 : tm.pulse * 2), 0, 6.283);
    g.fill();

    // строка о песне
    g.font = `500 16px ${FONTS.mono}`;
    g.letterSpacing = '1.5px';
    const right = [inp.audio ? `${Math.round(inp.audio.bpm)} BPM` : null, inp.audio ? keyName(inp.audio.key, inp.audio.mode) : null, MODES[sp.mode].name]
      .filter(Boolean)
      .join(' · ')
      .toUpperCase();
    g.textAlign = 'right';
    g.fillStyle = withAlpha(pal.ink, 0.6);
    g.fillText(right, R, 1318);
    const rw = g.measureText(right).width;
    g.textAlign = 'left';
    let song = `♪ ${inp.music.artist ? inp.music.artist + ' — ' : ''}${inp.music.title}`.toUpperCase();
    while (g.measureText(song).width > FIELD.w - rw - 40 && song.length > 8) song = song.slice(0, -2);
    if (song !== `♪ ${inp.music.artist ? inp.music.artist + ' — ' : ''}${inp.music.title}`.toUpperCase()) song += '…';
    g.fillStyle = withAlpha(pal.ink, 0.78);
    g.fillText(song, L, 1318);
    g.letterSpacing = '0px';
  }

  private drawTitle(title: string, a: number, tm: Timing, still: boolean) {
    const g = this.g;
    const sp = this.spec;
    const pal = sp.palette;
    const ts = sp.title;
    const L = FIELD.x;
    const text = ts.upper ? title.toUpperCase() : title;
    const fam = ts.family === 'serif' ? FONTS.serif : FONTS.sans;
    let size = ts.family === 'serif' ? (sp.mode === 'ma' ? 58 : 76) : 56;
    const setFont = () => {
      g.font = `${ts.italic ? 'italic ' : ''}${ts.weight} ${size}px ${fam}`;
      g.letterSpacing = `${(ts.tracking * size).toFixed(1)}px`;
    };
    setFont();
    while (g.measureText(text).width > FIELD.w - 40 && size > 40) {
      size -= 2;
      setFont();
    }
    const lines = g.measureText(text).width > FIELD.w - 40 ? wrap(g, text, FIELD.w - 40, 2) : [text];
    if (lines.length > 1) {
      size = Math.max(38, size - 6);
      setFont();
    }
    const baseY = lines.length > 1 ? 1066 : 1094;
    g.textAlign = 'left';
    if (sp.mode === 'collage') {
      // вырезанные буквы: наклеиваются по одной в долю
      g.letterSpacing = '0px';
      const per = Math.max(0.05, Math.min(0.12, this.beat / 3));
      const n = [...text].length;
      const appear = still ? 1 : clamp((tm.t - 0.4) / (n * per));
      const light = [mixHex(pal.paper, '#ffffff', 0.5), mixHex(pal.colors[3], '#ffffff', 0.25), mixHex(pal.colors[4] ?? pal.paper, '#ffffff', 0.2), '#f3e3b5', '#fbf8f1'];
      const rs = Math.min(60, size * 0.9);
      const twoLines = n * rs * 0.92 > FIELD.w - 10;
      drawRansom(g, title, { x: L, y: twoLines ? 1042 : 1086, size: twoLines ? rs * 0.92 : rs, maxWidth: FIELD.w - 10, seed: sp.seed + 77, palette: light, ink: pal.ink, appear });
      g.letterSpacing = '0px';
      return;
    }
    g.globalAlpha = a;
    const dy = (1 - easeInOut(a)) * 14;
    let x0 = L;
    if (sp.mode === 'construct') {
      g.fillStyle = pal.accent;
      g.fillRect(L, baseY - size * 0.78 + dy, 14, size * 0.8 * lines.length + (lines.length - 1) * size * 0.2);
      x0 = L + 32;
      if (!still) x0 -= (1 - easeInOut(a)) * 40;
    }
    g.fillStyle = sp.mode === 'ma' ? withAlpha(pal.ink, 0.85) : pal.ink;
    lines.forEach((ln, i) => g.fillText(ln, x0, baseY + i * size * 1.02 + dy));
    g.globalAlpha = 1;
    g.letterSpacing = '0px';
  }
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (g.measureText(t).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const head = lines.slice(0, maxLines);
    let last = head[maxLines - 1];
    while (g.measureText(last + '…').width > maxW && last.length > 3) last = last.slice(0, -1);
    head[maxLines - 1] = last.replace(/[\s,.;:]+$/, '') + '…»';
    return head;
  }
  return lines;
}

function fakePeaks(seed: number) {
  const r = mulberry32(seed);
  return Array.from({ length: 160 }, (_, i) => 0.25 + 0.5 * Math.abs(Math.sin(i * 0.31)) * r());
}
