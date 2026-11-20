import { MOTIFS, MOTIF_COLORS, hex, type Atmos, type Motif } from './atmos';
import { drawMoon, moonPhase } from './sky';

// Живой фон сайта: нарисованное небо и мелочи ведущих мотивов дневника (без картинок, всё процедурно).
// Мотивы плавно перетекают друг в друга, когда дневник меняется или человек пишет новый день.

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  rot: number;
  vr: number;
  ph: number;
  c: string;
  life: number; // для следа и вспышек: 1 → 0
}

const rgba = (h: string, a: number) => {
  const [r, g, b] = hex(h);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
};

// сколько частиц у мотива при полном весе
const DENSITY: Partial<Record<Motif, number>> = { snow: 80, rain: 70, love: 26, city: 26, nature: 10, autumn: 30, summer: 40, party: 40, cozy: 16, night: 90, sea: 14 };

export class AtmosScene {
  private g: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private cur = Object.fromEntries(MOTIFS.map((k) => [k, 0])) as Record<Motif, number>;
  private target = { ...this.cur };
  private pools = new Map<Motif, P[]>();
  private trail: P[] = [];
  private rings: P[] = [];
  private raf = 0;
  private last = performance.now();
  private t = 0;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private moon = moonPhase(new Date().toLocaleDateString('sv-SE'));
  private lead: Motif | null = null;
  private lastTrail = 0;
  /** насколько сильно фон проступает (страницы с большим количеством текста — слабее) */
  strength = 1;

  private cv: HTMLCanvasElement;

  constructor(cv: HTMLCanvasElement) {
    this.cv = cv;
    this.g = cv.getContext('2d')!;
    this.resize();
    addEventListener('resize', this.resize);
    addEventListener('pointermove', this.move, { passive: true });
    addEventListener('pointerdown', this.down, { passive: true });
    this.loop();
  }

  set(a: Atmos) {
    for (const k of MOTIFS) this.target[k] = 0;
    // ведущие мотивы — по силе, но в сумме фон всегда один цельный
    // главный мотив — в полную силу (если он уверенный), остальные — тише
    a.top.forEach((k, i) => (this.target[k] = Math.min(1, 0.55 + a.weights[k] * 1.5) * [1, 0.55, 0.35][i]));
    this.lead = a.top[0] ?? null;
    if (this.reduced) {
      this.cur = { ...this.target };
      this.frame(0);
    }
  }

  private resize = () => {
    this.dpr = Math.min(1.5, devicePixelRatio || 1);
    this.W = innerWidth;
    this.H = innerHeight;
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.pools.clear();
    if (this.reduced) this.frame(0);
  };

