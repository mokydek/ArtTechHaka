import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDiary } from '../App';
import Atmos from '../components/Atmos';
import { loadImage } from '../lib/analysis/photo';
import { nameAt, searchPlaces, wmo, type PlaceHit } from '../lib/place';
import { dayHours, readShot, shotContext, skyAt, toUtc, vfov, type HourWeather, type ShotContext, type SkyState } from '../lib/scene/context';
import type { PlaceSound } from '../lib/scene/sound';
import type { PanoHit, Ymaps } from '../lib/scene/yandex';
import Imagined, { type Source } from './Imagined';

// «Побывать там»: фото → настоящее место. Где снято — по GPS снимка, геолокации свежего кадра,
// адресу или названию на табличке; иначе человек отмечает точку на карте.
// Вокруг — настоящие панорамы улиц (Яндекс Карты), а не дорисовка. Нет панорам или это помещение — так и говорим.

type Via = 'gps' | 'here' | 'address' | 'map' | 'sign' | 'day' | 'none';
interface Loc {
  lat: number;
  lon: number;
  name: string;
  via: Via;
  /** точка известна до дома — ищем панораму сразу */
  precise: boolean;
  word?: string;
  others?: PlaceHit[];
}
type PanoState = { st: 'idle' } | { st: 'search' } | { st: 'found'; hit: PanoHit } | { st: 'none' } | { st: 'frame' };
type Mode = 'moment' | 'pano' | 'map' | 'room';

