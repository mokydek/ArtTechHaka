/**
 * «Ощущение» интерфейса: на каждое действие что-то отвечает — тихий звук, лёгкая вибрация,
 * оттиск печати или искорки. Звуки синтезируются на лету (без файлов), мягкие и негромкие.
 * Правило: после каждого действия спрашиваем себя «что должно случиться?» — см. docs/feel.md.
 */

export type Sound =
  | 'tick' // переключатели, вкладки, флажки
  | 'press' // кнопка-печать
  | 'page' // переход, перелистывание
  | 'tape' // вклеили фото
  | 'tear' // убрали фото
  | 'chime' // система что-то услышала (arg — нота 0..4)
  | 'develop' // день проявился
  | 'saved' // сохранено
  | 'boing' // погладили зайчика
  | 'pop' // открылось
  | 'popDown' // закрылось
  | 'nope' // чего-то не хватает
  | 'recOn'
  | 'recOff'
  | 'needle' // выбрана песня
  | 'pencil' // печатаешь в дневнике
  | 'shuffle' // поменяли раскладку
  | 'mood' // настроение 1..5 (arg)
  | 'note'; // уведомление

const KEY = 'ottisk:sound';
let on = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();
export const soundOn = () => on;
export function setSoundOn(v: boolean) {
  on = v;
  try {
    localStorage.setItem(KEY, v ? 'on' : 'off');
  } catch {
    /* без хранилища */
  }
  dispatchEvent(new CustomEvent('ottisk:sound', { detail: v }));
  if (v) play('tick');
}

/* ——— синтез ——— */

interface Bus {
  c: BaseAudioContext;
  out: AudioNode; // сухой выход
  room: AudioNode; // посыл в «комнату» (мягкий хвост для колокольчиков)
}
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuf(c: BaseAudioContext) {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}
function tone(b: Bus, t: number, f: number, o: { type?: OscillatorType; a?: number; d?: number; peak?: number; to?: number; wet?: number } = {}) {
  const { c } = b;
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + (o.a ?? 0.005) + (o.d ?? 0.3) * 0.6);
  const g = c.createGain();
  const a = o.a ?? 0.005,
    d = o.d ?? 0.3,
    p = o.peak ?? 0.08;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(p, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  osc.connect(g).connect(b.out);
  if (o.wet) {
    const w = c.createGain();
    w.gain.value = o.wet;
    g.connect(w).connect(b.room);
  }
  osc.start(t);
  osc.stop(t + a + d + 0.05);
}
function noise(b: Bus, t: number, len: number, o: { type?: BiquadFilterType; f?: number; q?: number; peak?: number; a?: number; am?: number; f2?: number }) {
  const { c } = b;
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c);
  const fl = c.createBiquadFilter();
  fl.type = o.type ?? 'bandpass';
  fl.frequency.setValueAtTime(o.f ?? 2000, t);
  if (o.f2) fl.frequency.exponentialRampToValueAtTime(o.f2, t + len);
  fl.Q.value = o.q ?? 0.8;
  const g = c.createGain();
  const a = o.a ?? 0.004,
    p = o.peak ?? 0.05;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(p, t + a);
  if (o.am) {
    // «липкий» звук скотча: амплитуда дрожит
    const n = Math.floor(len * o.am);
    for (let i = 1; i <= n; i++) g.gain.setValueAtTime(p * (0.25 + 0.75 * Math.random()) * (1 - i / (n + 1)), t + a + (len * i) / (n + 1));
  }
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(fl).connect(g).connect(b.out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + len + 0.02);
}
// мажорная пентатоника — что ни сыграй, звучит дружелюбно
const PENTA = [523.25, 587.33, 659.25, 783.99, 880];
const bell = (b: Bus, t: number, f: number, peak = 0.05, d = 1.1) => {
  tone(b, t, f, { peak, d, wet: 0.5 });
  tone(b, t, f * 2, { peak: peak * 0.28, d: d * 0.6, wet: 0.4 });
  tone(b, t, f * 3.01, { peak: peak * 0.1, d: d * 0.35 });
};