  // ——— след за курсором и касания: мелочь ведущего мотива ———
  private move = (e: PointerEvent) => {
    if (this.reduced || !this.lead) return;
    const now = performance.now();
    if (now - this.lastTrail < 45) return;
    this.lastTrail = now;
    if (this.trail.length > 40) this.trail.shift();
    const c = MOTIF_COLORS[this.lead];
    this.trail.push({ x: e.clientX, y: e.clientY, vx: (Math.random() - 0.5) * 20, vy: -10 - Math.random() * 20, r: 2 + Math.random() * 3, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 3, ph: Math.random() * 6, c: Math.random() < 0.5 ? c.accent : c.sky[0], life: 1 });
  };
  private down = (e: PointerEvent) => {
    if (this.reduced) return;
    const c = this.lead ? MOTIF_COLORS[this.lead].accent : '#b5482a';
    this.rings.push({ x: e.clientX, y: e.clientY, vx: 0, vy: 0, r: 4, rot: 0, vr: 0, ph: 0, c, life: 1 });
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (this.reduced || document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.frame(dt);
  };

  private pool(k: Motif): P[] {
    let p = this.pools.get(k);
    if (!p) {
      p = [];
      this.pools.set(k, p);
    }
    const want = Math.round((DENSITY[k] ?? 0) * Math.min(1, this.cur[k] * 1.3) * Math.min(1.4, (this.W * this.H) / (1440 * 900)));
    while (p.length < want) p.push(this.spawn(k, true));
    if (p.length > want) p.length = want;
    return p;
  }

  private spawn(k: Motif, anywhere: boolean): P {
    const W = this.W,
      H = this.H,
      band = H * 0.42;
    const R = Math.random;
    const base: P = { x: R() * W, y: anywhere ? R() * H : -20, vx: 0, vy: 0, r: 2, rot: R() * 6.28, vr: (R() - 0.5) * 1.5, ph: R() * 6.28, c: MOTIF_COLORS[k].accent, life: 1 };
    switch (k) {
      case 'snow':
        return { ...base, vy: 18 + R() * 26, r: 1.6 + R() * 2.8, c: R() < 0.5 ? '#9fb9d8' : '#b9cde4' };
      case 'rain':
        return { ...base, vy: 420 + R() * 260, vx: -60, r: 14 + R() * 18, c: '#55677c' };
      case 'love':
        return { ...base, vy: 14 + R() * 18, vx: 8 + R() * 10, r: 4 + R() * 5, c: R() < 0.6 ? '#ec8fa6' : '#f6c1cc' };
      case 'autumn':
        return { ...base, vy: 26 + R() * 30, vx: 10 + R() * 14, r: 6 + R() * 7, c: ['#d0782f', '#c2461f', '#e3a640', '#a8501d'][(R() * 4) | 0] };
      case 'nature':
        return { ...base, vy: 16 + R() * 14, vx: 14 + R() * 10, r: 4 + R() * 4, c: R() < 0.5 ? '#7aa35f' : '#a9c46c' };
      case 'party':
        return { ...base, vy: 30 + R() * 34, vx: (R() - 0.5) * 20, r: 3 + R() * 3, vr: (R() - 0.5) * 8, c: ['#e94f8a', '#5b8def', '#f2c14e', '#46b37d', '#9b6ef3'][(R() * 5) | 0] };
      case 'summer':
        return { ...base, y: anywhere ? R() * band * 1.4 : band * 1.4, vy: -(4 + R() * 8), vx: (R() - 0.5) * 6, r: 1 + R() * 2.2, c: '#fff1b8' };
      case 'cozy':
        return { ...base, y: anywhere ? H - R() * H * 0.5 : H + 10, vy: -(14 + R() * 20), vx: (R() - 0.5) * 8, r: 1 + R() * 1.8, c: R() < 0.5 ? '#ffb46b' : '#ffd79a' };
      case 'city':
        return { ...base, y: R() * band * 0.95, vx: (R() - 0.5) * 4, r: 6 + R() * 18, c: ['#ffc46b', '#ff8a9a', '#9fb7ff', '#ffe3a3'][(R() * 4) | 0] };
      case 'night':
        return { ...base, y: R() * band * 0.85, r: 0.5 + R() * 1.4, c: '#ffffff' };
      case 'sea':
        return { ...base, y: band * (0.62 + R() * 0.2), r: 1 + R() * 2, c: '#ffffff' };
      default:
        return base;
    }
  }

  private frame(dt: number) {
    const { g, W, H } = this;
    this.t += dt;
    const t = this.t;
    for (const k of MOTIFS) this.cur[k] += (this.target[k] - this.cur[k]) * Math.min(1, dt * 0.9 || 1);
    g.clearRect(0, 0, W, H);
    const S = this.strength;
    const band = H * 0.42;
    const active = MOTIFS.filter((k) => this.cur[k] > 0.01);

    // 1. небо сверху: смесь ведущих мотивов
    for (const k of active) {
      const c = MOTIF_COLORS[k].sky;
      const a = this.cur[k] * 0.72 * S;
      const gr = g.createLinearGradient(0, 0, 0, band);
      gr.addColorStop(0, rgba(c[0], a));
      gr.addColorStop(0.55, rgba(c[1], a * 0.75));
      gr.addColorStop(1, rgba(c[2], 0));
      g.fillStyle = gr;
      g.fillRect(0, 0, W, band);
    }

    // 2. крупные «картинки» мотивов
    for (const k of active) {
      const w = this.cur[k] * S;
      g.save();
      switch (k) {
        case 'sunset': {
          // солнце садится у горизонта, лучи медленно поворачиваются, иногда пролетают птицы
          const sx = W * 0.8,
            sy = band * 0.66 + Math.sin(t * 0.15) * 4,
            r = Math.min(110, W * 0.07);
          g.globalAlpha = w;
          const glow = g.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 4);
          glow.addColorStop(0, 'rgba(255,236,190,0.85)');
          glow.addColorStop(0.25, 'rgba(250,170,110,0.45)');
          glow.addColorStop(1, 'rgba(240,120,110,0)');
          g.fillStyle = glow;
          g.fillRect(sx - r * 4, sy - r * 4, r * 8, r * 8);
          g.globalAlpha = w * 0.08;
          g.fillStyle = '#fff3d6';
          for (let i = 0; i < 12; i++) {
            const a0 = (i / 12) * Math.PI * 2 + t * 0.03;
            g.beginPath();
            g.moveTo(sx, sy);
            g.lineTo(sx + Math.cos(a0) * W, sy + Math.sin(a0) * W);
            g.lineTo(sx + Math.cos(a0 + 0.06) * W, sy + Math.sin(a0 + 0.06) * W);
            g.fill();
          }
          g.globalAlpha = w * 0.9;
          g.fillStyle = '#fff4dc';
          g.beginPath();
          g.arc(sx, sy, r * 0.55, 0, Math.PI * 2);
          g.fill();
          // птицы
          g.globalAlpha = w * 0.45;
          g.strokeStyle = '#6b3c46';
          g.lineWidth = 1.4;
          for (let i = 0; i < 3; i++) {
            const px = ((t * 26 + i * 90) % (W + 300)) - 150,
              py = band * 0.3 + i * 18 + Math.sin(t + i) * 6,
              f = Math.sin(t * 6 + i) * 3;
            g.beginPath();
            g.moveTo(px - 8, py - 3 - f);
            g.quadraticCurveTo(px - 3, py - 2, px, py + 1);
            g.quadraticCurveTo(px + 3, py - 2, px + 8, py - 3 - f);
            g.stroke();
          }
          break;
        }
        case 'night': {
          // луна сегодняшней фазы
          g.globalAlpha = w;
          const mx = W * 0.86,
            my = band * 0.32;
          const halo = g.createRadialGradient(mx, my, 10, mx, my, 90);
          halo.addColorStop(0, 'rgba(240,236,214,0.35)');
          halo.addColorStop(1, 'rgba(240,236,214,0)');
          g.fillStyle = halo;
          g.fillRect(mx - 90, my - 90, 180, 180);
          drawMoon(g, mx, my, 22, this.moon, '#f4ecd2', 'rgba(40,46,80,0.35)');
          break;
        }
        case 'sea': {
          // волны у нижнего края
          for (let i = 0; i < 3; i++) {
            g.globalAlpha = w * (0.16 - i * 0.035);
            g.fillStyle = i === 0 ? '#5d9cc8' : i === 1 ? '#7fb6d9' : '#a9d0e6';
            g.beginPath();
            const base = H - 18 - i * 16;
            g.moveTo(0, H);
            for (let x = 0; x <= W; x += 16) g.lineTo(x, base + Math.sin(x / (120 + i * 40) + t * (0.6 + i * 0.2)) * (6 + i * 2));
            g.lineTo(W, H);
            g.fill();
          }
          break;
        }
        case 'nature': {
          // трава по нижнему краю качается
          g.globalAlpha = w * 0.22;
          g.strokeStyle = '#5f8f45';
          g.lineWidth = 2;
          for (let x = 0; x < W; x += 9) {
            const h = 14 + ((x * 7919) % 23);
            const sway = Math.sin(t * 1.3 + x * 0.05) * 4;
            g.beginPath();
            g.moveTo(x, H);
            g.quadraticCurveTo(x + sway * 0.5, H - h * 0.6, x + sway, H - h);
            g.stroke();
          }
          break;
        }
        case 'summer': {
          // засветка из угла, как на плёнке летом
          g.globalAlpha = w * (0.32 + Math.sin(t * 0.4) * 0.06);
          const lk = g.createRadialGradient(0, 0, 0, 0, 0, Math.max(W, H) * 0.55);
          lk.addColorStop(0, 'rgba(255,214,120,0.9)');
          lk.addColorStop(1, 'rgba(255,214,120,0)');
          g.fillStyle = lk;
          g.fillRect(0, 0, W, H);
          break;
        }
        case 'cozy': {
          // тёплый свет у краёв, мерцает как свеча
          const fl = 0.85 + Math.sin(t * 7) * 0.05 + Math.sin(t * 13.3) * 0.04;
          for (const cx of [0, W]) {
            g.globalAlpha = w * 0.32 * fl;
            const cg = g.createRadialGradient(cx, H, 0, cx, H, Math.max(W, H) * 0.45);
            cg.addColorStop(0, 'rgba(255,170,90,0.8)');
            cg.addColorStop(1, 'rgba(255,170,90,0)');
            g.fillStyle = cg;
            g.fillRect(0, 0, W, H);
          }
          break;
        }
        case 'rain': {
          // капли на «стекле» с дорожками
          g.globalAlpha = w * 0.7;
          for (let i = 0; i < 9; i++) {
            const x = ((i * 977) % 1000) / 1000 * W;
            const sp = 0.02 + ((i * 37) % 10) / 300;
            const y = ((t * sp + i * 0.13) % 1) * (H + 60) - 30;
            g.strokeStyle = 'rgba(120,140,160,0.35)';
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(x, y - 40);
            g.lineTo(x + Math.sin(y / 30) * 1.5, y);
            g.stroke();
            g.fillStyle = 'rgba(200,215,230,0.7)';
            g.beginPath();
            g.ellipse(x, y, 3.2, 4.2, 0, 0, Math.PI * 2);
            g.fill();
            g.fillStyle = 'rgba(255,255,255,0.9)';
            g.beginPath();
            g.arc(x - 1, y - 1.5, 1, 0, Math.PI * 2);
            g.fill();
          }
          break;
        }
      }
      g.restore();
    }

    // 3. частицы мотивов
    for (const k of active) {
      const ps = this.pool(k);
      const w = this.cur[k] * S;
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        p.x += (p.vx + Math.sin(t * 0.9 + p.ph) * (k === 'snow' || k === 'love' || k === 'autumn' ? 12 : 0)) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 30 || p.y < -40 || p.x < -60 || p.x > W + 60) {
          ps[i] = this.spawn(k, false);
          if (k === 'summer' || k === 'cozy') ps[i].y = k === 'summer' ? H * 0.42 * 1.4 : H + 10;
          if (k === 'city' || k === 'night' || k === 'sea') ps[i] = this.spawn(k, true);
          continue;
        }
        this.particle(k, p, w, t);
      }
    }

    // 4. след за курсором и круги от касаний
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      p.life -= dt * 1.1;
      if (p.life <= 0) {
        this.trail.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (this.lead) this.particle(this.lead, p, p.life * 0.9, t, true);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const p = this.rings[i];
      p.life -= dt * 1.8;
      if (p.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      g.strokeStyle = rgba(p.c, p.life * 0.45);
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(p.x, p.y, 4 + (1 - p.life) * 34, 0, Math.PI * 2);
      g.stroke();
    }
  }

  private particle(k: Motif, p: P, w: number, t: number, trail = false) {
    const g = this.g;
    switch (k) {
      case 'snow':
        g.fillStyle = trail ? rgba('#a9c1dc', w) : rgba(p.c, 0.85 * w);
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = rgba('#ffffff', 0.9 * w);
        g.beginPath();
        g.arc(p.x - p.r * 0.25, p.y - p.r * 0.25, p.r * 0.45, 0, Math.PI * 2);
        g.fill();
        break;
      case 'rain':
        if (trail) {
          g.strokeStyle = rgba('#6f8296', w * 0.6);
          g.lineWidth = 1;
          g.beginPath();
          g.arc(p.x, p.y, (1 - w) * 14 + 2, 0, Math.PI * 2);
          g.stroke();
        } else {
          g.strokeStyle = rgba(p.c, 0.3 * w);
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x + p.vx * 0.03, p.y + p.r);
          g.stroke();
        }
        break;
      case 'love':
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = rgba(p.c, 0.6 * w);
        if (trail || p.ph < 0.5) heart(g, p.r * 1.2);
        else {
          g.beginPath();
          g.ellipse(0, 0, p.r, p.r * 0.6, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
        break;
      case 'autumn':
      case 'nature':
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.scale(1, 0.6 + 0.4 * Math.sin(t * 2 + p.ph));
        g.fillStyle = rgba(p.c, (k === 'autumn' ? 0.6 : 0.45) * w);
        leaf(g, p.r);
        g.restore();
        break;
      case 'party':
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.scale(Math.cos(t * 3 + p.ph), 1);
        g.fillStyle = rgba(p.c, 0.65 * w);
        g.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
        g.restore();
        break;
      case 'summer':
      case 'cozy': {
        const a = (0.5 + 0.5 * Math.sin(t * 2 + p.ph)) * w * (k === 'cozy' ? 0.8 : 0.7);
        const gl = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        gl.addColorStop(0, rgba(p.c, a));
        gl.addColorStop(1, rgba(p.c, 0));
        g.fillStyle = gl;
        g.fillRect(p.x - p.r * 4, p.y - p.r * 4, p.r * 8, p.r * 8);
        break;
      }
      case 'city': {
        const a = (0.16 + 0.1 * Math.sin(t * 0.8 + p.ph)) * w * (trail ? 3 : 1);
        const gl = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        gl.addColorStop(0, rgba(p.c, a));
        gl.addColorStop(0.7, rgba(p.c, a * 0.6));
        gl.addColorStop(1, rgba(p.c, 0));
        g.fillStyle = gl;
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        g.fill();
        break;
      }
      case 'night':
      case 'sea':
      case 'sunset': {
        // мерцающие точки: звёзды, блики на воде, искры заката
        const a = (0.35 + 0.65 * Math.abs(Math.sin(t * (k === 'sea' ? 2.2 : 0.9) + p.ph))) * w * (k === 'night' ? 0.9 : 0.7);
        g.fillStyle = trail ? rgba(k === 'sunset' ? '#ffcf8a' : '#ffffff', w) : rgba(p.c, a);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(Math.PI / 4);
        const r = trail ? p.r * 0.9 : p.r;
        g.fillRect(-r * 0.25, -r * 1.6, r * 0.5, r * 3.2);
        g.fillRect(-r * 1.6, -r * 0.25, r * 3.2, r * 0.5);
        g.restore();
        break;
      }
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    removeEventListener('pointermove', this.move);
    removeEventListener('pointerdown', this.down);
  }
}

function heart(g: CanvasRenderingContext2D, s: number) {
  g.beginPath();
  g.moveTo(0, s * 0.35);
  g.bezierCurveTo(-s * 1.1, -s * 0.35, -s * 0.45, -s * 1.05, 0, -s * 0.45);
  g.bezierCurveTo(s * 0.45, -s * 1.05, s * 1.1, -s * 0.35, 0, s * 0.35);
  g.fill();
}

function leaf(g: CanvasRenderingContext2D, s: number) {
  g.beginPath();
  g.moveTo(0, -s);
  g.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s);
  g.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s);
  g.fill();
}
