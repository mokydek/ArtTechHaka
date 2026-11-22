import * as THREE from 'three';
import type { SceneLayers } from './depth';
import type { HourWeather, ShotContext, SkyState } from './context';

/**
 * «Побывать там», живое фото: кадр становится объёмным, как 3D-фото на iPhone.
 * Камера не уходит за пределы снимка (никаких зеркальных «продолжений»), зато внутри кадра всё живёт:
 * глубина и параллакс от наклона телефона или пальца, дыхание камеры, облака плывут, по земле бегут
 * тени облаков, листва качается от ветра того часа, дымка по глубине, частицы по погоде и сезону.
 */

export interface MomentOpts {
  layers: SceneLayers;
  ctx: ShotContext;
  weather: HourWeather | null;
  sky: SkyState;
  photo: CanvasImageSource & { width: number; height: number };
}

const NEAR = 2.2; // ближняя точка кадра
const FAR = 38; // дальняя (горы, горизонт)
const SKY = 90; // небо
const ZOOM = 1.12; // запас кадра: камера двигается, а края снимка не видны
const EXT = 0.14; // край сетки тянется за кадр

const NOISE = /* glsl */ `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a*noise(p); p = p*2.03 + 17.1; a *= 0.5; } return v; }
`;

const VERT = /* glsl */ `
attribute float aVeg;
attribute float aSky;
attribute float aDist;
uniform float uTime;
uniform float uWind;
varying vec2 vUv;
varying float vVeg;
varying float vSky;
varying float vDist;
void main(){
  vec3 p = position;
  // листва и трава качаются: угол качания одинаков вблизи и вдали, порывы идут волной
  float ph = p.x * 0.55 + p.y * 1.3 + p.z * 0.35;
  float gust = 0.55 + 0.45 * sin(uTime * 0.5 + p.x * 0.18);
  float s = sin(uTime * 1.9 + ph) * 0.6 + sin(uTime * 3.3 + ph * 1.7) * 0.4;
  float k = aVeg * (1.0 - aSky) * uWind * gust * aDist * 0.0042;
  p.x += s * k;
  p.y += s * k * 0.35;
  vUv = uv;
  vVeg = aVeg;
  vSky = aSky;
  vDist = aDist;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform vec3 uTint;
uniform float uExposure;
uniform float uSat;
uniform vec3 uHazeCol;
uniform float uHaze;
uniform float uCloud;   // насколько плывут облака на небе
uniform float uShadow;  // тени облаков на земле
uniform float uDapple;  // солнечные блики в листве
uniform float uNight;   // звёзды
uniform vec2 uDrift;
uniform float uFlash;
varying vec2 vUv;
varying float vVeg;
varying float vSky;
varying float vDist;
${NOISE}
void main(){
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.04) discard;
  vec3 col = c.rgb;
  if (vSky > 0.5) {
    float n = fbm(vUv * vec2(2.6, 4.2) + uDrift);
    col *= 1.0 + (n - 0.5) * 0.16 * uCloud;
    // ночью — звёзды
    vec2 q = vUv * vec2(220.0, 150.0);
    vec2 g = floor(q);
    float h = hash(g);
    vec2 off = vec2(hash(g + 7.1), hash(g + 2.3)) * 0.6 + 0.2;
    float st = step(0.993, h) * smoothstep(0.16, 0.0, length(fract(q) - off)) * (0.55 + 0.45 * sin(uTime * (1.2 + h * 2.0) + h * 40.0));
    col += vec3(st) * uNight;
  } else {
    float n = fbm(vec2(vUv.x * 1.4, vDist * 0.07) + uDrift * 0.7);
    col *= 1.0 - uShadow * smoothstep(0.42, 0.78, n);
    col *= 1.0 + vVeg * uDapple * (fbm(vUv * 34.0 + uTime * vec2(0.45, 0.25)) - 0.5) * 0.3;
  }
  float hz = uHaze * smoothstep(3.0, 40.0, vDist);
  col = mix(col, uHazeCol, hz);
  float l = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(l), col, uSat) * uTint * uExposure + uFlash;
  gl_FragColor = vec4(col, c.a);
}`;

const PVERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform float uScale;
varying float vSeed;
void main(){
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uTint;
uniform float uExposure;
uniform float uKind; // 0 пылинки, 1 листья, 2 снег
uniform float uTime;
uniform float uAlpha;
varying float vSeed;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float a;
  vec3 col = uColor;
  if (uKind > 0.5 && uKind < 1.5) {
    float r = uTime * (0.8 + vSeed) + vSeed * 6.28;
    p = mat2(cos(r), -sin(r), sin(r), cos(r)) * p;
    p.x *= 1.9;
    a = smoothstep(0.5, 0.42, length(p));
    col *= 0.75 + 0.5 * vSeed;
  } else {
    a = smoothstep(0.5, 0.0, length(p));
    if (uKind < 0.5) a *= 0.55 + 0.45 * sin(uTime * 2.3 + vSeed * 40.0);
  }
  if (a < 0.02) discard;
  gl_FragColor = vec4(col * uTint * uExposure, a * uAlpha);
}`;

type Uniforms = Record<string, THREE.IUniform>;
type Pic = CanvasImageSource & { width: number; height: number };

interface Masks {
  sky: Uint8Array; // небо самого снимка (без объекта — у слоя фона небо продлено сквозь объект)
  veg: Float32Array; // листва и трава, 0..1
  vegShare: number;
  autumn: number; // доля жёлто-оранжевой листвы
  leaf: number[]; // средний цвет листвы
}

function toCanvas(img: Pic, max: number) {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function pixels(img: Pic, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

/** где листва и трава (зелёное или осенне-жёлтое и насыщенное), и настоящее небо снимка */
function masks(L: SceneLayers, photo: Pic): Masks {
  const { gw, gh } = L;
  const px = pixels(photo, gw, gh);
  const fg = L.fg ? pixels(L.fg, gw, gh) : null;
  const sky = Uint8Array.from(L.sky, (v, i) => (v && !(fg && fg[i * 4 + 3] > 40) ? 1 : 0));
  const raw = new Float32Array(gw * gh);
  let lr = 0,
    lg = 0,
    lb = 0,
    warm = 0,
    n = 0;
  for (let i = 0; i < gw * gh; i++) {
    if (sky[i]) continue;
    const r = px[i * 4] / 255,
      g = px[i * 4 + 1] / 255,
      b = px[i * 4 + 2] / 255;
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    const sat = mx ? (mx - mn) / mx : 0;
    const green = g >= r * 0.92 && g > b * 1.1 && sat > 0.16 && mx > 0.08;
    const autumn = r > g * 1.05 && g > b * 1.25 && sat > 0.35 && r > 0.35 && mx < 0.85;
    if (!green && !autumn) continue;
    raw[i] = 1;
    lr += r;
    lg += g;
    lb += b;
    n++;
    if (autumn) warm++;
  }
  // объект (человек) не качается от ветра
  if (fg) for (let i = 0; i < gw * gh; i++) if (fg[i * 4 + 3] > 60) raw[i] = 0;
  const veg = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let s = 0,
        k = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          s += raw[yy * gw + xx];
          k++;
        }
      veg[y * gw + x] = s / k;
    }
  return { sky, veg, vegShare: n / (gw * gh), autumn: n ? warm / n : 0, leaf: n ? [lr / n, lg / n, lb / n] : [0.5, 0.6, 0.3] };
}

/** задник: весь кадр без объекта, а где небо было закрыто — продлённое и размытое небо */
function skyFill(L: SceneLayers) {
  const w = 96,
    h = Math.max(32, Math.round((96 * L.skyImg.height) / L.skyImg.width));
  const px = pixels(L.skyImg, w, h);
  let ar = 0,
    ag = 0,
    ab = 0,
    an = 0;
  for (let i = 0; i < w * h; i++)
    if (px[i * 4 + 3] > 250) {
      ar += px[i * 4];
      ag += px[i * 4 + 1];
      ab += px[i * 4 + 2];
      an++;
    }
  const avg = an ? [ar / an, ag / an, ab / an] : [176, 196, 222];
  const out = new ImageData(w, h);
  for (let x = 0; x < w; x++) {
    let c = avg;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      if (px[i + 3] > 250) c = [px[i], px[i + 1], px[i + 2]];
      out.data[i] = c[0];
      out.data[i + 1] = c[1];
      out.data[i + 2] = c[2];
      out.data[i + 3] = 255;
    }
  }
  const a = document.createElement('canvas');
  a.width = w;
  a.height = h;
  a.getContext('2d')!.putImageData(out, 0, 0);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = Math.round((512 * h) / w);
  const g = c.getContext('2d')!;
  g.filter = 'blur(14px)';
  g.drawImage(a, -20, -20, c.width + 40, c.height + 40);
  g.filter = 'none';
  // поверх — сам снимок без объекта и его настоящее небо: из точки съёмки просветы не видны вовсе
  const out2 = document.createElement('canvas');
  out2.width = L.bg.width;
  out2.height = L.bg.height;
  const g2 = out2.getContext('2d')!;
  g2.drawImage(c, 0, 0, out2.width, out2.height);
  g2.drawImage(L.bg, 0, 0);
  g2.drawImage(L.skyImg, 0, 0, out2.width, out2.height);
  return out2;
}

/**
 * У резких краёв фон уходит назад и берёт цвет того, что дальше: сдвинешься — за краем листа
 * или плеча откроется продолжение дальнего плана, а не резиновая плёнка.
 */
function dilateFar(d: Float32Array, gw: number, gh: number, bg: HTMLCanvasElement) {
  const o = Float32Array.from(d);
  const from = new Int32Array(gw * gh).fill(-1);
  const R = 2;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (d[i] >= SKY * 0.99) continue;
      let hi = d[i],
        hj = -1;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const j = yy * gw + xx;
          if (d[j] < SKY * 0.99 && d[j] > hi) {
            hi = d[j];
            hj = j;
          }
        }
      if (hj >= 0 && hi / d[i] > 1.3) {
        o[i] = hi;
        from[i] = hj;
      }
    }
  // цвет: клетка у края получает цвет дальней соседней клетки
  const c = document.createElement('canvas');
  c.width = bg.width;
  c.height = bg.height;
  const g = c.getContext('2d')!;
  g.drawImage(bg, 0, 0);
  const cw = bg.width / (gw - 1),
    ch = bg.height / (gh - 1);
  for (let i = 0; i < gw * gh; i++) {
    const j = from[i];
    if (j < 0) continue;
    const x = i % gw,
      y = (i / gw) | 0,
      jx = j % gw,
      jy = (j / gw) | 0;
    g.clearRect((x - 0.5) * cw, (y - 0.5) * ch, cw, ch);
    g.drawImage(bg, (jx - 0.5) * cw, (jy - 0.5) * ch, cw, ch, (x - 0.5) * cw, (y - 0.5) * ch, cw, ch);
  }
  return { dist: o, tex: c };
}

/**
 * Кромка неба у силуэта (2 клетки) стоит на глубине силуэта и двигается вместе с ним.
 * Она того же цвета, что и небо за ней, — поэтому край дома или дерева остаётся цельным, без ступенек,
 * а разрыв уходит в само небо, где задник совпадает с ним.
 */
function haloSky(d: Float32Array, sky: Uint8Array, gw: number, gh: number) {
  const o = Float32Array.from(d);
  const R = 2;
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x;
      if (!sky[i]) continue;
      let lo = Infinity;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx,
            yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
          const j = yy * gw + xx;
          if (!sky[j] && d[j] < lo) lo = d[j];
        }
      if (lo < Infinity) o[i] = lo;
    }
  return o;
}

export class Moment {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  private uni: Uniforms;
  private raf = 0;
  private t0 = performance.now();
  private last = performance.now();
  private tanV: number;
  private tanH: number;
  private yawMax = 0;
  private pitchMax = 0;
  // куда смотрим: цель (палец/наклон) и сглаженное текущее
  private aim = { yaw: 0, pitch: 0, x: 0, y: 0 };
  private cur = { yaw: 0, pitch: 0, x: 0, y: 0 };
  private gyro0: { b: number; g: number } | null = null;
  private wind = { speed: 0.4, dir: 0 };
  private particles: { pts: THREE.Points; vel: Float32Array; kind: number } | null = null;
  private rain: { seg: THREE.LineSegments; pos: Float32Array } | null = null;
  private storm = false;
  private flash = 0;
  private nextFlash = 4;
  private photoSky: SkyState;
  private ro: ResizeObserver;
  private sunUp = true;
  private cloudPct = 40;
  private m: Masks;
  private container: HTMLElement;
  private o: MomentOpts;
  onThunder?: () => void;

  constructor(container: HTMLElement, o: MomentOpts) {
    this.container = container;
    this.o = o;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // цвета снимка как есть, без пересчёта
    this.renderer.setClearColor(0x0b0d12);
    container.appendChild(this.renderer.domElement);
    this.photoSky = o.sky;
    const L = o.layers;
    this.tanV = Math.tan(((o.ctx.fovV / 2) * Math.PI) / 180);
    this.tanH = this.tanV * (o.photo.width / o.photo.height);
    this.uni = {
      uTime: { value: 0 },
      uWind: { value: 0.4 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uExposure: { value: 1 },
      uSat: { value: 1 },
      uHazeCol: { value: new THREE.Color(0.82, 0.84, 0.88) },
      uHaze: { value: 0.12 },
      uCloud: { value: 1 },
      uShadow: { value: 0 },
      uDapple: { value: 0 },
      uNight: { value: 0 },
      uDrift: { value: new THREE.Vector2() },
      uFlash: { value: 0 },
    };
    this.m = masks(L, o.photo);
    const { gw, gh } = L;
    const dist = (depth: Float32Array, sky: Uint8Array, push: number) => Float32Array.from(depth, (d, i) => this.dist(d, !!sky[i]) * push);
    // 1) задник — весь кадр далеко-далеко: виден только в просветах у краёв листвы и объектов
    this.scene.add(this.layer({ gw, gh, dist: new Float32Array(gw * gh).fill(SKY * 1.12), sky: this.m.sky, veg: new Float32Array(gw * gh), map: this.texture(skyFill(L)), order: -2 }));
    // 2) фон за объектом: объект убран и дорисован; у резких краёв фон отодвинут назад
    const front = haloSky(dist(L.depthRaw, this.m.sky, 1), this.m.sky, gw, gh);
    const far = dilateFar(dist(L.depth, L.sky, 1.015), gw, gh, L.bg);
    // то, что позади, не может оказаться ближе самого снимка (дорисовка под ногами берёт близкую землю)
    for (let i = 0; i < gw * gh; i++) if (far.dist[i] < front[i] * 1.015) far.dist[i] = front[i] * 1.015;
    this.scene.add(this.layer({ gw, gh, dist: far.dist, sky: L.sky, veg: this.m.veg, map: this.texture(far.tex), order: -1, alpha: true, cut: true }));
    // 3) сам снимок: грани на разрывах глубины выброшены, под ними — фон
    this.scene.add(this.layer({ gw, gh, dist: front, sky: this.m.sky, veg: this.m.veg, map: this.texture(toCanvas(o.photo, 2048)), order: 0, cut: true }));
    this.setWeather(o.weather);
    this.setSky(o.sky);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loop();
  }

  private texture(img: HTMLCanvasElement) {
    const t = new THREE.CanvasTexture(img);
    t.colorSpace = THREE.NoColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.anisotropy = 4;
    return t;
  }

  private dist(d: number, sky: boolean) {
    if (sky) return SKY;
    if (this.o.layers.kind === 'anything') {
      // у Depth Anything — диспаратность: линейна по 1/расстояние
      const disp = 1 - d;
      return 1 / (disp * (1 / NEAR - 1 / FAR) + 1 / FAR);
    }
    return NEAR + Math.pow(d, 1.4) * (FAR * 0.45 - NEAR);
  }

  /** Слой кадра: каждая точка стоит на своём луче от точки съёмки, поэтому оттуда видно ровно фото */
  private layer(o: { gw: number; gh: number; dist: Float32Array; sky: Uint8Array; veg: Float32Array; map: THREE.Texture; order: number; cut?: boolean; alpha?: boolean }) {
    const { gw, gh, dist, sky, veg } = o;
    const n = gw * gh;
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const skyA = new Float32Array(n);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const u = x / (gw - 1),
          v = y / (gh - 1);
        const d = dist[i];
        skyA[i] = sky[i] ? 1 : 0;
        // край сетки вытянут наружу: сдвинешься — за кадром продолжится его край, а не пустота
        const ue = x === 0 ? -EXT : x === gw - 1 ? 1 + EXT : u,
          ve = y === 0 ? -EXT : y === gh - 1 ? 1 + EXT : v;
        pos[i * 3] = (ue * 2 - 1) * this.tanH * d;
        pos[i * 3 + 1] = (1 - ve * 2) * this.tanV * d;
        pos[i * 3 + 2] = -d;
        // текстура за краем повторяет крайний пиксель (clamp), поэтому и в растянутой кромке всё на своих лучах
        uv[i * 2] = ue;
        uv[i * 2 + 1] = 1 - ve;
      }
    const idx: number[] = [];
    // на разрыве глубины (лист перед небом, человек перед стеной) грань не тянем — там виден слой позади
    const ok = (a: number, b: number, c: number) => !o.cut || Math.max(dist[a], dist[b], dist[c]) / Math.min(dist[a], dist[b], dist[c]) < 1.3;
    for (let y = 0; y < gh - 1; y++)
      for (let x = 0; x < gw - 1; x++) {
        const a = y * gw + x;
        if (ok(a, a + gw, a + 1)) idx.push(a, a + gw, a + 1);
        if (ok(a + 1, a + gw, a + gw + 1)) idx.push(a + 1, a + gw, a + gw + 1);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('aVeg', new THREE.BufferAttribute(veg, 1));
    geo.setAttribute('aSky', new THREE.BufferAttribute(skyA, 1));
    geo.setAttribute('aDist', new THREE.BufferAttribute(dist, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...this.uni, uMap: { value: o.map } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: !!o.alpha,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = o.order;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** камера: кадр заполняет экран с запасом; смотреть можно только в пределах снимка */
  private resize() {
    const w = this.container.clientWidth || 1,
      h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const av = w / h;
    let tv = this.tanV / ZOOM;
    if (tv * av > this.tanH / ZOOM) tv = this.tanH / ZOOM / av;
    this.camera.fov = (2 * Math.atan(tv) * 180) / Math.PI;
    this.camera.aspect = av;
    this.camera.updateProjectionMatrix();
    this.yawMax = Math.max(0, Math.atan(this.tanH * 0.96) - Math.atan(tv * av));
    this.pitchMax = Math.max(0, Math.atan(this.tanV * 0.96) - Math.atan(tv));
    const pm = this.particles?.pts.material as THREE.ShaderMaterial | undefined;
    if (pm) pm.uniforms.uScale.value = h * 0.9;
  }

  /** палец: тянешь — смотришь в пределах кадра */
  look(dx: number, dy: number) {
    const k = 0.0032;
    this.aim.yaw = clamp(this.aim.yaw + dx * k, -this.yawMax, this.yawMax);
    this.aim.pitch = clamp(this.aim.pitch + dy * k, -this.pitchMax, this.pitchMax);
  }
  /** мышь над кадром или положение пальца: сдвиг точки взгляда (параллакс), -1..1 */
  lean(nx: number, ny: number) {
    this.aim.x = clamp(nx, -1, 1);
    this.aim.y = clamp(ny, -1, 1);
  }
  /** наклон телефона: и параллакс, и взгляд */
  tilt(beta: number, gamma: number) {
    if (!this.gyro0) this.gyro0 = { b: beta, g: gamma };
    // точка отсчёта медленно подстраивается под то, как держат телефон
    this.gyro0.b += (beta - this.gyro0.b) * 0.004;
    this.gyro0.g += (gamma - this.gyro0.g) * 0.004;
    const db = clamp(beta - this.gyro0.b, -25, 25),
      dg = clamp(gamma - this.gyro0.g, -25, 25);
    this.aim.x = dg / 25;
    this.aim.y = -db / 25;
    this.aim.yaw = clamp((-dg * Math.PI) / 180 * 0.5, -this.yawMax, this.yawMax);
    this.aim.pitch = clamp((db * Math.PI) / 180 * 0.35, -this.pitchMax, this.pitchMax);
  }
  reset() {
    this.aim = { yaw: 0, pitch: 0, x: 0, y: 0 };
    this.gyro0 = null;
  }

  /** небо и свет выбранной минуты относительно минуты снимка */
  setSky(s: SkyState) {
    const g = grade(s.sunAlt),
      g0 = grade(this.photoSky.sunAlt);
    const same = Math.abs(s.sunAlt - this.photoSky.sunAlt) < 0.5;
    const tint = same ? [1, 1, 1] : g.tint.map((v, i) => clamp(v / g0.tint[i], 0.4, 1.6));
    (this.uni.uTint.value as THREE.Color).setRGB(tint[0], tint[1], tint[2]);
    this.uni.uExposure.value = same ? 1 : clamp(g.exp / g0.exp, 0.22, 1.6);
    this.uni.uSat.value = same ? 1 : clamp(g.sat / g0.sat, 0.35, 1.3);
    this.uni.uNight.value = same ? 0 : clamp((-s.sunAlt - 6) / 8, 0, 1) * 0.9;
    this.sunUp = s.sunAlt > 2;
    this.applyLife();
  }
  setWeather(w: HourWeather | null) {
    const ms = w ? w.wind / 3.6 : 2.5;
    this.wind = { speed: ms, dir: w?.windDir ?? 200 };
    this.uni.uWind.value = clamp(ms / 6, 0.18, 1.3);
    this.cloudPct = w?.cloud ?? 40;
    const code = w?.code ?? 0;
    const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
    const snow = (code >= 71 && code <= 77) || code === 85 || code === 86;
    const fog = code === 45 || code === 48;
    this.storm = code >= 95;
    this.uni.uHaze.value = fog ? 0.55 : rain ? 0.3 : this.cloudPct > 85 ? 0.18 : 0.1;
    (this.uni.uHazeCol.value as THREE.Color).setRGB(...((rain || fog || this.cloudPct > 80 ? [0.78, 0.8, 0.83] : [0.86, 0.88, 0.93]) as [number, number, number]));
    this.setParticles(rain ? 'rain' : snow ? 'snow' : null);
    this.applyLife();
  }
  /** то, что делает кадр живым, зависит от погоды и света */
  private applyLife() {
    const sunny = this.sunUp && this.cloudPct < 70;
    this.uni.uShadow.value = this.sunUp && this.cloudPct > 15 && this.cloudPct < 92 ? 0.16 : this.cloudPct >= 92 ? 0.05 : 0;
    this.uni.uDapple.value = sunny ? 1 : 0.25;
    this.uni.uCloud.value = this.cloudPct > 8 ? 1 : 0.3;
    // частицы по сезону и свету, если нет осадков
    if (!this.rain && (!this.particles || this.particles.kind !== 2)) {
      if (this.fall()) this.setParticles('leaves');
      else if (this.sunUp && this.m.vegShare > 0.05) this.setParticles('motes');
      else this.setParticles(null);
    }
  }

  /** листопад: осень по дате и полушарию, много жёлто-оранжевой листвы и не контровой закат */
  private fall() {
    const mo = +this.o.ctx.local.slice(5, 7);
    const autumn = this.o.ctx.lat >= 0 ? mo >= 9 && mo <= 11 : mo >= 3 && mo <= 5;
    return autumn && this.m.autumn > 0.5 && this.m.vegShare > 0.3 && !this.o.layers.sun;
  }

  private setParticles(kind: 'rain' | 'snow' | 'leaves' | 'motes' | null) {
    const leaf = this.m.leaf;
    const want = kind === 'snow' ? 2 : kind === 'leaves' ? 1 : kind === 'motes' ? 0 : -1;
    if (kind === 'rain') {
      if (this.particles) this.dropParticles();
      if (!this.rain) this.makeRain();
      return;
    }
    if (this.rain) {
      this.scene.remove(this.rain.seg);
      this.rain.seg.geometry.dispose();
      this.rain = null;
    }
    if (this.particles?.kind === want) return;
    this.dropParticles();
    if (want < 0) return;
    const N = want === 2 ? 700 : want === 1 ? 46 : 70;
    const pos = new Float32Array(N * 3),
      vel = new Float32Array(N * 3),
      size = new Float32Array(N),
      seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const z = -2 - Math.random() * 14;
      pos[i * 3] = (Math.random() * 2 - 1) * this.tanH * -z;
      pos[i * 3 + 1] = (Math.random() * 2 - 1) * this.tanV * -z;
      pos[i * 3 + 2] = z;
      seed[i] = Math.random();
      size[i] = want === 2 ? 0.05 + Math.random() * 0.07 : want === 1 ? 0.08 + Math.random() * 0.07 : 0.02 + Math.random() * 0.025;
      vel[i * 3] = (Math.random() - 0.5) * 0.1;
      vel[i * 3 + 1] = want === 2 ? -0.45 - Math.random() * 0.4 : want === 1 ? -0.35 - Math.random() * 0.3 : (Math.random() - 0.5) * 0.05;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const col = want === 2 ? [1, 1, 1] : want === 1 ? [clamp(leaf[0] * 1.15, 0, 1), clamp(leaf[1] * 0.95, 0, 1), clamp(leaf[2] * 0.7, 0, 1)] : [1, 0.93, 0.74];
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(col[0], col[1], col[2]) }, uKind: { value: want }, uTime: this.uni.uTime, uTint: this.uni.uTint, uExposure: this.uni.uExposure, uAlpha: { value: want === 0 ? 0.32 : 0.95 }, uScale: { value: (this.container.clientHeight || 800) * 0.9 } },
      vertexShader: PVERT,
      fragmentShader: PFRAG,
      transparent: true,
      depthWrite: false,
      blending: want === 0 ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    this.scene.add(pts);
    this.particles = { pts, vel, kind: want };
  }
  private dropParticles() {
    if (!this.particles) return;
    this.scene.remove(this.particles.pts);
    this.particles.pts.geometry.dispose();
    (this.particles.pts.material as THREE.Material).dispose();
    this.particles = null;
  }
  private makeRain() {
    const N = 1100;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.respawnDrop(pos, i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const seg = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.42, depthWrite: false }));
    seg.frustumCulled = false;
    seg.renderOrder = 3;
    this.scene.add(seg);
    this.rain = { seg, pos };
  }
  private respawnDrop(p: Float32Array, i: number, any: boolean) {
    const z = -1.5 - Math.random() * 14;
    const x = (Math.random() * 2 - 1) * this.tanH * -z * 1.1;
    const y = any ? (Math.random() * 2 - 1) * this.tanV * -z : this.tanV * -z * 1.1;
    const len = 0.25 + Math.random() * 0.2;
    p.set([x, y, z, x + this.windX() * 0.03, y - len, z], i * 6);
  }
  private windX() {
    // ветер «откуда дует» → вбок в кадре (направление съёмки неизвестно точно — берём проекцию)
    const rel = ((this.wind.dir - (this.o.ctx.heading ?? 0)) * Math.PI) / 180;
    return -Math.sin(rel) * clamp(this.wind.speed, 0, 12);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    this.uni.uTime.value = t;
    // облака плывут по ветру
    const drift = this.uni.uDrift.value as THREE.Vector2;
    drift.x += dt * (0.004 + this.wind.speed * 0.0016) * Math.sign(this.windX() || 1);
    drift.y += dt * 0.0012;
    // сглаженное движение к цели + «дыхание» камеры
    const e = 1 - Math.exp(-dt * 3.2);
    for (const k of ['yaw', 'pitch', 'x', 'y'] as const) this.cur[k] += (this.aim[k] - this.cur[k]) * e;
    const bx = Math.sin(t * 0.31) * 0.04 + Math.sin(t * 0.17) * 0.025,
      by = Math.sin(t * 0.23 + 1.3) * 0.02,
      bz = Math.sin(t * 0.11) * 0.1 - 0.06;
    this.camera.position.set(bx + this.cur.x * 0.11, by + this.cur.y * 0.06, bz);
    this.camera.rotation.set(this.cur.pitch, this.cur.yaw, 0, 'YXZ');
    // частицы
    const P = this.particles;
    if (P) {
      const a = P.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = a.array as Float32Array;
      const wx = this.windX() * (P.kind === 0 ? 0.004 : 0.03);
      for (let i = 0; i < p.length / 3; i++) {
        const sx = Math.sin(t * (0.7 + (i % 7) * 0.13) + i) * (P.kind === 0 ? 0.03 : 0.25);
        p[i * 3] += (P.vel[i * 3] + wx + sx * 0.4) * dt;
        p[i * 3 + 1] += P.vel[i * 3 + 1] * dt + (P.kind === 0 ? Math.cos(t * 0.5 + i) * 0.02 * dt : 0);
        p[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
        const z = p[i * 3 + 2];
        const hx = this.tanH * -z * 1.15,
          hy = this.tanV * -z * 1.15;
        if (p[i * 3 + 1] < -hy) p[i * 3 + 1] = hy;
        if (p[i * 3 + 1] > hy) p[i * 3 + 1] = -hy;
        if (p[i * 3] > hx) p[i * 3] = -hx;
        if (p[i * 3] < -hx) p[i * 3] = hx;
      }
      a.needsUpdate = true;
    }
    if (this.rain) {
      const p = this.rain.pos;
      const fall = 9 * dt,
        side = this.windX() * 0.03 * dt * 9;
      for (let i = 0; i < p.length / 6; i++) {
        p[i * 6 + 1] -= fall;
        p[i * 6 + 4] -= fall;
        p[i * 6] += side;
        p[i * 6 + 3] += side;
        if (p[i * 6 + 4] < -this.tanV * -p[i * 6 + 2] * 1.1) this.respawnDrop(p, i, false);
      }
      (this.rain.seg.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
    // гроза: вспышки
    if (this.storm) {
      this.nextFlash -= dt;
      if (this.nextFlash < 0) {
        this.flash = 0.5;
        this.nextFlash = 5 + Math.random() * 9;
        setTimeout(() => this.onThunder?.(), 600 + Math.random() * 1500);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
    this.uni.uFlash.value = this.flash * (0.5 + 0.5 * Math.sin(t * 60));
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.dropParticles();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.ShaderMaterial | undefined;
      if (mat) {
        (mat.uniforms?.uMap?.value as THREE.Texture | undefined)?.dispose();
        mat.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** свет часа по высоте солнца: экспозиция, оттенок, насыщенность */
function grade(alt: number) {
  if (alt > 25) return { exp: 1, tint: [1, 1, 1], sat: 1 };
  if (alt > 8) {
    const k = (alt - 8) / 17;
    return { exp: 0.96 + 0.04 * k, tint: [1.05 - 0.05 * k, 1, 0.92 + 0.08 * k], sat: 1.05 };
  }
  if (alt > 0) {
    const k = alt / 8;
    return { exp: 0.86 + 0.1 * k, tint: [1.12 - 0.07 * k, 0.96 + 0.04 * k, 0.8 + 0.12 * k], sat: 1.1 };
  }
  if (alt > -6) {
    const k = (alt + 6) / 6;
    return { exp: 0.55 + 0.31 * k, tint: [0.95 + 0.17 * k, 0.86 + 0.1 * k, 1.0 - 0.2 * k], sat: 0.85 + 0.25 * k };
  }
  if (alt > -12) {
    const k = (alt + 12) / 6;
    return { exp: 0.32 + 0.23 * k, tint: [0.62 + 0.33 * k, 0.72 + 0.14 * k, 1], sat: 0.55 + 0.3 * k };
  }
  return { exp: 0.3, tint: [0.6, 0.7, 1], sat: 0.5 };
}
