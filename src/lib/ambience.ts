import type { AmbKind, AmbLayer, DayAnalysis, DesignSpec, PlaceInfo } from './types';
import { mulberry32 } from './color';
import { weatherTags } from './place';

// «Звуки дня»: процедурный эмбиент под песней — дождь, ветер, костёр, море, птицы, сверчки, город, винил.
// Всё синтезируется на устройстве (без файлов), бесшовными петлями.

export type { AmbKind, AmbLayer };

export const AMB_NAMES: Record<AmbKind, string> = {
  rain: 'дождь по стеклу',
  wind: 'ветер',
  fire: 'треск огня',
  sea: 'прибой',
  birds: 'птицы',
  crickets: 'сверчки',
  city: 'гул города',
  vinyl: 'шорох винила',
};

/** Какие звуки были в дне — по словам, месту, погоде и форме */
export function pickAmbience(a: DayAnalysis, d: DesignSpec, place?: PlaceInfo): AmbLayer[] {
  const t = a.text;
  // погода уже сведена в t.weather (данные о месте добавляются, только если в записи погоды нет)
  const w = new Set(t.weather);
  const fromData = (k: string) => !!place && weatherTags(place).includes(k as never) && !t.weatherWords?.[k as keyof typeof t.weatherWords];
  const has = (list: { key: string }[], ...keys: string[]) => list.some((p) => keys.includes(p.key));
  const out: AmbLayer[] = [];
  const add = (kind: AmbKind, gain: number, why: string) => !out.some((o) => o.kind === kind) && out.push({ kind, gain, why });
  if (w.has('rain') || w.has('storm')) add('rain', 0.5, fromData('rain') ? `в этот день в ${place!.name} шёл дождь (данные погоды)` : 'в записи шёл дождь');
  if (has(t.places, 'sea', 'beach', 'shore', 'embankment', 'lake')) add('sea', 0.45, 'вода рядом — море, берег, озеро');
  if (has(t.objects, 'bonfire', 'fireplace', 'shashlik', 'candles')) add('fire', 0.42, 'огонь в записи — костёр, камин, шашлыки или свечи');
  if (w.has('wind') || w.has('snow') || has(t.places, 'steppe', 'mountains', 'roof')) add('wind', 0.35, w.has('snow') ? 'снег — глухой зимний ветер' : 'открытое место, ветер');
  const evening = t.timeOfDay === 'evening' || t.timeOfDay === 'night' || t.night;
  if (t.season === 'summer' && evening && (t.nature || has(t.places, 'dacha', 'village', 'garden', 'field'))) add('crickets', 0.35, 'летний вечер за городом — сверчки');
  if ((t.nature || has(t.places, 'park', 'forest', 'garden', 'dacha', 'village')) && !evening && !w.has('rain') && t.season !== 'winter') add('birds', 0.32, 'природа днём — птицы');
  if (has(t.places, 'city', 'street', 'square', 'bridge', 'station', 'roof', 'balcony') || (d.mode === 'nocturne' && !t.nature)) add('city', 0.3, 'город вокруг — далёкий гул');
  if (d.mode === 'film' || d.mood.nostalgia > 0.5) add('vinyl', 0.22, 'ностальгия — шорох старой пластинки');
  return out.slice(0, 3);
}

const SR = 44100;
const LEN = 12; // секунд в петле
const cache = new Map<AmbKind, Promise<AudioBuffer>>();

// простые фильтры
class OnePole {
  y = 0;
  a: number;
  constructor(a: number) {
    this.a = a;
  }
  lp(x: number) {
    this.y += this.a * (x - this.y);
    return this.y;
  }
}
const coef = (fc: number) => 1 - Math.exp((-2 * Math.PI * fc) / SR);

