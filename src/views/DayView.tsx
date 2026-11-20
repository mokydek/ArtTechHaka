import { useEffect, useState } from 'react';
import { useDiary } from '../App';
import type { DayMedia, DayRecord } from '../lib/types';
import { dayMotifs, lightOf } from '../lib/atmos';
import { download, folderZip, loadAssets, renderStory } from '../lib/pipeline';
import { humanDate } from '../lib/render/engine';
import { keyName } from '../lib/analysis/audio';
import { voiceLabel } from '../lib/voice';
import Stage from '../components/Stage';
import Why from '../components/Why';
import { LocalStore } from '../lib/store/local';
import Envelope, { countdown, useNow } from '../components/Envelope';
import { stamp } from '../lib/sfx';
import { placeLine } from '../lib/place';
import { AMB_NAMES } from '../lib/ambience';
import SkyBox from '../components/Sky';
import CutoutPicker from '../components/CutoutPicker';
import type { CutoutRt } from '../lib/render/engine';

const demoLocal = new LocalStore();

export default function DayView({ id }: { id: string }) {
  const { sealed } = useDiary();
  const s = sealed.find((d) => d.id === id);
  if (s) return <SealedDay rec={s} />;
  return <DayPage id={id} />;
}

/** Запечатанный день: до срока — только конверт; в срок — ломаем печать, и день проявляется заново */
function SealedDay({ rec }: { rec: DayRecord }) {
  const { store, reload, toast } = useDiary();
  const now = useNow(1000);
  const cd = countdown(rec.sealedUntil!, now);
  return (
    <div className="cap-view">
      <a className="mono muted" href="#/" style={{ textDecoration: 'none' }}>
        ← полка
      </a>
      <div className="cap-big">
        <Envelope
          due={cd.done}
          tint="#d8c3a0"
          label={`день · ${rec.date.split('-').reverse().join('.')}`}
          onOpened={async () => {
            if (!store) return;
            const { sealedUntil: _s, ...rest } = rec;
            void _s;
            try {
              const seen = (JSON.parse(localStorage.getItem('ottisk:seen') ?? '[]') as string[]).filter((x) => x !== rec.id);
              localStorage.setItem('ottisk:seen', JSON.stringify(seen));
            } catch {
              /* */
            }
            await store.update({ ...rest, unsealedAt: new Date().toISOString() } as DayRecord);
            await reload();
            toast('День вскрыт');
          }}
        />
      </div>
      {cd.done ? (
        <p className="cap-msg">Пора вспомнить. Сломайте печать.</p>
      ) : (
        <>
          <p className="cap-msg">Этот день запечатан. Откроется через</p>
          <div className="cap-count">{cd.text}</div>
          <p className="mono muted">запечатан {rec.sealedAt ? new Date(rec.sealedAt).toLocaleDateString('ru-RU') : ''} · откроется {new Date(rec.sealedUntil!).toLocaleDateString('ru-RU')}</p>
        </>
      )}
    </div>
  );
}

