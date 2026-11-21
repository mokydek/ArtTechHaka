import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useDiary } from '../App';
import { humanDate } from '../lib/render/engine';
import type { DayRecord } from '../lib/types';
import { nameAt } from '../lib/place';

/** Где был день: место из записи или GPS из фото */
function where(d: DayRecord): { lat: number; lon: number } | null {
  if (d.place && Number.isFinite(d.place.lat) && Number.isFinite(d.place.lon)) return { lat: d.place.lat, lon: d.place.lon };
  const m = d.photoMeta?.find((x) => x && Number.isFinite(x.lat) && Number.isFinite(x.lon));
  return m ? { lat: m.lat!, lon: m.lon! } : null;
}

type Pt = { d: DayRecord; lat: number; lon: number };
type Group = { pts: Pt[]; lat: number; lon: number };

/** Карта дней, как Atlas в Journey: круглые фото в радужной кайме, рядом — сколько дней в этом месте */
export default function MapView() {
  const { days, photos, loadPhotos, covers } = useDiary();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const [zoom, setZoom] = useState(4);
  const [open, setOpen] = useState<Pt[] | null>(null);
  const [ready, setReady] = useState(false);
  const [openName, setOpenName] = useState('');
  // у дней только с GPS из фото нет названия места — спрашиваем город по координатам
  useEffect(() => {
    setOpenName('');
    if (!open || open[0].d.place?.name) return;
    let dead = false;
    nameAt(open[0].lat, open[0].lon)
      .then((h) => !dead && setOpenName(h.name))
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [open]);

  const pts = useMemo<Pt[]>(
    () =>
      days
        .filter((d) => !d.sealedUntil)
        .map((d) => ({ d, w: where(d) }))
        .filter((x): x is { d: DayRecord; w: { lat: number; lon: number } } => !!x.w)
        .map(({ d, w }) => ({ d, lat: w.lat, lon: w.lon }))
        .sort((a, b) => b.d.date.localeCompare(a.d.date)),
    [days],
  );
  const key = pts.map((p) => p.d.id).join();
  useEffect(() => {
    if (pts.length) loadPhotos(pts.map((p) => p.d));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // карта создаётся один раз
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: false, attributionControl: true, worldCopyJump: true, minZoom: 2 }).setView([48, 68], 4);
    // CARTO теперь отдаёт заглушку «API key required» — берём стандартные тайлы OSM
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    L.control.zoom({ position: 'topleft' }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    m.on('zoomend', () => setZoom(m.getZoom()));
    m.on('click', () => setOpen(null));
    map.current = m;
    setReady(true);
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // показать все дни сразу при первом появлении точек
  const fitted = useRef(false);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !pts.length || fitted.current) return;
    fitted.current = true;
    if (pts.length === 1) m.setView([pts[0].lat, pts[0].lon], 11);
    else m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { padding: [70, 70], maxZoom: 12 });
  }, [key, pts, ready]);

  // группировка по близости на экране: соседние дни собираются в один кружок со счётчиком
  const groups = useMemo<Group[]>(() => {
    const m = map.current;
    if (!m || !ready) return [];
    const out: (Group & { x: number; y: number })[] = [];
    for (const p of pts) {
      const q = m.project([p.lat, p.lon], zoom);
      const g = out.find((o) => Math.hypot(o.x - q.x, o.y - q.y) < 64);
      if (g) g.pts.push(p);
      else out.push({ pts: [p], lat: p.lat, lon: p.lon, x: q.x, y: q.y });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, zoom, ready]);

  useEffect(() => {
    const m = map.current;
    const lg = layer.current;
    if (!m || !lg) return;
    lg.clearLayers();
    groups.forEach((g, i) => {
      const top = g.pts[0].d;
      const src = photos[top.id]?.[0] ?? top.photoUrls?.[0] ?? covers[top.id];
      const big = g.pts.length > 1;
      const size = big ? 74 : 62;
      const html =
        `<span class="atl-pin" style="--d:${i}">` +
        (src ? `<img src="${src}" alt="" />` : `<i style="background:linear-gradient(150deg,${top.design.palette.colors[1]},${top.design.palette.colors[3]})"></i>`) +
        (big ? `<b>${g.pts.length}</b>` : '') +
        `</span>`;
      const mk = L.marker([g.lat, g.lon], { icon: L.divIcon({ html, className: 'atl-icon', iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), riseOnHover: true });
      mk.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        const b = L.latLngBounds(g.pts.map((p) => [p.lat, p.lon]));
        // дни в одном месте раскрываются списком, разбросанные — приближаются
        if (g.pts.length > 1 && m.getZoom() < 16 && b.getNorthEast().distanceTo(b.getSouthWest()) > 300) m.fitBounds(b, { padding: [80, 80] });
        else setOpen(g.pts);
      });
      lg.addLayer(mk);
    });
  }, [groups, photos, covers]);

  const fitAll = () => {
    const m = map.current;
    if (!m || !pts.length) return;
    setOpen(null);
    if (pts.length === 1) m.setView([pts[0].lat, pts[0].lon], 11);
    else m.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])), { padding: [70, 70], maxZoom: 12 });
  };

  const places = new Set(pts.map((p) => p.d.place?.name ?? `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`)).size;

  return (
    <div className="atl">
      <div className="atl-head">
        <h1 className="h1">Карта</h1>
        {pts.length > 0 && (
          <span className="atl-count">
            {pts.length} {plural(pts.length, 'день', 'дня', 'дней')} · {places} {plural(places, 'место', 'места', 'мест')}
          </span>
        )}
      </div>
      <div className="atl-map">
        <div ref={box} className="atl-leaf" />
        {pts.length > 1 && (
          <button className="atl-all" onClick={fitAll}>
            Все дни
          </button>
        )}
        {!pts.length && (
          <div className="atl-empty">
            <b>Здесь появятся твои дни</b>
            <span>Добавь место в записи или фото с геометкой, и день встанет на карту.</span>
            <a className="btn" href="#/new">
              + Записать день
            </a>
          </div>
        )}
        {open && (
          <div className="atl-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="atl-sheet-h">
              <b>{open[0].d.place?.name ?? (openName || 'Это место')}</b>
              <span>
                {open.length} {plural(open.length, 'день', 'дня', 'дней')}
              </span>
              <button className="atl-x" onClick={() => setOpen(null)} aria-label="Закрыть">
                ×
              </button>
            </div>
            <div className="atl-cards">
              {open.map((p) => {
                const src = photos[p.d.id]?.[0] ?? p.d.photoUrls?.[0] ?? covers[p.d.id];
                return (
                  <a key={p.d.id} className="atl-card" href={`#/day/${encodeURIComponent(p.d.id)}`}>
                    {src ? <img src={src} alt="" /> : <span className="atl-ph" />}
                    <b>{p.d.title}</b>
                    <small>{humanDate(p.d.date)}</small>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10,
    b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}
