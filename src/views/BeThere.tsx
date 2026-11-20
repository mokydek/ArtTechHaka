import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDiary } from '../App';
import { loadImage } from '../lib/analysis/photo';
import { nameAt, searchPlaces, wmo, type PlaceHit } from '../lib/place';
import { dayHours, fromSun, readShot, shotContext, skyAt, toUtc, type HourWeather, type ShotContext, type SkyState } from '../lib/scene/context';
import type { SceneLayers } from '../lib/scene/depth';
import type { PlaceSound } from '../lib/scene/sound';
import type { World } from '../lib/scene/world';
import type { DayRecord, ShotMeta } from '../lib/types';

// «Побывать там»: фото → место, минута, солнце и погода того момента → сцена, по которой можно пройтись

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
  const holder = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);
  const audio = useRef<PlaceSound | null>(null);
  const compass = useRef<HTMLDivElement>(null);
  const facing = useRef<HTMLSpanElement>(null);
  const lastHour = useRef(-1);
  const photoLocal = useRef('');
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
        const { buildLayers } = await import('../lib/scene/depth');
        const L = await buildLayers(src.bmp, (s) => !dead && setStep(s));
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
        photoLocal.current = c.local;
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
      const { World } = await import('../lib/scene/world');
      if (dead || !holder.current) return;
      const photoMin = +ctx.local.slice(11, 13) * 60 + +ctx.local.slice(14, 16);
      const sky = skyFor(photoMin)!;
      const w = new World(holder.current, { layers, ctx, weather: weatherFor(ctx.hour, sky), sky, photoAspect: src.bmp.width / src.bmp.height });
      lastHour.current = ctx.hour;
      w.onFrame = (h) => {
        if (compass.current) compass.current.style.transform = `translateX(${-h * 4}px)`;
        if (facing.current) facing.current.textContent = `${rumb(h)} ${Math.round(h)}°`;
      };
      world.current = w;
      (window as unknown as { __ottiskWorld: World }).__ottiskWorld = w;
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
    // небо снимка — в минуту съёмки; чем дальше по времени, тем больше небо того часа
    const p = photoLocal.current;
    const pm = +p.slice(11, 13) * 60 + +p.slice(14, 16);
    const same = ctx?.local.slice(0, 10) === p.slice(0, 10);
    w.setPhotoSky(same ? 1 - Math.min(1, Math.max(0, (Math.abs(minute - pm) - 10) / 80)) : 0);
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

  // управление: тянуть — смотреть; на телефоне слева — джойстик
  const drag = useRef<{ id: number; x: number; y: number; stick: boolean } | null>(null);
  const stick = useRef<HTMLDivElement>(null);
  const onDown = (e: React.PointerEvent) => {
    wake();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const isStick = e.pointerType === 'touch' && e.clientX - r.left < r.width * 0.42;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, stick: isStick };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (isStick && stick.current) {
      stick.current.style.display = 'block';
      stick.current.style.left = e.clientX - r.left + 'px';
      stick.current.style.top = e.clientY - r.top + 'px';
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const w = world.current;
    if (!d || d.id !== e.pointerId || !w) return;
    if (d.stick) {
      const dx = Math.max(-1, Math.min(1, (e.clientX - d.x) / 50)),
        dy = Math.max(-1, Math.min(1, (e.clientY - d.y) / 50));
      w.move = { x: dx, z: dy };
      const knob = stick.current?.firstElementChild as HTMLElement | null;
      if (knob) knob.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
    } else {
      w.look(e.clientX - d.x, e.clientY - d.y);
      d.x = e.clientX;
      d.y = e.clientY;
    }
  };
  const onUp = () => {
    if (drag.current?.stick && world.current) world.current.move = { x: 0, z: 0 };
    drag.current = null;
    if (stick.current) stick.current.style.display = 'none';
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
          <span>Выберите фото — окажитесь в том месте, в ту минуту, под тем же небом.</span>
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
      <div ref={holder} className="there-gl" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      <div ref={stick} className="there-stick">
        <i />
      </div>
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
          <div className="there-compass">
            <div ref={compass} className="there-tape">
              {Array.from({ length: 49 }, (_, i) => i * 15 - 360).map((d) => (
                <span key={d} style={{ left: d * 4 }} className={d % 45 ? 'tick' : 'tick big'}>
                  {d % 45 ? '' : rumb(d)}
                </span>
              ))}
              {[-360, 0, 360].map((o) => (
                <span key={'s' + o} className={'sun' + (sky.sunAlt < 0 ? ' down' : '')} style={{ left: (sky.sunAz + o) * 4 }}>
                  ☀
                </span>
              ))}
              {sky.moonAlt > 0 &&
                [-360, 0, 360].map((o) => (
                  <span key={'m' + o} className="moon" style={{ left: (sky.moonAz + o) * 4 }}>
                    ☾
                  </span>
                ))}
            </div>
            <div className="there-needle" />
          </div>
          <div className="there-card">
            <div className="there-place">
              <button className="there-link" onClick={() => setWhere((v) => !v)} title="изменить место">
                ⌖ {ctx.place}
              </button>
              <small>{src0?.place === 'gps' ? 'GPS из фото' : src0?.place === 'day' ? 'место из записи' : 'место не указано'}</small>
            </div>
            {where && <WherePicker onPick={setPlace} />}
            <div>
              <input className="there-date mono" type="date" value={ctx.local.slice(0, 10)} onChange={(e) => setDate(e.target.value)} /> <b>{hm(minute)}</b>{' '}
              <small>{minute === photoMin ? (src0?.time === 'exif' ? 'время снимка' : src0?.time === 'sun' ? 'время по солнцу на фото' : src0?.time === 'text' ? 'время по записи' : 'время не указано') : `снимок — ${hm(photoMin)}`}</small>
            </div>
            <div>
              {weather ? (
                <>
                  {tags?.label}
                  {weather.temp != null && ` · ${weather.temp > 0 ? '+' : ''}${Math.round(weather.temp)}°`} · ветер {Math.round(weather.wind / 3.6)} м/с {rumb(weather.windDir)} · облака {Math.round(weather.cloud)}%
                </>
              ) : hours === undefined ? (
                '…'
              ) : (
                'погода того часа неизвестна'
              )}
              <small>{hours ? 'архив погоды' : weather ? 'погода из записи' : ''}</small>
            </div>
            <div>
              {sky.sunAlt > 0 ? `солнце ${Math.round(sky.sunAlt)}° над горизонтом, ${rumb(sky.sunAz)} ${Math.round(sky.sunAz)}°` : `солнце за горизонтом (${Math.round(sky.sunAlt)}°)`} · луна {Math.round(sky.moonFrac * 100)}%
            </div>
            <div>
              взгляд: <span ref={facing}>—</span> <small>{src0?.heading === 'exif' ? 'компас снимка' : src0?.heading === 'sun' ? 'по солнцу на фото' : 'направление угадано'}</small>
            </div>
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
          <div className="there-hint mono">WASD — идти · Shift — быстрее · тянуть — смотреть</div>
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
