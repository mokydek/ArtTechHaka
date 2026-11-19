import type { ParticleKind } from '../types';
import { mulberry32, withAlpha, mixHex } from '../color';

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
  life: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** «Погода внутри»: частицы, которые несут сезон, погоду и время суток */
export class Particles {
  kind: ParticleKind;
  ps: P[] = [];
  rect: Rect;
  rnd: () => number;
  colors: string[];
  ink: string | null; // на светлой бумаге дождь и снег рисуем тушью
  constructor(kind: ParticleKind, density: number, rect: Rect, palette: string[], accent: string, seed: number, ink: string | null = null) {
    this.ink = ink;
    this.kind = kind;
    this.rect = rect;
    this.rnd = mulberry32(seed);
    const warm = palette.slice(1, 4).map((c) => mixHex(c, '#d9862c', 0.45));
    this.colors =
      kind === 'leaves'
        ? [...warm, mixHex(accent, '#b5531f', 0.5)]
        : kind === 'petals'
          ? ['#f6d7dc', '#f3e6ea', mixHex(palette[4], '#f2b8c6', 0.5)]
          : kind === 'confetti'
            ? [...palette.slice(1), accent]
            : ['#ffffff'];
    const base: Record<ParticleKind, number> = { none: 0, leaves: 26, snow: 130, rain: 150, petals: 34, motes: 60, fireflies: 22, confetti: 90, sparks: 50, stars: 70 };
    const n = Math.round(base[kind] * (0.45 + density));
    for (let i = 0; i < n; i++) this.ps.push(this.spawn(true));
  }

  spawn(initial: boolean): P {
    const r = this.rnd,
      R = this.rect;
    const p: P = { x: R.x + r() * R.w, y: R.y + r() * R.h, vx: 0, vy: 0, r: 1, rot: r() * 6.28, vr: (r() - 0.5) * 2, ph: r() * 6.28, c: this.colors[Math.floor(r() * this.colors.length)], life: 1 };
    switch (this.kind) {
      case 'leaves':
        p.r = 9 + r() * 12;
        p.vy = 35 + r() * 45;
        p.vx = 10 + r() * 25;
        if (!initial) p.y = R.y - 30;
        break;
      case 'petals':
        p.r = 5 + r() * 6;
        p.vy = 25 + r() * 30;
        p.vx = 15 + r() * 20;
        if (!initial) p.y = R.y - 20;
        break;
      case 'snow':
        p.r = 1.2 + r() * r() * 4.5;
        p.vy = 18 + p.r * 11 + r() * 10;
        p.vx = (r() - 0.3) * 12;
        if (!initial) p.y = R.y - 10;
        break;
      case 'rain':
        p.r = 18 + r() * 26;
        p.vy = 900 + r() * 500;
        p.vx = -170 - r() * 60;
        if (!initial) p.y = R.y - 50 - r() * 200;
        break;
      case 'motes':
        p.r = 0.8 + r() * 2;
        p.vx = (r() - 0.5) * 8;
        p.vy = -3 - r() * 6;
        break;
      case 'fireflies':
        p.r = 2 + r() * 2.5;
        p.vx = (r() - 0.5) * 14;
        p.vy = (r() - 0.5) * 10;
        break;
      case 'confetti':
        p.r = 5 + r() * 5;
        p.vy = 60 + r() * 80;
        p.vx = (r() - 0.5) * 40;
        p.vr = (r() - 0.5) * 10;
        if (!initial) p.y = R.y - 20;
        break;
      case 'sparks':
        p.r = 1 + r() * 2;
        p.vy = -(50 + r() * 90);
        p.vx = (r() - 0.5) * 30;
        p.life = r();
        if (!initial) p.y = R.y + R.h + 5;
        break;
      case 'stars':
        p.r = 0.6 + r() * r() * 2.2;
        p.y = R.y + r() * R.h * 0.6;
        break;
    }
    return p;
  }

