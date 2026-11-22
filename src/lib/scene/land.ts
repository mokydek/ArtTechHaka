import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RGB, SceneTags } from './tags';
import type { OsmWorld } from './osm';

/**
 * Условное продолжение за рамкой снимка: земля, дорога, деревья, дома, фонари, холмы на горизонте.
 * Всё в красках самого фото, чтобы край кадра переходил в мир без шва.
 * Начало координат — точка съёмки (на земле), вперёд — −Z, как смотрела камера.
 */

export interface Land {
  group: THREE.Group;
  colliders: { x0: number; x1: number; z0: number; z1: number }[];
  solid?: (x: number, z: number) => boolean;
  height: (x: number, z: number) => number;
  setNight: (n: number) => void;
  radius: number;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noise2(seed: number) {
  const h = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 17.3) * 43758.5453;
    return s - Math.floor(s);
  };
  const n = (x: number, y: number) => {
    const ix = Math.floor(x),
      iy = Math.floor(y);
    const fx = x - ix,
      fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx),
      uy = fy * fy * (3 - 2 * fy);
    const a = h(ix, iy),
      b = h(ix + 1, iy),
      c = h(ix, iy + 1),
      d = h(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  return (x: number, y: number) => n(x, y) * 0.55 + n(x * 2.1 + 5, y * 2.1 + 3) * 0.3 + n(x * 4.3 + 9, y * 4.3 + 1) * 0.15;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function paint(geo: THREE.BufferGeometry, f: (n: THREE.Vector3, p: THREE.Vector3) => RGB, keepUv = false) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!keepUv) g.deleteAttribute('uv');
  g.computeVertexNormals();
  const pos = g.getAttribute('position'),
    nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3(),
    p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nor, i);
    p.fromBufferAttribute(pos, i);
    const c = f(n, p);
    col.set(c, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function buildLand(t: SceneTags, o: { seed: number; snowy: boolean; hHalf: number; osm?: OsmWorld | null }): Land {
  const R = rng(o.seed);
  const nz = noise2(o.seed % 997);
  const group = new THREE.Group();
  const colliders: Land['colliders'] = [];
  const C = t.colors;
  const snow: RGB = [0.9, 0.92, 0.96];
  const osm = o.osm && t.kind !== 'indoor' ? o.osm : null;
  const road = osm ? null : t.road;
  const city = t.kind === 'city' || !!osm;
  const park = t.kind === 'park';
  const RAD = 760;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const matSmooth = new THREE.MeshLambertMaterial({ vertexColors: true });

  if (t.kind === 'indoor') return room(t, o, R);

  // ---------- рельеф ----------
  const flatR = city ? RAD : 70;
  const height = (x: number, z: number) => {
    const r = Math.hypot(x, z);
    if (r < flatR) return 0;
    let h = (nz(x * 0.006, z * 0.006) - 0.45) * 26 * smooth(flatR, 320, r);
    if (road) h *= smooth(road.width * 0.6, road.width * 3, Math.abs(x - road.x));
    return Math.max(-2, h);
  };

  const tex = (c: HTMLCanvasElement | null) => {
    if (!c) return null;
    const x = new THREE.CanvasTexture(c);
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.colorSpace = THREE.NoColorSpace;
    x.anisotropy = 8;
    return x;
  };
  const groundTex = osm || (o.snowy && t.ground !== 'snow') ? null : tex(t.tex.ground);
  const leafTex = tex(t.tex.leaf);

  // ---------- земля ----------
  {
    const rings = 52,
      segs = 112;
    const pos: number[] = [],
      col: number[] = [],
      uvs: number[] = [],
      idx: number[] = [];
    // с текстурой из снимка цвет уже в ней — вершинам остаётся только лёгкая пятнистость
    const paving = mix(C.road, [0.62, 0.61, 0.58], 0.55);
    const base: RGB = groundTex ? [1, 1, 1] : o.snowy ? mix(C.ground, snow, t.ground === 'snow' ? 0.15 : 0.75) : osm ? paving : C.ground;
    for (let i = 0; i <= rings; i++) {
      const r = i === 0 ? 0 : 1.5 * Math.pow(RAD / 1.5, (i - 1) / (rings - 1));
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        const x = Math.sin(a) * r,
          z = -Math.cos(a) * r;
        pos.push(x, height(x, z), z);
        uvs.push(x / 4.5, z / 4.5);
        const v = nz(x * 0.04, z * 0.04),
          v2 = nz(x * 0.011 + 40, z * 0.011);
        let c = mul(base, 0.86 + v * 0.26);
        if (!o.snowy && t.ground === 'grass' && !groundTex) c = mix(c, mul(C.leaf, 0.8), smooth(0.55, 0.8, v2) * 0.5);
        if (groundTex) c = mul(c, 0.92 - smooth(0.5, 0.8, v2) * 0.12);
        if (o.snowy) c = mix(c, [0.78, 0.84, 0.95], smooth(0.5, 0.75, v2) * 0.3);
        col.push(...c);
      }
    }
    for (let i = 0; i < rings; i++)
      for (let j = 0; j < segs; j++) {
        const a = i * segs + j,
          b = i * segs + ((j + 1) % segs),
          c = (i + 1) * segs + j,
          d = (i + 1) * segs + ((j + 1) % segs);
        idx.push(a, b, c, b, d, c);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, groundTex ? new THREE.MeshLambertMaterial({ vertexColors: true, map: groundTex }) : matSmooth));
  }

  // ---------- дорога ----------
  if (road) {
    const w = road.width,
      L = RAD * 0.9;
    const parts: THREE.BufferGeometry[] = [];
    const strip = (x0: number, x1: number, y: number, c: RGB) => {
      const pos: number[] = [],
        col: number[] = [],
        idx: number[] = [];
      const n = 160;
      for (let i = 0; i <= n; i++) {
        const z = -L + (2 * L * i) / n;
        for (const x of [x0, x1]) {
          pos.push(x, height(x, z) + y, z);
          col.push(...mul(c, 0.94 + nz(x * 0.3, z * 0.05) * 0.12));
        }
      }
      for (let i = 0; i < n; i++) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      parts.push(g);
    };
    const asphalt = o.snowy ? mix(C.road, [0.7, 0.72, 0.76], 0.35) : C.road;
    strip(road.x - w / 2, road.x + w / 2, 0.03, asphalt);
    // обочины / тротуары
    if (city || park) {
      const sw = mix(C.road, [0.75, 0.74, 0.72], 0.45);
      strip(road.x - w / 2 - 3, road.x - w / 2, 0.12, o.snowy ? mix(sw, snow, 0.6) : sw);
      strip(road.x + w / 2, road.x + w / 2 + 3, 0.12, o.snowy ? mix(sw, snow, 0.6) : sw);
    }
    // разметка
    const line: RGB = o.snowy ? [0.8, 0.8, 0.78] : [0.86, 0.86, 0.82];
    for (let z = -L; z < L; z += 9) {
      const g = new THREE.PlaneGeometry(0.16, 3.2);
      g.rotateX(-Math.PI / 2);
      g.translate(road.x, height(road.x, z) + 0.05, z);
      parts.push(paint(g, () => line));
    }
    const m = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), matSmooth);
    group.add(m);
  }

  // ---------- настоящее место (OpenStreetMap) ----------
  const solidPolys: { pts: [number, number][]; x0: number; x1: number; z0: number; z1: number }[] = [];
  const osmTrees: [number, number][] = [];
  const osmLamps: number[] = [];
  if (osm) {
    const shapeGeo = (pts: [number, number][], y: number) => {
      const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
      const g = new THREE.ShapeGeometry(sh);
      g.rotateX(-Math.PI / 2);
      g.translate(0, y, 0);
      return g;
    };
    // газоны, лес, вода, песок
    const ap: THREE.BufferGeometry[] = [];
    const grassC = o.snowy ? mix(snow, C.ground, 0.1) : t.ground === 'grass' ? C.ground : mul(C.leaf, 0.95);
    for (const a of osm.areas) {
      const c: RGB = a.kind === 'water' ? (o.snowy ? [0.78, 0.82, 0.88] : [0.22, 0.33, 0.42]) : a.kind === 'sand' ? [0.78, 0.7, 0.52] : a.kind === 'wood' ? mul(grassC, 0.82) : grassC;
      try {
        ap.push(paint(shapeGeo(a.pts, a.kind === 'water' ? 0.03 : 0.02), () => c));
      } catch {
        /* кривой полигон — пропускаем */
      }
      // деревья в лесу и парке
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const [x, z] of a.pts) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      if (a.kind === 'water' || a.kind === 'sand') continue;
      const per = a.kind === 'wood' ? 45 : 260;
      const n = Math.min(300, Math.round(((x1 - x0) * (z1 - z0)) / per));
      for (let k = 0; k < n; k++) {
        const x = x0 + R() * (x1 - x0),
          z = z0 + R() * (z1 - z0);
        if (inPoly(x, z, a.pts)) osmTrees.push([x, z]);
      }
    }
    if (ap.length) group.add(new THREE.Mesh(mergeGeometries(ap), matSmooth));
    // улицы и дорожки
    const rp: THREE.BufferGeometry[] = [];
    const asphalt = o.snowy ? mix(C.road, [0.72, 0.74, 0.78], 0.4) : C.road;
    const path = o.snowy ? mix(snow, C.road, 0.25) : mix(C.road, [0.7, 0.66, 0.6], 0.45);
    for (const r of osm.roads) {
      const c = r.kind === 'path' ? path : asphalt;
      const y = r.kind === 'major' ? 0.05 : r.kind === 'minor' ? 0.045 : 0.04;
      const pos: number[] = [];
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i],
          [bx, bz] = r.pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        const nx = (-(bz - az) / L) * (r.w / 2),
          nz2 = ((bx - ax) / L) * (r.w / 2);
        // продлеваем на полширины — стыки без щелей
        const ex = ((bx - ax) / L) * (r.w / 2),
          ez = ((bz - az) / L) * (r.w / 2);
        const A = [ax - ex + nx, az - ez + nz2],
          B = [ax - ex - nx, az - ez - nz2],
          Cc = [bx + ex + nx, bz + ez + nz2],
          D = [bx + ex - nx, bz + ez - nz2];
        pos.push(A[0], y, A[1], Cc[0], y, Cc[1], B[0], y, B[1], B[0], y, B[1], Cc[0], y, Cc[1], D[0], y, D[1]);
        // фонари вдоль улиц
        if (r.kind !== 'path')
          for (let s2 = 12; s2 < L; s2 += 32) {
            const x = ax + ((bx - ax) * s2) / L + nx * 1.25,
              z = az + ((bz - az) * s2) / L + nz2 * 1.25;
            if (Math.hypot(x, z) > 8 && osmLamps.length < 240 * 3) osmLamps.push(x, z, Math.atan2(-nx, -nz2));
          }
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const nrm = g.getAttribute('normal');
      for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, 0, 1, 0);
      rp.push(paint(g, () => c));
    }
    if (rp.length) group.add(new THREE.Mesh(mergeGeometries(rp), new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
    // дома по контурам, высота — из карты (этажи) или по типу
    const bp: THREE.BufferGeometry[] = [];
    for (const b of osm.buildings) {
      let x0 = Infinity,
        x1 = -Infinity,
        z0 = Infinity,
        z1 = -Infinity;
      for (const [x, z] of b.pts) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
      if (x1 - x0 > 400 || z1 - z0 > 400) continue;
      let g: THREE.BufferGeometry;
      try {
        g = new THREE.ExtrudeGeometry(new THREE.Shape(b.pts.map(([x, z]) => new THREE.Vector2(x, -z))), { depth: b.h, bevelEnabled: false });
      } catch {
        continue;
      }
      g.rotateX(-Math.PI / 2);
      g.computeVertexNormals();
      // окна: UV в метрах этажа
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const nor = g.getAttribute('normal');
      for (let i = 0; i < uv.count; i++) {
        if (Math.abs(nor.getY(i)) > 0.5) uv.setXY(i, 0.02, 0.02);
        else uv.setXY(i, uv.getX(i) / 13.6, uv.getY(i) / 12.4);
      }
      const tone = 0.88 + R() * 0.24;
      const pick = R();
      let base: RGB = pick < 0.35 ? C.wall : pick < 0.6 ? [0.58, 0.36, 0.27] : pick < 0.82 ? [0.8, 0.74, 0.62] : [0.7, 0.7, 0.68];
      if (b.color) {
        const cc = new THREE.Color();
        try {
          cc.setStyle(b.color);
          base = [cc.r, cc.g, cc.b];
        } catch {
          /* неизвестный цвет */
        }
      }
      const wall = mul(mix(base, C.wall, 0.25), tone);
      const roof: RGB = o.snowy ? snow : mul(wall, 0.55);
      bp.push(paint(g, (n) => (n.y > 0.5 ? roof : wall), true));
      solidPolys.push({ pts: b.pts, x0: x0 - 0.5, x1: x1 + 0.5, z0: z0 - 0.5, z1: z1 + 0.5 });
    }
    if (bp.length) {
      const { map, glow: gm } = facade(R);
      const bmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map, emissiveMap: gm, emissive: new THREE.Color(1, 0.78, 0.48), emissiveIntensity: 0 });
      const m = new THREE.Mesh(mergeGeometries(bp), bmat);
      m.userData.night = (n: number) => (bmat.emissiveIntensity = n * 0.9);
      group.add(m);
    }
    for (const tr of osm.trees) osmTrees.push(tr);
  }
  const solid = (x: number, z: number) => {
    for (const p of solidPolys) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && (inPoly(x, z, p.pts) || inPoly(x + 0.4, z, p.pts) || inPoly(x - 0.4, z, p.pts) || inPoly(x, z + 0.4, p.pts) || inPoly(x, z - 0.4, p.pts))) return true;
    return false;
  };

  // ---------- дома ----------
  const houses: { x: number; z: number; w: number; d: number }[] = [];
  if ((city || park) && !osm) {
    const parts: THREE.BufferGeometry[] = [];
    const add = (x: number, z: number, w: number, d: number, h: number) => {
      // ближе 10 м от точки съёмки домов нет (считаем до ближайшей стены, а не до центра)
      if (Math.hypot(Math.max(Math.abs(x) - w / 2, 0), Math.max(Math.abs(z) - d / 2, 0)) < 10) return;
      for (const q of houses) if (Math.abs(q.x - x) < (q.w + w) / 2 + 2 && Math.abs(q.z - z) < (q.d + d) / 2 + 2) return;
      houses.push({ x, z, w, d });
      colliders.push({ x0: x - w / 2 - 0.4, x1: x + w / 2 + 0.4, z0: z - d / 2 - 0.4, z1: z + d / 2 + 0.4 });
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2 + height(x, z) - 0.2, z);
      // окна по 3 м: UV в метрах этажа
      const uv = g.getAttribute('uv') as THREE.BufferAttribute;
      const nor = g.getAttribute('normal');
      for (let i = 0; i < uv.count; i++) {
        const ny = nor.getY(i),
          nx = nor.getX(i);
        if (Math.abs(ny) > 0.5) {
          uv.setXY(i, 0.02, 0.02);
          continue;
        }
        const span = Math.abs(nx) > 0.5 ? d : w;
        uv.setXY(i, (uv.getX(i) * span) / 13.6, (uv.getY(i) * h) / 12);
      }
      const tone = 0.88 + R() * 0.24;
      const pick = R();
      const base: RGB = pick < 0.35 ? C.wall : pick < 0.6 ? [0.58, 0.36, 0.27] : pick < 0.82 ? [0.8, 0.74, 0.62] : [0.7, 0.7, 0.68];
      const wall = mul(mix(base, C.wall, 0.3), tone);
      const roof: RGB = o.snowy ? snow : mul(wall, 0.55);
      parts.push(paint(g, (n) => (n.y > 0.5 ? roof : wall), true));
    };
    if (road) {
      for (const side of [-1, 1]) {
        let z = -RAD * 0.45;
        while (z < RAD * 0.45) {
          const d = 10 + R() * 12;
          const w = 9 + R() * 8;
          const floors = city ? 2 + Math.floor(R() * (R() < 0.1 ? 7 : 4)) : 2 + Math.floor(R() * 2);
          const set = road.width / 2 + (city ? 5 : 14) + R() * (city ? 4 : 30);
          if (!park || R() < 0.55) add(road.x + side * (set + w / 2), z + d / 2, w, d, floors * 3 + 0.6);
          z += d + 3 + R() * (city ? 6 : 20);
        }
      }
    } else {
      const n = city ? 70 : 26;
      for (let k = 0; k < n * 3 && houses.length < n; k++) {
        const a = R() * Math.PI * 2,
          r = 20 + Math.pow(R(), 0.7) * 260;
        const fa = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
        if (fa < o.hHalf + 0.1 && r < 45) continue;
        const floors = city ? 2 + Math.floor(R() * (R() < 0.1 ? 7 : 4)) : 2 + Math.floor(R() * 2);
        add(Math.sin(a) * r, -Math.cos(a) * r, 10 + R() * 10, 10 + R() * 10, floors * 3 + 0.6);
      }
    }
    if (parts.length) {
      const { map, glow } = facade(R);
      const bmat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map, emissiveMap: glow, emissive: new THREE.Color(1, 0.78, 0.48), emissiveIntensity: 0 });
      const m = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), bmat);
      m.userData.night = (n: number) => (bmat.emissiveIntensity = n * 1.1);
      group.add(m);
    }
  }
  const inHouse = (x: number, z: number, pad: number) => houses.some((q) => Math.abs(q.x - x) < q.w / 2 + pad && Math.abs(q.z - z) < q.d / 2 + pad) || solid(x, z);

  // ---------- деревья ----------
  {
    const veg = Math.max(t.veg, park ? 0.12 : 0.04);
    const total = osm ? 0 : Math.round(t.kind === 'nature' ? (veg > 0.25 ? 1500 : veg > 0.1 ? 700 : 160) : city ? 160 : 520);
    const leaf = o.snowy && !t.conifer ? mix(C.leaf, [0.42, 0.38, 0.34], 0.7) : C.leaf;
    const coniferShare = t.conifer ? 0.75 : o.snowy ? 0.45 : 0.15;
    const items: { x: number; z: number; s: number; c: number; kind: 0 | 1 }[] = [];
    const roadClear = road ? road.width / 2 + (city || park ? 5 : 2.5) : 0;
    for (let k = 0; k < total * 4 && items.length < total; k++) {
      let x: number, z: number;
      if (city && road && R() < 0.75) {
        // аллея вдоль тротуара
        const side = R() < 0.5 ? -1 : 1;
        x = road.x + side * (road.width / 2 + 3.6 + R() * 0.6);
        z = Math.round((R() * 2 - 1) * 300 / 12) * 12;
      } else {
        const a = R() * Math.PI * 2;
        const r = 5 + Math.pow(R(), 0.8) * 320;
        x = Math.sin(a) * r;
        z = -Math.cos(a) * r;
        const side = x < 0 ? t.vegL : t.vegR;
        if (z < 0 && R() > 0.25 + side * 2.2) continue; // впереди — как на фото по сторонам
      }
      const r = Math.hypot(x, z);
      if (r < 3.5) continue;
      if (road && Math.abs(x - road.x) < roadClear && !(city && Math.abs(Math.abs(x - road.x) - (road.width / 2 + 3.9)) < 0.8)) continue;
      // прямо в кадре вблизи — пусто: там стоит сам снимок
      if (z < 0 && Math.abs(Math.atan2(x, -z)) < o.hHalf + 0.06 && r < 18) continue;
      if (inHouse(x, z, 2)) continue;
      items.push({ x, z, s: 0.75 + R() * (t.kind === 'nature' ? 1.3 : 0.7), c: R(), kind: R() < coniferShare ? 1 : 0 });
    }
    for (const [x, z] of osmTrees.slice(0, 1600)) {
      if (Math.hypot(x, z) < 3.5 || solid(x, z)) continue;
      items.push({ x, z, s: 0.8 + R() * 0.9, c: R(), kind: R() < coniferShare ? 1 : 0 });
    }
    // листва — из куска самого снимка (если зелень на фото есть), ствол — цветом коры
    const texLeaf = o.snowy && !t.conifer ? null : leafTex;
    const crownMat = texLeaf ? new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, map: texLeaf }) : mat;
    const m4 = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      e = new THREE.Euler();
    const col = new THREE.Color();
    for (const kind of [0, 1] as const) {
      const list = items.filter((i) => i.kind === kind);
      if (!list.length) continue;
      const g = treeGeo(kind, leaf, o.snowy, !!texLeaf);
      const ims = [new THREE.InstancedMesh(g.trunk, mat, list.length), new THREE.InstancedMesh(g.crown, crownMat, list.length)];
      list.forEach((it, i) => {
        e.set(0, it.c * 6.28, 0);
        q.setFromEuler(e);
        m4.compose(new THREE.Vector3(it.x, height(it.x, it.z) - 0.1, it.z), q, new THREE.Vector3(it.s, it.s * (0.9 + it.c * 0.25), it.s));
        const k = 0.82 + it.c * 0.3;
        col.setRGB(k, k * (0.96 + it.c * 0.08), k);
        for (const im of ims) {
          im.setMatrixAt(i, m4);
          im.setColorAt(i, col);
        }
        if (it.s > 0.6) colliders.push({ x0: it.x - 0.4, x1: it.x + 0.4, z0: it.z - 0.4, z1: it.z + 0.4 });
      });
      for (const im of ims) {
        im.instanceMatrix.needsUpdate = true;
        group.add(im);
      }
    }
  }

  // ---------- фонари ----------
  const glowPts: number[] = [];
  if ((city || park) && road) {
    const poles: THREE.BufferGeometry[] = [];
    const metal: RGB = [0.16, 0.17, 0.19];
    for (const side of [-1, 1])
      for (let z = -280; z <= 280; z += 26) {
        const x = road.x + side * (road.width / 2 + 1.2);
        if (Math.hypot(x, z) < 6 || inHouse(x, z, 1)) continue;
        const p = new THREE.CylinderGeometry(0.07, 0.1, 5.2, 6);
        p.translate(x, 2.6 + height(x, z), z);
        const arm = new THREE.BoxGeometry(1.4, 0.08, 0.08);
        arm.translate(x - side * 0.6, 5.1 + height(x, z), z);
        const head = new THREE.BoxGeometry(0.5, 0.12, 0.26);
        head.translate(x - side * 1.2, 5.0 + height(x, z), z);
        poles.push(paint(p, () => metal), paint(arm, () => metal), paint(head, () => [0.9, 0.86, 0.72]));
        glowPts.push(x - side * 1.2, 4.92 + height(x, z), z);
      }
    if (poles.length) group.add(new THREE.Mesh(mergeGeometries(poles), mat));
  } else if (osm && osmLamps.length) {
    const poles: THREE.BufferGeometry[] = [];
    const metal: RGB = [0.16, 0.17, 0.19];
    for (let i = 0; i < osmLamps.length; i += 3) {
      const x = osmLamps[i],
        z = osmLamps[i + 1],
        a = osmLamps[i + 2];
      if (solid(x, z)) continue;
      const p = new THREE.CylinderGeometry(0.07, 0.1, 5.2, 6);
      p.translate(x, 2.6, z);
      const hx = x + Math.sin(a) * 1.1,
        hz = z + Math.cos(a) * 1.1;
      const head = new THREE.BoxGeometry(0.4, 0.12, 0.4);
      head.translate(hx, 5.0, hz);
      poles.push(paint(p, () => metal), paint(head, () => [0.9, 0.86, 0.72]));
      glowPts.push(hx, 4.92, hz);
    }
    if (poles.length) group.add(new THREE.Mesh(mergeGeometries(poles), mat));
  } else if (park) {
    for (let k = 0; k < 16; k++) {
      const a = R() * Math.PI * 2,
        r = 10 + R() * 60;
      const x = Math.sin(a) * r,
        z = -Math.cos(a) * r;
      if (inHouse(x, z, 1)) continue;
      glowPts.push(x, 3.6, z);
      const p = new THREE.CylinderGeometry(0.06, 0.09, 3.7, 6);
      p.translate(x, 1.85, z);
      group.add(new THREE.Mesh(paint(p, () => [0.15, 0.15, 0.17]), mat));
    }
  }
  let glow: THREE.Points | null = null;
  if (glowPts.length) {
    // тёплые круги света на земле под фонарями
    const pool = new THREE.CircleGeometry(1, 24);
    pool.rotateX(-Math.PI / 2);
    const pc = document.createElement('canvas');
    pc.width = pc.height = 128;
    const pg = pc.getContext('2d')!;
    const rg = pg.createRadialGradient(64, 64, 0, 64, 64, 64);
    rg.addColorStop(0, 'rgba(255,210,150,0.9)');
    rg.addColorStop(0.5, 'rgba(255,190,120,0.35)');
    rg.addColorStop(1, 'rgba(255,180,110,0)');
    pg.fillStyle = rg;
    pg.fillRect(0, 0, 128, 128);
    const pt = new THREE.CanvasTexture(pc);
    const pm = new THREE.MeshBasicMaterial({ map: pt, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false });
    const pools = new THREE.InstancedMesh(pool, pm, glowPts.length / 3);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < glowPts.length / 3; i++) {
      const x = glowPts[i * 3],
        z = glowPts[i * 3 + 2];
      m4.makeScale(6, 1, 6).setPosition(x, height(x, z) + 0.16, z);
      pools.setMatrixAt(i, m4);
    }
    pools.renderOrder = 4;
    pools.userData.night = (n: number) => (pm.opacity = n * 0.55);
    group.add(pools);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(glowPts, 3));
    const m = new THREE.ShaderMaterial({
      uniforms: { uOn: { value: 0 }, uScale: { value: 600 } },
      vertexShader: `uniform float uScale; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = uScale * 3.2 / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uOn; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = exp(-d*d*22.0) + 0.6*exp(-d*d*260.0); gl_FragColor = vec4(vec3(1.0,0.78,0.45) * a * uOn, 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    glow = new THREE.Points(g, m);
    glow.frustumCulled = false;
    glow.renderOrder = 5;
    group.add(glow);
  }

  // ---------- горизонт ----------
  {
    const pos: number[] = [],
      col: number[] = [],
      idx: number[] = [];
    const segs = 160;
    const far = mix(C.leaf, [0.55, 0.6, 0.68], 0.35);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const r = 640;
      const hgt = city ? 0 : 14 + nz(Math.cos(a) * 3 + 10, Math.sin(a) * 3) * 70;
      const x = Math.sin(a) * r,
        z = -Math.cos(a) * r;
      pos.push(x * 1.15, -4, z * 1.15, x, hgt, z);
      const c = o.snowy ? mix(far, snow, 0.55) : far;
      col.push(...c, ...c);
    }
    for (let j = 0; j < segs; j++) {
      const a = j * 2,
        b = ((j + 1) % segs) * 2;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
    if (!city) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      group.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    } else {
      // город на горизонте — силуэты кварталов
      const parts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < 140; k++) {
        const a = R() * Math.PI * 2,
          r = 320 + R() * 300;
        const h = 10 + Math.pow(R(), 2) * 70;
        const g = new THREE.BoxGeometry(20 + R() * 30, h, 20 + R() * 30);
        g.translate(Math.sin(a) * r, h / 2, -Math.cos(a) * r);
        parts.push(paint(g, () => mul(C.wall, 0.8)));
      }
      group.add(new THREE.Mesh(mergeGeometries(parts), mat));
    }
  }

  const setNight = (n: number) => {
    group.traverse((o2) => o2.userData.night?.(n));
    if (glow) (glow.material as THREE.ShaderMaterial).uniforms.uOn.value = n;
  };
  return { group, colliders, solid, height, setNight, radius: osm ? 250 : 300 };
}

/** ель (1) или лиственное дерево (0), высота ~5 м при масштабе 1: ствол и крона отдельно */
function treeGeo(kind: 0 | 1, leaf: RGB, snowy: boolean, textured: boolean): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const bark: RGB = [0.27, 0.2, 0.15];
  const crowns: THREE.BufferGeometry[] = [];
  // с текстурой листвы цвет в ней; вершинам — светотень (верх светлее, низ темнее)
  const tone = (n: THREE.Vector3, c: RGB, k: number): RGB => {
    const base = textured ? mul([1, 1, 1], kind ? 0.62 * k : k) : mul(c, k);
    return snowy && n.y > 0.35 ? mix(base, [0.92, 0.94, 0.98], 0.75) : base;
  };
  let trunk: THREE.BufferGeometry;
  if (kind === 1) {
    trunk = new THREE.CylinderGeometry(0.1, 0.16, 1.3, 5);
    trunk.translate(0, 0.65, 0);
    const dark = mul(leaf, 0.72);
    [
      [1.35, 1.9, 1.6],
      [1.05, 1.6, 2.6],
      [0.72, 1.3, 3.5],
      [0.4, 1.0, 4.25],
    ].forEach(([r, h, y], i) => {
      const c = new THREE.ConeGeometry(r, h, 7, 1, false);
      c.translate(0, y, 0);
      crowns.push(paint(c, (n) => tone(n, dark, 0.9 + i * 0.06), true));
    });
  } else {
    trunk = new THREE.CylinderGeometry(0.13, 0.22, 2.4, 6);
    trunk.translate(0, 1.2, 0);
    for (const [r, x, y, z] of [
      [1.6, 0, 3.4, 0],
      [1.1, 0.8, 3.0, 0.3],
      [1.0, -0.7, 3.1, -0.4],
      [0.9, 0.1, 4.3, 0.2],
    ]) {
      const c = new THREE.IcosahedronGeometry(r, 1);
      c.scale(1, 0.85, 1);
      c.translate(x, y, z);
      crowns.push(paint(c, (n) => tone(n, leaf, 0.78 + Math.max(0, n.y) * 0.32), true));
    }
  }
  return { trunk: paint(trunk, () => bark), crown: mergeGeometries(crowns) };
}

/** фасад: стена с окнами (днём) и светящиеся окна (ночью), плитка 4×4 окна */
function facade(R: () => number) {
  const S = 256,
    cell = S / 4;
  const a = document.createElement('canvas');
  a.width = a.height = S;
  const g = a.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  const b = document.createElement('canvas');
  b.width = b.height = S;
  const e = b.getContext('2d')!;
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const x = i * cell + cell * 0.26,
        y = j * cell + cell * 0.2,
        w = cell * 0.48,
        h = cell * 0.56;
      g.fillStyle = '#d9d4cc';
      g.fillRect(x - 3, y - 3, w + 6, h + 6);
      const gl = g.createLinearGradient(0, y, 0, y + h);
      gl.addColorStop(0, '#9aa9b8');
      gl.addColorStop(1, '#55606e');
      g.fillStyle = gl;
      g.fillRect(x, y, w, h);
      g.fillStyle = '#d9d4cc';
      g.fillRect(x + w / 2 - 1.5, y, 3, h);
      g.fillRect(x, y + h * 0.38, w, 3);
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(i * cell, j * cell + cell - 4, cell, 4);
      if (R() < 0.32) {
        e.fillStyle = R() < 0.7 ? '#ffd9a0' : '#fff1d6';
        e.fillRect(x, y, w, h);
      }
    }
  const map = new THREE.CanvasTexture(a),
    glow = new THREE.CanvasTexture(b);
  for (const t of [map, glow]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.anisotropy = 4;
  }
  return { map, glow };
}

/** комната: снимок сделан в помещении — стены, пол, окно со светом того часа */
function room(t: SceneTags, o: { seed: number }, R: () => number): Land {
  void o;
  const group = new THREE.Group();
  const W = 7 + R() * 3,
    D = 9 + R() * 3,
    H = 2.9;
  const wall = mix(t.colors.indoorWall, [0.82, 0.79, 0.74], 0.45);
  const floorC = mix(t.colors.ground, [0.5, 0.36, 0.24], 0.5);
  const z0 = -D * 0.62,
    z1 = D * 0.38,
    zc = (z0 + z1) / 2;
  // стены и пол — с рисунком (обои в мелкую полосу, паркет), цвет — из снимка
  const canvasTex = (draw: (g: CanvasRenderingContext2D) => void, rx: number, ry: number) => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    draw(c.getContext('2d')!);
    const x = new THREE.CanvasTexture(c);
    x.wrapS = x.wrapT = THREE.RepeatWrapping;
    x.repeat.set(rx, ry);
    x.colorSpace = THREE.NoColorSpace;
    x.anisotropy = 8;
    return x;
  };
  const paper = canvasTex((g) => {
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = 'rgba(0,0,0,0.035)';
      g.fillRect(x, 0, 14, 256);
    }
  }, W / 1.2, H / 1.2);
  const parquet = canvasTex((g) => {
    for (let y = 0; y < 256; y += 32)
      for (let x = (y / 32) % 2 ? -64 : 0; x < 256; x += 128) {
        const k = 0.82 + R() * 0.3;
        g.fillStyle = `rgb(${Math.round(255 * k)},${Math.round(255 * k * 0.97)},${Math.round(255 * k * 0.93)})`;
        g.fillRect(x, y, 127, 31);
      }
  }, W / 2.4, D / 2.4);
  const lam = (map: THREE.Texture | null, c: RGB) => new THREE.MeshLambertMaterial({ map, color: new THREE.Color(...c) });
  const plane = (w: number, h: number, mat: THREE.Material, x: number, y: number, z: number, ry: number, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0, 'YXZ');
    group.add(m);
    return m;
  };
  const wallMat = lam(paper, wall);
  plane(W, D, lam(parquet, floorC), 0, 0, zc, 0, -Math.PI / 2);
  plane(W, D, lam(null, mul(wall, 1.1)), 0, H, zc, 0, Math.PI / 2);
  plane(D, H, wallMat, -W / 2, H / 2, zc, Math.PI / 2);
  plane(D, H, wallMat, W / 2, H / 2, zc, -Math.PI / 2);
  plane(W, H, wallMat, 0, H / 2, z0, 0);
  plane(W, H, wallMat, 0, H / 2, z1, Math.PI);
  // плинтусы, дверь, окна со светом неба этой минуты
  const trim = lam(null, mul(wall, 0.72));
  plane(D, 0.1, trim, -W / 2 + 0.01, 0.05, zc, Math.PI / 2);
  plane(D, 0.1, trim, W / 2 - 0.01, 0.05, zc, -Math.PI / 2);
  plane(W, 0.1, trim, 0, 0.05, z1 - 0.01, Math.PI);
  plane(0.95, 2.05, lam(null, mul(floorC, 0.7)), W / 2 - 1.4, 1.025, z1 - 0.02, Math.PI);
  const wins: THREE.Mesh[] = [];
  const glass = new THREE.MeshBasicMaterial({ color: 0xdde8f5 });
  const frame = lam(null, [0.92, 0.92, 0.9]);
  for (const [x, ry] of [
    [-W / 2 + 0.02, Math.PI / 2],
    [W / 2 - 0.02, -Math.PI / 2],
  ] as const)
    for (const dz of [-1.6, 1.6]) {
      plane(1.5, 1.7, frame, x, 1.55, zc + dz, ry);
      wins.push(plane(1.3, 1.5, glass, x + Math.sign(-x) * 0.01, 1.55, zc + dz, ry));
    }
  // лампа под потолком и тёплый круг света от неё
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), new THREE.MeshBasicMaterial({ color: 0xfff0d8 }));
  lamp.position.set(0, H - 0.35, zc);
  group.add(lamp);
  const colliders = [
    { x0: -W / 2 - 1, x1: -W / 2 + 0.4, z0: z0 - 1, z1: z1 + 1 },
    { x0: W / 2 - 0.4, x1: W / 2 + 1, z0: z0 - 1, z1: z1 + 1 },
    { x0: -W, x1: W, z0: z0 - 1, z1: z0 + 0.4 },
    { x0: -W, x1: W, z0: z1 - 0.4, z1: z1 + 1 },
  ];
  const setNight = (n: number) => {
    glass.color.setRGB(0.86 - n * 0.78, 0.9 - n * 0.79, 0.96 - n * 0.74);
    (lamp.material as THREE.MeshBasicMaterial).color.setRGB(0.7 + n * 0.3, 0.66 + n * 0.3, 0.6 + n * 0.25);
  };
  return { group, colliders, height: () => 0, setNight, radius: Math.max(W, D) / 2 };
}

function inPoly(x: number, y: number, poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i],
      [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
