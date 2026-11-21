import type { DayRecord } from './types';
import type { MemoryRenderer } from './render/engine';
import { humanDate } from './render/engine';
import { drawRansom } from './render/ransom';
import { ambBuffer } from './ambience';
import { mulberry32 } from './color';

// «Фильм месяца»: дни подряд, каждый — со своей песней и своей формой, титры вырезанными буквами

export interface FilmClip {
  rec: DayRecord;
  r: MemoryRenderer;
  audio: AudioBuffer | null;
  cover?: HTMLImageElement;
}

export const TITLE = 3.6,
  CLIP = 6.5,
  XF = 1.1,
  END = 4.5;

export class FilmEngine {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private data = new Float32Array(1024);
  private sources: AudioScheduledSourceNode[] = [];
  private t0 = 0;
  private offset = 0;
  private raf = 0;
  playing = false;
  private level = 0;
  rec: MediaStreamAudioDestinationNode | null = null;
  onTime?: (t: number) => void;
  onEnd?: () => void;
  private paper: HTMLCanvasElement;

  clips: FilmClip[];
  title: string;
  subtitle: string;

  constructor(clips: FilmClip[], title: string, subtitle: string) {
    this.clips = clips;
    this.title = title;
    this.subtitle = subtitle;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1080;
    this.canvas.height = 1350;
    this.g = this.canvas.getContext('2d')!;
    this.paper = makePaper();
  }

  get duration() {
    return TITLE + this.clips.length * CLIP + END;
  }

  private ensure() {
    if (this.ac) return;
    this.ac = new AudioContext();
    this.master = this.ac.createGain();
    this.analyser = this.ac.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(this.analyser);
    this.analyser.connect(this.ac.destination);
  }

  get time() {
    if (!this.playing || !this.ac) return this.offset;
    return this.ac.currentTime - this.t0;
  }

