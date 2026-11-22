// Прокси к Overpass API (OpenStreetMap): из некоторых сетей сервера Overpass недоступны напрямую.
// GET /api/osm?lat=..&lon=..&r=.. → { elements } — дома, улицы, газоны, вода и деревья вокруг точки.
// Данные © участники OpenStreetMap, ODbL.

const HOSTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export default async function handler(req, res) {
  const lat = parseFloat(req.query.lat),
    lon = parseFloat(req.query.lon);
  const r = Math.min(400, Math.max(50, parseInt(req.query.r ?? '260', 10) || 260));
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: 'lat/lon' });
    return;
  }
  // прямоугольник быстрее, чем «around»
  const dLat = r / 110540,
    dLon = r / (111320 * Math.cos((lat * Math.PI) / 180));
  const bb = `${(lat - dLat).toFixed(5)},${(lon - dLon).toFixed(5)},${(lat + dLat).toFixed(5)},${(lon + dLon).toFixed(5)}`;
  const q = `[out:json][timeout:25][bbox:${bb}];(
way["building"];
way["highway"];
way["landuse"~"^(grass|forest|meadow|recreation_ground|village_green|cemetery)$"];
way["leisure"~"^(park|garden|pitch|playground)$"];
way["natural"~"^(wood|water|scrub|grassland|beach|sand)$"];
node["natural"="tree"];
);out geom 5000;`;
  const log = [];
  for (const host of HOSTS) {
    const t0 = Date.now();
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25000);
    try {
      const rr = await fetch(host, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Imprint-diary/1.0 (hackathon project)' },
        signal: ctl.signal,
      });
      if (!rr.ok) {
        log.push(`${host.split('/')[2]} ${rr.status} ${Date.now() - t0}ms`);
        continue;
      }
      const j = await rr.json();
      if (!Array.isArray(j.elements)) continue;
      res.setHeader('Cache-Control', 'public, s-maxage=604800, max-age=86400');
      res.status(200).json({ elements: j.elements });
      return;
    } catch (e) {
      log.push(`${host.split('/')[2]} ${String(e).slice(0, 60)} ${Date.now() - t0}ms`);
    } finally {
      clearTimeout(t);
    }
  }
  res.status(502).json({ error: 'overpass unavailable', log });
}
