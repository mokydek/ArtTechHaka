import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { bunnySay } from '../components/Mascot';
import { bunnyReact, burst, buzz, play, stampMark } from '../lib/feel';
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
import { isFresh } from '../lib/scene/where';
import type { DayRecord, DiaryFont, PageDeco, PageNote, PhotoLayout, ShotMeta } from '../lib/types';
import FlowText, { noteRect } from '../components/FlowText';
import HelpCard, { needsHelp } from '../components/HelpCard';
import { MOOD_COLORS, MOOD_WORDS, setMood as saveMood, type Mood } from '../lib/moods';
import { moodImg } from '../components/Bunny';
import { PhotoPage } from '../components/Journal';
import type { PlaceInfo } from '../lib/types';
import VoiceNote from '../components/VoiceNote';
import Camera from '../components/Camera';
import CutoutPicker, { type NewCut } from '../components/CutoutPicker';
import { analyzeText } from '../lib/analysis/text';
import { MOTIFS as MOTIF_ORDER, MOTIF_NAMES, dayMotifs, type Motif } from '../lib/atmos';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function NewDay({ nb }: { nb?: string }) {
  const { store, days, reload, setCover, notebooks, defaultNotebook, setDraft } = useDiary();
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
  const [font, setFont] = useState<DiaryFont>('hand');
  const [feel, setFeel] = useState<Mood | null>(null);
  const [songOpen, setSongOpen] = useState(false);
  const [writing, setWriting] = useState(false);
  const opener = useRef<PhotoOpen>({});
  // украшение страницы: цвет листа, рисунок и надписи (текст их обтекает)
  const [deco, setDeco] = useState<PageDeco>({});
  const [mode, setMode] = useState<'write' | 'draw' | 'note'>('write');
  const [pen, setPen] = useState({ c: INKS[0], w: 9 });
  const [palette, setPalette] = useState(false);
  const [typing, setTyping] = useState(false);
  const decorated = !!(deco.strokes?.length || deco.notes?.length);
  // включили рисование или надписи — показываем правую страницу целиком
  useEffect(() => {
    if (mode === 'write') return;
    document.querySelector('.nd2 .nd-right')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [mode]);
  const pageBg = deco.color ?? null;
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
      const next = (Object.keys(m) as Motif[]).filter((k) => (m[k] ?? 0) >= 0.5).sort((a, b) => (m[b] ?? 0) - (m[a] ?? 0));
      setHeard((prev) => {
        // система что-то услышала — тихий колокольчик, нота своя для каждого нового мотива
        next.filter((k) => !prev.includes(k)).forEach((k, i) => setTimeout(() => play('chime', MOTIF_ORDER.indexOf(k)), i * 140));
        return next;
      });
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
      // снимок только что сделан, а GPS в нём нет (браузер вырезал) — человек ещё там: берём геолокацию телефона
      const fresh = ms.map((m) => !!m && m.lat == null && isFresh(m));
      if (fresh.some(Boolean) && 'geolocation' in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000, maximumAge: 120000 }));
          ms = ms.map((m, i) => (fresh[i] && m ? { ...m, lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6), geo: 'device' as const } : m));
        } catch {
          /* не дали — место останется из записи */
        }
        if (dead) return;
      }
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
    play('nope');
    buzz(30);
    bunnyReact('point');
    setTimeout(() => setNudge(false), 900);
  };

  const develop = async () => {
    setErr('');
    setPhase('build');
    setSteps([]);
    try {
      const pageNo = Math.max(0, ...days.map((d) => d.pageNo)) + 1;
      const b = await buildDay({ text, date, photos, music: music ?? { kind: 'none' }, pageNo, place: place ?? undefined, feel: feel ?? undefined }, (s) =>
        setSteps((old) => {
          if (s.done) play('tick');
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
      play('develop');
      bunnyReact('happy', 2200);
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
      rec.font = font;
      if (deco.color || deco.strokes?.length || deco.notes?.length) rec.page = deco;
      if (feel) {
        rec.feel = feel;
        saveMood(rec.date, feel);
      }
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
      stampMark('Сохранено');
      bunnyReact('happy', 2200);
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
            <button className="btn" onClick={() => save()} disabled={phase === 'save' || !title.trim()} data-sfx="none">
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

  const cover = notebooks.find((n) => n.id === nbId)?.cover;
  return (
    <div className="nd nd2">
      <div className="nd-top">
        {own.length > 1 ? (
          <label className="nd-nb">
            <span>в тетрадь</span>
            <select value={nbId} onChange={(e) => setNbId(e.target.value)} disabled={phase === 'build'}>
              {own.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
        <label className="nd-when" title="Поменять дату">
          <span>{dateWords(date)}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              if (!e.target.value) return;
              dateTouched.current = true;
              setDate(e.target.value);
            }}
            aria-label="Дата"
          />
        </label>
      </div>
      <div className="nd-diary" style={{ ['--cover' as string]: coverTint(cover?.style) }}>
        <span className="nd-band" aria-hidden />
        <div className="nd-book">
          <section className="nd-page nd-left" ref={(e) => void (secs.current.photo = e)} style={pageBg ? { background: pageBg } : undefined}>
            <div className="nd-lays" role="radiogroup" aria-label="Как вклеить фото">
              {LAYOUTS.map(([k, g, label]) => {
                const on = layout.kind === k && (k !== 'collage' || (layout.grid ?? 'grid') === g);
                return (
                  <button
                    key={k + (g ?? '')}
                    role="radio"
                    data-sfx="none"
                    aria-checked={on}
                    aria-label={label}
                    title={label}
                    className={'nd-lay' + (on ? ' on' : '')}
                    disabled={phase === 'build'}
                    onClick={() => {
                      play('shuffle');
                      setLay(k === 'free' ? { kind: 'free', items: scatter(photos.length, lay.kind === 'free' ? lay.items : undefined) } : k === 'collage' ? { kind: 'collage', grid: g } : { kind: k });
                      setChosen(true);
                    }}
                  >
                    <LayIcon k={k} g={g} />
                  </button>
                );
              })}
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
              open={opener}
            />
            {!!cuts.length && (
              <div className="cut-list nd-stickers">
                {cuts.map((c) => (
                  <div key={c.rt.id} className="cut-item">
                    <img src={(c.rt.img as HTMLCanvasElement).toDataURL()} alt="" />
                    {phase !== 'build' && <button onClick={() => setCuts((cs) => cs.filter((x) => x !== c))}>×</button>}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="nd-page nd-right" style={pageBg ? { background: pageBg } : undefined}>
            <div className={'nd-q' + (text.trim() ? ' done' : '')}>
              <span>{prompt}</span>
              <button className="nd-ic" onClick={() => setPi((x) => (x < 0 ? Math.floor(Math.random() * PROMPTS.length) : x + 1))} title="другой вопрос" aria-label="Другой вопрос" disabled={phase === 'build'}>
                ↻
              </button>
              <button className="nd-ic nd-expand" onClick={() => setWriting(true)} title="Писать на весь экран" aria-label="Писать на весь экран" disabled={phase === 'build'}>
                <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
                  <path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="field nd-field" ref={(e) => void (secs.current.text = e)}>
              {mode === 'write' && (typing || !decorated) ? (
                <textarea ref={ta} autoFocus={typing} onBlur={() => setTyping(false)} className={'f-' + font} value={text} onChange={(e) => setText(e.target.value)} placeholder="Пиши как другу…" disabled={phase === 'build'} />
              ) : (
                <FlowText text={text} font={font} deco={deco} className="nd-flowbox">
                  <DecoLayer mode={mode} deco={deco} onDeco={setDeco} pen={pen} font={font} onWrite={() => setTyping(true)} />
                </FlowText>
              )}
              <div className="heard" aria-live="polite">
                {heard.map((k) => (
                  <span key={k}>✦ {MOTIF_NAMES[k]}</span>
                ))}
              </div>
            </div>
            <div className="nd-foot">
              <VoiceNote onText={dictate} voice={voice} onVoice={setVoice} disabled={phase === 'build'} />
            </div>
          </section>
        </div>
      </div>

      <div className="nd-strip">
        <div className="nd-mood" role="radiogroup" aria-label="Атмосфера дня">
          {([1, 2, 3, 4, 5] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={feel === m}
              aria-label={MOOD_WORDS[m]}
              title={MOOD_WORDS[m]}
              className={'nd-face' + (feel === m ? ' on' : '')}
              style={{ ['--mc' as string]: MOOD_COLORS[m] }}
              onClick={() => {
                play('mood', m);
                setFeel(feel === m ? null : m);
              }}
              disabled={phase === 'build'}
            >
              <img src={moodImg(m)} alt="" draggable={false} />
            </button>
          ))}
          <small>атмосфера дня</small>
        </div>
        <button className={'nd-song' + (music ? ' on' : '')} onClick={() => setSongOpen(true)} disabled={phase === 'build'}>
          <i>♫</i>
          <span>{music ? songLabel(music) : 'Добавить песню'}</span>
        </button>
        <PlacePicker date={date} value={place} onChange={setPlace} disabled={phase === 'build'} />
      </div>
      {needsHelp(text) && <HelpCard />}
      {fromPhoto && <div className="nd-note">⌖ {fromPhoto}</div>}

      <div className="nd-tools" role="toolbar" aria-label="Страница">
        <button className="nd-tool" onClick={() => opener.current.add?.()} disabled={phase === 'build'}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <rect x="3.5" y="5" width="17" height="14" rx="2" />
            <circle cx="9" cy="10" r="1.6" />
            <path d="M4 17l5-5 4 4 3-3 4 4" />
          </svg>
          <span>Фото</span>
        </button>
        {!!navigator.mediaDevices?.getUserMedia && (
          <button className="nd-tool" onClick={() => opener.current.cam?.()} disabled={phase === 'build'}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
              <circle cx="12" cy="13" r="3.6" />
            </svg>
            <span>Снять</span>
          </button>
        )}
        <CutoutPicker tool disabled={phase === 'build'} count={cuts.length} onAdded={(c) => setCuts((cs) => [...cs, c])} />
        <button className={'nd-tool' + (palette ? ' on' : '')} onClick={() => setPalette((x) => !x)} disabled={phase === 'build'}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 3.5c-4.7 0-8.5 3.6-8.5 8.2 0 4.2 3.3 8.8 8 8.8 1.4 0 2-.8 2-1.8 0-1.3-1.1-1.6-1.1-2.9 0-1 .8-1.7 1.9-1.7h2.5c2.2 0 3.7-1.6 3.7-3.8 0-3.7-3.8-6.8-8.5-6.8z" />
            <circle cx="8" cy="11" r="1.2" />
            <circle cx="11.5" cy="7.6" r="1.2" />
            <circle cx="15.6" cy="9" r="1.2" />
          </svg>
          <span>Цвет листа</span>
        </button>
        <button className={'nd-tool' + (mode === 'draw' ? ' on' : '')} onClick={() => setMode(mode === 'draw' ? 'write' : 'draw')} disabled={phase === 'build'}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M4 20l1.2-4.6L16.4 4.2a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z" />
            <path d="M14.5 6l3.5 3.5" />
          </svg>
          <span>Рисовать</span>
        </button>
        <button className={'nd-tool' + (mode === 'note' ? ' on' : '')} onClick={() => setMode(mode === 'note' ? 'write' : 'note')} disabled={phase === 'build'}>
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />
          </svg>
          <span>Текст</span>
        </button>
      </div>
      {palette && (
        <div className="nd-sub2" role="radiogroup" aria-label="Цвет листа">
          {PAPERS.map((c) => (
            <button key={c} role="radio" aria-checked={(deco.color ?? PAPERS[0]) === c} className={'nd-sw' + ((deco.color ?? PAPERS[0]) === c ? ' on' : '')} style={{ background: c }} onClick={() => (play('tick'), setDeco((d) => ({ ...d, color: c === PAPERS[0] ? undefined : c })))} aria-label={c} />
          ))}
        </div>
      )}
      {mode !== 'write' && (
        <div className="nd-sub2 nd-pens">
          <span className="nd-sub2-t">{mode === 'draw' ? 'Рисуй на правой странице, текст обтечёт рисунок' : 'Нажми на страницу, чтобы добавить надпись'}</span>
          {INKS.map((c) => (
            <button key={c} className={'nd-sw ink' + (pen.c === c ? ' on' : '')} style={{ background: c }} onClick={() => setPen((p) => ({ ...p, c }))} aria-label={c} />
          ))}
          {mode === 'draw' &&
            [5, 9, 20].map((w) => (
              <button key={w} className={'nd-pw' + (pen.w === w ? ' on' : '')} onClick={() => setPen((p) => ({ ...p, w }))} aria-label={'толщина ' + w}>
                <i style={{ width: 4 + w * 0.7, height: 4 + w * 0.7 }} />
              </button>
            ))}
          <button
            className="btn ghost small"
            onClick={() =>
              setDeco((d) => {
                const k = mode === 'draw' ? 'strokes' : 'notes';
                const list = [...(d[k] ?? [])];
                list.pop();
                return { ...d, [k]: list };
              })
            }
          >
            ↶ Отменить
          </button>
          <button className="btn small" onClick={() => setMode('write')}>
            Готово
          </button>
        </div>
      )}

      <div className="nd-go">
        {phase === 'build' ? (
          <div className="steps">
            {steps.map((s, i) => (
              <div className="st" key={i}>
                <i>
                  {s.done ? (
                    <svg viewBox="0 0 16 16" width="15" height="15" aria-label="готово">
                      <path d="M2.5 8.5l3.4 3.3L13.5 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : (
                    <span className="blink">▌</span>
                  )}
                </i>
                <div>
                  {s.label}
                  {s.detail && <div className="det">{s.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <button className={'btn' + (ready ? '' : ' soft')} onClick={go}>
              Проявить день
            </button>
            {!ready && <div className={'hint' + (nudge ? ' nudge' : '')}>{missing.map(([, m]) => m).join(' ')}</div>}
            {err && <p style={{ color: '#a33' }}>{err}</p>}
          </>
        )}
      </div>

      {songOpen &&
        createPortal(
          <div className="sp-back" onClick={() => setSongOpen(false)}>
            <div className="sp-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Песня дня">
              <div className="sp-head">
                <h3>Песня дня</h3>
                <button className="nd-ic" onClick={() => setSongOpen(false)} aria-label="Закрыть">
                  ×
                </button>
              </div>
              <SongPicker
                value={music}
                onChange={(m) => {
                  if (m) {
                    play('needle');
                    setSongOpen(false);
                  }
                  setMusic(m);
                }}
                disabled={phase === 'build'}
                motifs={heard}
                mood={feel ? { valence: ((feel - 3) / 2) * 0.9, arousal: mood.arousal + (feel === 5 ? 0.15 : 0) } : mood}
              />
              {music && (
                <button className="btn ghost small" onClick={() => setMusic(null)}>
                  Убрать песню
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
      {writing && <FocusWriter question={prompt} text={text} onText={setText} font={font} onFont={setFont} onClose={() => setWriting(false)} />}
    </div>
  );
}

const LAYOUTS: [PhotoLayout['kind'], PhotoLayout['grid'], string][] = [
  ['polaroid', undefined, 'Полароиды'],
  ['collage', 'rows', 'Коллаж: полосы'],
  ['collage', 'cols', 'Коллаж: колонки'],
  ['collage', 'grid', 'Коллаж: сетка'],
  ['free', undefined, 'Как хочу'],
];
/** иконки раскладок, как в инсте */
function LayIcon({ k, g }: { k: PhotoLayout['kind']; g?: PhotoLayout['grid'] }) {
  const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' as const };
  if (k === 'polaroid')
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="5" y="3.5" width="14" height="17" rx="1.5" {...P} />
        <rect x="7.5" y="6" width="9" height="9" {...P} />
      </svg>
    );
  if (k === 'free')
    return (
      <svg viewBox="0 0 24 24" aria-hidden>
        <rect x="3" y="4" width="10" height="10" rx="1" transform="rotate(-10 8 9)" {...P} />
        <rect x="11" y="10" width="10" height="10" rx="1" transform="rotate(8 16 15)" {...P} />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" {...P} />
      {g === 'rows' && <path d="M3.5 9.2h17M3.5 14.8h17" {...P} />}
      {g === 'cols' && <path d="M12 3.5v17" {...P} />}
      {(g === 'grid' || !g) && <path d="M12 3.5v17M3.5 12h17" {...P} />}
    </svg>
  );
}
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEK = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const dateWords = (iso: string) => {
  const d = new Date(iso + 'T12:00:00');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${WEEK[d.getDay()]}`;
};
const songLabel = (m: MusicInput) => (m.kind === 'track' ? `${m.track.artist} · ${m.track.title}` : m.kind === 'file' ? m.file.name.replace(/\.[^.]+$/, '') : m.kind === 'manual' ? [m.artist, m.title].filter(Boolean).join(' · ') : '');
/** цвет обложки тетради вокруг разворота */
function coverTint(style?: string) {
  const C: Record<string, string> = { black: '#1d1c23', kraft: '#b98d5f', marble: '#d9d4cc', guava: '#e98f86', birds: '#9fb7c9', linen: '#cfc4ae', night: '#232647', olive: '#7d8456', ransom: '#e9e1d0', collage: '#2c2b3a', custom: '#2c2b3a' };
  return C[style ?? 'black'] ?? '#1d1c23';
}
const PAPERS = ['#fbf8f1', '#ffffff', '#f3effd', '#fdeef1', '#eef7f1', '#eef4fb', '#fdf6dc', '#efe3cc'];
const INKS = ['#34314d', '#7a66d9', '#ef8466', '#4fa98a', '#f2b84b', '#5b9bd5'];

/** Слой поверх страницы: рисование пальцем/мышью и надписи, которые можно двигать */
function DecoLayer({ mode, deco, onDeco, pen, font, onWrite }: { mode: 'write' | 'draw' | 'note'; deco: PageDeco; onDeco: (f: (d: PageDeco) => PageDeco) => void; pen: { c: string; w: number }; font: DiaryFont; onWrite: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const drawing = useRef(false);
  const drag = useRef<{ i: number; dx: number; dy: number } | null>(null);
  const [edit, setEdit] = useState<{ i: number; t: string } | null>(null);
  const pt = (e: React.PointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 1000), Math.round(((e.clientY - r.top) / r.width) * 1000)] as const;
  };
  const w = el.current?.clientWidth ?? 500;
  const notes = deco.notes ?? [];
  const hitNote = (x: number, y: number) =>
    notes.findIndex((n) => {
      const [nx, ny, nw, nh] = noteRect(n, 1000);
      return x >= nx && x <= nx + nw && y >= ny && y <= ny + nh;
    });
  const setNote = (i: number, p: Partial<PageNote>) => onDeco((d) => ({ ...d, notes: (d.notes ?? []).map((n, j) => (j === i ? { ...n, ...p } : n)) }));
  return (
    <div
      ref={el}
      className={'deco deco-' + mode}
      onPointerDown={(e) => {
        if (mode === 'write') return onWrite();
        // не даём браузеру увести фокус и выделять текст: иначе новая надпись сразу теряет фокус
        e.preventDefault();
        if (edit) return;
        const [x, y] = pt(e);
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        if (mode === 'draw') {
          drawing.current = true;
          onDeco((d) => ({ ...d, strokes: [...(d.strokes ?? []), { c: pen.c, w: pen.w, p: [x, y] }] }));
        } else {
          const i = hitNote(x, y);
          if (i >= 0) drag.current = { i, dx: x - notes[i].x, dy: y - notes[i].y };
          else {
            const n: PageNote = { x: Math.max(0, x - 20), y: Math.max(0, y - 30), t: '', f: font === 'print' || font === 'type' ? 'hand' : font, c: pen.c, s: 64, r: Math.round((Math.random() - 0.5) * 8) };
            onDeco((d) => ({ ...d, notes: [...(d.notes ?? []), n] }));
            setEdit({ i: notes.length, t: '' });
          }
        }
      }}
      onPointerMove={(e) => {
        if (drawing.current) {
          const [x, y] = pt(e);
          onDeco((d) => {
            const list = [...(d.strokes ?? [])];
            const s = list[list.length - 1];
            const p = s.p;
            if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) < 3) return d;
            list[list.length - 1] = { ...s, p: [...p, x, y] };
            return { ...d, strokes: list };
          });
        } else if (drag.current) {
          const [x, y] = pt(e);
          setNote(drag.current.i, { x: Math.max(0, x - drag.current.dx), y: Math.max(0, y - drag.current.dy) });
        }
      }}
      onPointerUp={(e) => {
        if (drag.current) {
          const [x, y] = pt(e);
          const g = drag.current;
          const moved = Math.hypot(x - g.dx - notes[g.i].x, y - g.dy - notes[g.i].y) > 2;
          drag.current = null;
          // короткое нажатие по надписи — исправить её
          if (!moved && Math.abs(notes[g.i].x + g.dx - x) < 4) setEdit({ i: g.i, t: notes[g.i].t });
        }
        drawing.current = false;
      }}
    >
      {edit && notes[edit.i] && (
        <div className="deco-edit" style={{ left: Math.min((notes[edit.i].x * w) / 1000, w - 230), top: (notes[edit.i].y * w) / 1000 }} onPointerDown={(e) => e.stopPropagation()}>
          <input
            autoFocus
            className={'f-' + notes[edit.i].f}
            value={edit.t}
            placeholder="надпись"
            maxLength={60}
            onChange={(e) => {
              setEdit({ ...edit, t: e.target.value });
              setNote(edit.i, { t: e.target.value });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            onBlur={() => {
              if (!edit.t.trim()) onDeco((d) => ({ ...d, notes: (d.notes ?? []).filter((_, j) => j !== edit.i) }));
              setEdit(null);
            }}
          />
          <button
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => {
              onDeco((d) => ({ ...d, notes: (d.notes ?? []).filter((_, j) => j !== edit.i) }));
              setEdit(null);
            }}
            aria-label="Удалить надпись"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

const FONTS: [DiaryFont, string][] = [
  ['hand', 'От руки'],
  ['script', 'Каллиграфия'],
  ['print', 'Печатный'],
  ['type', 'Машинка'],
];
/** Письмо на весь экран: вопрос сверху, линованный лист и выбор почерка сбоку */
function FocusWriter({ question, text, onText, font, onFont, onClose }: { question: string; text: string; onText: (t: string) => void; font: DiaryFont; onFont: (f: DiaryFont) => void; onClose: () => void }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ta.current?.focus();
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    document.documentElement.classList.add('in-lock');
    return () => {
      removeEventListener('keydown', k);
      document.documentElement.classList.remove('in-lock');
    };
  }, [onClose]);
  return createPortal(
    <div className="fw" role="dialog" aria-label="Запись">
      <div className="fw-page">
        <div className="fw-q">{question}</div>
        <textarea ref={ta} className={'fw-ta f-' + font} value={text} onChange={(e) => onText(e.target.value)} placeholder="Пиши как другу…" />
      </div>
      <div className="fw-fonts" role="radiogroup" aria-label="Почерк">
        {FONTS.map(([f, name]) => (
          <button key={f} role="radio" aria-checked={font === f} className={'fw-font f-' + f + (font === f ? ' on' : '')} onClick={() => (play('tick'), onFont(f))} title={name}>
            <b>Аа</b>
            <small>{name}</small>
          </button>
        ))}
      </div>
      <button className="btn fw-done" onClick={onClose}>
        Готово
      </button>
    </div>,
    document.body,
  );
}

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
type PhotoOpen = { add?: () => void; cam?: () => void };
function PhotoBoard({ files, onChange, layout, onLayout, disabled, open }: { files: File[]; onChange: (f: File[]) => void; layout: PhotoLayout; onLayout: (l: PhotoLayout) => void; disabled?: boolean; open?: { current: PhotoOpen } }) {
  const inp = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  const [cam, setCam] = useState(false);
  if (open) open.current = { add: () => !disabled && inp.current?.click(), cam: () => !disabled && setCam(true) };
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
    if (!imgs.length) return;
    onChange([...files, ...imgs].slice(0, 8));
    // фото «прилипло» на скотч: звук, искорки над листом, зайчик радуется
    play('tape');
    buzz(10);
    bunnyReact('happy');
    requestAnimationFrame(() => {
      const r = sheet.current?.getBoundingClientRect();
      if (r) burst(r.left + r.width / 2, r.top + r.height * 0.4, 'sparks', 8);
    });
  };
  const sheet = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState(-1);
  const remove = (i: number) => {
    play('tear');
    setLeaving(i);
    setTimeout(() => {
      setLeaving(-1);
      onChange(filesRef.current.filter((_, j) => j !== i));
    }, 220);
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
        <div className={'pb-slots k-' + layout.kind + (layout.kind === 'collage' ? ' g-' + (layout.grid ?? 'grid') : '') + (over ? ' over' : '')} {...drop}>
          {Array.from({ length: layout.kind === 'collage' ? (layout.grid === 'cols' ? 2 : layout.grid === 'rows' ? 3 : 4) : layout.kind === 'free' ? 2 : 3 }, (_, i) => (
            <button key={i} className="pb-slot" onClick={() => !disabled && inp.current?.click()} disabled={disabled} aria-label="Вклеить фото">
              <span>+</span>
              <small>фото</small>
            </button>
          ))}
        </div>
      ) : (
        <div className={'pb-sheet' + (over ? ' over' : '')} {...drop} ref={sheet} key={layout.kind}>
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
            <div key={u} className={leaving === i ? 'leaving' : undefined}>
              <img src={u} alt="" />
              {!disabled && (
                <button onClick={() => remove(i)} aria-label="Убрать фото" data-sfx="none">
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
