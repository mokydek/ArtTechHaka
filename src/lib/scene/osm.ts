/**
 * Настоящее место вокруг снимка: дома, улицы, парки, вода и деревья из OpenStreetMap
 * (Overpass API, данные © участники OpenStreetMap, ODbL).
 * Всё переводим в метры вокруг точки съёмки: вперёд (−Z) — куда смотрела камера.
 */

export interface OsmWorld {
  buildings: { pts: [number, number][]; h: number; color?: string }[];
  roads: { pts: [number, number][]; w: number; kind: 'major' | 'minor' | 'path' }[];
  areas: { pts: [number, number][]; kind: 'grass' | 'wood' | 'water' | 'sand' }[];
  trees: [number, number][];
  heading: number; // куда смотреть (может быть уточнено по улице)
  shift: [number, number]; // насколько сдвинули точку съёмки (на ближайшую улицу), м
}

interface El {
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

const ROAD_W: Record<string, number> = {
  motorway: 16,
  trunk: 14,
  primary: 13,
  secondary: 11,
  tertiary: 9,
  residential: 7,
  unclassified: 7,
  living_street: 6,
  service: 4.5,
  pedestrian: 6,
  footway: 2.4,
  path: 2,
  cycleway: 2.2,
  track: 3,
};

export async function fetchOsm(lat: number, lon: number, radius = 260, ms = 9000): Promise<El[] | null> {
  const r = Math.round(radius);
  const q = `[out:json][timeout:10];(
way["building"](around:${r},${lat},${lon});
way["highway"](around:${r},${lat},${lon});
way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery)$"](around:${r},${lat},${lon});
way["leisure"~"^(park|garden|pitch|playground)$"](around:${r},${lat},${lon});
way["natural"~"^(wood|water|scrub|grassland|beach|sand)$"](around:${r},${lat},${lon});
way["waterway"="riverbank"](around:${r},${lat},${lon});
node["natural"="tree"](around:${r},${lat},${lon});
);out geom 4000;`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    for (const host of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try {
        const res = await fetch(host, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
        if (!res.ok) continue;
        const j = await res.json();
        if (Array.isArray(j.elements)) return j.elements as El[];
      } catch (e) {
        if (ctl.signal.aborted) return null;
      }
    }
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Метры вокруг точки; если точка внутри дома или далеко от улиц — встаём на ближайшую улицу */
export function localize(els: El[], lat: number, lon: number, heading: number, headingKnown: boolean): OsmWorld | null {
  const kx = Math.cos((lat * Math.PI) / 180) * 111320,
    ky = 110540;
  const en = (p: { lat: number; lon: number }): [number, number] => [(p.lon - lon) * kx, (p.lat - lat) * ky];
  const B: OsmWorld['buildings'] = [],
    Rd: OsmWorld['roads'] = [],
    A: OsmWorld['areas'] = [],
    T: [number, number][] = [];
  for (const e of els) {
    const tg = e.tags ?? {};
    if (e.type === 'node' && e.lat != null && e.lon != null) {
      T.push(en({ lat: e.lat, lon: e.lon }));
      continue;
    }
    if (!e.geometry || e.geometry.length < 2) continue;
    const pts = e.geometry.map(en);
    if (tg.building) {
      const lv = parseFloat(tg['building:levels'] ?? '');
      const hh = parseFloat(tg.height ?? '');
      const h = !isNaN(hh) ? hh : !isNaN(lv) ? lv * 3.1 + 1 : tg.building === 'house' || tg.building === 'detached' || tg.building === 'garage' || tg.building === 'shed' ? 6 : 12;
      if (pts.length >= 4) B.push({ pts: pts.slice(0, -1), h: Math.min(120, Math.max(3, h)), color: tg['building:colour'] });
    } else if (tg.highway && ROAD_W[tg.highway] != null) {
      const w = parseFloat(tg.width ?? '') || ROAD_W[tg.highway];
      const kind = w <= 3 ? 'path' : ['motorway', 'trunk', 'primary', 'secondary'].includes(tg.highway) ? 'major' : 'minor';
      Rd.push({ pts, w, kind });
    } else if (pts.length >= 4) {
      const v = tg.natural ?? tg.landuse ?? tg.leisure ?? (tg.waterway ? 'water' : '');
      const kind = v === 'water' ? 'water' : v === 'wood' || v === 'forest' || v === 'scrub' ? 'wood' : v === 'beach' || v === 'sand' ? 'sand' : 'grass';
      A.push({ pts: pts.slice(0, -1), kind });
    }
  }
  if (B.length + Rd.length < 3) return null;

  // где встать: точка внутри дома или дальше 25 м от улицы — переносим на ближайшую улицу (не тропинку)
  const inside = (x: number, y: number, poly: [number, number][]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i],
        [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  let best = { d: Infinity, x: 0, y: 0, dir: 0 };
  for (const r of Rd) {
    if (r.kind === 'path') continue;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [ax, ay] = r.pts[i],
        [bx, by] = r.pts[i + 1];
      const vx = bx - ax,
        vy = by - ay;
      const L2 = vx * vx + vy * vy || 1;
      const t = Math.max(0, Math.min(1, -(ax * vx + ay * vy) / L2));
      const px = ax + vx * t,
        py = ay + vy * t;
      const d = Math.hypot(px, py);
      if (d < best.d) best = { d, x: px, y: py, dir: (Math.atan2(vx, vy) * 180) / Math.PI };
    }
  }
  const inHouse = B.some((b) => inside(0, 0, b.pts));
  let sx = 0,
    sy = 0;
  if (best.d < 200 && (inHouse || best.d > 25)) {
    sx = best.x;
    sy = best.y;
  }
  let hd = heading;
  if (!headingKnown && best.d < 200) {
    // направление неизвестно — смотрим вдоль улицы (из двух сторон — ближе к угаданной)
    const a = (best.dir + 360) % 360,
      b = (a + 180) % 360;
    const diff = (u: number) => Math.abs((((u - heading) % 360) + 540) % 360 - 180);
    hd = diff(a) < diff(b) ? a : b;
  }
  // в оси мира: вправо — x, назад — z
  const h = (hd * Math.PI) / 180,
    ch = Math.cos(h),
    shh = Math.sin(h);
  const W = ([e, n]: [number, number]): [number, number] => {
    const x = e - sx,
      y = n - sy;
    return [x * ch - y * shh, -(x * shh + y * ch)];
  };
  return {
    buildings: B.map((b) => ({ ...b, pts: b.pts.map(W) })).filter((b) => !inside(0, 0, b.pts)),
    roads: Rd.map((r) => ({ ...r, pts: r.pts.map(W) })),
    areas: A.map((a) => ({ ...a, pts: a.pts.map(W) })),
    trees: T.map(W),
    heading: hd,
    shift: [sx, sy],
  };
}