  /** расписываем все песни и звуки дней на общую дорожку */
  private async schedule(from: number) {
    const ac = this.ac!;
    const now = ac.currentTime + 0.05;
    this.t0 = now - from;
    const out = this.master!;
    for (let i = 0; i < this.clips.length; i++) {
      const c = this.clips[i];
      const start = TITLE + i * CLIP - XF / 2; // песня входит под конец предыдущего дня
      const end = start + CLIP + XF;
      if (end <= from) continue;
      const lead = Math.max(0, from - start);
      const when = now + Math.max(0, start - from);
      const g = ac.createGain();
      g.connect(out);
      if (this.rec) g.connect(this.rec);
      const vol = 0.9;
      const fadeIn = Math.max(0, XF - lead);
      g.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : vol, when);
      if (fadeIn > 0) g.gain.linearRampToValueAtTime(vol, when + fadeIn);
      g.gain.setValueAtTime(vol, now + (end - XF - from));
      g.gain.linearRampToValueAtTime(0.0001, now + (end - from));
      if (c.audio) {
        const s = ac.createBufferSource();
        s.buffer = c.audio;
        // из 30-секундного фрагмента берём середину — обычно припев
        const base = Math.max(0, Math.min(c.audio.duration - (CLIP + XF), c.audio.duration * 0.3));
        s.connect(g);
        s.start(when, base + lead, CLIP + XF - lead);
        this.sources.push(s);
      }
      // звуки дня — тихо под песней
      for (const l of c.rec.ambience ?? []) {
        const b = await ambBuffer(l.kind);
        const s = ac.createBufferSource();
        s.buffer = b;
        s.loop = true;
        const ag = ac.createGain();
        ag.gain.value = l.gain * (c.audio ? 0.55 : 1);
        s.connect(ag).connect(g);
        s.start(when, lead % b.duration);
        s.stop(now + (end - from) + 0.05);
        this.sources.push(s);
      }
    }
  }

  async play() {
    if (this.playing) return;
    this.ensure();
    await this.ac!.resume();
    if (this.offset >= this.duration - 0.05) this.offset = 0;
    await this.schedule(this.offset);
    this.playing = true;
    this.loop();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time;
    this.playing = false;
    for (const s of this.sources)
      try {
        s.stop();
      } catch {
        /* */
      }
    this.sources = [];
    cancelAnimationFrame(this.raf);
  }

  seek(t: number) {
    const was = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.duration - 0.01, t));
    this.draw(this.offset);
    this.onTime?.(this.offset);
    if (was) this.play();
  }

  private loop = () => {
    if (!this.playing) return;
    const t = this.time;
    if (t >= this.duration) {
      this.pause();
      this.offset = this.duration;
      this.draw(this.duration - 0.001);
      this.onEnd?.();
      return;
    }
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.data);
      let s = 0;
      for (let i = 0; i < this.data.length; i++) s += this.data[i] * this.data[i];
      this.level = this.level * 0.8 + Math.min(1, Math.sqrt(s / this.data.length) * 4.5) * 0.2;
    }
    this.draw(t);
    this.onTime?.(t);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** кадр фильма в момент t */
  draw(t: number) {
    const g = this.g;
    const W = 1080,
      H = 1350;
    g.globalAlpha = 1;
    g.drawImage(this.paper, 0, 0);
    // клипы
    for (let i = 0; i < this.clips.length; i++) {
      const s = TITLE + i * CLIP;
      if (t < s - XF || t > s + CLIP + XF) continue;
      const local = t - s;
      const a = Math.min(1, (local + XF) / XF, (CLIP + XF - local) / XF);
      if (a <= 0) continue;
      const c = this.clips[i];
      c.r.draw(Math.max(0, local + 1.2), { level: this.level });
      const z = 1.035 - 0.035 * Math.min(1, Math.max(0, (local + XF) / (CLIP + XF)));
      g.save();
      g.globalAlpha = ease(Math.max(0, a));
      g.translate(W / 2, H / 2);
      g.scale(z, z);
      g.drawImage(c.r.canvas, -W / 2, -H / 2, W, H);
      g.restore();
    }
    // титр
    if (t < TITLE + XF) {
      const a = Math.min(1, (TITLE + XF - t) / XF);
      g.save();
      g.globalAlpha = ease(a);
      g.drawImage(this.paper, 0, 0);
      const appear = Math.min(1, t / (TITLE * 0.6));
      drawRansom(g, this.title, { x: 90, y: 600, size: 92, maxWidth: W - 180, seed: 11, palette: ['#fbf8f1', '#f3e3b5', '#e6d2c4', '#d9e2e6', '#efe2c9'], ink: '#1d1b1f', align: 'center', appear });
      g.globalAlpha = ease(a) * Math.min(1, Math.max(0, (t - 1.2) / 0.8));
      g.fillStyle = '#5d5750';
      g.font = '500 24px "Imprint Text", serif';
      g.letterSpacing = '6px';
      g.textAlign = 'center';
      g.fillText(this.subtitle.toUpperCase(), W / 2, 860);
      g.letterSpacing = '0px';
      g.restore();
    }
    // конец: обложки дней веером
    const endS = TITLE + this.clips.length * CLIP;
    if (t > endS - XF * 0.2) {
      const local = t - endS;
      const a = Math.min(1, (local + XF * 0.2) / XF);
      g.save();
      g.globalAlpha = ease(Math.max(0, a));
      g.drawImage(this.paper, 0, 0);
      const n = this.clips.length;
      const rnd = mulberry32(7);
      this.clips.forEach((c, i) => {
        if (!c.cover) return;
        const k = Math.min(1, Math.max(0, (local - i * 0.12) / 0.5));
        if (k <= 0) return;
        const cols = Math.min(n, 4);
        const row = Math.floor(i / cols),
          col = i % cols;
        const rows = Math.ceil(n / cols);
        const cw = 210,
          ch = 262;
        const x = W / 2 + (col - (Math.min(cols, n - row * cols) - 1) / 2) * (cw + 24);
        const y = 560 + (row - (rows - 1) / 2) * (ch + 30);
        g.save();
        g.translate(x, y - (1 - ease(k)) * 60);
        g.rotate((rnd() - 0.5) * 0.16);
        g.globalAlpha = ease(Math.max(0, a)) * k;
        g.shadowColor = 'rgba(30,20,10,0.35)';
        g.shadowBlur = 18;
        g.shadowOffsetY = 8;
        g.fillStyle = '#fffdf8';
        g.fillRect(-cw / 2 - 8, -ch / 2 - 8, cw + 16, ch + 16);
        g.shadowColor = 'transparent';
        g.drawImage(c.cover, -cw / 2, -ch / 2, cw, ch);
        g.restore();
      });
      g.globalAlpha = ease(Math.max(0, a)) * Math.min(1, Math.max(0, (local - 1) / 0.8));
      g.fillStyle = '#1d1b1f';
      g.textAlign = 'center';
      g.font = 'italic 500 64px "Imprint Serif", serif';
      g.fillText(this.title, W / 2, 1130);
      g.fillStyle = '#5d5750';
      g.font = '500 22px "Imprint Text", serif';
      g.letterSpacing = '6px';
      g.fillText(`${humanDate(this.clips[0].rec.date).split(' · ')[0]}, ${humanDate(this.clips[n - 1].rec.date).split(' · ')[0]}`.toUpperCase(), W / 2, 1186);
      g.letterSpacing = '0px';
      g.restore();
    }
  }

  async record(onProgress?: (p: number) => void): Promise<Blob> {
    this.pause();
    this.offset = 0;
    this.ensure();
    const stream = this.canvas.captureStream(30);
    this.rec = this.ac!.createMediaStreamDestination();
    this.rec.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((res) => (mr.onstop = () => res(new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' }))));
    mr.start(250);
    await new Promise<void>((res) => {
      const prevEnd = this.onEnd;
      const iv = setInterval(() => onProgress?.(Math.min(1, this.time / this.duration)), 200);
      this.onEnd = () => {
        clearInterval(iv);
        this.onEnd = prevEnd;
        res();
      };
      this.play();
    });
    await new Promise((r) => setTimeout(r, 300));
    mr.stop();
    this.rec.disconnect();
    this.rec = null;
    this.offset = 0;
    return done;
  }

  destroy() {
    this.pause();
    this.ac?.close();
  }
}

const ease = (x: number) => x * x * (3 - 2 * x);

function makePaper() {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe9df';
  g.fillRect(0, 0, 1080, 1350);
  const img = g.getImageData(0, 0, 1080, 1350);
  const rnd = mulberry32(3);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 14;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c;
}
