import { useEffect, useMemo, useRef, useState } from 'react';
import { bunnySay } from '../components/Mascot';
import type { Pose } from '../components/Bunny';
import { useDiary } from '../App';
import { TAIL, buildDay, fragment, renderCover, retitle, type BuiltDay, type MusicInput, type Step } from '../lib/pipeline';
import { lookupTrack, recommendSongs, resolveLink, searchTracks, type Ranked, type TrackCandidate } from '../lib/analysis/music';
import { bestExcerpt } from '../lib/analysis/audio';
import Stage from '../components/Stage';
import Why from '../components/Why';
import { PROMPTS, dayPrompt } from '../lib/prompts';
import { dayWeather, hereNow, nameAt, placeLine, searchPlaces, type PlaceHit } from '../lib/place';
import { readShot } from '../lib/scene/context';
import type { DayRecord, PhotoLayout, ShotMeta } from '../lib/types';
import { PhotoPage } from '../components/Journal';
import type { PlaceInfo } from '../lib/types';
import VoiceNote from '../components/VoiceNote';
import Camera from '../components/Camera';
import CutoutPicker, { type NewCut } from '../components/CutoutPicker';
import { analyzeText } from '../lib/analysis/text';
import { MOTIF_NAMES, dayMotifs, type Motif } from '../lib/atmos';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function NewDay({ nb }: { nb?: string }) {
  const { store, days, reload, setCover, toast, notebooks, defaultNotebook, setDraft } = useDiary();
  const own = notebooks.filter((n) => !n.demo);
  const [nbId, setNbId] = useState(nb && own.some((n) => n.id === nb) ? nb : defaultNotebook);
  useEffect(() => {
    if (!nbId && defaultNotebook) setNbId(defaultNotebook);
  }, [nbId, defaultNotebook]);
  const [date, setDate] = useState(today());

  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [voice, setVoice] = useState<Blob | null>(null);
  const [live, setLive] = useState(false);
  const [cuts, setCuts] = useState<NewCut[]>([]);
  const cutRts = useMemo(() => cuts.map((c) => c.rt), [cuts]);
  const voiceUrl = useMemo(() => (voice ? URL.createObjectURL(voice) : undefined), [voice]);
  const dictate = (t: string) =>
    setText((prev) => {
      const base = prev.trimEnd();
      const piece = t.charAt(0).toUpperCase() + t.slice(1);
      return (base ? base + (/[.!?…]$/.test(base) ? ' ' : '. ') : '') + piece;
    });
  const [text, setText] = useState('');
  // пока человек пишет — сайт подстраивается под то, что он вспоминает
  const [heard, setHeard] = useState<Motif[]>([]);
  const [mood, setMood] = useState({ valence: 0, arousal: 0 });
  useEffect(() => {
    const id = setTimeout(() => {
      if (text.trim().length < 8) {
        setDraft(null);
        setHeard([]);
        return;
      }
      const tf = analyzeText(text, date);
      const m = dayMotifs(tf, text);
      setDraft(m);
      setMood({ valence: tf.valence, arousal: tf.arousal });
      setHeard((Object.keys(m) as Motif[]).filter((k) => (m[k] ?? 0) >= 0.5).sort((a, b) => (m[b] ?? 0) - (m[a] ?? 0)));
    }, 350);
    return () => clearTimeout(id);
  }, [text, date, setDraft]);
  useEffect(() => () => setDraft(null), [setDraft]);
  const [photos, setPhotos] = useState<File[]>([]);
  // как фото вклеены: пока человек не выбрал сам, 1–2 фото — полароиды, больше — коллаж
  const [lay, setLay] = useState<PhotoLayout>({ kind: 'polaroid' });
  const [chosen, setChosen] = useState(false);
  const layout: PhotoLayout = chosen ? lay : { kind: photos.length <= 2 ? 'polaroid' : 'collage' };
  // EXIF фото: где и когда снято — подставляем место и дату, если их не задали
  const [metas, setMetas] = useState<(ShotMeta | null)[]>([]);
  const [fromPhoto, setFromPhoto] = useState('');
  const dateTouched = useRef(false);
  useEffect(() => {
    let dead = false;
    Promise.all(photos.map((f) => readShot(f))).then(async (ms) => {
      if (dead) return;
      setMetas(ms);
      const g = ms.find((m) => m?.lat != null);
      const t = ms.find((m) => m?.local);
      const notes: string[] = [];
      if (t?.local && !dateTouched.current && t.local.slice(0, 10) !== date) {
        setDate(t.local.slice(0, 10));
        notes.push('дата');
      }
      if (g && !place) {
        const hit = await nameAt(g.lat!, g.lon!);
        const w = await dayWeather(hit.lat, hit.lon, (t?.local ?? date).slice(0, 10)).catch(() => undefined);
        if (!dead) {
          setPlace({ name: hit.name, country: hit.country, lat: hit.lat, lon: hit.lon, weather: w });
          notes.push('место');
        }
      }
      if (!dead && notes.length) setFromPhoto(notes.join(' и ') + ', из фото');
    });
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);
  const [music, setMusic] = useState<MusicInput | null>(null);
  const [phase, setPhase] = useState<'form' | 'build' | 'preview' | 'save'>('form');
  const [steps, setSteps] = useState<Step[]>([]);
  const [built, setBuilt] = useState<BuiltDay | null>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const [pi, setPi] = useState(-1);
  const prompt = pi < 0 ? dayPrompt(date) : PROMPTS[pi % PROMPTS.length];
  const ta = useRef<HTMLTextAreaElement>(null);

  // воспоминание собирается даже из одного фото: текст, голос и песня — по желанию
  const missing: ['text' | 'photo' | 'song', string][] = [];
  if (!photos.length) missing.push(['photo', 'Добавь хотя бы одно фото.']);
  const ready = !missing.length;
  const extra = !text.trim() && !voice ? 'Можно без текста и песни, хватит фото.' : !music ? 'Песню можно не выбирать.' : '';
  const secs = useRef<Record<string, HTMLElement | null>>({});
  /* зайчик подсказывает следующий шаг (не перебивая, пока человек печатает) */
  const stepKey = phase === 'build' ? 'build' : phase === 'preview' ? 'preview' : missing.length ? 'photo' : !text.trim() && !voice ? 'text' : !music ? 'song' : 'ready';
  useEffect(() => {
    if (phase === 'save') return;
    const H: Record<string, [string, Pose]> = {
      text: ['Напиши пару слов или надиктуй голосом. Можно и без этого.', 'point'],
      photo: ['Начни с фото дня. Хватит и одного.', 'point'],
      song: ['Добавь песню этого дня, если хочешь.', 'point'],
      ready: ['Всё на месте! Жми «Проявить день».', 'happy'],
      build: ['Проявляю твой день, как в фотолаборатории…', 'think'],
      preview: ['Красиво получилось! Можно поправить название и сохранить в дневник.', 'happy'],
    };
    const [text, pose] = H[stepKey];
    let tries = 0;
    let t = 0;
    const go = () => {
      if (document.activeElement?.tagName === 'TEXTAREA' && stepKey !== 'text' && tries++ < 30) return void (t = window.setTimeout(go, 1500));
      bunnySay({ key: 'new-' + stepKey, text, pose });
    };
    t = window.setTimeout(go, stepKey === 'text' ? 1800 : 1000);
    return () => clearTimeout(t);
  }, [stepKey, phase]);
  const [nudge, setNudge] = useState(false);
  /** кнопка всегда нажимается: если чего-то не хватает — ведём к этому месту */
  const go = () => {
    if (ready) return develop();
    const el = secs.current[missing[0][0]];
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.classList.remove('flash');
    void el?.offsetWidth;
    el?.classList.add('flash');
    setTimeout(() => el?.classList.remove('flash'), 1700);
    setNudge(true);
    setTimeout(() => setNudge(false), 900);
  };

  const develop = async () => {
    setErr('');
    setPhase('build');
    setSteps([]);
    try {
      const pageNo = Math.max(0, ...days.map((d) => d.pageNo)) + 1;
      const b = await buildDay({ text, date, photos, music: music ?? { kind: 'none' }, pageNo, place: place ?? undefined }, (s) =>
        setSteps((old) => {
          const i = old.findIndex((o) => o.key === s.key);
          if (i >= 0) {
            const c = [...old];
            c[i] = s;
            return c;
          }
          return [...old, s];
        }),
      );
      setSteps((o) => [...o, { key: 'render', label: 'Проявляю страницу', done: true }]);
      await new Promise((r) => setTimeout(r, 450));
      setBuilt(b);
      setTitle(b.record.title);
      setPhase('preview');
    } catch (e) {
      console.error(e);
      setErr('Не получилось: ' + (e instanceof Error ? e.message : String(e)));
      setPhase('form');
    }
  };

  const save = async (video?: Blob) => {
    if (!built || !store) return;
    setPhase('save');
    try {
      const rec = retitle(built.record, title || built.record.title);
      rec.notebookId = nbId || defaultNotebook;
      rec.live3d = live;
      rec.layout = layout;
      if (metas.some(Boolean)) rec.photoMeta = metas;
      if (cuts.length) rec.cutouts = cuts.map((c) => ({ id: c.rt.id, kind: c.kind, x: c.rt.x, y: c.rt.y, s: c.rt.s, rot: c.rt.rot }));
      if (voice) {
        rec.hasVoice = true;
        rec.voiceName = `voice.${voice.type.includes('mp4') ? 'mp4' : 'webm'}`;
      }
      const cover = await renderCover(rec, built.bitmaps, 720, cutRts);
      await store.save(rec, { photos: built.photoBlobs, cover, excerpt: built.excerpt });
      if (voice) await store.saveBlob(rec.id, 'voice', voice);
      for (const c of cuts) await store.saveBlob(rec.id, `cutout-${c.rt.id}`, c.blob);
      if (video) {
        await store.saveBlob(rec.id, 'video', video);
        rec.hasVideo = true;
        rec.videoName = `memory.${video.type.includes('mp4') ? 'mp4' : 'webm'}`;
        await store.update(rec);
      }
      setCover(rec.id, URL.createObjectURL(cover));
      await reload();
      toast(`Сохранено в папку «${rec.folder}»`);
      location.hash = `#/day/${rec.id}`;
    } catch (e) {
      console.error(e);
      setErr('Не сохранилось: ' + (e instanceof Error ? e.message : String(e)));
      setPhase('preview');
    }
  };

  if ((phase === 'preview' || phase === 'save') && built) {
    return (
      <div className="day">
        <Stage rec={built.record} title={title} bitmaps={built.bitmaps} audio={built.audio} autoplay
          voiceUrl={voiceUrl}
          develop
          live={live}
          onLive={setLive}
          cutouts={cutRts}
          onCutouts={(list) => setCuts((cs) => list.map((rt) => cs.find((c) => c.rt.id === rt.id)!).filter(Boolean))}
        />
        <div className="panel">
          <div className="sec">
            Название дня
          </div>
          <input className="title-edit" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} />
          <div className="mono muted" style={{ margin: '8px 0 18px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <span className="folder-ic" style={{ marginTop: 0 }} /> {date} {title}
          </div>
          <div className="ctrl" style={{ marginTop: 0 }}>
            <button className="btn" onClick={() => save()} disabled={phase === 'save' || !title.trim()}>
              {phase === 'save' ? 'Сохраняю…' : 'Сохранить в дневник'}
            </button>
            <button className="btn ghost" onClick={() => setPhase('form')} disabled={phase === 'save'}>
              ← Изменить запись
            </button>
          </div>
          {err && <p style={{ color: '#a33' }}>{err}</p>}
          <Why rec={built.record} />
        </div>
      </div>
    );
  }

  return (
    <div className="nd">
      {own.length > 1 && (
        <div className="nb-pick">
          <span className="muted">в тетрадь</span>
          <select className="inp" value={nbId} onChange={(e) => setNbId(e.target.value)} disabled={phase === 'build'}>
            {own.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="nd-book">
        <section className="nd-page nd-left" ref={(e) => void (secs.current.photo = e)}>
          <div className="nd-row">
            <h2 className="nd-sub">Фото</h2>
            <div className="nd-seg" role="radiogroup" aria-label="Как вклеить фото">
              {LAYOUTS.map(([k, label]) => (
                <button
                  key={k}
                  role="radio"
                  aria-checked={layout.kind === k}
                  className={'tab' + (layout.kind === k ? ' on' : '')}
                  disabled={phase === 'build'}
                  onClick={() => {
                    setLay(k === 'free' ? { kind: 'free', items: scatter(photos.length, lay.kind === 'free' ? lay.items : undefined) } : { kind: k });
                    setChosen(true);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <PhotoBoard
            files={photos}
            onChange={(f) => {
              setPhotos(f);
              if (lay.kind === 'free') setLay({ kind: 'free', items: scatter(f.length, lay.items) });
            }}
            layout={layout}
            onLayout={setLay}
            disabled={phase === 'build'}
          />
          <h2 className="nd-sub" style={{ marginTop: 26 }}>
            Вклейки
          </h2>
          <CutoutPicker count={cuts.length} onAdded={(c) => setCuts((cs) => [...cs, c])} />
          {!!cuts.length && (
            <div className="cut-list">
              {cuts.map((c) => (
                <div key={c.rt.id} className="cut-item">
                  <img src={(c.rt.img as HTMLCanvasElement).toDataURL()} alt="" />
                  {phase !== 'build' && <button onClick={() => setCuts((cs) => cs.filter((x) => x !== c))}>×</button>}
                </div>
              ))}
            </div>
          )}
          <div className="hint">Билет, рисунок, записка: главное вырежется в наклейку.</div>
        </section>
        <section className="nd-page nd-right">
          <div className="nd-row">
            <h1 className="nd-h">Как прошёл день?</h1>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                dateTouched.current = true;
                setDate(e.target.value);
              }}
              className="inp nd-date"
              aria-label="Дата"
            />
          </div>
          <div className="ask">
            <span className="prompt-q">{prompt}</span>
            <button className="ask-more" onClick={() => setPi((x) => (x < 0 ? Math.floor(Math.random() * PROMPTS.length) : x + 1))} title="другой вопрос" disabled={phase === 'build'}>
              ↻
            </button>
          </div>
          <div className="field" ref={(e) => void (secs.current.text = e)}>
            <textarea ref={ta} value={text} onChange={(e) => setText(e.target.value)} placeholder="Пиши как другу…" disabled={phase === 'build'} />
            <div className="heard" aria-live="polite">
              {heard.map((k) => (
                <span key={k}>✦ {MOTIF_NAMES[k]}</span>
              ))}
            </div>
          </div>
          <VoiceNote onText={dictate} voice={voice} onVoice={setVoice} disabled={phase === 'build'} />
          {fromPhoto && <div className="muted" style={{ margin: '-6px 0 10px', fontSize: 13 }}>⌖ {fromPhoto}</div>}
          <PlacePicker date={date} value={place} onChange={setPlace} disabled={phase === 'build'} />
          <h2 className="nd-sub" style={{ marginTop: 22 }}>
            Песня дня
          </h2>
          <div ref={(e) => void (secs.current.song = e)}>
            <SongPicker value={music} onChange={setMusic} disabled={phase === 'build'} motifs={heard} mood={mood} />
          </div>
          <div className="nd-go">
            {phase === 'build' ? (
              <div className="steps">
                {steps.map((s, i) => (
                  <div className="st" key={i}>
                    <i>{s.done ? '✓' : <span className="blink">▌</span>}</i>
                    <div>
                      {s.label}
                      {s.detail && <div className="det">{s.detail}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className={'hint' + (nudge ? ' nudge' : '')} style={{ marginBottom: 12 }}>
                  {ready ? extra || 'Всё готово.' : missing.map(([, m]) => m).join(' ')}
                </div>
                <button className={'btn' + (ready ? '' : ' soft')} onClick={go} style={{ fontSize: 14, padding: '14px 26px' }}>
                  Проявить день
                </button>
                {err && <p style={{ color: '#a33' }}>{err}</p>}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

const LAYOUTS: [PhotoLayout['kind'], string][] = [
  ['polaroid', 'Полароиды'],
  ['collage', 'Коллаж'],
  ['free', 'Как хочу'],
];
/** стартовая «россыпь» для свободной раскладки; уже разложенные фото не двигаем */
function scatter(n: number, prev?: NonNullable<PhotoLayout['items']>) {
  const out = (prev ?? []).slice(0, n);
  for (let i = out.length; i < n; i++) {
    const col = i % 2,
      row = Math.floor(i / 2);
    out.push({ x: 0.32 + col * 0.36 + (Math.random() - 0.5) * 0.06, y: 0.25 + row * 0.3 + (Math.random() - 0.5) * 0.05, w: n === 1 ? 0.7 : 0.5, rot: Math.round((Math.random() - 0.5) * 14) });
  }
  return out;
}
const DRAFT_COLORS = ['#3b3a4a', '#7d8fb0', '#e8c37a', '#e6b5ac', '#b8d0c4'];

/** Фото дня прямо на странице: вклеиваются полароидами, коллажем или как человек разложит сам */
function PhotoBoard({ files, onChange, layout, onLayout, disabled }: { files: File[]; onChange: (f: File[]) => void; layout: PhotoLayout; onLayout: (l: PhotoLayout) => void; disabled?: boolean }) {
  const inp = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [cam, setCam] = useState(false);
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  const filesRef = useRef(files);
  filesRef.current = files;
  const add = (list: FileList | null) => {
    if (!list) return;
    const imgs = [...list].filter((f) => f.type.startsWith('image/') || (!f.type && /\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(f.name)));
    onChange([...files, ...imgs].slice(0, 8));
  };
  const drop = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      add(e.dataTransfer.files);
    },
  };
  const draft = { id: 'draft-' + files.length, layout, design: { palette: { colors: DRAFT_COLORS } } } as unknown as DayRecord;
  return (
    <div className="pb">
      <input ref={inp} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      {!files.length ? (
        <button className={'pb-empty' + (over ? ' over' : '')} onClick={() => !disabled && inp.current?.click()} {...drop} disabled={disabled}>
          <span className="pb-plus">+</span>
          <span>Вклеить фото</span>
          <small>или перетащи сюда</small>
        </button>
      ) : (
        <div className={'pb-sheet' + (over ? ' over' : '')} {...drop}>
          {layout.kind === 'free' && layout.items ? (
            <FreeBoard urls={urls} items={layout.items} onItems={(items) => onLayout({ kind: 'free', items })} disabled={disabled} />
          ) : (
            <PhotoPage d={draft} photos={urls} />
          )}
        </div>
      )}
      {!!files.length && (
        <div className="thumbs">
          {urls.map((u, i) => (
            <div key={u}>
              <img src={u} alt="" />
              {!disabled && (
                <button onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label="Убрать фото">
                  ×
                </button>
              )}
            </div>
          ))}
          {!disabled && files.length < 8 && (
            <button className="pb-add" onClick={() => inp.current?.click()} aria-label="Добавить фото">
              +
            </button>
          )}
        </div>
      )}
      {!disabled && !!navigator.mediaDevices?.getUserMedia && (
        <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setCam(true)}>
          📷 Снять сейчас
        </button>
      )}
      {cam && <Camera onShot={(f) => onChange([...filesRef.current, f].slice(0, 8))} onClose={() => setCam(false)} />}
    </div>
  );
}

/** «Как хочу»: фото можно двигать пальцем, поворачивать и менять размер */
function FreeBoard({ urls, items, onItems, disabled }: { urls: string[]; items: NonNullable<PhotoLayout['items']>; onItems: (i: NonNullable<PhotoLayout['items']>) => void; disabled?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState(-1);
  const drag = useRef<{ i: number; x: number; y: number; ox: number; oy: number } | null>(null);
  const set = (i: number, p: Partial<(typeof items)[number]>) => onItems(items.map((it, j) => (j === i ? { ...it, ...p } : it)));
  return (
    <div
      className="fr-board jp"
      ref={box}
      onPointerDown={(e) => {
        if (e.target === box.current) setSel(-1);
      }}
    >
      {items.slice(0, urls.length).map((it, i) => (
        <figure
          key={i}
          className={'jp-free' + (sel === i ? ' sel' : '')}
          style={{ left: `${it.x * 100}%`, top: `${it.y * 100}%`, width: `${it.w * 100}%`, transform: `translate(-50%, -50%) rotate(${it.rot}deg)`, zIndex: sel === i ? 50 : i + 1 }}
          onPointerDown={(e) => {
            if (disabled) return;
            e.preventDefault();
            setSel(i);
            drag.current = { i, x: e.clientX, y: e.clientY, ox: it.x, oy: it.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const g = drag.current;
            if (!g || g.i !== i || !box.current) return;
            const r = box.current.getBoundingClientRect();
            set(i, { x: Math.max(0.05, Math.min(0.95, g.ox + (e.clientX - g.x) / r.width)), y: Math.max(0.05, Math.min(0.95, g.oy + (e.clientY - g.y) / r.height)) });
          }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => !disabled && set(i, { w: Math.max(0.22, Math.min(0.95, it.w - e.deltaY * 0.0008)) })}
        >
          <img src={urls[i]} alt="" draggable={false} />
        </figure>
      ))}
      {sel >= 0 && items[sel] && !disabled && (
        <div className="fr-tools" onPointerDown={(e) => e.stopPropagation()}>
          <button onClick={() => set(sel, { rot: items[sel].rot - 8 })} aria-label="Повернуть влево">
            ⟲
          </button>
          <button onClick={() => set(sel, { rot: items[sel].rot + 8 })} aria-label="Повернуть вправо">
            ⟳
          </button>
          <button onClick={() => set(sel, { w: Math.max(0.22, items[sel].w - 0.08) })} aria-label="Меньше">
            −
          </button>
          <button onClick={() => set(sel, { w: Math.min(0.95, items[sel].w + 0.08) })} aria-label="Больше">
            +
          </button>
        </div>
      )}
      {sel < 0 && !disabled && <div className="fr-tip">тяни фото пальцем, нажми, чтобы повернуть</div>}
    </div>
  );
}

function SongPicker({ value, onChange, disabled, motifs, mood }: { value: MusicInput | null; onChange: (m: MusicInput | null) => void; disabled?: boolean; motifs: Motif[]; mood: { valence: number; arousal: number } }) {
  const [tab, setTab] = useState<'search' | 'file'>('search');
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Ranked[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | undefined>();
  const [recs, setRecs] = useState<Ranked[]>([]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  // песни под этот день — по тому, что человек уже написал
  const recKey = motifs.slice(0, 2).join() + (mood.arousal > 0.15 || mood.valence > 0.4 ? '+' : '-');
  useEffect(() => {
    let dead = false;
    const id = setTimeout(() => recommendSongs(motifs.slice(0, 2), mood).then((r) => !dead && setRecs(r)), 300);
    return () => {
      dead = true;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recKey]);

  const find = async () => {
    const s = q.trim();
    if (!s) return;
    setBusy(true);
    setNote('');
    setRes([]);
    try {
      let list: Ranked[] = [];
      let asked = s;
      if (/^https?:\/\//i.test(s)) {
        setLink(s);
        const r = await resolveLink(s);
        if (r?.appleId) {
          const t = await lookupTrack(r.appleId);
          list = t ? [{ ...t, match: 1 }] : [];
          asked = '';
        } else if (r?.query) {
          setNote(`По ссылке: «${r.serviceTitle ?? r.query}». Ищу в каталоге…`);
          asked = r.query;
          list = await searchTracks(r.query);
        } else {
          setNote('Этот сервис не отдаёт название по ссылке. Впишите «исполнитель, название», а ссылку мы сохраним в папке дня.');
          return;
        }
      } else list = await searchTracks(s);
      setRes(list);
      if (!list.length) setNote('В каталоге такой песни нет. Загрузите свой файл, система сама найдёт припев, а отрывок можно подвинуть.');
      else if (asked && list[0].match < 0.75) setNote('Точного совпадения в каталоге нет, ниже похожие. Если вашей песни среди них нет, загрузите свой файл.');
      else setNote('');
    } finally {
      setBusy(false);
    }
  };

  const preview = (t: TrackCandidate) => {
    if (!audio.current) audio.current = new Audio();
    const a = audio.current;
    if (playing === t.trackId) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = t.previewUrl!;
    a.volume = 0.7;
    a.play().catch(() => setNote('Браузер не дал включить звук, нажмите ▶ ещё раз.'));
    a.onended = () => setPlaying(null);
    setPlaying(t.trackId);
  };
  useEffect(() => () => audio.current?.pause(), []);

  const sel = value?.kind === 'track' ? value.track.trackId : null;
  const row = (t: Ranked) => (
    <div key={t.trackId} className={'track' + (sel === t.trackId ? ' on' : '')} role="button" onClick={() => !disabled && onChange({ kind: 'track', track: t, link })} style={{ cursor: 'pointer' }}>
      {t.artwork ? <img src={t.artwork} alt="" /> : <span />}
      <div>
        <b>{t.title}</b>
        <small>
          {t.artist} · {[t.year, t.genre].filter(Boolean).join(' · ')}
        </small>
      </div>
      <button
        className="btn ghost small"
        onClick={(e) => {
          e.stopPropagation();
          preview(t);
        }}
      >
        {playing === t.trackId ? '❚❚' : '▶ 30 с'}
      </button>
    </div>
  );
  return (
    <div className="field">
      <div className="seg">
        <button className={'tab' + (tab === 'search' ? ' on' : '')} onClick={() => setTab('search')}>
          Ссылка или название
        </button>
        <button className={'tab' + (tab === 'file' ? ' on' : '')} onClick={() => setTab('file')}>
          Свой аудиофайл
        </button>
      </div>
      {tab === 'search' ? (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="inp"
              value={q}
              disabled={disabled}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && find()}
              placeholder="Исполнитель и название или ссылка"
            />
            <button className="btn" onClick={find} disabled={busy || disabled}>
              {busy ? '…' : 'Найти'}
            </button>
          </div>
          {note && <div className="hint">{note}</div>}
          <div className="results">{res.map(row)}</div>
          {!res.length && recs.length > 0 && (
            <div className="recs">
              <div className="sec" style={{ marginTop: 14 }}>
                Подойдёт к этому дню
              </div>
              <div className="results">{recs.map(row)}</div>
            </div>
          )}
        </>
      ) : (
        <FilePick value={value} onChange={onChange} disabled={disabled} />
      )}
      {value && (
        <div className="mono" style={{ marginTop: 12 }}>
          ♪ выбрано: {value.kind === 'track' ? `${value.track.artist} · ${value.track.title}` : value.kind === 'file' ? value.file.name : value.kind === 'manual' ? `${value.artist} · ${value.title}` : ''}
        </div>
      )}
    </div>
  );
}

/** Свой файл: волна песни и окно в 30 секунд, которое можно подвинуть и послушать */
function FilePick({ value, onChange, disabled }: { value: MusicInput | null; onChange: (m: MusicInput | null) => void; disabled?: boolean }) {
  const file = value?.kind === 'file' ? value.file : null;
  const start = value?.kind === 'file' ? (value.start ?? 0) : 0;
  const [buf, setBuf] = useState<AudioBuffer | null>(null);
  const [err, setErr] = useState('');
  const [play, setPlay] = useState(false);
  const cv = useRef<HTMLCanvasElement>(null);
  const ac = useRef<AudioContext | null>(null);
  const src = useRef<AudioBufferSourceNode | null>(null);
  const drag = useRef<{ x: number; s: number } | null>(null);
  const stop = () => {
    src.current?.stop();
    src.current = null;
    setPlay(false);
  };
  useEffect(() => () => stop(), []);
  const pick = async (f: File) => {
    stop();
    setErr('');
    setBuf(null);
    try {
      ac.current ??= new AudioContext();
      const b = await ac.current.decodeAudioData(await f.arrayBuffer());
      setBuf(b);
      const usable = b.duration > TAIL + 8 ? b.duration - TAIL : b.duration;
      const { start: s0 } = await bestExcerpt(b, Math.min(30, usable));
      onChange({ kind: 'file', file: f, start: fragment(b.duration, s0).start });
    } catch {
      setErr('Не получилось прочитать этот файл. Подойдут mp3, m4a, wav.');
      onChange({ kind: 'file', file: f });
    }
  };
  const win = buf ? fragment(buf.duration, start) : null;
  // волна + окно
  useEffect(() => {
    const c = cv.current;
    if (!c || !buf || !win) return;
    const W = (c.width = c.clientWidth * devicePixelRatio),
      H = (c.height = 64 * devicePixelRatio);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    const ch = buf.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / W));
    const x0 = (win.start / buf.duration) * W,
      x1 = ((win.start + win.dur) / buf.duration) * W;
    for (let x = 0; x < W; x++) {
      let m = 0;
      for (let i = x * step; i < (x + 1) * step && i < ch.length; i += 8) m = Math.max(m, Math.abs(ch[i]));
      const h = Math.max(1, m * H * 0.9);
      g.fillStyle = x >= x0 && x <= x1 ? getComputedStyle(c).getPropertyValue('--accent') || '#b5482a' : 'rgba(29,27,31,0.25)';
      g.fillRect(x, (H - h) / 2, 1, h);
    }
    g.strokeStyle = 'rgba(29,27,31,0.7)';
    g.lineWidth = 2 * devicePixelRatio;
    g.strokeRect(x0, 1, x1 - x0, H - 2);
  }, [buf, win?.start, win?.dur]);
  const listen = () => {
    if (play) return stop();
    if (!buf || !win || !ac.current) return;
    ac.current.resume();
    const s = ac.current.createBufferSource();
    s.buffer = buf;
    s.connect(ac.current.destination);
    s.start(0, win.start, win.dur);
    s.onended = () => setPlay(false);
    src.current = s;
    setPlay(true);
  };
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return (
    <>
      <label className="drop" style={{ display: 'block' }}>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 21 }}>{file ? file.name : 'Выберите mp3 / m4a / wav'}</div>
        <div className="hint">Система найдёт самые плотные 30 секунд (обычно припев). Заставку в конце (TikTok, Reels) не берёт.</div>
        <input type="file" accept="audio/*,video/mp4" hidden disabled={disabled} onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      </label>
      {err && <div className="hint">{err}</div>}
      {buf && win && file && (
        <div className="frag">
          <canvas
            ref={cv}
            className="frag-wave"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, s: win.start };
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const r = (e.target as HTMLElement).getBoundingClientRect();
              const ds = ((e.clientX - drag.current.x) / r.width) * buf.duration;
              onChange({ kind: 'file', file, start: fragment(buf.duration, drag.current.s + ds).start });
            }}
            onPointerUp={() => {
              drag.current = null;
              if (play) {
                stop();
              }
            }}
          />
          <div className="frag-row">
            <button className="btn ghost small" onClick={listen} type="button">
              {play ? '❚❚' : '▶ отрывок'}
            </button>
            <span className="mono muted">
              {fmt(win.start)} – {fmt(win.start + win.dur)} из {fmt(buf.duration)} · тяните окно, чтобы выбрать
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function PlacePicker({ date, value, onChange, disabled }: { date: string; value: PlaceInfo | null; onChange: (p: PlaceInfo | null) => void; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const timer = useRef(0);
  const pick = async (h: PlaceHit) => {
    setHits([]);
    setQ('');
    setBusy(true);
    setNote('');
    const weather = await dayWeather(h.lat, h.lon, date).catch(() => undefined);
    onChange({ name: h.name, country: h.country, lat: h.lat, lon: h.lon, weather });
    if (!weather) setNote('Погоду за этот день найти не удалось, место сохранится без неё.');
    setBusy(false);
  };
  // дата поменялась — погоду пересчитать
  useEffect(() => {
    if (!value) return;
    let dead = false;
    dayWeather(value.lat, value.lon, date)
      .then((w) => !dead && onChange({ ...value, weather: w }))
      .catch(() => {});
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  const type = (v: string) => {
    setQ(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => searchPlaces(v).then(setHits).catch(() => setHits([])), 280);
  };
  const here = async () => {
    setBusy(true);
    setNote('');
    try {
      await pick(await hereNow());
    } catch {
      setNote('Геолокация недоступна, впишите город.');
      setBusy(false);
    }
  };
  return (
    <div className="field place">
      {value ? (
        <div className="place-stamp">
          <span className="place-pin">⌖</span>
          <span>{placeLine(value)}</span>
          {!disabled && (
            <button className="ask-more" onClick={() => onChange(null)} title="убрать место">
              ×
            </button>
          )}
        </div>
      ) : (
        <div className="place-row">
          <input className="inp" value={q} onChange={(e) => type(e.target.value)} placeholder="Где это было?" disabled={disabled || busy} />
          <button className="btn ghost small" onClick={here} disabled={disabled || busy}>
            {busy ? '…' : '⌖ Я здесь'}
          </button>
          {!!hits.length && (
            <div className="place-hits">
              {hits.map((h, i) => (
                <button key={i} onClick={() => pick(h)}>
                  <b>{h.name}</b> <span className="muted">{[h.admin, h.country].filter(Boolean).join(', ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {note && <div className="hint">{note}</div>}
    </div>
  );
}
