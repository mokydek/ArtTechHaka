import * as THREE from 'three';
import type { SceneLayers } from './depth';
import type { HourWeather, ShotContext, SkyState } from './context';
import { buildLand, type Land } from './land';
import type { OsmWorld } from './osm';
import { readScene, type RGB, type SceneTags } from './tags';

/**
 * «Побывать там»: снимок — окно в тот момент, а вокруг достроен мир, по которому можно ходить.
 * В точке съёмки видно ровно фото (объёмное, живое: ветер, облака, свет минуты, наклон телефона).
 * Повернёшься или шагнёшь — снимок мягко растворяется, и вокруг продолжение: настоящие дома и улицы
 * из OpenStreetMap, если место известно, или условный мир по тому, что на фото (улица, парк, поле,
 * лес, снег, комната), в его красках и текстурах.
 */

export interface MomentOpts {
  osm?: OsmWorld | null; // настоящие дома и улицы вокруг, если место известно
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
uniform float uOpacity;
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
  // мягкие края: снимок растворяется в достроенном мире вокруг
  float fe = smoothstep(0.0, 0.07, vUv.x) * smoothstep(0.0, 0.07, 1.0 - vUv.x) * smoothstep(0.0, 0.07, vUv.y) * smoothstep(0.0, 0.07, 1.0 - vUv.y);
  gl_FragColor = vec4(col, c.a * fe * uOpacity);
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

/**
 * Кромка неба у силуэта (2 клетки) стоит на глубине силуэта и двигается вместе с ним.
 * Она того же цвета, что и небо за ней, — поэтому край дома или дерева остаётся цельным, без ступенек,
 * а растяжка уходит в само небо, где однотонный цвет тянется незаметно.
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

const EYE = 1.6;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main(){
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uLow;
uniform vec3 uBelow;
uniform vec3 uSunDir;
uniform float uSunUp;
uniform float uCloudAmt;
uniform vec3 uCloudCol;
uniform vec2 uDrift;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;
${NOISE}
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uLow, uTop, smoothstep(0.0, 0.6, h));
  float sd = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.88, 0.66) * (pow(sd, 1400.0) * 4.0 + pow(sd, 10.0) * 0.16) * uSunUp;
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.3 + uDrift * 10.0;
    float n = fbm(uv);
    float c = smoothstep(1.02 - uCloudAmt * 0.75, 1.1, n + 0.32) * smoothstep(0.0, 0.2, h);
    col = mix(col, uCloudCol * (0.85 + n * 0.3), c * 0.9);
    vec2 q = vec2(atan(d.x, d.z) * 110.0, h * 160.0);
    vec2 g = floor(q);
    float s = hash(g);
    float st = step(0.994, s) * smoothstep(0.32, 0.0, length(fract(q) - 0.5)) * (0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 50.0));
    col += vec3(st) * uNight * (1.0 - c);
  }
  col = mix(uBelow, col, smoothstep(-0.06, 0.015, h));
  gl_FragColor = vec4(col, 1.0);
}`;

/** небо без снимка: цвета по высоте солнца */
function skyPalette(alt: number): { top: RGB; low: RGB } {
  if (alt > 12) return { top: [0.33, 0.52, 0.82], low: [0.72, 0.8, 0.9] };
  if (alt > 0) return { top: [0.36, 0.5, 0.75], low: [0.96, 0.76, 0.55] };
  if (alt > -6) return { top: [0.22, 0.27, 0.46], low: [0.86, 0.56, 0.46] };
  if (alt > -12) return { top: [0.08, 0.1, 0.22], low: [0.24, 0.24, 0.36] };
  return { top: [0.025, 0.035, 0.08], low: [0.07, 0.08, 0.13] };
}

export class Moment {
  readonly renderer: THREE.WebGLRenderer;
  private world = new THREE.Scene();
  private panel = new THREE.Scene();
  private fx = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 3000);
  private uni: Uniforms;
  private domeU: Uniforms;
  private dome: THREE.Mesh;
  private hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  private sun = new THREE.DirectionalLight(0xffffff, 1);
  private fog = new THREE.FogExp2(0xcccccc, 0.004);
  private raf = 0;
  private t0 = performance.now();
  private last = performance.now();
  private tanV: number;
  private tanH: number;
  private coverFov = 50;
  private walkFov = 62;
  private pitch0: number;
  private photo = new THREE.Group();
  private land: Land;
  // взгляд: цель и сглаженное текущее; наклон телефона и мышь — добавки рядом со снимком
  private aim = { yaw: 0, pitch: 0 };
  private cur = { yaw: 0, pitch: 0 };
  private leanAim = { x: 0, y: 0 };
  private leanCur = { x: 0, y: 0 };
  private tiltAim = { yaw: 0, pitch: 0 };
  private tiltCur = { yaw: 0, pitch: 0 };
  private gyro0: { b: number; g: number } | null = null;
  private pos = { x: 0, z: 0 };
  private homing = false;
  private keys = new Set<string>();
  /** джойстик: x — вбок, z — назад (как экран) */
  move = { x: 0, z: 0 };
  private wind = { speed: 0.4, dir: 0 };
  private particles: { pts: THREE.Points; vel: Float32Array; kind: number; R: number } | null = null;
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
  readonly tags: SceneTags;
  /** мир собран по OpenStreetMap */
  osm = false;
  private seed = 7;
  private lastSky: SkyState | null = null;
  private heading: number;
  readonly info: { scale: number; pitch0: number };
  onThunder?: () => void;