const RUMB = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const rumb = (deg: number) => RUMB[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const NEAR_OK = 40; // м: дальше — честно говорим, насколько далеко панорама

const VIA: Record<Via, (l: Loc) => string> = {
  gps: (l) => (l.word === 'device' ? 'по геолокации телефона, когда снимок добавили' : 'по GPS снимка'),
  here: () => 'где вы сейчас: снимок свежий',
  address: (l) => `по адресу на табличке «${l.word ?? ''}»`,
  map: () => 'отмечено на карте',
  sign: (l) => `по табличке «${l.word ?? ''}» — только населённый пункт`,
  day: () => 'город из записи',
  none: () => 'место неизвестно',
};

export default function BeThere({ dayId, idx }: { dayId?: string; idx?: number }) {
  const { days, sealed, store } = useDiary();
  const rec = useMemo(() => (dayId ? [...days, ...sealed].find((d) => d.id === dayId) ?? null : null), [days, sealed, dayId]);
  const [src, setSrc] = useState<Source | null>(null);
  const [step, setStep] = useState('');
  const [err, setErr] = useState('');
  const [loc, setLoc] = useState<Loc | null>(null);
  const [inside, setInside] = useState(false);
  const [ctx, setCtx] = useState<ShotContext | null>(null);
  const [hours, setHours] = useState<HourWeather[] | null | undefined>(undefined);
  const [minute, setMinute] = useState(0);
  const [pano, setPano] = useState<PanoState>({ st: 'idle' });
  const [mode, setMode] = useState<Mode>('moment');
  const [heading, setHeading] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(true);
  const audio = useRef<PlaceSound | null>(null);
  const back = dayId ? `#/day/${dayId}` : '#/';

  // 1. снимок: из дня или свой
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

  // 2. где это снято
  useEffect(() => {
    if (!src) return;
    let dead = false;
    (async () => {
      const where = await import('../lib/scene/where');
      const cues = where.outdoorCues(src.bmp);
      if (dead) return;
      setInside(cues.verdict === 'unclear');
      const dayPlace = src.rec?.place ?? null;
      let L: Loc;
      if (src.meta?.lat != null && src.meta.lon != null) {
        L = { lat: src.meta.lat, lon: src.meta.lon, name: `${src.meta.lat.toFixed(4)}, ${src.meta.lon.toFixed(4)}`, via: 'gps', precise: true, word: src.meta.geo };
        nameAt(L.lat, L.lon).then((p) => !dead && setLoc((o) => (o && o.via === 'gps' && /^\d/.test(o.name) ? { ...o, name: [p.name, p.country].filter(Boolean).join(', ') } : o)));
      } else {
        setStep('ищу, где это снято');
        const f = await Promise.race([
          where.findPlace(src.bmp, src.meta, { near: dayPlace ?? days.find((d) => d.place)?.place ?? undefined, onStep: (s) => !dead && setStep(s) }),
          new Promise<null>((r) => setTimeout(() => r(null), 35000)),
        ]).catch(() => null);
        if (dead) return;
        if (f)
          L = {
            lat: f.lat,
            lon: f.lon,
            name: f.via === 'sign' ? [f.name, f.admin].filter(Boolean).join(', ') : f.via === 'here' ? [f.name, f.country].filter(Boolean).join(', ') : f.name,
            via: f.via,
            precise: f.precise,
            word: f.word,
            others: f.others,
          };
        else if (dayPlace) L = { lat: dayPlace.lat, lon: dayPlace.lon, name: dayPlace.name, via: 'day', precise: false };
        else L = { lat: NaN, lon: NaN, name: 'Место неизвестно', via: 'none', precise: false };
      }
      setLoc(L);
      setStep('');
    })();
    return () => {
      dead = true;
    };
  }, [src]);

  // 3. время и погода — когда известно хотя бы примерно где
  useEffect(() => {
    if (!src || !loc) return;
    let dead = false;
    const known = loc.via !== 'none';
    const c = shotContext(src.rec, src.meta, src.bmp.width / src.bmp.height, known ? { name: loc.name, lat: loc.lat, lon: loc.lon } : undefined);
    setCtx(c);
    setMinute(+c.local.slice(11, 13) * 60 + +c.local.slice(14, 16));
    setHeading(src.meta?.heading ?? null);
    if (!known) {
      setHours(null);
      return;
    }
    setHours(undefined);
    Promise.race([dayHours(loc.lat, loc.lon, c.local.slice(0, 10)), new Promise<null>((r) => setTimeout(() => r(null), 9000))])
      .catch(() => null)
      .then((h) => !dead && setHours(h));
    return () => {
      dead = true;
    };
  }, [src, loc?.lat, loc?.lon, loc?.via]); // eslint-disable-line react-hooks/exhaustive-deps

  // 4. точка известна — ищем настоящую панораму рядом
  useEffect(() => {
    if (!loc?.precise) {
      setPano({ st: 'idle' });
      return;
    }
    let dead = false;
    setPano({ st: 'search' });
    import('../lib/scene/yandex')
      .then((y) => y.nearestPano(loc.lat, loc.lon))
      .then((hit) => !dead && setPano(hit && hit.dist < 400 ? { st: 'found', hit } : { st: 'none' }))
      // API Яндекса недоступен (ключ, суточный лимит) — откроем встроенную панораму Яндекс Карт без проверки
      .catch(() => !dead && setPano({ st: 'frame' }));
    return () => {
      dead = true;
    };
  }, [loc?.lat, loc?.lon, loc?.precise]); // eslint-disable-line react-hooks/exhaustive-deps

  const offset = useCallback(() => {
    const o = hours?.[0]?.utcOffset;
    if (o != null && !Number.isNaN(o)) return o;
    if (src?.meta?.offset) return undefined;
    return Math.round((ctx?.lon ?? 75) / 15) * 3600;
  }, [hours, src, ctx?.lon]);
  const skyFor = useCallback(
    (min: number): SkyState | null => {
      if (!ctx || !loc || loc.via === 'none') return null;
      return skyAt(toUtc(`${ctx.local.slice(0, 10)}T${hm(min)}`, offset(), src?.meta?.offset), ctx.lat, ctx.lon);
    },
    [ctx, loc, offset, src],
  );
  const photoMin = ctx ? +ctx.local.slice(11, 13) * 60 + +ctx.local.slice(14, 16) : 0;
  const sky = useMemo(() => skyFor(minute), [skyFor, minute]);
  const photoSky = useMemo(() => skyFor(photoMin), [skyFor, photoMin]);
  const hour = Math.floor(minute / 60) % 24;
  const weather = hours?.[hour] ?? null;

  useEffect(() => {
    if (sky) audio.current?.set(weather, sky.sunAlt);
  }, [sky, weather]);
  useEffect(() => {
    if (audio.current) audio.current.muted = !sound;
  }, [sound]);
  useEffect(() => () => audio.current?.close(), []);
  const wake = async () => {
    if (!sound) return;
    if (!audio.current) {
      const { PlaceSound } = await import('../lib/scene/sound');
      audio.current = new PlaceSound();
      if (sky) audio.current.set(weather, sky.sunAlt);
    }
    if (!audio.current.running) await audio.current.resume();
  };

  const placeFromMap = (lat: number, lon: number) => {
    setLoc({ lat, lon, name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, via: 'map', precise: true });
    setMode('moment');
    nameAt(lat, lon).then((p) => setLoc((o) => (o?.via === 'map' && o.lat === lat ? { ...o, name: [p.name, p.country].filter(Boolean).join(', ') } : o)));
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
          <span>Выберите фото — окажитесь на том самом месте, на настоящей улице, в ту минуту.</span>
          <span className="mono">{step || 'выбрать фото'}</span>
          {err && <span className="mono there-err">{err}</span>}
        </label>
      </div>
    );

  if (mode === 'room' && src) return <Imagined src={{ ...src, place: loc && loc.via !== 'none' ? { name: loc.name, lat: loc.lat, lon: loc.lon } : null }} onBack={() => setMode('moment')} />;

  const aspect = src ? src.bmp.width / src.bmp.height : 1;
  const fovV = vfov(src?.meta, aspect);
  const fovH = (2 * Math.atan(Math.tan((fovV * Math.PI) / 360) * aspect) * 180) / Math.PI;
  const tags = weather ? wmo(weather.code) : null;
  const found = pano.st === 'found' ? pano.hit : null;
  // где искать на карте: найденное место, иначе — город из последних записей дневника
  const lastPlace = src?.rec?.place ?? days.find((d) => d.place)?.place ?? null;
  const center = loc && loc.via !== 'none' ? { lat: loc.lat, lon: loc.lon, zoom: loc.precise ? 17 : loc.via === 'day' ? 12 : 14 } : lastPlace ? { lat: lastPlace.lat, lon: lastPlace.lon, zoom: 12 } : { lat: 51.1283, lon: 71.4305, zoom: 12 };

  return (
    <div className="there" onPointerDown={wake}>
      {src && mode === 'moment' && <PhotoStage bmp={src.bmp} />}
      {mode === 'pano' && pano.st === 'frame' && src && loc && <PanoFrame lat={loc.lat} lon={loc.lon} heading={heading} bmp={src.bmp} onBack={() => setMode('moment')} />}
      {mode === 'pano' && found && src && (
        <PanoView onFail={() => setPano({ st: 'frame' })} hit={found} at={[loc!.lat, loc!.lon]} bmp={src.bmp} heading={heading} fovH={fovH} fovV={fovV} onHeading={setHeading} onBack={() => setMode('moment')} />
      )}
      {mode === 'map' && <MapPick center={center} onPick={placeFromMap} onCancel={() => setMode('moment')} />}
      {mode !== 'map' && sky && <Atmos sunAlt={sky.sunAlt} base={mode === 'pano' ? null : (photoSky?.sunAlt ?? null)} weather={weather} />}

      {!loc && (
        <div className="there-load">
          {src && <p className="mono">{err || step || 'готовлю…'}</p>}
          {!src && <p className="mono">{err || step || 'открываю…'}</p>}
        </div>
      )}
      {mode !== 'map' && (
        <a className="there-x mono" href={back} aria-label="закрыть">
          ×
        </a>
      )}

      {loc && ctx && mode !== 'map' && (
        <>
          <div className={'there-card' + (open ? ' open' : '')}>
            <button className="there-sum" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
              <b>{mode === 'pano' && found?.name ? found.name : loc.name}</b>
              <span>
                {sky ? hm(minute) : ctx.source.time === 'exif' ? hm(photoMin) : 'время неизвестно'}
                {tags && ` · ${tags.label}`}
                {weather?.temp != null && ` ${weather.temp > 0 ? '+' : ''}${Math.round(weather.temp)}°`}
              </span>
            </button>
            {open && (
              <div className="there-more">
                <div>
                  <button className="there-link" onClick={() => setMode('map')}>
                    {loc.via === 'none' ? 'указать место' : 'изменить место'}
                  </button>
                  <small>{VIA[loc.via](loc)}</small>
                </div>
                <div>
                  {ctx.local.slice(0, 10).split('-').reverse().join('.')}
                  <small>{ctx.source.time === 'exif' ? 'время снимка' : ctx.source.time === 'text' ? 'время по записи' : 'дата и время не указаны в снимке'}</small>
                </div>
                {weather && (
                  <div>
                    ветер {Math.round(weather.wind / 3.6)} м/с, {rumb(weather.windDir)} · облака {Math.round(weather.cloud)}%<small>архив погоды</small>
                  </div>
                )}
                {sky && (
                  <div>
                    {sky.sunAlt > 0 ? `солнце ${Math.round(sky.sunAlt)}° над горизонтом, ${rumb(sky.sunAz)}` : 'солнце за горизонтом'} · луна {Math.round(sky.moonFrac * 100)}%
                  </div>
                )}
                {mode === 'pano' && <div>панорама улицы <small>© Яндекс Карты</small></div>}
              </div>
            )}
          </div>

          {mode === 'moment' && (
            <Status
              loc={loc}
              pano={pano}
              inside={inside}
              onPano={() => setMode('pano')}
              onMap={() => setMode('map')}
              onRoom={() => setMode('room')}
            />
          )}

          {sky && (
            <div className={'there-bar' + (mode === 'moment' ? ' up' : '')}>
              <input type="range" min={0} max={1439} step={5} value={minute} onChange={(e) => setMinute(+e.target.value)} aria-label="время суток" />
              <button className="btn small" onClick={() => setMinute(photoMin)}>
                как на фото
              </button>
              <button className="btn ghost small" onClick={() => setSound((s) => !s)}>
                звук {sound ? 'вкл' : 'выкл'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Честно о том, что нашли и чего нет — и что можно сделать */
function Status({ loc, pano, inside, onPano, onMap, onRoom }: { loc: Loc; pano: PanoState; inside: boolean; onPano: () => void; onMap: () => void; onRoom: () => void }) {
  let text = '';
  const acts: [string, () => void, boolean?][] = [];
  if (loc.precise) {
    if (pano.st === 'search') text = 'Нашёл место. Ищу панораму улицы рядом…';
    else if (pano.st === 'found') {
      const d = Math.round(pano.hit.dist);
      text = d <= NEAR_OK ? `Нашёл место: панорама улицы в ${d} м от точки снимка.` : `Нашёл место, но ближайшая панорама улицы — в ${d} м от точки снимка.`;
      if (inside) text += ' Снимок похож на помещение — панорама покажет улицу снаружи.';
      acts.push([d <= NEAR_OK ? 'Оглядеться на месте' : 'Посмотреть оттуда', onPano, true]);
      acts.push(['Другое место', onMap]);
    } else if (pano.st === 'none') {
      text = 'Место нашёл, но здесь нет панорам улиц. Придумывать вид вокруг не буду.';
      acts.push(['Отметить другое место', onMap]);
      if (inside) acts.push(['Додумать комнату', onRoom]);
    } else if (pano.st === 'frame') {
      text = 'Нашёл место. Открою панораму Яндекс Карт рядом — заранее проверить, есть ли она здесь, сейчас не получается.';
      acts.push(['Оглядеться на месте', onPano, true]);
      acts.push(['Другое место', onMap]);
    }
  } else if (loc.via === 'sign') {
    text = `По табличке это ${loc.name}. Где именно стояли — по кадру не понять: отметьте точку на карте.`;
    acts.push(['Отметить на карте', onMap, true]);
  } else if (loc.via === 'day') {
    text = `Из записи знаю только город: ${loc.name}. Отметьте точку, где сделан снимок.`;
    acts.push(['Отметить на карте', onMap, true]);
  } else if (inside) {
    text = 'Не вижу в кадре ни неба, ни улицы — похоже на помещение. Внутри домов панорам нет, а придумывать комнату без спроса не буду.';
    acts.push(['Додумать комнату', onRoom]);
    acts.push(['Это улица — отметить на карте', onMap]);
  } else {
    text = 'Не нашёл, где это снято: в фото нет GPS, а адресов и названий в кадре не видно. Отметьте точку на карте — и окажетесь там.';
    acts.push(['Отметить на карте', onMap, true]);
  }
  // на iPhone геопозиция фото передаётся сайту, только если включить её в окне выбора фото
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const tip = ios && !loc.precise ? 'На iPhone: в окне выбора фото нажмите «Параметры» и включите геопозицию — тогда место найдётся само.' : '';
  return (
    <div className="there-status">
      <p>{text}</p>
      {tip && <p className="there-tip">{tip}</p>}
      {acts.length > 0 && (
        <div>
          {acts.map(([t, f, main]) => (
            <button key={t} className={'btn small' + (main ? '' : ' ghost')} onClick={f}>
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Сам снимок: резкий, целиком, без искажений; по краям — он же, размытый */
function PhotoStage({ bmp }: { bmp: ImageBitmap }) {
  const a = useRef<HTMLCanvasElement>(null),
    b = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    for (const c of [a.current, b.current]) {
      if (!c) continue;
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
    }
  }, [bmp]);
  return (
    <div className="there-photo">
      <canvas ref={a} className="bg" />
      <canvas ref={b} className="fg" />
    </div>
  );
}

// —— проекция снимка на панораму: 4 угла кадра → экран, CSS matrix3d ——
type V3 = [number, number, number];
const R = Math.PI / 180;
const dirv = (b: number, p: number): V3 => [Math.cos(p * R) * Math.sin(b * R), Math.sin(p * R), Math.cos(p * R) * Math.cos(b * R)];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
function adj(m: number[]) {
  return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]];
}
function mm(a: number[], b: number[]) {
  const c = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) c[3 * i + j] += a[3 * i + k] * b[3 * k + j];
  return c;
}
function mv(m: number[], v: number[]) {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}
function basis(p: number[]) {
  const m = [p[0], p[2], p[4], p[1], p[3], p[5], 1, 1, 1];
  const v = mv(adj(m), [p[6], p[7], 1]);
  return mm(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}
/** Прямоугольник w×h → четырёхугольник q (TL, TR, BL, BR) */
function matrix3d(w: number, h: number, q: number[]) {
  const s = basis([0, 0, w, 0, 0, h, w, h]);
  const d = basis(q);
  const t = mm(d, adj(s)).map((x, _, arr) => x / arr[8]);
  return `matrix3d(${[t[0], t[3], 0, t[6], t[1], t[4], 0, t[7], 0, 0, 1, 0, t[2], t[5], 0, t[8]].join(',')})`;
}

/** Настоящая панорама улицы; снимок закреплён там, куда смотрела камера */
function PanoView({ hit, at, bmp, heading, fovH, fovV, onHeading, onBack, onFail }: { hit: PanoHit; at: [number, number]; bmp: ImageBitmap; heading: number | null; fovH: number; fovV: number; onHeading: (h: number) => void; onBack: () => void; onFail: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const pin = useRef<HTMLCanvasElement>(null);
  const player = useRef<Ymaps | null>(null);
  const [far, setFar] = useState(false);
  const [show, setShow] = useState<'on' | 'ghost' | 'off'>('on');
  const [align, setAlign] = useState(heading == null);
  // поиск направления по самому снимку: search — идёт, ok — нашли, unsure — не уверены
  const [auto, setAuto] = useState<'idle' | 'search' | 'ok' | 'unsure'>('idle');
  const [pitch, setPitch] = useState(0);
  const origin = useRef<[number, number]>(hit.pos);
  const st = useRef({ heading, align, show, far, pitch });
  st.current = { heading, align, show, far, pitch };

  // где сейчас снимок на экране
  const place = useCallback(() => {
    const p = player.current,
      c = pin.current,
      box = el.current;
    if (!p || !c || !box) return;
    const { heading: H, align: al, show: sh, far: fr, pitch: Pp } = st.current;
    if (sh === 'off' || fr) {
      c.style.visibility = 'hidden';
      return;
    }
    const [B, P] = p.getDirection() as number[];
    const [hs, vs] = p.getSpan() as number[];
    const W = box.clientWidth,
      Hh = box.clientHeight;
    // совмещение: снимок держится в центре экрана, человек поворачивает панораму под него
    const hd = al || H == null ? B : H,
      pd = al || H == null ? P : Pp;
    const f = dirv(B, P),
      r: V3 = [Math.cos(B * R), 0, -Math.sin(B * R)];
    const u = cross(f, r);
    const c0 = dirv(hd, pd),
      rp: V3 = [Math.cos(hd * R), 0, -Math.sin(hd * R)];
    const up = cross(c0, rp);
    const tx = Math.tan((fovH / 2) * R),
      ty = Math.tan((fovV / 2) * R);
    const th = Math.tan((hs / 2) * R),
      tv = Math.tan((vs / 2) * R);
    const q: number[] = [];
    for (const [sx, sy] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const d = add(add(c0, rp, sx * tx), up, sy * ty);
      const z = dot(d, f);
      if (z < 0.05) {
        c.style.visibility = 'hidden';
        return;
      }
      q.push(W / 2 + (dot(d, r) / z / th) * (W / 2), Hh / 2 - (dot(d, u) / z / tv) * (Hh / 2));
    }
    c.style.visibility = 'visible';
    c.style.opacity = al ? '0.5' : sh === 'ghost' ? '0.45' : '1';
    c.style.transform = matrix3d(c.width, c.height, q);
  }, [fovH, fovV]);

  useEffect(() => {
    let dead = false;
    import('../lib/scene/yandex')
      .then(async (y) => {
        const ym = await y.loadYmaps();
        if (dead || !el.current) return;
        const pl = new ym.panorama.Player(el.current, hit.pano, {
          direction: heading != null ? [heading, 0] : 'auto',
          controls: ['zoomControl'],
          suppressMapOpenBlock: true,
          hotkeysEnabled: true,
        });
        player.current = pl;
        (window as unknown as { __ottiskPano?: Ymaps }).__ottiskPano = pl;
        pl.events.add(['directionchange', 'spanchange'], place);
        pl.events.add('error', () => !dead && onFail());
        pl.events.add('panoramachange', () => {
          const pos = pl.getPanorama().getPosition() as number[];
          setFar(y.meters(origin.current, [pos[0], pos[1]]) > 14);
        });
        place();
        // куда смотрела камера, неизвестно — ищем сами: сравниваем снимок с этой и соседними панорамами
        if (heading != null) return;
        setAuto('search');
        try {
          const A = await import('../lib/scene/align');
          const ph = A.photoFeatures(bmp);
          const cands: Ymaps[] = [hit.pano];
          try {
            const arrows = (hit.pano.getConnectionArrows?.() ?? []) as Ymaps[];
            for (const a of arrows.slice(0, 6)) {
              const p = await a.getConnectedPanorama();
              const pos = p.getPosition() as number[];
              if (y.meters(at, [pos[0], pos[1]]) < 45) cands.push(p);
            }
          } catch {
            /* без соседей */
          }
          let best: { p: Ymaps; r: import('../lib/scene/align').AlignResult } | null = null;
          for (const p of cands) {
            const e = await A.panoEquirect(p, 2048);
            await new Promise((r) => setTimeout(r, 0));
            const r = A.alignOn(e, ph, fovH, fovV);
            if (!best || r.score > best.r.score) best = { p, r };
            if (dead) return;
          }
          (window as unknown as { __ottiskAlign?: unknown }).__ottiskAlign = best && { heading: best.r.heading, pitch: best.r.pitch, score: best.r.score, sure: best.r.sure, n: cands.length };
          if (best && best.r.sure > 1) {
            if (best.p !== hit.pano) {
              await pl.setPanorama(best.p);
              const pos = best.p.getPosition() as number[];
              origin.current = [pos[0], pos[1]];
              setFar(false);
            }
            pl.setDirection([best.r.heading, best.r.pitch]);
            setPitch(best.r.pitch);
            onHeading(best.r.heading);
            setAlign(false);
            setAuto('ok');
          } else {
            // не уверены — разворачиваем к лучшему варианту, а человек поправит и подтвердит
            if (best) pl.setDirection([best.r.heading, best.r.pitch]);
            setAuto('unsure');
          }
        } catch (e) {
          console.warn('[Imprint] совмещение по снимку не вышло', e);
          if (!dead) setAuto('unsure');
        }
      })
      // плеер API не открылся — переходим на встроенную панораму Яндекс Карт
      .catch(() => !dead && onFail());
    return () => {
      dead = true;
      player.current?.destroy();
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit]);

  useEffect(() => {
    const c = pin.current;
    if (!c) return;
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    place();
  }, [bmp, place]);
  useEffect(() => place(), [heading, align, show, far, pitch, place]);
  useEffect(() => {
    const on = () => place();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, [place]);

  const fix = () => {
    const p = player.current;
    if (!p) return;
    onHeading((p.getDirection() as number[])[0]);
    setAlign(false);
  };

  return (
    <div className="there-pano">
      <div ref={el} className="there-player" />
      <div className="there-pinbox" aria-hidden>
        <canvas ref={pin} className="there-pin" />
      </div>
      <div className="there-pano-bar">
        <button className="btn small ghost" onClick={onBack}>
          ← к снимку
        </button>
        {far ? (
          <button className="btn small" onClick={() => player.current?.moveTo(origin.current)}>
            вернуться к месту снимка
          </button>
        ) : align && auto === 'search' ? (
          <span className="mono">ищу, куда смотрела камера…</span>
        ) : align ? (
          <>
            <span className="mono">{auto === 'unsure' ? 'похоже, камера смотрела сюда — поправьте, если нужно' : 'поверните панораму под снимок'}</span>
            <button className="btn small" onClick={fix}>
              совпало
            </button>
          </>
        ) : (
          <>
            <button className="btn small ghost" onClick={() => setShow((s) => (s === 'on' ? 'ghost' : s === 'ghost' ? 'off' : 'on'))}>
              снимок: {show === 'on' ? 'поверх' : show === 'ghost' ? 'насквозь' : 'скрыт'}
            </button>
            {auto === 'ok' && <span className="mono">направление найдено по снимку</span>}
            <button className="btn small ghost" onClick={() => setAlign(true)}>
              совместить заново
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Отметить точку снимка на карте (OpenStreetMap: без лимитов Яндекса) */
function MapPick({ center, onPick, onCancel }: { center: { lat: number; lon: number; zoom: number }; onPick: (lat: number, lon: number) => void; onCancel: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import('leaflet').Map | null>(null);
  const [pt, setPt] = useState<[number, number] | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const t = useRef(0);
  useEffect(() => {
    let dead = false;
    let mark: import('leaflet').CircleMarker | null = null;
    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (dead || !el.current) return;
      const m = L.map(el.current, { zoomControl: true, attributionControl: true }).setView([center.lat, center.lon], center.zoom);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(m);
      map.current = m;
      (window as unknown as { __ottiskMap?: unknown }).__ottiskMap = m;
      m.on('click', (e: import('leaflet').LeafletMouseEvent) => {
        const c: [number, number] = [e.latlng.lat, e.latlng.lng];
        if (!mark) mark = L.circleMarker(c, { radius: 9, color: '#fff', weight: 3, fillColor: '#e0452b', fillOpacity: 1 }).addTo(m);
        else mark.setLatLng(c);
        setPt(c);
      });
    })();
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="there-map">
      <div ref={el} className="there-mapbox" />
      <div className="there-map-find">
        <input
          className="mono"
          placeholder="город, улица"
          value={q}
          onChange={(e) => {
            const v = e.target.value;
            setQ(v);
            clearTimeout(t.current);
            t.current = window.setTimeout(() => searchPlaces(v).then(setHits).catch(() => setHits([])), 300);
          }}
        />
        {hits.slice(0, 4).map((h) => (
          <button
            key={`${h.lat},${h.lon}`}
            onClick={() => {
              map.current?.setView([h.lat, h.lon], 15);
              setHits([]);
              setQ(h.name);
            }}
          >
            {h.name}
            <small>{[h.admin, h.country].filter(Boolean).join(', ')}</small>
          </button>
        ))}
      </div>
      <div className="there-map-bar">
        <span>{pt ? 'Точка снимка отмечена' : 'Нажмите на карте, где сделан снимок'}</span>
        <button className="btn small ghost" onClick={onCancel}>
          отмена
        </button>
        <button className="btn small" disabled={!pt} onClick={() => pt && onPick(pt[0], pt[1])}>
          здесь
        </button>
      </div>
    </div>
  );
}

/** Запасной путь, если API Яндекса недоступен (ключ, лимит): встроенная панорама Яндекс Карт */
function PanoFrame({ lat, lon, heading, bmp, onBack }: { lat: number; lon: number; heading: number | null; bmp: ImageBitmap; onBack: () => void }) {
  const [big, setBig] = useState(false);
  const thumb = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = thumb.current;
    if (!c) return;
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
  }, [bmp]);
  const ll = `${lon.toFixed(6)},${lat.toFixed(6)}`;
  const src = `https://yandex.ru/map-widget/v1/?ll=${encodeURIComponent(ll)}&z=17&panorama%5Bpoint%5D=${encodeURIComponent(ll)}&panorama%5Bdirection%5D=${encodeURIComponent(`${Math.round(heading ?? 0)},0`)}&panorama%5Bspan%5D=${encodeURIComponent('110,60')}&panorama%5Bfull%5D=true`;
  return (
    <div className="there-pano">
      <iframe className="there-player" src={src} title="Панорама Яндекс Карт" allow="fullscreen" />
      <canvas ref={thumb} className={'there-thumb' + (big ? ' big' : '')} onClick={() => setBig((v) => !v)} />
      <div className="there-pano-bar">
        <button className="btn small ghost" onClick={onBack}>
          ← снимок
        </button>
        <span className="mono">панорама Яндекс Карт</span>
      </div>
    </div>
  );
}
