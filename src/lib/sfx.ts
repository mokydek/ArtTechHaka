// Маленькие звуки интерфейса — синтез на лету, без файлов

let ac: AudioContext | null = null;
const ctx = () => (ac ??= new AudioContext());

function noiseBurst(len: number, shape: (t: number) => number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  try {
    const a = ctx();
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * shape(i / d.length);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = a.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(a.destination);
    src.start();
  } catch {
    /* без звука */
  }
}

/** шелест страницы */
export const rustle = () => noiseBurst(0.32, (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.6)), 2) * (1 - t), 2400, 0.6, 0.22);

/** треск сургуча */
export function crack() {
  noiseBurst(0.09, (t) => Math.exp(-t * 9), 1800, 1.2, 0.9);
  setTimeout(() => noiseBurst(0.06, (t) => Math.exp(-t * 12), 2600, 1.5, 0.6), 70);
  setTimeout(() => noiseBurst(0.12, (t) => Math.exp(-t * 7), 900, 0.8, 0.5), 150);
}

/** глухой удар печати */
export function stamp() {
  try {
    const a = ctx();
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140, a.currentTime);
    o.frequency.exponentialRampToValueAtTime(55, a.currentTime + 0.18);
    g.gain.setValueAtTime(0.5, a.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + 0.25);
    o.connect(g).connect(a.destination);
    o.start();
    o.stop(a.currentTime + 0.3);
  } catch {
    /* */
  }
  noiseBurst(0.05, (t) => Math.exp(-t * 10), 400, 0.7, 0.4, 'lowpass');
}

/** бумага разворачивается */
export const unfold = () => noiseBurst(0.6, (t) => Math.sin(Math.PI * t) * (0.6 + 0.4 * Math.sin(t * 40)), 3200, 0.5, 0.16);