  constructor(container: HTMLElement, o: MomentOpts) {
    this.container = container;
    this.o = o;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // цвета снимка как есть, без пересчёта
    this.renderer.setClearColor(0x0b0d12);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.photoSky = o.sky;
    this.heading = o.ctx.heading;
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
      uOpacity: { value: 1 },
    };
    this.m = masks(L, o.photo);
    const mo = +o.ctx.local.slice(5, 7);
    this.tags = readScene(L, o.photo, { month: mo, south: o.ctx.lat < 0, temp: o.weather?.temp, sunUp: o.sky.sunAlt > 0 });

    // ---- снимок: окно в тот момент, стоит в точке съёмки ----
    const { gw, gh } = L;
    const dist = (depth: Float32Array, sky: Uint8Array, push: number) => Float32Array.from(depth, (d, i) => this.dist(d, !!sky[i]) * push);
    const front = haloSky(dist(L.depthRaw, this.m.sky, 1), this.m.sky, gw, gh);
    this.photo.add(this.layer({ gw, gh, dist: front, sky: this.m.sky, veg: this.m.veg, map: this.texture(toCanvas(o.photo, 2048)), order: 0 }));
    this.pitch0 = clamp(-Math.atan((1 - 2 * L.horizon) * this.tanV), -0.45, 0.45);
    // масштаб: земля у нижнего края снимка ложится на землю мира (глаза на высоте 1,6 м)
    const ys: number[] = [];
    const cp = Math.cos(this.pitch0),
      sp = Math.sin(this.pitch0);
    for (let y = Math.floor(gh * 0.9); y < gh; y++)
      for (let x = Math.floor(gw * 0.25); x < gw * 0.75; x++) {
        const i = y * gw + x;
        if (this.m.sky[i]) continue;
        const d = front[i],
          ly = (1 - (y / (gh - 1)) * 2) * this.tanV * d,
          lz = -d;
        ys.push(ly * cp - lz * sp);
      }
    ys.sort((a, b) => a - b);
    const med = ys.length ? ys[Math.floor(ys.length / 2)] : -1;
    const scale = med < -0.05 ? clamp(EYE / -med, 0.25, 6) : 1;
    this.photo.position.set(0, EYE, 0);
    this.photo.rotation.set(this.pitch0, 0, 0);
    this.photo.scale.setScalar(scale);
    this.panel.add(this.photo);
    this.info = { scale, pitch0: this.pitch0 };
    this.aim.pitch = this.cur.pitch = this.pitch0;