export const SOUNDS: Record<Sound, (b: Bus, t: number, arg?: number) => void> = {
  tick: (b, t) => {
    noise(b, t, 0.028, { type: 'highpass', f: 3500, peak: 0.05 });
    tone(b, t, 1900, { peak: 0.018, d: 0.03 });
  },
  press: (b, t) => {
    tone(b, t, 170, { to: 70, peak: 0.16, d: 0.13 });
    noise(b, t, 0.05, { type: 'lowpass', f: 900, peak: 0.07 });
    noise(b, t + 0.01, 0.06, { f: 3200, q: 0.6, peak: 0.018 });
  },
  page: (b, t) => noise(b, t, 0.26, { f: 1800, f2: 4200, q: 0.6, a: 0.07, peak: 0.045 }),
  tape: (b, t) => {
    noise(b, t, 0.2, { f: 2600, q: 1.1, peak: 0.06, am: 70 });
    tone(b, t + 0.19, 220, { to: 120, peak: 0.07, d: 0.08 });
  },
  tear: (b, t) => noise(b, t, 0.22, { type: 'highpass', f: 1500, f2: 5000, peak: 0.05, am: 50 }),
  chime: (b, t, n = 0) => bell(b, t, PENTA[Math.abs(Math.round(n)) % 5], 0.04),
  develop: (b, t) => [392, 523.25, 659.25, 783.99].forEach((f, i) => bell(b, t + i * 0.11, f, 0.045, 1.4)),
  saved: (b, t) => {
    SOUNDS.press(b, t);
    [523.25, 659.25, 783.99].forEach((f, i) => bell(b, t + 0.12 + i * 0.03, f, 0.035, 1.5));
  },
  boing: (b, t) => {
    tone(b, t, 330, { to: 620, peak: 0.07, d: 0.12, type: 'triangle' });
    tone(b, t + 0.1, 600, { to: 440, peak: 0.05, d: 0.14 });
  },
  pop: (b, t) => tone(b, t, 520, { to: 880, peak: 0.05, d: 0.07 }),
  popDown: (b, t) => tone(b, t, 760, { to: 430, peak: 0.04, d: 0.08 }),
  nope: (b, t) => {
    tone(b, t, 150, { to: 120, peak: 0.12, d: 0.09 });
    tone(b, t + 0.12, 130, { to: 100, peak: 0.1, d: 0.11 });
  },
  recOn: (b, t) => {
    tone(b, t, 660, { peak: 0.05, d: 0.07 });
    tone(b, t + 0.08, 990, { peak: 0.05, d: 0.09 });
  },
  recOff: (b, t) => {
    tone(b, t, 990, { peak: 0.05, d: 0.07 });
    tone(b, t + 0.08, 660, { peak: 0.05, d: 0.1 });
  },
  needle: (b, t) => {
    noise(b, t, 0.04, { type: 'lowpass', f: 600, peak: 0.08 });
    for (let i = 0; i < 5; i++) noise(b, t + 0.05 + i * 0.045 + Math.random() * 0.02, 0.012, { type: 'highpass', f: 2500, peak: 0.03 });
    bell(b, t + 0.12, 659.25, 0.025, 0.8);
  },
  pencil: (b, t) => noise(b, t, 0.035 + Math.random() * 0.02, { f: 3000 + Math.random() * 1500, q: 2, peak: 0.012 + Math.random() * 0.006 }),
  shuffle: (b, t) => {
    for (let i = 0; i < 3; i++) noise(b, t + i * 0.06, 0.12, { f: 2200 + i * 500, q: 0.7, a: 0.03, peak: 0.035 });
  },
  mood: (b, t, m = 3) => {
    const chords: Record<number, number[]> = { 1: [220, 261.63], 2: [246.94, 293.66], 3: [329.63, 392], 4: [392, 493.88, 587.33], 5: [523.25, 659.25, 783.99, 1046.5] };
    const fs = chords[Math.max(1, Math.min(5, Math.round(m)))];
    const gap = m >= 4 ? 0.08 : 0.16;
    fs.forEach((f, i) => bell(b, t + i * gap, f, m <= 2 ? 0.035 : 0.04, m <= 2 ? 1.6 : 1.2));
  },
  note: (b, t) => {
    noise(b, t, 0.18, { f: 2600, q: 0.7, a: 0.05, peak: 0.03 });
    bell(b, t + 0.05, 783.99, 0.02, 0.6);
  },
};

// выравнивание громкости (по замерам в OfflineAudioContext): все звуки одной «тихой» семьи
const LEVEL: Record<Sound, number> = { tick: 1.6, press: 1.8, page: 1.4, tape: 1, tear: 1.2, chime: 1.8, develop: 1, saved: 1.2, boing: 1.4, pop: 2.3, popDown: 2.3, nope: 0.9, recOn: 1.3, recOff: 1.3, needle: 1, pencil: 4, shuffle: 1.4, mood: 1.1, note: 1.6 };
function scoped(b: Bus, k: number): Bus {
  const o = b.c.createGain();
  o.gain.value = k;
  o.connect(b.out);
  const r = b.c.createGain();
  r.gain.value = k;
  r.connect(b.room);
  return { c: b.c, out: o, room: r };
}

