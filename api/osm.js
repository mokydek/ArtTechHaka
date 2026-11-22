// Прокси к Overpass API (OpenStreetMap): из некоторых сетей сервера Overpass недоступны напрямую.
// GET /api/osm?lat=..&lon=..&r=.. → { elements } — дома, улицы, газоны, вода и деревья вокруг точки.
// Данные © участники OpenStreetMap, ODbL.

const HOSTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

export default async function handler(req, res) {
  const lat = parseFloat(req.query.lat),
    lon = parseFloat(req.query.lon);
  const r = Math.min(400, Math.max(50, parseInt(req.query.r ?? '260', 10) || 260));
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: 'lat/lon' });
    return;
  }
  // округляем до ~10 м: один и тот же запрос кешируется
  const la = lat.toFixed(4),
    lo = lon.toFixed(4);
  const q = `[out:json][timeout:20];(
way["building"](around:${r},${la},${lo});
way["highway"](around:${r},${la},${lo});
way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery)$"](around:${r},${la},${lo});
way["leisure"~"^(park|garden|pitch|playground)$"](around:${r},${la},${lo});
way["natural"~"^(wood|water|scrub|grassland|beach|sand)$"](around:${r},${la},${lo});
way["waterway"="riverbank"](around:${r},${la},${lo});
node["natural"="tree"](around:${r},${la},${lo});
);out geom 4000;`;
  for (const host of HOSTS) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    try {
      const rr = await fetch(host, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Imprint-diary/1.0 (hackathon project)' },
        signal: ctl.signal,
      });
      if (!rr.ok) continue;
      const j = await rr.json();
      if (!Array.isArray(j.elements)) continue;
      res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400');
      res.status(200).json({ elements: j.elements });
      return;
    } catch {
      /* следующий сервер */
    } finally {
      clearTimeout(t);
    }
  }
  res.status(502).json({ error: 'overpass unavailable' });
}