    // ---- мир вокруг: продолжение за рамкой ----
    let seed = 7;
    for (const ch of o.ctx.local + o.ctx.place) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    this.seed = seed;
    this.land = buildLand(this.tags, { seed, snowy: this.tags.ground === 'snow', hHalf: Math.atan(this.tanH) });
    this.world.add(this.land.group);
    if (o.osm) this.applyOsm(o.osm);
    this.domeU = {
      uTop: { value: new THREE.Color() },
      uLow: { value: new THREE.Color() },
      uBelow: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunUp: { value: 1 },
      uCloudAmt: { value: 0.4 },
      uCloudCol: { value: new THREE.Color(1, 1, 1) },
      uDrift: this.uni.uDrift,
      uNight: { value: 0 },
      uTime: this.uni.uTime,
    };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.ShaderMaterial({ uniforms: this.domeU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }));
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    this.dome.visible = this.tags.kind !== 'indoor';
    this.world.add(this.dome, this.hemi, this.sun, this.sun.target);
    this.world.fog = this.tags.kind === 'indoor' ? null : this.fog;

    this.setWeather(o.weather);
    this.setSky(o.sky);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    window.addEventListener('blur', this.onBlur);
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
  private layer(o: { gw: number; gh: number; dist: Float32Array; sky: Uint8Array; veg: Float32Array; map: THREE.Texture; order: number }) {
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
        // край сетки вытянут наружу: это поле, где снимок растворяется в мире
        const ue = x === 0 ? -EXT : x === gw - 1 ? 1 + EXT : u,
          ve = y === 0 ? -EXT : y === gh - 1 ? 1 + EXT : v;
        pos[i * 3] = (ue * 2 - 1) * this.tanH * d;
        pos[i * 3 + 1] = (1 - ve * 2) * this.tanV * d;
        pos[i * 3 + 2] = -d;
        uv[i * 2] = ue;
        uv[i * 2 + 1] = 1 - ve;
      }
    const idx: number[] = [];
    for (let y = 0; y < gh - 1; y++)
      for (let x = 0; x < gw - 1; x++) {
        const a = y * gw + x;
        idx.push(a, a + gw, a + 1, a + 1, a + gw, a + gw + 1);
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
      transparent: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = o.order;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Настоящее место пришло (OpenStreetMap): пересобираем мир вокруг — если координаты точные (GPS)
   * или снимок городской. Природу и комнаты дорисовываем сами.
   */
  applyOsm(osm: OsmWorld): boolean {
    const k = this.tags.kind;
    if (k === 'indoor' || !(this.o.ctx.source.place === 'gps' || k === 'city' || k === 'park')) return false;
    const land = buildLand(this.tags, { seed: this.seed, snowy: this.tags.ground === 'snow', hHalf: Math.atan(this.tanH), osm });
    this.world.remove(this.land.group);
    this.disposeTree(this.land.group);
    this.land = land;
    this.world.add(land.group);
    this.heading = osm.heading;
    this.osm = true;
    if (this.lastSky) this.setSky(this.lastSky);
    if (this.blocked(this.pos.x, this.pos.z)) this.pos = { x: 0, z: 0 };
    return true;
  }
  private disposeTree(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
      for (const mat of mats) {
        const mm = mat as THREE.MeshLambertMaterial;
        mm.map?.dispose();
        mm.emissiveMap?.dispose();
        mat.dispose();
      }
    });
  }

  /** у снимка — кадр во весь экран; когда отходишь от точки съёмки, взгляд становится шире */
  private resize() {
    const w = this.container.clientWidth || 1,
      h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const av = w / h;
    let tv = this.tanV / ZOOM;
    if (tv * av > this.tanH / ZOOM) tv = this.tanH / ZOOM / av;
    this.coverFov = clamp((2 * Math.atan(tv) * 180) / Math.PI, 34, 80);
    this.walkFov = av < 0.8 ? 70 : 60;
    this.camera.aspect = av;
    this.camera.updateProjectionMatrix();
    const pm = this.particles?.pts.material as THREE.ShaderMaterial | undefined;
    if (pm) pm.uniforms.uScale.value = h * 0.9;
  }

  /** палец или мышь: тянешь — оглядываешься (по кругу, без ограничений по сторонам) */
  look(dx: number, dy: number) {
    const k = 0.0034;
    this.homing = false;
    this.aim.yaw += dx * k;
    this.aim.pitch = clamp(this.aim.pitch + dy * k, -1.25, 1.25);
  }
  /** мышь над кадром: сдвиг точки взгляда (параллакс), -1..1 */
  lean(nx: number, ny: number) {
    this.leanAim.x = clamp(nx, -1, 1);
    this.leanAim.y = clamp(ny, -1, 1);
  }
  /** наклон телефона: заглянуть за предметы и чуть повернуть взгляд */
  tilt(beta: number, gamma: number) {
    if (!this.gyro0) this.gyro0 = { b: beta, g: gamma };
    // точка отсчёта медленно подстраивается под то, как держат телефон
    this.gyro0.b += (beta - this.gyro0.b) * 0.004;
    this.gyro0.g += (gamma - this.gyro0.g) * 0.004;
    const db = clamp(beta - this.gyro0.b, -25, 25),
      dg = clamp(gamma - this.gyro0.g, -25, 25);
    this.leanAim.x = dg / 25;
    this.leanAim.y = -db / 25;
    this.tiltAim.yaw = ((-dg * Math.PI) / 180) * 0.5;
    this.tiltAim.pitch = ((db * Math.PI) / 180) * 0.35;
  }
  /** вернуться в точку съёмки и смотреть как на фото */
  reset() {
    this.homing = true;
    this.leanAim = { x: 0, y: 0 };
    this.tiltAim = { yaw: 0, pitch: 0 };
    this.gyro0 = null;
  }
  /** сколько прошли от точки съёмки, м */
  get away() {
    return Math.hypot(this.pos.x, this.pos.z);
  }

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const k = e.code;
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(k)) return;
    e.preventDefault();
    if (e.type === 'keydown') {
      this.keys.add(k);
      this.homing = false;
    } else this.keys.delete(k);
  };
  private onBlur = () => this.keys.clear();

  /** небо и свет выбранной минуты относительно минуты снимка */
  setSky(s: SkyState) {
    this.lastSky = s;
    const g = grade(s.sunAlt),
      g0 = grade(this.photoSky.sunAlt);
    const same = Math.abs(s.sunAlt - this.photoSky.sunAlt) < 0.5;
    const tint = same ? [1, 1, 1] : g.tint.map((v, i) => clamp(v / g0.tint[i], 0.4, 1.6));
    const E = same ? 1 : clamp(g.exp / g0.exp, 0.22, 1.6);
    (this.uni.uTint.value as THREE.Color).setRGB(tint[0], tint[1], tint[2]);
    this.uni.uExposure.value = E;
    this.uni.uSat.value = same ? 1 : clamp(g.sat / g0.sat, 0.35, 1.3);
    const night = clamp((-s.sunAlt - 6) / 8, 0, 1);
    this.uni.uNight.value = same ? 0 : night * 0.9;
    this.sunUp = s.sunAlt > 2;

    // небо мира: цвета неба самого снимка в свете выбранной минуты (или по высоте солнца, если неба на фото нет)
    const C = this.tags.colors;
    const pal = skyPalette(s.sunAlt);
    const gr = (c: RGB): RGB => [c[0] * tint[0] * E, c[1] * tint[1] * E, c[2] * tint[2] * E];
    const top = C.skyTop ? gr(C.skyTop) : pal.top;
    const low = C.skyLow ? gr(C.skyLow) : pal.low;
    (this.domeU.uTop.value as THREE.Color).setRGB(...top);
    (this.domeU.uLow.value as THREE.Color).setRGB(...low);
    const fogC = new THREE.Color(...low).lerp(new THREE.Color(...top), 0.15);
    this.fog.color.copy(fogC);
    (this.domeU.uBelow.value as THREE.Color).copy(fogC);
    this.domeU.uNight.value = night;
    const rel = ((s.sunAz - this.heading) * Math.PI) / 180,
      alt = (s.sunAlt * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(rel) * Math.cos(alt), Math.sin(alt), -Math.cos(rel) * Math.cos(alt));
    (this.domeU.uSunDir.value as THREE.Vector3).copy(dir);
    this.domeU.uSunUp.value = clamp((s.sunAlt + 1) / 4, 0, 1) * (1 - clamp((this.cloudPct - 60) / 35, 0, 1));
    (this.domeU.uCloudCol.value as THREE.Color).setRGB(...(gr(C.skyLow ? [Math.min(1, C.skyLow[0] * 1.15), Math.min(1, C.skyLow[1] * 1.15), Math.min(1, C.skyLow[2] * 1.12)] : [0.92, 0.92, 0.94]) as RGB));
    // свет мира — настоящий свет этой минуты: днём светло, ночью темно, горят окна и фонари
    const ga = grade(s.sunAlt);
    // в комнате вечером горит свет — темнее, чем днём, но не темнота
    const amb = this.tags.kind === 'indoor' ? Math.max(0.5, 0.62 * ga.exp) : 0.56 * ga.exp + (this.sunUp ? 0 : 0.03),
      sunI = this.sunUp ? 0.56 * ga.exp * Math.max(0, Math.sin(alt)) * (this.cloudPct > 85 ? 0.35 : 1) : 0;
    this.hemi.color.setRGB(ga.tint[0], ga.tint[1], ga.tint[2]);
    this.hemi.groundColor.setRGB(ga.tint[0] * 0.62, ga.tint[1] * 0.6, ga.tint[2] * 0.58);
    this.hemi.intensity = Math.PI * amb;
    this.hemi.userData.base = this.hemi.intensity;
    this.sun.color.setRGB(Math.min(1.3, ga.tint[0] * 1.05), ga.tint[1], ga.tint[2] * 0.92);
    this.sun.intensity = Math.PI * sunI;
    this.sun.position.copy(dir).multiplyScalar(200);
    this.land.setNight(clamp((-s.sunAlt + 1) / 7, 0, 1));
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
    this.domeU.uCloudAmt.value = clamp(this.cloudPct / 100, 0.05, 1);
    const k = this.tags.kind;
    this.fog.density = fog ? 0.03 : snow ? 0.012 : rain ? 0.01 : k === 'nature' && this.tags.veg > 0.25 ? 0.006 : k === 'city' ? 0.0045 : 0.0035;
    this.setParticles(rain ? 'rain' : snow ? 'snow' : null);
    this.applyLife();
  }

  /** то, что делает кадр живым, зависит от погоды и света */
  private applyLife() {
    const sunny = this.sunUp && this.cloudPct < 70;
    this.uni.uShadow.value = this.sunUp && this.cloudPct > 15 && this.cloudPct < 92 ? 0.16 : this.cloudPct >= 92 ? 0.05 : 0;
    this.uni.uDapple.value = sunny ? 1 : 0.25;
    this.uni.uCloud.value = this.cloudPct > 8 ? 1 : 0.3;
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

  /** частицы живут в мире вокруг идущего: снег, листья, пылинки в солнце */
  private setParticles(kind: 'rain' | 'snow' | 'leaves' | 'motes' | null) {
    const leaf = this.m.leaf;
    const want = kind === 'snow' ? 2 : kind === 'leaves' ? 1 : kind === 'motes' ? 0 : -1;
    if (kind === 'rain') {
      if (this.particles) this.dropParticles();
      if (!this.rain) this.makeRain();
      return;
    }
    if (this.rain) {
      this.fx.remove(this.rain.seg);
      this.rain.seg.geometry.dispose();
      this.rain = null;
    }
    if (this.particles?.kind === want) return;
    this.dropParticles();
    if (want < 0) return;
    const N = want === 2 ? 1400 : want === 1 ? 90 : 120;
    const R = want === 0 ? 7 : 16;
    const pos = new Float32Array(N * 3),
      vel = new Float32Array(N * 3),
      size = new Float32Array(N),
      seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = this.pos.x + (Math.random() * 2 - 1) * R;
      pos[i * 3 + 1] = want === 0 ? 0.3 + Math.random() * 3 : Math.random() * 12;
      pos[i * 3 + 2] = this.pos.z + (Math.random() * 2 - 1) * R;
      seed[i] = Math.random();
      size[i] = want === 2 ? 0.05 + Math.random() * 0.07 : want === 1 ? 0.08 + Math.random() * 0.07 : 0.02 + Math.random() * 0.025;
      vel[i * 3] = (Math.random() - 0.5) * 0.1;
      vel[i * 3 + 1] = want === 2 ? -0.6 - Math.random() * 0.5 : want === 1 ? -0.5 - Math.random() * 0.4 : (Math.random() - 0.5) * 0.05;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
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
    this.fx.add(pts);
    this.particles = { pts, vel, kind: want, R };
  }
  private dropParticles() {
    if (!this.particles) return;
    this.fx.remove(this.particles.pts);
    this.particles.pts.geometry.dispose();
    (this.particles.pts.material as THREE.Material).dispose();
    this.particles = null;
  }
  private makeRain() {
    const N = 1600;
    const pos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.respawnDrop(pos, i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const seg = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.4, depthWrite: false }));
    seg.frustumCulled = false;
    this.fx.add(seg);
    this.rain = { seg, pos };
  }
  private respawnDrop(p: Float32Array, i: number, any: boolean) {
    const x = this.pos.x + (Math.random() * 2 - 1) * 13,
      z = this.pos.z + (Math.random() * 2 - 1) * 13;
    const y = any ? Math.random() * 13 : 13;
    const len = 0.35 + Math.random() * 0.25;
    const w = this.windVec();
    p.set([x, y, z, x + w.x * 0.03, y - len, z + w.z * 0.03], i * 6);
  }
  /** ветер «откуда дует» → куда сносит, в осях мира (вперёд — направление съёмки) */
  private windVec() {
    const rel = ((this.wind.dir + 180 - this.heading) * Math.PI) / 180;
    const s = clamp(this.wind.speed, 0, 12);
    return { x: Math.sin(rel) * s, z: -Math.cos(rel) * s };
  }

  private blocked(x: number, z: number) {
    if (Math.hypot(x, z) > this.land.radius) return true;
    for (const c of this.land.colliders) if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true;
    return !!this.land.solid?.(x, z);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const t = (now - this.t0) / 1000;
    this.uni.uTime.value = t;
    const W = this.windVec();
    const drift = this.uni.uDrift.value as THREE.Vector2;
    drift.x += dt * (0.004 + this.wind.speed * 0.0016) * Math.sign(W.x || 1);
    drift.y += dt * 0.0012;

    // ходьба
    const k = this.keys;
    let mx = this.move.x + (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let mz = this.move.z + (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    if (ml > 0.02) this.homing = false;
    const speed = k.has('ShiftLeft') || k.has('ShiftRight') ? 4.5 : 1.7;
    const yaw = this.cur.yaw;
    const fx = -Math.sin(yaw),
      fz = -Math.cos(yaw);
    const nx = this.pos.x + (fx * -mz + Math.cos(yaw) * mx) * speed * dt,
      nz2 = this.pos.z + (fz * -mz - Math.sin(yaw) * mx) * speed * dt;
    if (!this.blocked(nx, this.pos.z)) this.pos.x = nx;
    if (!this.blocked(this.pos.x, nz2)) this.pos.z = nz2;
    if (this.homing) {
      const h = 1 - Math.exp(-dt * 2.4);
      this.pos.x += (0 - this.pos.x) * h;
      this.pos.z += (0 - this.pos.z) * h;
      const turns = Math.round(this.aim.yaw / (Math.PI * 2)) * Math.PI * 2;
      this.aim.yaw += (turns - this.aim.yaw) * h;
      this.aim.pitch += (this.pitch0 - this.aim.pitch) * h;
      if (this.away < 0.01 && Math.abs(turns - this.aim.yaw) < 0.002) this.homing = false;
    }

    // взгляд
    const e = 1 - Math.exp(-dt * 9);
    this.cur.yaw += (this.aim.yaw - this.cur.yaw) * e;
    this.cur.pitch += (this.aim.pitch - this.cur.pitch) * e;
    const e2 = 1 - Math.exp(-dt * 3.2);
    this.leanCur.x += (this.leanAim.x - this.leanCur.x) * e2;
    this.leanCur.y += (this.leanAim.y - this.leanCur.y) * e2;
    this.tiltCur.yaw += (this.tiltAim.yaw - this.tiltCur.yaw) * e2;
    this.tiltCur.pitch += (this.tiltAim.pitch - this.tiltCur.pitch) * e2;
    // рядом с точкой съёмки — снимок; отходишь — он растворяется в мире, а взгляд становится шире
    const o = 1 - smooth(0.2, 1.5, this.away);
    this.uni.uOpacity.value = o;
    const fov = this.walkFov + (this.coverFov - this.walkFov) * o;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    const bx = (Math.sin(t * 0.31) * 0.04 + Math.sin(t * 0.17) * 0.025) * o + this.leanCur.x * 0.11 * o,
      by = Math.sin(t * 0.23 + 1.3) * 0.02 * o + this.leanCur.y * 0.06 * o + (ml > 0.02 ? Math.sin(t * 9) * 0.025 : 0),
      bz = (Math.sin(t * 0.11) * 0.1 - 0.06) * o;
    const cy = Math.cos(yaw),
      sy = Math.sin(yaw);
    this.camera.position.set(this.pos.x + bx * cy + bz * sy, EYE + this.land.height(this.pos.x, this.pos.z) + by, this.pos.z - bx * sy + bz * cy);
    this.camera.rotation.set(this.cur.pitch + this.tiltCur.pitch, this.cur.yaw + this.tiltCur.yaw, 0, 'YXZ');
    this.dome.position.copy(this.camera.position);

    // частицы вокруг идущего
    const P = this.particles;
    if (P) {
      const a = P.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = a.array as Float32Array;
      const wk = P.kind === 0 ? 0.03 : 0.25;
      const cx = this.pos.x,
        cz = this.pos.z,
        R = P.R;
      for (let i = 0; i < p.length / 3; i++) {
        const sx = Math.sin(t * (0.7 + (i % 7) * 0.13) + i) * (P.kind === 0 ? 0.03 : 0.25);
        p[i * 3] += (P.vel[i * 3] + W.x * wk * 0.12 + sx * 0.4) * dt;
        p[i * 3 + 1] += P.vel[i * 3 + 1] * dt + (P.kind === 0 ? Math.cos(t * 0.5 + i) * 0.02 * dt : 0);
        p[i * 3 + 2] += (P.vel[i * 3 + 2] + W.z * wk * 0.12) * dt;
        if (p[i * 3 + 1] < 0) p[i * 3 + 1] += P.kind === 0 ? 3.3 : 12;
        if (P.kind === 0 && p[i * 3 + 1] > 3.3) p[i * 3 + 1] -= 3;
        if (p[i * 3] - cx > R) p[i * 3] -= 2 * R;
        if (p[i * 3] - cx < -R) p[i * 3] += 2 * R;
        if (p[i * 3 + 2] - cz > R) p[i * 3 + 2] -= 2 * R;
        if (p[i * 3 + 2] - cz < -R) p[i * 3 + 2] += 2 * R;
      }
      a.needsUpdate = true;
    }
    if (this.rain) {
      const p = this.rain.pos;
      const fall = 9 * dt;
      for (let i = 0; i < p.length / 6; i++) {
        p[i * 6 + 1] -= fall;
        p[i * 6 + 4] -= fall;
        p[i * 6] += W.x * 0.03 * fall;
        p[i * 6 + 3] += W.x * 0.03 * fall;
        p[i * 6 + 2] += W.z * 0.03 * fall;
        p[i * 6 + 5] += W.z * 0.03 * fall;
        if (p[i * 6 + 4] < 0 || Math.abs(p[i * 6] - this.pos.x) > 14 || Math.abs(p[i * 6 + 2] - this.pos.z) > 14) this.respawnDrop(p, i, false);
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
    const fl = this.flash * (0.5 + 0.5 * Math.sin(t * 60));
    this.uni.uFlash.value = fl;
    this.hemi.intensity = (this.hemi.userData.base ?? this.hemi.intensity) + fl * Math.PI * 1.5;

    // мир, поверх — снимок (у него свои глубины), поверх — снег и дождь
    const r = this.renderer;
    r.clear();
    r.render(this.world, this.camera);
    if (o > 0.004) {
      r.clearDepth();
      r.render(this.panel, this.camera);
    }
    r.render(this.fx, this.camera);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    window.removeEventListener('blur', this.onBlur);
    this.dropParticles();
    for (const sc of [this.world, this.panel, this.fx])
      sc.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        const mats = (Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) as THREE.Material[];
        for (const mat of mats) {
          const u = (mat as THREE.ShaderMaterial).uniforms;
          (u?.uMap?.value as THREE.Texture | undefined)?.dispose();
          const mm = mat as THREE.MeshLambertMaterial;
          mm.map?.dispose();
          mm.emissiveMap?.dispose();
          mat.dispose();
        }
      });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

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