const SEAL_PRESETS: [string, () => Date][] = [
  ['через месяц', () => addMonths(1)],
  ['через полгода', () => addMonths(6)],
  ['в годовщину', () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }],
  ['через минуту — попробовать', () => new Date(Date.now() + 60_000)],
];
function addMonths(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

function SealPanel({ rec }: { rec: DayRecord }) {
  const { store, reload, toast } = useDiary();
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(2);
  if (!open)
    return (
      <button className="btn ghost small" onClick={() => setOpen(true)}>
        ✉ Запечатать день
      </button>
    );
  return (
    <div className="seal-panel">
      <div className="mono muted">день исчезнет из тетради и вернётся под сургучом</div>
      <div className="cap-presets">
        {SEAL_PRESETS.map(([l], j) => (
          <button key={l} className={'tab' + (i === j ? ' on' : '')} onClick={() => setI(j)}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="btn small"
          onClick={async () => {
            if (!store) return;
            const until = SEAL_PRESETS[i][1]();
            stamp();
            await store.update({ ...rec, sealedUntil: until.toISOString(), sealedAt: new Date().toISOString() });
            await reload();
            toast(`Запечатано до ${until.toLocaleDateString('ru-RU')}`);
          }}
        >
          Запечатать
        </button>
        <button className="btn ghost small" onClick={() => setOpen(false)}>
          Отмена
        </button>
      </div>
    </div>
  );
}

function SharePanel({ rec }: { rec: DayRecord }) {
  const { store, toast } = useDiary();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const cloud = store?.kind === 'cloud';
  if (!open)
    return (
      <button className="btn ghost small" onClick={() => setOpen(true)} disabled={!cloud} title={cloud ? '' : 'открытки работают в облачном режиме'}>
        ✉ Открытка другу
      </button>
    );
  const make = async () => {
    if (!store || store.kind !== 'cloud') return;
    setBusy(true);
    try {
      const tok = await (store as unknown as { sharePostcard: (r: DayRecord, n: string) => Promise<string> }).sharePostcard(rec, note.trim());
      setLink(`${location.origin}/#/p/${tok}`);
    } catch (e) {
      console.error(e);
      toast('Не получилось создать открытку');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="seal-panel" style={{ width: '100%' }}>
      {!link ? (
        <>
          <div className="mono muted">пара слов на обороте</div>
          <textarea className="inp pc-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Помнишь этот вечер?" maxLength={240} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn small" onClick={make} disabled={busy}>
              {busy ? 'Наклеиваю марку…' : 'Отправить открытку'}
            </button>
            <button className="btn ghost small" onClick={() => setOpen(false)}>
              Отмена
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mono muted">ссылка на открытку — откроется без регистрации, живёт год</div>
          <input className="inp" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn small"
              onClick={async () => {
                if (navigator.share && /Android|iPhone|iPad/i.test(navigator.userAgent)) await navigator.share({ title: rec.title, text: note || rec.title, url: link }).catch(() => {});
                else {
                  await navigator.clipboard.writeText(link).catch(() => {});
                  toast('Ссылка скопирована');
                }
              }}
            >
              Скопировать / поделиться
            </button>
            <a className="btn ghost small" href={link.replace(location.origin + '/', '')}>
              Посмотреть
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function DayPage({ id }: { id: string }) {
  const { store, days: allDays, covers, toast, reload, notebookOf, notebooks, setFocus } = useDiary();
  const rec0 = allDays.find((d) => d.id === id) ?? null;
  // сайт на время просмотра берёт цвета снимков и мотивы этого дня
  useEffect(() => {
    if (!rec0) return;
    setFocus({ motifs: dayMotifs(rec0.analysis.text, rec0.text, rec0.analysis.photos), paper: lightOf(rec0.design.palette), accent: rec0.design.palette.accent });
    return () => setFocus(null);
  }, [rec0, setFocus]);
  const nbId = rec0 ? notebookOf(rec0) : '';
  const nb = notebooks.find((n) => n.id === nbId);
  const days = rec0 ? allDays.filter((d) => notebookOf(d) === nbId) : allDays;
  const rec = days.find((d) => d.id === id) ?? null;
  const [media, setMedia] = useState<DayMedia | null>(null);
  const [assets, setAssets] = useState<{ bitmaps: ImageBitmap[]; audio: AudioBuffer | null } | null>(null);
  const [cuts, setCuts] = useState<CutoutRt[]>([]);
  const [video, setVideo] = useState<Blob | null>(null);
  const [zipping, setZipping] = useState(false);
  const [storyBusy, setStoryBusy] = useState(false);
  // в первый раз день проявляется как полароид
  const [firstView] = useState(() => {
    try {
      const seen = JSON.parse(localStorage.getItem('ottisk:seen') ?? '[]') as string[];
      if (seen.includes(id)) return false;
      localStorage.setItem('ottisk:seen', JSON.stringify([...seen, id].slice(-500)));
      return true;
    } catch {
      return false;
    }
  });
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!rec || !store) return;
    let dead = false;
    (async () => {
      try {
        const m: DayMedia = rec.demo ? { photos: [], cover: covers[rec.id] } : await store.media(rec);
        if (dead) return;
        setMedia(m);
        // вклейки: картинки из папки дня + раскладка из записи
        const rts: CutoutRt[] = [];
        for (const c of rec.cutouts ?? []) {
          const u = m.cutouts?.[c.id];
          if (!u) continue;
          try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = u;
            await img.decode();
            rts.push({ id: c.id, img, x: c.x, y: c.y, s: c.s, rot: c.rot });
          } catch {
            /* пропускаем */
          }
        }
        if (!dead) setCuts(rts);
        const a = await loadAssets(rec, m);
        if (!dead) setAssets(a);
      } catch (e) {
        console.error(e);
        setErr('Не удалось загрузить медиа дня');
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id, store]);

  if (!rec) return <p className="muted mono">{days.length ? 'День не найден.' : 'Загружаю…'}</p>;

  const idx = days.findIndex((d) => d.id === id);
  const newer = days[idx - 1];
  const older = days[idx + 1];
  const a = rec.analysis.music.audio;
  const t = rec.analysis.text;

  const onVideo = async (b: Blob) => {
    setVideo(b);
    const ext = b.type.includes('mp4') ? 'mp4' : 'webm';
    download(b, `${rec.folder} — воспоминание.${ext}`);
    try {
      if (rec.demo) await demoLocal.saveBlob(rec.id, 'video', b);
      else if (store) {
        await store.saveBlob(rec.id, 'video', b);
        await store.update({ ...rec, hasVideo: true, videoName: `memory.${ext}` });
        await reload();
      }
      toast('Видео сохранено в папку дня');
    } catch {
      toast('Видео скачано, но не сохранилось в облако');
    }
  };

  const zip = async () => {
    if (!media) return;
    setZipping(true);
    try {
      const z = await folderZip(rec, media, video ?? undefined);
      download(z, `${rec.folder}.zip`);
    } finally {
      setZipping(false);
    }
  };

  const story = async () => {
    if (!assets) return;
    setStoryBusy(true);
    try {
      const b = await renderStory(rec, assets.bitmaps, 6, cuts);
      const file = new File([b], `${rec.folder} — сторис.png`, { type: 'image/png' });
      const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
      if (nav.canShare?.({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) await nav.share({ files: [file], title: rec.title }).catch(() => download(b, file.name));
      else download(b, file.name);
    } finally {
      setStoryBusy(false);
    }
  };

  const remove = async () => {
    if (!store || rec.demo) return;
    if (!confirm(`Удалить папку «${rec.folder}»? Это нельзя отменить.`)) return;
    await store.remove(rec.id);
    await reload();
    location.hash = nb ? `#/nb/${nb.id}` : '#/';
  };

  return (
    <div className="day">
      {assets ? (
        <Stage
          rec={rec}
          bitmaps={assets.bitmaps}
          audio={assets.audio}
          autoplay
          onVideo={onVideo}
          voiceUrl={media?.voice}
          develop={firstView}
          cutouts={cuts}
          onCutouts={
            rec.demo
              ? undefined
              : async (list) => {
                  setCuts(list);
                  if (!store) return;
                  const kinds = new Map((rec.cutouts ?? []).map((c) => [c.id, c.kind]));
                  await store.update({ ...rec, cutouts: list.map((c) => ({ id: c.id, kind: kinds.get(c.id) ?? 'cut', x: c.x, y: c.y, s: c.s, rot: c.rot })) });
                  await reload();
                }
          }
          live={!!rec.live3d}
          onLive={async (on) => {
            if (rec.demo || !store) return;
            await store.update({ ...rec, live3d: on });
            await reload();
          }}
          extra={
            <>
              <button className="btn ghost small" onClick={zip} disabled={zipping || !media}>
                {zipping ? 'Собираю…' : '⇩ Папка дня .zip'}
              </button>
              <button className="btn ghost small" onClick={story} disabled={storyBusy}>
                {storyBusy ? '…' : '⇩ Сторис 9:16'}
              </button>
            </>
          }
        />
      ) : (
        <div className="stage">
          {covers[rec.id] ? <img src={covers[rec.id]} style={{ width: '100%', maxHeight: 'calc(100vh - 190px)', objectFit: 'contain', opacity: 0.6 }} alt="" /> : null}
          <p className="mono muted blink">{err || 'Открываю папку…'}</p>
        </div>
      )}
      <div className="panel">
        {nb && (
          <a className="mono muted" href={`#/nb/${nb.id}`} style={{ display: 'inline-block', marginBottom: 10, textDecoration: 'none' }}>
            ← {nb.title}
          </a>
        )}
        <div className="sec">
          <b>№ {String(rec.pageNo).padStart(3, '0')}</b> · {humanDate(rec.date)} {rec.demo && <span className="badge">пример</span>}
        </div>
        <h1>{rec.title}</h1>
        {rec.place && <div className="place-stamp" style={{ margin: '0 0 14px' }}>⌖ {placeLine(rec.place)}</div>}
        <div className="tree">
          <div>
            <span className="folder-ic" style={{ display: 'inline-block', marginRight: 8, verticalAlign: '-1px' }} />
            {rec.folder}/
          </div>
          <div>├─ запись.txt <span className="k">— {t.wordCount} слов</span></div>
          <div>├─ фото/ <span className="k">— {rec.photoCount} шт.</span></div>
          <div>
            ├─ песня <span className="k">— {[rec.music.artist, rec.music.title].filter(Boolean).join(' · ')}</span>
          </div>
          {rec.hasExcerpt && <div>├─ фрагмент песни.wav <span className="k">— 30 с</span></div>}
          {!!rec.ambience?.length && (
            <div>
              ├─ звуки дня.wav <span className="k">— {rec.ambience.map((a) => AMB_NAMES[a.kind]).join(' + ')}</span>
            </div>
          )}
          <div>├─ воспоминание.{rec.videoName?.split('.').pop() ?? 'webm'} <span className="k">— {rec.hasVideo || video ? 'сохранено' : 'нажмите «Сохранить видео»'}</span></div>
          <div>├─ обложка.jpg</div>
          {rec.hasVoice && <div>├─ мой голос <span className="k">— запись автора</span></div>}
          <div>├─ озвучка <span className="k">— {rec.design.voice.character}</span></div>
          <div>└─ почему так.txt</div>
        </div>

        <div className="box">
          <div className="sec">Запись</div>
          <div className="entry">{rec.text}</div>
        </div>

        <div className="box">
          <div className="sec">Песня дня</div>
          <div className="kv">
            <span className="k">трек</span>
            <span>
              {[rec.music.artist, rec.music.title].filter(Boolean).join(' — ')}
              {rec.music.year ? `, ${rec.music.year}` : ''}
            </span>
            {rec.music.genre && (
              <>
                <span className="k">жанр</span>
                <span>{rec.music.genre}</span>
              </>
            )}
            {a && (
              <>
                <span className="k">темп</span>
                <span>{Math.round(a.bpm)} BPM</span>
                <span className="k">лад</span>
                <span>{keyName(a.key, a.mode)}</span>
                <span className="k">энергия</span>
                <span>{Math.round(a.energy * 100)}%</span>
              </>
            )}
            <span className="k">голос</span>
            <span>{voiceLabel(rec.design.voice)}</span>
            {(rec.music.link || rec.music.serviceUrl) && (
              <>
                <span className="k">открыть</span>
                <span>
                  {rec.music.link && (
                    <a href={rec.music.link} target="_blank" rel="noreferrer">
                      ссылка из записи
                    </a>
                  )}
                  {rec.music.link && rec.music.serviceUrl && ' · '}
                  {rec.music.serviceUrl && (
                    <a href={rec.music.serviceUrl} target="_blank" rel="noreferrer">
                      Apple Music
                    </a>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        <SkyBox rec={rec} />

        <ThereBox rec={rec} photos={media?.photos.length ? media.photos : (rec.photoUrls ?? [])} />

        <Why rec={rec} />

        <div className="navdays">
          {older ? <a href={`#/day/${older.id}`}>← {older.title}</a> : <span />}
          {newer ? <a href={`#/day/${newer.id}`} style={{ textAlign: 'right' }}>{newer.title} →</a> : <span />}
        </div>
        <div style={{ marginTop: 30, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <SharePanel rec={rec} />
          {!rec.demo && (
            <CutoutPicker
              compact
              count={cuts.length}
              onAdded={async (c) => {
                if (!store) return;
                await store.saveBlob(rec.id, `cutout-${c.rt.id}`, c.blob);
                const next = [...cuts, c.rt];
                setCuts(next);
                await store.update({ ...rec, cutouts: [...(rec.cutouts ?? []), { id: c.rt.id, kind: c.kind, x: c.rt.x, y: c.rt.y, s: c.rt.s, rot: c.rt.rot }] });
                await reload();
                toast('Вклейка на странице — её можно разложить');
              }}
            />
          )}
        </div>
        {!rec.demo && (
          <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <SealPanel rec={rec} />
            <button className="btn ghost small" onClick={remove}>
              Удалить день
            </button>
          </div>
        )}
        <p className="hint" style={{ marginTop: 24 }}>
          Настроение здесь — художественная интерпретация записи, а не психологическая оценка.
        </p>
      </div>
    </div>
  );
}

export type { DayRecord };

/** Войти в любое фото дня: место, минута, солнце и погода того момента */
function ThereBox({ rec, photos }: { rec: DayRecord; photos: string[] }) {
  if (!photos.length) return null;
  return (
    <div className="box">
      <div className="sec">Побывать там</div>
      <div className="there-tiles">
        {photos.map((u, i) => {
          const m = rec.photoMeta?.[i];
          return (
            <a key={i} href={`#/there/${encodeURIComponent(rec.id)}/${i}`} title="войти в этот кадр">
              <img src={u} alt="" loading="lazy" />
              <span>{m?.lat != null ? '⌖ GPS' : '🚶'}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}