  update(dt: number, t: number, wind: number) {
    const R = this.rect;
    for (let i = 0; i < this.ps.length; i++) {
      const p = this.ps[i];
      const sway = Math.sin(t * 1.3 + p.ph);
      switch (this.kind) {
        case 'leaves':
        case 'petals':
          p.x += (p.vx + sway * 30 + wind * 60) * dt;
          p.y += (p.vy + Math.cos(t * 2 + p.ph) * 12) * dt;
          p.rot += p.vr * dt * (1 + wind);
          break;
        case 'snow':
          p.x += (p.vx + sway * 9 + wind * 25) * dt;
          p.y += p.vy * dt;
          break;
        case 'rain':
          p.x += (p.vx - wind * 80) * dt;
          p.y += p.vy * dt;
          break;
        case 'motes':
          p.x += (p.vx + sway * 4) * dt;
          p.y += (p.vy + Math.cos(t * 0.7 + p.ph) * 4) * dt;
          break;
        case 'fireflies':
          p.x += (p.vx + Math.sin(t * 0.8 + p.ph) * 12) * dt;
          p.y += (p.vy + Math.cos(t * 0.6 + p.ph * 2) * 10) * dt;
          break;
        case 'confetti':
          p.x += (p.vx + sway * 20) * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          break;
        case 'sparks':
          p.x += (p.vx + sway * 18) * dt;
          p.y += p.vy * dt;
          p.life -= dt * 0.5;
          if (p.life <= 0) Object.assign(p, this.spawn(false), { life: 1 });
          break;
        case 'stars':
          break;
      }
      // выход за пределы
      if (p.y > R.y + R.h + 40 || p.x < R.x - 60 || p.x > R.x + R.w + 60 || p.y < R.y - 260) {
        if (this.kind === 'motes' || this.kind === 'fireflies') {
          p.x = R.x + this.rnd() * R.w;
          p.y = R.y + this.rnd() * R.h;
        } else if (this.kind !== 'sparks') {
          Object.assign(p, this.spawn(false));
          if (this.kind === 'rain' || this.kind === 'snow' || this.kind === 'leaves' || this.kind === 'petals' || this.kind === 'confetti') p.x = R.x + this.rnd() * (R.w + 200);
        }
      }
    }
  }

  draw(g: CanvasRenderingContext2D, t: number, level: number, pulse: number) {
    g.save();
    for (const p of this.ps) {
      switch (this.kind) {
        case 'leaves':
        case 'petals': {
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(t * 1.7 + p.ph)));
          g.fillStyle = p.c;
          g.globalAlpha = 0.9;
          g.beginPath();
          g.moveTo(-p.r, 0);
          g.quadraticCurveTo(0, -p.r * 0.75, p.r, 0);
          g.quadraticCurveTo(0, p.r * 0.75, -p.r, 0);
          g.fill();
          if (this.kind === 'leaves') {
            g.strokeStyle = 'rgba(80,40,10,0.35)';
            g.lineWidth = 1;
            g.beginPath();
            g.moveTo(-p.r * 1.2, 0);
            g.lineTo(p.r * 0.9, 0);
            g.stroke();
          }
          g.restore();
          break;
        }
        case 'snow':
          g.globalAlpha = this.ink ? 0.18 + 0.2 * (p.r / 5.7) : 0.55 + 0.4 * (p.r / 5.7);
          g.fillStyle = this.ink ?? '#ffffff';
          g.beginPath();
          g.arc(p.x, p.y, p.r, 0, 6.283);
          g.fill();
          break;
        case 'rain':
          g.globalAlpha = this.ink ? 0.22 : 0.28;
          g.strokeStyle = this.ink ?? '#dfe8f2';
          g.lineWidth = 1.2;
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.r * 0.17, p.y + p.r);
          g.stroke();
          break;
        case 'motes': {
          const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.9 + p.ph));
          g.globalAlpha = tw * (0.55 + level * 0.4);
          g.fillStyle = '#fff6dc';
          g.beginPath();
          g.arc(p.x, p.y, p.r, 0, 6.283);
          g.fill();
          break;
        }
        case 'fireflies': {
          const b = Math.max(0, Math.sin(t * 1.6 + p.ph * 3));
          const rr = p.r * (3 + 2 * b);
          const grd = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
          grd.addColorStop(0, withAlpha('#f6ff9e', 0.9 * b + 0.1));
          grd.addColorStop(1, 'rgba(246,255,158,0)');
          g.globalAlpha = 1;
          g.fillStyle = grd;
          g.beginPath();
          g.arc(p.x, p.y, rr, 0, 6.283);
          g.fill();
          break;
        }
        case 'confetti':
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.scale(Math.cos(t * 5 + p.ph), 1);
          g.globalAlpha = 0.95;
          g.fillStyle = p.c;
          g.fillRect(-p.r / 2, -p.r, p.r, p.r * 2 * (1 + pulse * 0.2));
          g.restore();
          break;
        case 'sparks':
          g.globalAlpha = Math.max(0, p.life) * (0.7 + 0.3 * Math.sin(t * 20 + p.ph));
          g.fillStyle = '#ffb347';
          g.beginPath();
          g.arc(p.x, p.y, p.r, 0, 6.283);
          g.fill();
          break;
        case 'stars': {
          const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * (0.6 + p.ph * 0.2) + p.ph));
          g.globalAlpha = tw;
          g.fillStyle = '#fdf6e3';
          g.beginPath();
          g.arc(p.x, p.y, p.r, 0, 6.283);
          g.fill();
          break;
        }
      }
    }
    g.restore();
  }
}