let live: { c: AudioContext; bus: Bus } | null = null;
function makeBus(c: BaseAudioContext, dest: AudioNode): Bus {
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 3;
  const master = c.createGain();
  master.gain.value = 0.9;
  master.connect(comp).connect(dest);
  // «комната»: короткий мягкий хвост из затухающего шума
  const len = Math.floor(c.sampleRate * 1.1);
  const ir = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3) * 0.6;
  }
  const conv = c.createConvolver();
  conv.buffer = ir;
  const wet = c.createGain();
  wet.gain.value = 0.35;
  conv.connect(wet).connect(master);
  return { c, out: master, room: conv };
}

/** для проверок: какие звуки сыграли */
const log: Sound[] = [];
(window as unknown as { __feelLog: Sound[] }).__feelLog = log;
setTimeout(() => ((window as unknown as { __feelRender: typeof renderSound }).__feelRender = renderSound));

const last = new Map<Sound, number>();
export function play(s: Sound, arg?: number) {
  log.push(s);
  if (log.length > 200) log.shift();
  if (!on || document.hidden) return;
  // одинаковые звуки чаще 40 мс сливаются в один
  const now = performance.now();
  if (now - (last.get(s) ?? 0) < (s === 'pencil' ? 60 : 40)) return;
  last.set(s, now);
  try {
    if (!live) {
      const c = new AudioContext({ latencyHint: 'interactive' });
      live = { c, bus: makeBus(c, c.destination) };
    }
    const { c, bus } = live;
    if (c.state === 'suspended') void c.resume();
    SOUNDS[s](scoped(bus, LEVEL[s]), c.currentTime + 0.005, arg);
  } catch {
    /* без звука */
  }
}

/** отрисовать звук в буфер (для проверок качества) */
export async function renderSound(s: Sound, arg?: number, sec = 2) {
  const c = new OfflineAudioContext(2, Math.floor(44100 * sec), 44100);
  SOUNDS[s](scoped(makeBus(c, c.destination), LEVEL[s]), 0.01, arg);
  return c.startRendering();
}

/** короткая вибрация на телефонах, где она есть */
export function buzz(ms = 8) {
  try {
    if (on) navigator.vibrate?.(ms);
  } catch {
    /* */
  }
}

/* ——— видимые ответы ——— */
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** большой оттиск печати поверх экрана: «Сохранено», «Готово» */
export function stampMark(text: string) {
  play('saved');
  buzz(14);
  if (calm()) return;
  const el = document.createElement('div');
  el.className = 'feel-stamp';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span>${text.replace(/[<>&]/g, '')}</span>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

/** искорки из точки: сердечки, звёздочки, конфетти или капли */
export function burst(x: number, y: number, kind: 'hearts' | 'sparks' | 'confetti' | 'drops' = 'sparks', n = 9) {
  if (calm()) return;
  const glyph = { hearts: '♥', sparks: '✦', confetti: '', drops: '•' }[kind];
  const colors = kind === 'confetti' ? ['#e9845a', '#efbd5c', '#7d8fb0', '#e6b5ac', '#55449e'] : kind === 'hearts' ? ['#e2564f', '#e9845a', '#f4b3b8'] : kind === 'drops' ? ['#7d8fb0', '#a3b2c9'] : ['#efbd5c', '#55449e', '#e9845a'];
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.className = 'feel-bit ' + kind;
    s.textContent = glyph;
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6;
    const r = 34 + Math.random() * 38;
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    s.style.setProperty('--dx', Math.cos(a) * r + 'px');
    s.style.setProperty('--dy', Math.sin(a) * r - (kind === 'drops' ? -20 : 18) + 'px');
    s.style.setProperty('--rot', (Math.random() - 0.5) * 120 + 'deg');
    s.style.color = colors[i % colors.length];
    if (kind === 'confetti') s.style.background = colors[i % colors.length];
    s.style.animationDelay = Math.random() * 60 + 'ms';
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
}

/** реакция зайчика на действие (поза на пару секунд) */
export function bunnyReact(pose: 'happy' | 'think' | 'sad' | 'wave' | 'point', ms = 1600) {
  dispatchEvent(new CustomEvent('ottisk:bunny-react', { detail: { pose, ms } }));
}
