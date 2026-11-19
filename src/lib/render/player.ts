import { MemoryRenderer } from './engine';

/** Проигрыватель воспоминания: звук + кадры по часам аудио, запись видео */
export class MemoryPlayer {
  readonly r: MemoryRenderer;
  readonly buffer: AudioBuffer | null;
  private ac: AudioContext | null = null;
  private src: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private data: Float32Array<ArrayBuffer> | null = null;
  private startedAt = 0;
  private offset = 0;
  private wallStart = 0;
  private raf = 0;
  private level = 0;
  playing = false;
  onTime?: (t: number) => void;
  private recDest: MediaStreamAudioDestinationNode | null = null;
  private duckTo = 1;
  private stopAtEnd = false;
  private endCb: (() => void) | null = null;

  constructor(r: MemoryRenderer, buffer: AudioBuffer | null) {
    this.r = r;
    this.buffer = buffer;
  }

  private ensureAudio() {
    if (this.ac) return;
    this.ac = new AudioContext();
    this.gain = this.ac.createGain();
    this.analyser = this.ac.createAnalyser();
    this.analyser.fftSize = 1024;
    this.data = new Float32Array(this.analyser.fftSize) as Float32Array<ArrayBuffer>;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ac.destination);
  }

  get time(): number {
    if (!this.playing) return this.offset;
    if (this.buffer && this.ac) return this.ac.currentTime - this.startedAt;
    return (performance.now() - this.wallStart) / 1000;
  }

  play() {
    if (this.playing) return;
    if (this.offset >= this.r.duration - 0.05) this.offset = 0;
    if (this.buffer) {
      this.ensureAudio();
      this.ac!.resume();
      this.src = this.ac!.createBufferSource();
      this.src.buffer = this.buffer;
      this.src.connect(this.gain!);
      if (this.recDest) this.src.connect(this.recDest);
      this.src.start(0, Math.min(this.offset, this.buffer.duration - 0.01));
      this.startedAt = this.ac!.currentTime - this.offset;
    } else {
      this.wallStart = performance.now() - this.offset * 1000;
    }
    this.playing = true;
    this.loop();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time;
    this.playing = false;
    try {
      this.src?.stop();
    } catch {
      /* уже остановлен */
    }
    this.src = null;
    cancelAnimationFrame(this.raf);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const was = this.playing;
    this.pause();
    this.offset = Math.max(0, Math.min(this.r.duration, t));
    this.r.draw(this.offset);
    this.onTime?.(this.offset);
    if (was) this.play();
  }

  /** звук заблокирован политикой автозапуска */
  blocked(): boolean {
    return !!this.buffer && !!this.ac && this.ac.state !== 'running';
  }

  duck(v: number) {
    this.duckTo = v;
    if (this.gain && this.ac) this.gain.gain.setTargetAtTime(v, this.ac.currentTime, 0.4);
  }

  private measure(): number | undefined {
    if (!this.analyser || !this.data) return undefined;
    this.analyser.getFloatTimeDomainData(this.data);
    let s = 0;
    for (let i = 0; i < this.data.length; i++) s += this.data[i] * this.data[i];
    const rms = Math.sqrt(s / this.data.length) / Math.max(0.15, this.duckTo);
    const v = Math.min(1, rms * 4.5);
    this.level = this.level * 0.8 + v * 0.2;
    return this.level;
  }

  private loop = () => {
    if (!this.playing) return;
    const t = this.time;
    if (t >= this.r.duration) {
      if (this.stopAtEnd) {
        this.r.draw(this.r.duration - 0.01, { level: 0 });
        this.pause();
        this.endCb?.();
        return;
      }
      // воспоминание по кругу
      this.pause();
      this.offset = 0;
      this.play();
      return;
    }
    this.r.draw(t, { level: this.measure() });
    this.onTime?.(t);
    this.raf = requestAnimationFrame(this.loop);
  };

  /** Запись видео: canvas + звук песни */
  async record(onProgress?: (p: number) => void): Promise<Blob> {
    this.pause();
    this.offset = 0;
    const stream = this.r.canvas.captureStream(30);
    if (this.buffer) {
      this.ensureAudio();
      this.recDest = this.ac!.createMediaStreamDestination();
      this.recDest.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    }
    const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    const mimeType = types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<Blob>((res) => (rec.onstop = () => res(new Blob(chunks, { type: mimeType.split(';')[0] || 'video/webm' }))));
    rec.start(250);
    this.stopAtEnd = true;
    this.play();
    await new Promise<void>((res) => {
      const iv = setInterval(() => onProgress?.(Math.min(1, this.time / this.r.duration)), 150);
      this.endCb = () => {
        clearInterval(iv);
        res();
      };
      setTimeout(() => this.endCb?.(), (this.r.duration + 2) * 1000);
    });
    this.endCb = null;
    this.stopAtEnd = false;
    this.pause();
    await new Promise((r) => setTimeout(r, 300));
    rec.stop();
    if (this.recDest) {
      this.recDest.disconnect();
      this.recDest = null;
    }
    this.offset = 0;
    return done;
  }

  destroy() {
    this.pause();
    this.ac?.close();
    this.ac = null;
  }
}
