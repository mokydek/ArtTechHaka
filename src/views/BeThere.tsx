import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDiary } from '../App';
import { loadImage } from '../lib/analysis/photo';
import { nameAt, searchPlaces, wmo, type PlaceHit } from '../lib/place';
import { dayHours, fromSun, readShot, shotContext, skyAt, toUtc, type HourWeather, type ShotContext, type SkyState } from '../lib/scene/context';
import type { SceneLayers } from '../lib/scene/depth';
import type { PlaceSound } from '../lib/scene/sound';
import type { Moment } from '../lib/scene/moment';
import type { DayRecord, ShotMeta } from '../lib/types';

// «Побывать там»: фото → место, минута, солнце и погода того момента → живое объёмное окно в тот момент

interface Source {
  bmp: ImageBitmap;
  meta: ShotMeta | null;
  rec: DayRecord | null;
  name: string;
}

const RUMB = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const rumb = (deg: number) => RUMB[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Погода, если архив недоступен: из записи дня */
function fallbackWeather(rec: DayRecord | null, hour: number, sky: SkyState): HourWeather | null {
  if (!rec) return null;
  const w = rec.place?.weather;
  const tags = new Set<string>([...(rec.analysis.text.weather ?? []), ...(w ? wmo(w.code).tags : [])]);
  if (!tags.size && !w) return null;
  const code = w?.code ?? (tags.has('storm') ? 95 : tags.has('snow') ? 73 : tags.has('rain') ? 63 : tags.has('fog') ? 45 : tags.has('clouds') ? 3 : 1);
  return {
    code,
    temp: w?.tmax != null && w.tmin != null ? (hour > 10 && hour < 19 ? w.tmax : w.tmin) : undefined,
    precip: tags.has('rain') ? 1 : 0,
    rain: tags.has('rain') ? 1 : 0,
    snow: tags.has('snow') ? 0.4 : 0,
    cloud: tags.has('rain') || tags.has('snow') || tags.has('storm') ? 95 : tags.has('clouds') ? 80 : tags.has('fog') ? 100 : 15,
    wind: w?.wind ?? 10,
    windDir: 220,
    isDay: sky.sunAlt > 0,
    utcOffset: NaN,
  };
}

export default function BeThere({ dayId, idx }: { dayId?: string; idx?: number }) {
  const { days, sealed, store } = useDiary();
  const rec = useMemo(() => (dayId ? [...days, ...sealed].find((d) => d.id === dayId) ?? null : null), [days, sealed, dayId]);
  const [src, setSrc] = useState<Source | null>(null);
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  const [layers, setLayers] = useState<SceneLayers | null>(null);
  const [ctx, setCtx] = useState<ShotContext | null>(null);
  const [hours, setHours] = useState<HourWeather[] | null | undefined>(undefined);
  const [minute, setMinute] = useState(0);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [where, setWhere] = useState(false);
  const [open, setOpen] = useState(false);
  // жест-подсказка «тяни, чтобы оглядеться» — только в первые разы
  const [hinted] = useState(() => {
    try {
      const n = +(localStorage.getItem('ottisk:hint-there') ?? 0);
      localStorage.setItem('ottisk:hint-there', String(n + 1));
      return n >= 2;
    } catch {
      return false;
    }
  });
  const holder = useRef<HTMLDivElement>(null);
  const world = useRef<Moment | null>(null);
  const osmRef = useRef<import('../lib/scene/osm').OsmWorld | null>(null);
  const [osmUsed, setOsmUsed] = useState(false);
  const audio = useRef<PlaceSound | null>(null);
  const lastHour = useRef(-1);
  const back = dayId ? `#/day/${dayId}` : '#/';

  // 1. источник: фото дня или своё
  useEffect(() => {
    if (!dayId || !rec || !store || src) return;
    (async () => {
      try {
        setStep('открываю фото');
        const m = rec.demo ? null : await store.media(rec);
        const urls = m?.photos.length ? m.photos : (rec.photoUrls ?? []);
        const i = Math.min(urls.length - 1, Math.max(0, idx ?? 0));
        if (i < 0) throw new Error('В этом дне нет фото');
        const bmp = await loadImage(urls[i], 1600);
        setSrc({ bmp, meta: rec.photoMeta?.[i] ?? null, rec, name: rec.title });
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Не удалось открыть фото');
      }
    })();
  }, [dayId, idx, rec, store, src]);

  const pickFile = async (f: File) => {
    setErr('');
    setStep('читаю метаданные снимка');
    try {
      const [meta, bmp] = await Promise.all([readShot(f), loadImage(f, 1600)]);
      setSrc({ bmp, meta, rec: null, name: f.name });
    } catch {
      setErr('Не получилось прочитать это фото');
      setStep('');
    }
  };

  // 2. слои, место, время, погода
  useEffect(() => {
    if (!src) return;
    let dead = false;
    (async () => {
      try {
        // место известно — дома и улицы вокруг грузим параллельно с глубиной
        const c0 = shotContext(src.rec, src.meta, src.bmp.width / src.bmp.height, src.rec?.place);
        const osmP = c0.source.place !== 'default' ? import('../lib/scene/osm').then((m) => m.fetchOsm(c0.lat, c0.lon)).catch(() => null) : Promise.resolve(null);
        const { buildLayers } = await import('../lib/scene/depth');
        const L = await buildLayers(src.bmp, (s) => !dead && setStep(s), { fill: false });
        if (dead) return;
        let c = shotContext(src.rec, src.meta, src.bmp.width / src.bmp.height, src.rec?.place);
        setStep('поднимаю архив погоды того дня');
        const h = await Promise.race([dayHours(c.lat, c.lon, c.local.slice(0, 10)), new Promise<null>((r) => setTimeout(() => r(null), 9000))]).catch(() => null);
        if (dead) return;
        // солнце в кадре: по нему — направление камеры и, если время неизвестно, минута
        if (L.sun && (c.source.heading !== 'exif' || c.source.time !== 'exif')) {
          setStep('ищу, где стояло солнце');
          const ho = h?.[0]?.utcOffset;
          const lonOff = Math.round(c.lon / 15) * 3600;
          const utcOf = (local: string) => toUtc(local, ho ?? (src.meta?.offset ? undefined : lonOff), src.meta?.offset);
          c = fromSun(c, L.sun, L.horizon, src.bmp.width / src.bmp.height, utcOf, src.rec?.analysis.text.timeOfDay ?? undefined);
        }
        setStep('ищу улицы вокруг');
        const els = await Promise.race([osmP, new Promise<null>((r) => setTimeout(() => r(null), 6000))]);
        if (dead) return;
        if (els) {
          const { localize } = await import('../lib/scene/osm');
          osmRef.current = localize(els, c.lat, c.lon, c.heading, c.source.heading !== 'guess');
        }
        setHours(h);
        setLayers(L);
        setCtx(c);
        setMinute(+c.local.slice(11, 13) * 60 + +c.local.slice(14, 16));
        if (c.source.place === 'gps') nameAt(c.lat, c.lon).then((p) => !dead && setCtx((o) => (o ? { ...o, place: [p.name, p.country].filter(Boolean).join(', ') } : o)));
      } catch (e) {
        console.error(e);
        if (!dead) setErr('Не получилось построить сцену');
      }
    })();
    return () => {
      dead = true;
    };
  }, [src]);

  const offset = useCallback(
    () => {
      const o = hours?.[0]?.utcOffset;
      if (o != null && !Number.isNaN(o)) return o;
      if (src?.meta?.offset) return undefined; // возьмёт из EXIF
      return Math.round((ctx?.lon ?? 75) / 15) * 3600;
    },
    [hours, src, ctx?.lon],
  );

  const skyFor = useCallback(
    (min: number) => {
      if (!ctx) return null;
      const local = `${ctx.local.slice(0, 10)}T${hm(min)}`;
      return skyAt(toUtc(local, offset(), src?.meta?.offset), ctx.lat, ctx.lon);
    },
    [ctx, offset, src],
  );

  const weatherFor = useCallback((hour: number, sky: SkyState) => hours?.[hour] ?? fallbackWeather(src?.rec ?? null, hour, sky), [hours, src]);

  // 3. сцена
  useEffect(() => {
    if (!layers || !ctx || !holder.current || world.current || !src) return;
    let dead = false;
    (async () => {
      setStep('ставлю небо того часа');
      const { Moment } = await import('../lib/scene/moment');
      if (dead || !holder.current) return;
      const photoMin = +ctx.local.slice(11, 13) * 60 + +ctx.local.slice(14, 16);
      const sky = skyFor(photoMin)!;
      const w = new Moment(holder.current, { layers, ctx, weather: weatherFor(ctx.hour, sky), sky, photo: src.bmp, osm: osmRef.current });
      setOsmUsed(w.osm);
      lastHour.current = ctx.hour;
      world.current = w;
      (window as unknown as { __ottiskWorld: Moment }).__ottiskWorld = w;
      setReady(true);
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, ctx?.heading, src]);

  useEffect(
    () => () => {
      world.current?.destroy();
      world.current = null;
      audio.current?.close();
    },
    [],
  );

  // время суток и погода часа
  const sky = useMemo(() => skyFor(minute), [skyFor, minute]);
  const hour = Math.floor(minute / 60) % 24;
  const weather = sky ? weatherFor(hour, sky) : null;
  useEffect(() => {
    const w = world.current;
    if (!w || !sky || !ready) return;
    if (lastHour.current !== hour) {
      lastHour.current = hour;
      w.setWeather(weather);
    }
    w.setSky(sky);
    audio.current?.set(weather, sky.sunAlt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sky, hour, ready, hours]);

  // звук стартует от первого касания (так требует браузер)
  const wake = async () => {
    if (!sound) return;
    if (!audio.current) {
      const { PlaceSound } = await import('../lib/scene/sound');
      const s = new PlaceSound();
      audio.current = s;
      if (world.current) world.current.onThunder = () => s.thunder();
      if (sky) s.set(weather, sky.sunAlt);
    }
    if (!audio.current.running) await audio.current.resume();
  };
  useEffect(() => {
    if (audio.current) audio.current.muted = !sound;
  }, [sound]);

  // наклон телефона — смотреть по сторонам и заглядывать за предметы (на iPhone — после разрешения)
  const motion = useRef(false);
  const askMotion = () => {
    if (motion.current) return;
    const D = (window as unknown as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }).DeviceOrientationEvent;
    if (!D?.requestPermission) {
      motion.current = true;
      return;
    }
    // iOS спрашивает только в ответ на касание (touchend/click)
    D.requestPermission()
      .then((r) => (motion.current = r === 'granted'))
      .catch(() => {});
  };
  useEffect(() => {
    if (!ready) return;
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      const a = screen.orientation?.angle ?? 0;
      // в горизонтальном положении оси меняются местами
      const [b, g] = a === 90 ? [-e.gamma, e.beta] : a === 270 || a === -90 ? [e.gamma, -e.beta] : [e.beta, e.gamma];
      world.current?.tilt(b, g);
    };
    window.addEventListener('deviceorientation', on);
    return () => window.removeEventListener('deviceorientation', on);
  }, [ready]);

  // управление: тянуть — оглядеться; на телефоне слева — джойстик, чтобы идти; мышь над кадром — заглянуть сбоку
  const touches = useRef(new Map<number, { x: number; y: number; stick: boolean; ox: number; oy: number }>());
  const stick = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent) => {
    wake();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isStick = e.pointerType === 'touch' && e.clientX - r.left < r.width * 0.42 && ![...touches.current.values()].some((t) => t.stick);
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY, stick: isStick, ox: e.clientX, oy: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (isStick && stick.current) {
      stick.current.classList.add('on');
      stick.current.style.left = e.clientX - r.left + 'px';
      stick.current.style.top = e.clientY - r.top + 'px';
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const w = world.current;
    if (!w) return;
    const d = touches.current.get(e.pointerId);
    if (d?.stick) {
      const dx = Math.max(-1, Math.min(1, (e.clientX - d.ox) / 46)),
        dy = Math.max(-1, Math.min(1, (e.clientY - d.oy) / 46));
      w.move = { x: dx, z: dy };
      const knob = stick.current?.firstElementChild as HTMLElement | null;
      if (knob) knob.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
      return;
    }
    if (d) {
      w.look(e.clientX - d.x, e.clientY - d.y);
      d.x = e.clientX;
      d.y = e.clientY;
      return;
    }
    if (e.pointerType === 'mouse') {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      w.lean(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const d = touches.current.get(e.pointerId);
    touches.current.delete(e.pointerId);
    if (d?.stick) {
      if (world.current) world.current.move = { x: 0, z: 0 };
      stick.current?.classList.remove('on');
      const knob = stick.current?.firstElementChild as HTMLElement | null;
      if (knob) knob.style.transform = '';
      if (stick.current) {
        stick.current.style.left = '';
        stick.current.style.top = '';
      }
    }
    askMotion();
  };

  const asPhoto = () => {
    if (!ctx) return;
    world.current?.reset();
    setMinute(+ctx.local.slice(11, 13) * 60 + +ctx.local.slice(14, 16));
  };

  const setPlace = async (p: PlaceHit) => {
    setWhere(false);
    if (!ctx) return;
    setCtx({ ...ctx, lat: p.lat, lon: p.lon, place: [p.name, p.country].filter(Boolean).join(', '), source: { ...ctx.source, place: 'day' } });
    setHours(undefined);
    const h = await dayHours(p.lat, p.lon, ctx.local.slice(0, 10)).catch(() => null);
    lastHour.current = -1;
    setHours(h);
  };
  const setDate = async (d: string) => {
    if (!ctx || !d) return;
    setCtx({ ...ctx, local: d + ctx.local.slice(10), source: { ...ctx.source, time: 'text' } });
    const h = await dayHours(ctx.lat, ctx.lon, d).catch(() => null);
    lastHour.current = -1;
    setHours(h);
  };

  // —— выбор фото ——
  if (!dayId && !src)
    return (
      <div className="there there-pick">
        <a className="there-x mono" href="#/">
          ×
        </a>
        <label className="there-drop">
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pickFile(e.target.files[0])} />
          <b>Побывать там</b>
          <span>Выберите фото, окажитесь в том месте, в ту минуту, под тем же небом.</span>
          <span className="mono">{step || 'выбрать фото'}</span>
          {err && <span className="mono there-err">{err}</span>}
        </label>
      </div>
    );

  const src0 = ctx?.source;
  const tags = weather ? wmo(weather.code) : null;
  const photoMin = ctx ? +ctx.local.slice(11, 13) * 60 + +ctx.local.slice(14, 16) : 0;
  return (
    <div className="there">
      <div ref={holder} className="there-gl" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={(e) => e.pointerType === 'mouse' && world.current?.lean(0, 0)} />
      {ready && !hinted && <div className="gesture" aria-hidden />}
      {ready && (
        <div ref={stick} className="there-stick" aria-hidden>
          <i />
        </div>
      )}
      {!ready && (
        <div className="there-load">
          {src && <BlurPhoto bmp={src.bmp} />}
          <p className="mono">{err || step || 'готовлю…'}</p>
        </div>
      )}
      <a className="there-x mono" href={back}>
        ×
      </a>
      {ready && ctx && sky && (
        <>
          <div className={'there-card' + (open ? ' open' : '')}>
            <button className="there-sum" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <b>{ctx.place}</b>
              <span>
                {hm(minute)}
                {tags && ` · ${tags.label}`}
                {weather?.temp != null && ` ${weather.temp > 0 ? '+' : ''}${Math.round(weather.temp)}°`}
              </span>
            </button>
            {open && (
              <div className="there-more">
                <div>
                  <button className="there-link" onClick={() => setWhere((v) => !v)}>
                    изменить место
                  </button>
                  <small>{src0?.place === 'gps' ? 'GPS из фото' : src0?.place === 'day' ? 'место из записи' : 'место не указано'}</small>
                </div>
                {where && <WherePicker onPick={setPlace} />}
                <div>
                  <input className="there-date mono" type="date" value={ctx.local.slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
                  <small>{minute === photoMin ? (src0?.time === 'exif' ? 'время снимка' : src0?.time === 'sun' ? 'время по солнцу на фото' : src0?.time === 'text' ? 'время по записи' : 'время не указано') : `снимок, ${hm(photoMin)}`}</small>
                </div>
                <div>
                  {weather ? (
                    <>
                      ветер {Math.round(weather.wind / 3.6)} м/с, {rumb(weather.windDir)} · облака {Math.round(weather.cloud)}%
                    </>
                  ) : hours === undefined ? (
                    '…'
                  ) : (
                    'погода того часа неизвестна'
                  )}
                  <small>{hours ? 'архив погоды' : weather ? 'погода из записи' : ''}</small>
                </div>
                {osmUsed && (
                  <div>
                    дома и улицы вокруг <small>© OpenStreetMap</small>
                  </div>
                )}
                <div>
                  {sky.sunAlt > 0 ? `солнце ${Math.round(sky.sunAlt)}° над горизонтом, ${rumb(sky.sunAz)}` : `солнце за горизонтом`} · луна {Math.round(sky.moonFrac * 100)}%
                </div>
              </div>
            )}
          </div>
          <div className="there-bar">
            <input type="range" min={0} max={1439} step={5} value={minute} onChange={(e) => setMinute(+e.target.value)} aria-label="время суток" />
            <button className="btn small" onClick={asPhoto}>
              как на фото
            </button>
            <button
              className="btn ghost small"
              onClick={() => {
                setSound((s) => !s);
                wake();
              }}
            >
              звук {sound ? 'вкл' : 'выкл'}
            </button>
          </div>
          <div className="there-hint mono">WASD, идти · Shift, быстрее · тянуть, смотреть</div>
        </>
      )}
    </div>
  );
}

function BlurPhoto({ bmp }: { bmp: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
  }, [bmp]);
  return <canvas ref={ref} />;
}

function WherePicker({ onPick }: { onPick: (p: PlaceHit) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const t = useRef(0);
  return (
    <div className="there-where">
      <input
        autoFocus
        className="mono"
        placeholder="город или место"
        value={q}
        onChange={(e) => {
          const v = e.target.value;
          setQ(v);
          clearTimeout(t.current);
          t.current = window.setTimeout(() => searchPlaces(v).then(setHits).catch(() => setHits([])), 300);
        }}
      />
      {hits.map((h) => (
        <button key={`${h.lat},${h.lon}`} onClick={() => onPick(h)}>
          {h.name}
          <small>{[h.admin, h.country].filter(Boolean).join(', ')}</small>
        </button>
      ))}
    </div>
  );
}
