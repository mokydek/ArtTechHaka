import { ambBuffer } from '../ambience';
import type { AmbKind } from '../types';
import type { HourWeather } from './context';

// Звук места в тот час: дождь, ветер, птицы днём, сверчки тёплой ночью, гром в грозу

export class PlaceSound {
  private ac = new AudioContext();
  private master = this.ac.createGain();
  private layers = new Map<AmbKind, GainNode>();

  constructor() {
    this.master.gain.value = 0.9;
    this.master.connect(this.ac.destination);
  }

  get running() {
    return this.ac.state === 'running';
  }

  resume() {
    return this.ac.resume();
  }

  set muted(m: boolean) {
    this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ac.currentTime, 0.15);
  }

  private async layer(kind: AmbKind) {
    let g = this.layers.get(kind);
    if (g) return g;
    g = this.ac.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    this.layers.set(kind, g);
    const buf = await ambBuffer(kind);
    const s = this.ac.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(g);
    s.start(0, Math.random() * buf.duration);
    return g;
  }

  /** Подобрать слои под погоду и время суток */
  async set(w: HourWeather | null, sunAlt: number) {
    const rain = w ? Math.max(w.rain, [61, 63, 65, 80, 81, 82, 95, 96, 99].includes(w.code) ? 0.6 : [51, 53, 55].includes(w.code) ? 0.2 : 0) : 0;
    const wind = w?.wind ?? 6;
    const temp = w?.temp ?? 10;
    const want: Partial<Record<AmbKind, number>> = {
      rain: rain > 0 ? Math.min(1, 0.35 + rain * 0.4) : 0,
      wind: Math.min(0.9, Math.max(0.12, (wind - 4) / 30)),
      birds: sunAlt > -2 && rain < 0.1 && temp > 2 ? 0.45 : 0,
      crickets: sunAlt < -4 && temp > 12 && rain < 0.1 ? 0.5 : 0,
      city: 0.18,
    };
    for (const [k, v] of Object.entries(want) as [AmbKind, number][]) {
      if (!v && !this.layers.has(k)) continue;
      const g = await this.layer(k);
      g.gain.setTargetAtTime(v, this.ac.currentTime, 0.8);
    }
  }

  /** Раскат грома: низкий шум с медленным затуханием */
  thunder() {
    const ac = this.ac;
    const dur = 4;
    const b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const d = b.getChannelData(0);
    let v = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / ac.sampleRate;
      v = v * 0.985 + (Math.random() * 2 - 1) * 0.15;
      const env = Math.min(1, t * 6) * Math.exp(-t * 1.1) * (0.7 + 0.3 * Math.sin(t * 9 + Math.sin(t * 3) * 4));
      d[i] = v * env;
    }
    const s = ac.createBufferSource();
    s.buffer = b;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const g = ac.createGain();
    g.gain.value = 2.2;
    s.connect(lp).connect(g).connect(this.master);
    s.start();
  }

  close() {
    this.ac.close();
  }
}
