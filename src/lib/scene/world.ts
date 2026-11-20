import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { SceneLayers } from './depth';
import type { HourWeather, ShotContext, SkyState } from './context';
import { drawMoon } from '../sky';

// «Побывать там»: кадр превращается в рельеф по глубине, небо и погода — как в тот час, можно ходить

const EYE = 1.6;
const RADIUS = 8; // насколько можно отойти от точки съёмки

export interface WorldOpts {
  layers: SceneLayers;
  ctx: ShotContext;
  weather: HourWeather | null;
  sky: SkyState;
  photoAspect: number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private sky = new Sky();
  private sun = new THREE.DirectionalLight(0xffffff, 2);
  private hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a3b2a, 0.6);
  private photoMats: THREE.MeshBasicMaterial[] = [];
  private shadowMat = new THREE.ShadowMaterial({ opacity: 0.35, depthWrite: false });
  private groundMat: THREE.MeshBasicMaterial;
  private groundCol: THREE.Color;
  private clouds: THREE.Mesh;
  private overcast: THREE.Mesh;
  private stars: THREE.Points;
  private moon: THREE.Sprite;
  private rain: THREE.LineSegments | null = null;
  private snow: THREE.Points | null = null;
  private drops: Float32Array | null = null;
  private flakes: Float32Array | null = null;
  private wind = new THREE.Vector3();
  private flash = 0;
  private nextFlash = 3;
  private storm = false;
  readonly pitch0: number; // наклон камеры, при котором вид совпадает с фото
  yaw = 0;
  pitch = 0;
  pos = new THREE.Vector3(0, EYE, 0);
  private keys = new Set<string>();
  move = { x: 0, z: 0 }; // джойстик
  private clock = new THREE.Timer();
  private raf = 0;
  private walked = 0;
  photoAlt: number;
  onFrame?: (heading: number) => void;
  onThunder?: () => void;

  private container: HTMLElement;
  private o: WorldOpts;

  constructor(container: HTMLElement, o: WorldOpts) {
    this.container = container;
    this.o = o;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    const L = o.layers;
    this.camera = new THREE.PerspectiveCamera(o.ctx.fovV, 1, 0.05, 4000);
    const tanV = Math.tan(((o.ctx.fovV / 2) * Math.PI) / 180);
    const cyh = (1 - 2 * L.horizon) * tanV;
    this.pitch0 = -Math.atan(cyh); // горизонт выше центра — камера смотрела чуть вниз
    this.pitch = this.pitch0;
    this.photoAlt = o.sky.sunAlt;

    // ——— небо ———
    this.sky.scale.setScalar(450000);
    this.scene.add(this.sky);
    this.clouds = this.makeClouds();
    this.clouds.visible = false; // облака рисует само небо (процедурные, с подсветкой солнцем)
    // сплошная облачность: ровная серая пелена под отдельными облаками
    this.overcast = new THREE.Mesh(
      new THREE.SphereGeometry(1900, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xb8bcc2, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false }),
    );
    this.overcast.renderOrder = -2;
    this.scene.add(this.overcast);
    this.stars = this.makeStars();
    this.scene.add(this.stars);
    this.moon = this.makeMoon();
    this.scene.add(this.moon);

    // ——— свет ———
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -25;
    sc.right = 25;
    sc.top = 25;
    sc.bottom = -25;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target, this.hemi);

    // ——— земля за пределами кадра ———
    this.groundCol = new THREE.Color(L.ground);
    this.groundMat = new THREE.MeshBasicMaterial({ color: this.groundCol.clone(), toneMapped: false });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(600, 64), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.03;
    // земля — подложка: ничего не заслоняет, поверх неё рисуются кадр и его продолжение
    this.groundMat.depthWrite = false;
    ground.renderOrder = -5;
    this.sky.renderOrder = -10;
    this.scene.add(ground);
    const shadowPlane = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), this.shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = 0.02;
    shadowPlane.receiveShadow = true;
    shadowPlane.renderOrder = 2;
    this.scene.add(shadowPlane);

    // ——— кадр: рельеф по глубине ———
    this.scene.add(this.photoMesh(L, tanV));
    const ring = this.ringMesh(L, tanV);
    if (ring) this.scene.add(ring);
    if (L.fg && L.fgBox) this.scene.add(this.subjectMesh(L, tanV));

    // ——— погода ———
    this.setWeather(o.weather);
    this.setSky(o.sky);

    window.addEventListener('keydown', this.kd);
    window.addEventListener('keyup', this.ku);
    this.resize();
    window.addEventListener('resize', this.resize);
    this.loop();
  }

  /** Луч из точки съёмки через пиксель (u,v) — в мировых координатах */
  private ray(u: number, v: number, tanV: number) {
    const tanH = tanV * this.o.photoAspect;
    const d = new THREE.Vector3((2 * u - 1) * tanH, (1 - 2 * v) * tanV, -1);
    d.applyAxisAngle(new THREE.Vector3(1, 0, 0), this.pitch0);
    return d;
  }

  private k = 1; // масштаб глубины, подогнанный под плоскость земли

  /** Расстояние вдоль луча: глубина нейросети, а ниже горизонта — плоскость земли, если они согласны */
  private dist(v: number, dpt: number, dir: THREE.Vector3, far: number) {
    const near = 1.4;
    let t = near * Math.exp(dpt * Math.log(far / near)) * dir.length() * this.k;
    const L = this.o.layers;
    if (dir.y < -0.002) {
      const tg = (EYE / -dir.y) * dir.length();
      // земля далеко за «глубиной» — значит, там стена или предмет: верим глубине
      const s = smooth(1.5, 2.8, tg / t);
      const tt = tg * (1 - s) + t * s;
      const w = smooth(L.horizon + 0.01, L.horizon + 0.18, v);
      t = Math.min(t * (1 - w) + tt * w, tg); // под землю не уходим
    }
    return Math.min(t, far * 1.8);
  }

  /** Подогнать масштаб глубины по нижней части кадра (обычно там земля) */
  private calibrate(L: SceneLayers, tanV: number, far: number) {
    const near = 1.4;
    const r: number[] = [];
    for (let y = Math.floor(L.gh * Math.max(L.horizon + 0.2, 0.7)); y < L.gh; y++)
      for (let x = 0; x < L.gw; x += 2) {
        const i = y * L.gw + x;
        if (L.sky[i]) continue;
        const dir = this.ray(x / (L.gw - 1), y / (L.gh - 1), tanV);
        if (dir.y > -0.02) continue;
        const t = near * Math.exp(L.depth[i] * Math.log(far / near));
        r.push(EYE / -dir.y / t);
      }
    if (r.length < 20) return 1;
    r.sort((a, b) => a - b);
    return Math.min(3, Math.max(0.5, r[Math.floor(r.length / 2)]));
  }

  private photoMesh(L: SceneLayers, tanV: number) {
    const hasSky = L.sky.some((s) => s);
    const far = hasSky ? 70 : 12;
    const { gw, gh } = L;
    this.k = this.calibrate(L, tanV, far);
    const pos = new Float32Array(gw * gh * 3);
    const uv = new Float32Array(gw * gh * 2);
    const col = new Float32Array(gw * gh * 4);
    const ts = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        const u = x / (gw - 1),
          v = y / (gh - 1);
        const dir = this.ray(u, v, tanV);
        const t = L.sky[i] ? far * 2 : this.dist(v, L.depth[i], dir, far);
        ts[i] = t;
        const n = dir.clone().normalize();
        const p = n.multiplyScalar(t);
        pos[i * 3] = p.x;
        pos[i * 3 + 1] = p.y + EYE;
        pos[i * 3 + 2] = p.z;
        uv[i * 2] = u;
        uv[i * 2 + 1] = 1 - v;
      }
    // разрывы глубины: такие вершины гасим, чтобы не было «резиновых» перепонок
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        let r = 1;
        for (const j of [x > 0 ? i - 1 : i, x < gw - 1 ? i + 1 : i, y > 0 ? i - gw : i, y < gh - 1 ? i + gw : i]) r = Math.max(r, ts[j] / ts[i], ts[i] / ts[j]);
        const u = x / (gw - 1);
        // края кадра растворяются, а не обрываются
        const edge = smooth(0, 0.035, u) * smooth(0, 0.035, 1 - u) * smooth(0, 0.03, y / (gh - 1));
        const a = (1 - smooth(1.3, 1.8, r)) * edge;
        col.set([1, 1, 1, a], i * 4);
      }
    const idx: number[] = [];
    for (let y = 0; y < gh - 1; y++)
      for (let x = 0; x < gw - 1; x++) {
        const a = y * gw + x,
          b = a + 1,
          c = a + gw,
          d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    const tex = new THREE.CanvasTexture(L.bg);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, toneMapped: false });
    this.photoMats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Объект стоит на земле там, где его «ноги», с лёгким рельефом и тенью от солнца */
  private subjectMesh(L: SceneLayers, tanV: number) {
    const b = L.fgBox!;
    const hasSky = L.sky.some((s) => s);
    const far = hasSky ? 70 : 12;
    // расстояние до объекта: по низу рамки (если ниже горизонта — на земле), иначе по глубине
    const footV = Math.min(0.995, b.y + b.h);
    const footDir = this.ray(b.x + b.w / 2, footV, tanV);
    const sampleD = (u: number, v: number) => L.depthRaw[Math.min(L.gh - 1, Math.round(v * (L.gh - 1))) * L.gw + Math.min(L.gw - 1, Math.round(u * (L.gw - 1)))];
    let ts = footDir.y < -0.01 ? (EYE / -footDir.y) * footDir.length() : this.dist(b.y + b.h / 2, sampleD(b.x + b.w / 2, b.y + b.h / 2), this.ray(b.x + b.w / 2, b.y + b.h / 2, tanV), far);
    ts = Math.min(ts, far * 0.6);
    let med = 0;
    for (let k = 0; k < 9; k++) med += sampleD(b.x + b.w * (0.3 + 0.2 * (k % 3)), b.y + b.h * (0.3 + 0.2 * Math.floor(k / 3)));
    med /= 9;
    const N = 48;
    const pos: number[] = [],
      uv: number[] = [],
      idx: number[] = [];
    const pad = 0.02;
    const x0 = Math.max(0, b.x - pad),
      y0 = Math.max(0, b.y - pad),
      x1 = Math.min(1, b.x + b.w + pad),
      y1 = Math.min(1, b.y + b.h + pad);
    for (let j = 0; j <= N; j++)
      for (let i = 0; i <= N; i++) {
        const u = x0 + ((x1 - x0) * i) / N,
          v = y0 + ((y1 - y0) * j) / N;
        const dir = this.ray(u, v, tanV).normalize();
        const relief = Math.max(-0.12, Math.min(0.12, (sampleD(u, v) - med) * 0.6));
        const p = dir.multiplyScalar(ts * (1 + relief));
        pos.push(p.x, p.y + EYE, p.z);
        uv.push(u, 1 - v);
      }
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const a = j * (N + 1) + i,
          bb = a + 1,
          c = a + N + 1,
          d = c + 1;
        idx.push(a, c, bb, bb, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const tex = new THREE.CanvasTexture(L.fg!);
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.15, side: THREE.DoubleSide, toneMapped: false });
    this.photoMats.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: tex, alphaTest: 0.5 });
    mesh.renderOrder = 3;
    return mesh;
  }


  /** Что за краями кадра: память достраивает — размытое зеркальное продолжение снимка по кругу */
  private ringMesh(L: SceneLayers, tanV: number) {
    const tanH = tanV * this.o.photoAspect;
    const hfov = 2 * Math.atan(tanH);
    const rest = Math.PI * 2 - hfov;
    let k = Math.max(1, Math.round((rest / hfov - 1) / 2) * 2 + 1); // нечётное: края совпадают с краями фото
    if (k > 9) k = 9;
    const W = 512,
      H = Math.round(W / this.o.photoAspect);
    const c = document.createElement('canvas');
    c.width = W * k;
    c.height = H;
    const g = c.getContext('2d')!;
    g.filter = `blur(${Math.round(W / 70)}px) saturate(0.75) brightness(0.92)`;
    for (let i = 0; i < k; i++) {
      g.save();
      if (i % 2 === 0) {
        g.translate(W * (i + 1), 0);
        g.scale(-1, 1);
        g.drawImage(L.bg, 0, 0, W, H);
      } else g.drawImage(L.bg, W * i, 0, W, H);
      g.restore();
    }
    g.filter = 'none';
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const R = L.sky.some((s) => s) ? 55 : 10;
    const cols = 24 * k,
      rows = 24;
    const pos: number[] = [],
      uv: number[] = [],
      col: number[] = [],
      idx: number[] = [];
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      const dir = this.ray(0.5, v, tanV);
      const el = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
      const y = EYE + R * Math.tan(Math.max(-1.2, Math.min(1.2, el)));
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        // от правого края кадра по часовой, с небольшим заходом под края снимка
        const lap = 0.07;
        const th = hfov / 2 - lap + (rest + 2 * lap) * u;
        pos.push(R * Math.sin(th), y, -R * Math.cos(th));
        uv.push(u, 1 - v);
        col.push(1, 1, 1, 1);
      }
    }
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i,
          b = a + 1,
          cc = a + cols + 1,
          d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, toneMapped: false, depthWrite: false });
    this.photoMats.push(m);
    const mesh = new THREE.Mesh(geo, m);
    mesh.renderOrder = 0;
    return mesh;
  }

  private makeClouds() {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 512;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, 1024, 512);
    // мягкие облака: много полупрозрачных пятен
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 420; i++) {
      const x = rnd() * 1024,
        y = 120 + Math.pow(rnd(), 0.7) * 300,
        r = 20 + rnd() * 90;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.22)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
      g.fillRect(x - r - 1024, y - r, r * 2, r * 2);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1800, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), m);
    mesh.renderOrder = -1;
    return mesh;
  }

  private makeStars() {
    const n = 1500;
    const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        e = Math.asin(Math.random());
      p.set([Math.cos(a) * Math.cos(e) * 1500, Math.sin(e) * 1500, Math.sin(a) * Math.cos(e) * 1500], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, toneMapped: false }));
  }

  private makeMoon() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d')!;
    const ph = this.o.sky.moonPhase;
    drawMoon(g, 64, 64, 56, { illum: this.o.sky.moonFrac, waxing: ph < 0.5 }, '#f4ecd2', 'rgba(20,24,40,0.15)');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false, toneMapped: false }));
    s.scale.setScalar(70);
    return s;
  }

  /** Направление на светило в мире: −Z — куда смотрела камера (компас ctx.heading) */
  private dir(az: number, alt: number) {
    const rel = ((az - this.o.ctx.heading) * Math.PI) / 180;
    const a = (alt * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(rel) * Math.cos(a), Math.sin(a), -Math.cos(rel) * Math.cos(a));
  }

  /** Небо, солнце, луна и свет для заданного момента */
  setSky(s: SkyState) {
    const w = this.o.weather;
    const cloud = (w?.cloud ?? 20) / 100;
    const sd = this.dir(s.sunAz, s.sunAlt);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(sd);
    u.turbidity.value = 2 + cloud * 12;
    u.rayleigh.value = 1.2 + (1 - cloud) * 1.5;
    u.mieCoefficient.value = 0.004 + cloud * 0.02;
    u.mieDirectionalG.value = 0.8;
    u.cloudCoverage.value = Math.min(1, cloud * 1.05);
    u.cloudDensity.value = 0.25 + cloud * 0.7;
    u.cloudElevation.value = 0.55;
    u.cloudSpeed.value = 0.00002 * (1 + (w?.wind ?? 8) / 15);
    const day = smooth(-8, 6, s.sunAlt);
    const golden = smooth(-2, 4, s.sunAlt) * (1 - smooth(8, 20, s.sunAlt));
    this.sun.position.copy(sd.clone().multiplyScalar(60)).add(new THREE.Vector3(0, 0, -8));
    this.sun.target.position.set(0, 0, -8);
    this.sun.intensity = 2.6 * day * (1 - cloud * 0.85);
    this.sun.color.setHSL(0.09, 0.6 * golden + 0.1, 0.6 + 0.3 * (1 - golden));
    this.sun.castShadow = s.sunAlt > 1;
    this.shadowMat.opacity = 0.42 * smooth(1, 8, s.sunAlt) * (1 - cloud * 0.9);
    this.hemi.intensity = 0.15 + 0.6 * day;
    this.renderer.toneMappingExposure = 0.35 + 0.25 * day;
    // облака: днём белые, в сумерках розовеют, ночью темнеют
    const cm = this.clouds.material as THREE.MeshBasicMaterial;
    cm.opacity = Math.min(1, 0.15 + cloud * 1.1);
    cm.color.setRGB(0.22 + 0.78 * day + golden * 0.05, 0.23 + 0.75 * day - golden * 0.12, 0.28 + 0.7 * day - golden * 0.3);
    const om = this.overcast.material as THREE.MeshBasicMaterial;
    const wet = !!w && (w.rain > 0.05 || w.snow > 0.01 || [45, 48, 51, 53, 55, 61, 63, 65, 71, 73, 75, 80, 81, 82, 95, 96, 99].includes(w.code));
    om.opacity = wet ? 0.55 + cloud * 0.3 : smooth(0.85, 1, cloud) * 0.45;
    om.color.setRGB(0.08 + 0.64 * day, 0.09 + 0.65 * day, 0.11 + 0.66 * day);
    // звёзды и луна
    (this.stars.material as THREE.PointsMaterial).opacity = (1 - smooth(-12, -2, s.sunAlt)) * (1 - cloud);
    const md = this.dir(s.moonAz, s.moonAlt);
    this.moon.position.copy(md.multiplyScalar(1400));
    (this.moon.material as THREE.SpriteMaterial).opacity = s.moonAlt > -2 ? (1 - day * 0.7) * (1 - cloud * 0.8) : 0;
    // туман и земля в тон неба
    const fogCol = new THREE.Color().setRGB(0.05 + 0.65 * day, 0.06 + 0.7 * day, 0.1 + 0.75 * day);
    if (golden > 0.1) fogCol.lerp(new THREE.Color(0.85, 0.6, 0.45), golden * 0.4);
    if (cloud > 0.6) fogCol.lerp(new THREE.Color(0.55 * day + 0.05, 0.57 * day + 0.05, 0.6 * day + 0.07), (cloud - 0.6) * 1.5);
    const code = w?.code ?? 0;
    const density = code === 45 || code === 48 ? 0.035 : w && (w.rain > 0.2 || w.snow > 0.05) ? 0.012 : 0.003 + cloud * 0.003;
    this.scene.fog = new THREE.FogExp2(fogCol, density);
    this.scene.background = fogCol;
    // фото подсвечиваем относительно того часа, когда оно снято
    const lum = (alt: number) => 0.18 + 0.82 * smooth(-8, 18, alt);
    const k = Math.max(0.2, Math.min(1.5, lum(s.sunAlt) / lum(this.photoAlt)));
    const warm = golden * 0.25;
    const night = 1 - day;
    const wetK = w && (w.rain > 0.05 || w.snow > 0.01) ? 0.08 : 0;
    const dull = (smooth(0.6, 1, cloud) * 0.12 + wetK) * day; // пасмурно и мокро — свет глуше и холоднее
    const tint = new THREE.Color(k * (1 + warm * 0.3 - dull), k * (1 + warm * 0.05 - dull * 0.8), k * (1 - warm * 0.4 + night * 0.25 - dull * 0.4));
    for (const m of this.photoMats) m.color.copy(tint);
    this.groundMat.color.copy(this.groundCol).multiply(tint);
  }

  setWeather(w: HourWeather | null) {
    this.o.weather = w;
    if (this.rain) this.scene.remove(this.rain);
    if (this.snow) this.scene.remove(this.snow);
    this.rain = this.snow = null;
    if (!w) return;
    // ветер: «откуда дует» → куда несёт; переводим в систему камеры
    const to = ((w.windDir + 180 - this.o.ctx.heading) * Math.PI) / 180;
    const sp = Math.min(14, w.wind / 3.6);
    this.wind.set(Math.sin(to) * sp, 0, -Math.cos(to) * sp);
    // в помещении (неба в кадре нет) осадки не рисуем — только звук за окном
    const outdoor = this.o.layers.sky.some((v) => v);
    const rainy = outdoor && (w.rain > 0.05 || [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99].includes(w.code));
    const snowy = outdoor && (w.snow > 0.01 || [71, 73, 75, 77, 85, 86].includes(w.code));
    this.storm = [95, 96, 99].includes(w.code);
    if (rainy) {
      const n = Math.round(1500 + Math.min(6000, (w.rain || 1) * 1800));
      this.drops = new Float32Array(n * 6);
      for (let i = 0; i < n; i++) this.spawnDrop(i, true);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.drops, 3));
      this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xdfe8f4, transparent: true, opacity: 0.7 }));
      this.rain.frustumCulled = false;
      this.rain.renderOrder = 10;
      this.scene.add(this.rain);
    }
    if (snowy) {
      const n = Math.round(3000 + Math.min(6000, (w.snow || 0.5) * 4000));
      this.flakes = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        this.flakes[i * 3] = this.pos.x + (Math.random() - 0.5) * 30;
        this.flakes[i * 3 + 1] = Math.random() * 14;
        this.flakes[i * 3 + 2] = this.pos.z + (Math.random() - 0.5) * 30;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.flakes, 3));
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const cg = c.getContext('2d')!;
      const grd = cg.createRadialGradient(16, 16, 0, 16, 16, 16);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      cg.fillStyle = grd;
      cg.fillRect(0, 0, 32, 32);
      this.snow = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.11, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 1, toneMapped: false }));
      this.snow.frustumCulled = false;
      this.snow.renderOrder = 10;
      this.scene.add(this.snow);
    }
  }

  private spawnDrop(i: number, initial: boolean) {
    const d = this.drops!;
    const x = this.pos.x + (Math.random() - 0.5) * 30,
      z = this.pos.z + (Math.random() - 0.5) * 30,
      y = initial ? Math.random() * 16 : 14 + Math.random() * 4;
    const len = 0.5;
    const v = new THREE.Vector3(this.wind.x, -9, this.wind.z).normalize().multiplyScalar(len);
    d.set([x, y, z, x - v.x, y - v.y, z - v.z], i * 6);
  }

  private kd = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keys.add(e.code);
  };
  private ku = (e: KeyboardEvent) => this.keys.delete(e.code);

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0032;
    this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch - dy * 0.0032));
  }

  reset() {
    this.pos.set(0, EYE, 0);
    this.yaw = 0;
    this.pitch = this.pitch0;
  }

  resize = () => {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    // кадр целиком: на широком экране — по высоте, на узком (телефон) — по ширине
    const tanV = Math.tan(((this.o.ctx.fovV / 2) * Math.PI) / 180);
    const fit = this.camera.aspect < this.o.photoAspect ? (Math.atan((tanV * this.o.photoAspect) / this.camera.aspect) * 360) / Math.PI : this.o.ctx.fovV;
    this.camera.fov = Math.min(100, fit);
    this.camera.updateProjectionMatrix();
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.clock.update();
    const dt = Math.min(0.05, this.clock.getDelta());
    const t = this.clock.getElapsed();
    this.sky.material.uniforms.time.value = t;
    // ходьба
    const k = this.keys;
    let fx = this.move.x,
      fz = this.move.z;
    if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    const speed = (k.has('ShiftLeft') ? 3 : 1.4) * dt;
    if (fx || fz) {
      const len = Math.hypot(fx, fz);
      const sx = (fx / Math.max(1, len)) * speed,
        sz = (fz / Math.max(1, len)) * speed;
      const c = Math.cos(this.yaw),
        s = Math.sin(this.yaw);
      this.pos.x += sx * c + sz * s;
      this.pos.z += -sx * s + sz * c;
      this.walked += Math.hypot(sx, sz);
      const r = Math.hypot(this.pos.x, this.pos.z);
      if (r > RADIUS) this.pos.multiplyScalar(RADIUS / r).setY(EYE);
    }
    const bob = Math.sin(this.walked * 7) * 0.025;
    this.camera.position.set(this.pos.x, EYE + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // облака плывут по ветру
    this.clouds.rotation.y += dt * 0.002 * (1 + this.wind.length() * 0.2);
    // дождь
    if (this.rain && this.drops) {
      const d = this.drops;
      const vx = this.wind.x * dt,
        vy = -9 * dt,
        vz = this.wind.z * dt;
      for (let i = 0; i < d.length / 6; i++) {
        const o = i * 6;
        d[o] += vx;
        d[o + 1] += vy;
        d[o + 2] += vz;
        d[o + 3] += vx;
        d[o + 4] += vy;
        d[o + 5] += vz;
        if (d[o + 4] < 0) this.spawnDrop(i, false);
      }
      (this.rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (this.snow && this.flakes) {
      const f = this.flakes;
      for (let i = 0; i < f.length / 3; i++) {
        const o = i * 3;
        f[o] += (this.wind.x * 0.35 + Math.sin(t * 0.8 + i) * 0.3) * dt;
        f[o + 1] -= (0.7 + (i % 5) * 0.12) * dt;
        f[o + 2] += (this.wind.z * 0.35 + Math.cos(t * 0.7 + i * 1.3) * 0.3) * dt;
        if (f[o + 1] < 0) {
          f[o] = this.pos.x + (Math.random() - 0.5) * 30;
          f[o + 1] = 12 + Math.random() * 3;
          f[o + 2] = this.pos.z + (Math.random() - 0.5) * 30;
        }
      }
      (this.snow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    // гроза
    if (this.storm) {
      if (t > this.nextFlash) {
        this.flash = 1;
        this.nextFlash = t + 4 + Math.random() * 9;
        setTimeout(() => this.onThunder?.(), 300 + Math.random() * 1500);
      }
      this.flash *= Math.exp(-dt * 6);
      this.hemi.intensity += this.flash * 2.5;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.storm) this.hemi.intensity -= this.flash * 2.5;
    this.onFrame?.((((this.o.ctx.heading - (this.yaw * 180) / Math.PI) % 360) + 360) % 360);
  };

  snapshot(): string {
    return this.renderer.domElement.toDataURL('image/jpeg', 0.9);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.kd);
    window.removeEventListener('keyup', this.ku);
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