export function synth(kind: AmbKind): Float32Array[] {
  const n = SR * LEN;
  const L = new Float32Array(n),
    R = new Float32Array(n);
  const rnd = mulberry32(kind.length * 977 + kind.charCodeAt(0));
  const white = () => rnd() * 2 - 1;
  let brown = 0;
  const brownN = () => {
    brown = (brown + white() * 0.02) * 0.998;
    return brown * 3.5;
  };
  const lp1 = new OnePole(coef(800)),
    lp2 = new OnePole(coef(6000)),
    hp = new OnePole(coef(400));

  // события: [начало (сэмпл), функция]
  const events: { at: number; len: number; f: (i: number) => [number, number] }[] = [];

  switch (kind) {
    case 'rain': {
      for (let i = 0; i < n; i++) {
        const x = white();
        const hi = x - hp.lp(x);
        const s = lp2.lp(hi) * 0.3 + lp1.lp(brownN()) * 0.08;
        L[i] = s;
        R[i] = s * 0.9 + white() * 0.02;
      }
      const drops = LEN * 260;
      for (let k = 0; k < drops; k++) {
        const at = Math.floor(rnd() * n);
        const amp = Math.pow(rnd(), 3) * 0.5;
        const pan = rnd();
        const dec = 0.0015 + rnd() * 0.004;
        const f = 2500 + rnd() * 4500;
        events.push({ at, len: Math.floor(dec * SR * 6), f: (i) => {
          const tt = i / SR;
          const v = amp * Math.exp(-tt / dec) * Math.sin(2 * Math.PI * f * tt);
          return [v * (1 - pan), v * pan];
        } });
      }
      break;
    }
    case 'wind': {
      const bp = new OnePole(coef(300));
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const gust = 0.55 + 0.3 * Math.sin((2 * Math.PI * t) / LEN) + 0.15 * Math.sin((2 * Math.PI * 3 * t) / LEN + 1);
        bp.a = coef(180 + 500 * gust);
        const s = bp.lp(brownN() + white() * 0.15) * gust * 1.6;
        L[i] = s;
        R[i] = s * (0.8 + 0.2 * Math.sin((2 * Math.PI * 2 * t) / LEN));
      }
      break;
    }
    case 'fire': {
      const lo = new OnePole(coef(250));
      for (let i = 0; i < n; i++) {
        const s = lo.lp(brownN()) * 0.12;
        L[i] = s;
        R[i] = s;
      }
      let at = 0;
      while (at < n) {
        at += Math.floor(SR * (0.01 + Math.pow(rnd(), 2) * 0.25));
        const big = rnd() < 0.08;
        const amp = (big ? 0.6 : 0.12 + rnd() * 0.25) * (rnd() < 0.5 ? 1 : -1);
        const dec = big ? 0.006 : 0.0012 + rnd() * 0.002;
        const pan = 0.3 + rnd() * 0.4;
        events.push({ at, len: Math.floor(dec * SR * 6), f: (i) => {
          const v = amp * Math.exp(-i / (dec * SR)) * (rnd() * 2 - 1);
          return [v * (1 - pan) * 1.4, v * pan * 1.4];
        } });
      }
      break;
    }
    case 'sea': {
      const lo = new OnePole(coef(400)),
        hi = new OnePole(coef(2500));
      const period = LEN / 2; // две волны на петлю
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const ph = (t % period) / period;
        const swell = Math.pow(Math.sin(Math.PI * ph), 2);
        const crash = ph > 0.45 ? Math.exp(-(ph - 0.45) * 7) : Math.pow(ph / 0.45, 3);
        hi.a = coef(600 + 3000 * crash);
        const s = lo.lp(brownN()) * (0.2 + 0.45 * swell) + hi.lp(white()) * 0.4 * (0.25 + crash);
        L[i] = s;
        R[i] = s * 0.85 + lo.y * 0.1;
      }
      break;
    }
    case 'birds': {
      const lo = new OnePole(coef(500));
      for (let i = 0; i < n; i++) {
        const s = lo.lp(brownN()) * 0.012;
        L[i] = s;
        R[i] = s;
      }
      let at = Math.floor(SR * 0.3);
      while (at < n - SR) {
        const phrase = 2 + Math.floor(rnd() * 5);
        const base = 2600 + rnd() * 2200;
        const pan = rnd();
        const amp = 0.06 + rnd() * 0.12;
        for (let p = 0; p < phrase; p++) {
          const dur = 0.05 + rnd() * 0.09;
          const up = rnd() < 0.5;
          const f0 = base * (0.9 + rnd() * 0.25);
          const sweep = (up ? 1 : -1) * (400 + rnd() * 1400);
          let phase = 0;
          events.push({ at, len: Math.floor(dur * SR), f: (i) => {
            const tt = i / SR,
              x = tt / dur;
            const fr = f0 + sweep * x + 180 * Math.sin(2 * Math.PI * 38 * tt);
            phase += (2 * Math.PI * fr) / SR;
            const v = amp * Math.sin(Math.PI * x) * Math.sin(phase);
            return [v * (1 - pan), v * pan];
          } });
          at += Math.floor((dur + 0.03 + rnd() * 0.06) * SR);
        }
        at += Math.floor(SR * (0.4 + rnd() * 1.6));
      }
      break;
    }
    case 'crickets': {
      const lo = new OnePole(coef(300));
      for (let i = 0; i < n; i++) {
        const s = lo.lp(brownN()) * 0.01;
        L[i] = s;
        R[i] = s;
      }
      for (let c = 0; c < 3; c++) {
        const f = 4200 + c * 370 + rnd() * 200;
        const pan = 0.2 + c * 0.3;
        const amp = 0.05 + rnd() * 0.03;
        const per = 0.42 + rnd() * 0.25;
        for (let at = Math.floor(rnd() * per * SR); at < n - SR; at += Math.floor(per * SR * (0.92 + rnd() * 0.16))) {
          for (let p = 0; p < 3; p++) {
            const st = at + Math.floor(p * 0.034 * SR);
            events.push({ at: st, len: Math.floor(0.022 * SR), f: (i) => {
              const tt = i / SR;
              const v = amp * Math.sin((Math.PI * tt) / 0.022) * Math.sin(2 * Math.PI * f * tt);
              return [v * (1 - pan), v * pan];
            } });
          }
        }
      }
      break;
    }
    case 'city': {
      const lo = new OnePole(coef(180)),
        mid = new OnePole(coef(900));
      for (let i = 0; i < n; i++) {
        const t = i / SR;
        const s = lo.lp(brownN()) * 0.6 + mid.lp(white()) * 0.1 * (1 + 0.3 * Math.sin((2 * Math.PI * t) / 4));
        L[i] = s;
        R[i] = s * 0.95;
      }
      // проезжающие машины
      for (let k = 0; k < 4; k++) {
        const at = Math.floor(rnd() * (n - 4 * SR));
        const len = Math.floor((2.5 + rnd() * 2) * SR);
        const dir = rnd() < 0.5;
        const car = new OnePole(coef(700));
        events.push({ at, len, f: (i) => {
          const x = i / len;
          const v = car.lp(white()) * 0.5 * Math.pow(Math.sin(Math.PI * x), 2);
          const pan = dir ? x : 1 - x;
          return [v * (1 - pan), v * pan];
        } });
      }
      break;
    }
    case 'vinyl': {
      const hiss = new OnePole(coef(5000));
      for (let i = 0; i < n; i++) {
        const x = white();
        const s = (x - hiss.lp(x)) * 0.025;
        L[i] = s;
        R[i] = s;
      }
      const clicks = LEN * 22;
      for (let k = 0; k < clicks; k++) {
        const at = Math.floor(rnd() * n);
        const amp = Math.pow(rnd(), 4) * 0.2 + 0.01;
        const sg = rnd() < 0.5 ? 1 : -1;
        events.push({ at, len: 40, f: (i) => {
          const v = sg * amp * Math.exp(-i / 6);
          return [v, v];
        } });
      }
      // «оборот» пластинки — лёгкий удар раз в 1.8 с
      for (let at = 0; at < n; at += Math.floor(1.8 * SR)) {
        events.push({ at, len: 600, f: (i) => {
          const v = 0.03 * Math.exp(-i / 120) * Math.sin(i / 9);
          return [v, v];
        } });
      }
      break;
    }
  }
  // события с переносом через край петли (бесшовно)
  for (const e of events) {
    for (let i = 0; i < e.len; i++) {
      const [a, b] = e.f(i);
      const j = (e.at + i) % n;
      L[j] += a;
      R[j] += b;
    }
  }
  // срез инфранизов (иначе вся энергия уходит в гул, которого не слышно в динамиках ноутбука)
  const HP: Record<AmbKind, number> = { rain: 250, wind: 140, fire: 180, sea: 110, birds: 400, crickets: 1200, city: 70, vinyl: 300 };
  for (const ch of [L, R]) {
    const a = new OnePole(coef(HP[kind])),
      b = new OnePole(coef(HP[kind]));
    for (let i = 0; i < n; i++) {
      const x1 = ch[i] - a.lp(ch[i]);
      ch[i] = x1 - b.lp(x1);
    }
  }
  // бесшовная склейка: последние 0.6 с переливаем в начало
  const xf = Math.floor(0.6 * SR);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    const j = n - xf + i;
    L[i] = L[i] * k + L[j] * (1 - k);
    R[i] = R[i] * k + R[j] * (1 - k);
  }
  const outL = L.subarray(0, n - xf),
    outR = R.subarray(0, n - xf);
  // нормализация по RMS — все слои одной «громкости»
  let s = 0;
  for (let i = 0; i < outL.length; i += 7) s += outL[i] * outL[i] + outR[i] * outR[i];
  const rms = Math.sqrt(s / ((outL.length / 7) * 2)) || 1;
  const g = (kind === 'vinyl' ? 0.05 : 0.12) / rms;
  for (let i = 0; i < outL.length; i++) {
    outL[i] = Math.max(-1, Math.min(1, outL[i] * g));
    outR[i] = Math.max(-1, Math.min(1, outR[i] * g));
  }
  return [outL, outR];
}

export function ambBuffer(kind: AmbKind): Promise<AudioBuffer> {
  if (!cache.has(kind)) {
    cache.set(
      kind,
      new Promise((res) => {
        setTimeout(() => {
          const [l, r] = synth(kind);
          const b = new AudioBuffer({ numberOfChannels: 2, length: l.length, sampleRate: SR });
          b.copyToChannel(l as Float32Array<ArrayBuffer>, 0);
          b.copyToChannel(r as Float32Array<ArrayBuffer>, 1);
          res(b);
        }, 0);
      }),
    );
  }
  return cache.get(kind)!;
}

/** Микширует слои в WAV-совместимый буфер длиной dur (для «папки дня») */
export async function renderAmbience(layers: AmbLayer[], dur: number): Promise<AudioBuffer | null> {
  if (!layers.length) return null;
  const off = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  for (const l of layers) {
    const b = await ambBuffer(l.kind);
    const src = off.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const g = off.createGain();
    g.gain.value = l.gain;
    src.connect(g).connect(off.destination);
    src.start();
  }
  return off.startRendering();
}
