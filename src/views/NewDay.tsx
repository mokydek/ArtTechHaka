import { useEffect, useRef, useState } from 'react';
import { useDiary } from '../App';
import { buildDay, renderCover, retitle, type BuiltDay, type MusicInput, type Step } from '../lib/pipeline';
import { lookupTrack, resolveLink, searchTracks, type TrackCandidate } from '../lib/analysis/music';
import Stage from '../components/Stage';
import Why from '../components/Why';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function NewDay() {
  const { store, days, reload, setCover, toast } = useDiary();
  const [date, setDate] = useState(today());
  const [text, setText] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [music, setMusic] = useState<MusicInput | null>(null);
  const [phase, setPhase] = useState<'form' | 'build' | 'preview' | 'save'>('form');
  const [steps, setSteps] = useState<Step[]>([]);
  const [built, setBuilt] = useState<BuiltDay | null>(null);
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');

  const ready = text.trim().length > 10 && photos.length > 0 && !!music;

  const develop = async () => {
    setErr('');
    setPhase('build');
    setSteps([]);
    try {
      const pageNo = Math.max(0, ...days.map((d) => d.pageNo)) + 1;
      const b = await buildDay({ text, date, photos, music: music!, pageNo }, (s) =>
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
      const cover = await renderCover(rec, built.bitmaps);
      await store.save(rec, { photos: built.photoBlobs, cover, excerpt: built.excerpt });
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
        <Stage rec={built.record} title={title} bitmaps={built.bitmaps} audio={built.audio} autoplay />
        <div className="panel">
          <div className="sec">
            <b>●</b> Папка дня — название придумала система, можно поправить
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
    <div className="new">
      <div>
        <div className="sec">
          <b>01</b> // Запись
        </div>
        <h1 className="h1" style={{ fontSize: 44, marginBottom: 18 }}>
          Как прошёл день?
        </h1>
        <div className="field">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Пишите как близкому другу: погода, свет, запахи, звуки, кто был рядом, мелочи, которые запомнились…"
            disabled={phase === 'build'}
          />
          <div className="hint" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>Система ищет в тексте время суток, сезон, погоду, места, людей и слова настроения.</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="inp" style={{ width: 170, padding: '6px 10px' }} />
          </div>
        </div>
        <div className="sec">
          <b>02</b> // Фото
        </div>
        <Photos files={photos} onChange={setPhotos} disabled={phase === 'build'} />
      </div>
      <div>
        <div className="sec">
          <b>03</b> // Песня дня
        </div>
        <SongPicker value={music} onChange={setMusic} disabled={phase === 'build'} />
        <div style={{ marginTop: 34 }}>
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
              <button className="btn" onClick={develop} disabled={!ready} style={{ fontSize: 13, padding: '14px 26px' }}>
                Проявить день →
              </button>
              <div className="hint">
                {!text.trim() ? 'Нужна запись (хотя бы пара предложений). ' : ''}
                {!photos.length ? 'Нужно минимум одно фото. ' : ''}
                {!music ? 'Выберите песню. ' : ''}
                {ready && 'Всё на месте. Анализ идёт на устройстве — запись никуда не отправляется до сохранения.'}
              </div>
              {err && <p style={{ color: '#a33' }}>{err}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Photos({ files, onChange, disabled }: { files: File[]; onChange: (f: File[]) => void; disabled?: boolean }) {
  const inp = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  const add = (list: FileList | null) => {
    if (!list) return;
    const imgs = [...list].filter((f) => f.type.startsWith('image/'));
    onChange([...files, ...imgs].slice(0, 8));
  };
  return (
    <div className="field">
      <div
        className={'drop' + (over ? ' over' : '')}
        onClick={() => !disabled && inp.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <div style={{ fontFamily: 'var(--serif)', fontSize: 21 }}>Перетащите фото дня сюда</div>
        <div className="hint" style={{ marginTop: 2 }}>
          или нажмите, чтобы выбрать · от 1 до 8 снимков
        </div>
        <input ref={inp} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      </div>
      {!!files.length && (
        <div className="thumbs">
          {urls.map((u, i) => (
            <div key={u}>
              <img src={u} alt="" />
              {!disabled && <button onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SongPicker({ value, onChange, disabled }: { value: MusicInput | null; onChange: (m: MusicInput | null) => void; disabled?: boolean }) {
  const [tab, setTab] = useState<'search' | 'file'>('search');
  const [q, setQ] = useState('');
  const [res, setRes] = useState<TrackCandidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [link, setLink] = useState<string | undefined>();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  const find = async () => {
    const s = q.trim();
    if (!s) return;
    setBusy(true);
    setNote('');
    setRes([]);
    try {
      if (/^https?:\/\//i.test(s)) {
        setLink(s);
        const r = await resolveLink(s);
        if (r?.appleId) {
          const t = await lookupTrack(r.appleId);
          setRes(t ? [t] : []);
        } else if (r?.query) {
          setNote(`По ссылке: «${r.serviceTitle ?? r.query}». Ищу в каталоге…`);
          const list = await searchTracks(r.query);
          setRes(list);
          if (!list.length) setNote('Песню по ссылке не нашли в каталоге — впишите «исполнитель — название».');
        } else setNote('Этот сервис не отдаёт название по ссылке. Впишите «исполнитель — название», а ссылку мы сохраним в папке дня.');
      } else {
        const list = await searchTracks(s);
        setRes(list);
        if (!list.length) setNote('Ничего не нашли. Попробуйте иначе или загрузите свой файл.');
      }
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
    a.play();
    a.onended = () => setPlaying(null);
    setPlaying(t.trackId);
  };
  useEffect(() => () => audio.current?.pause(), []);

  const sel = value?.kind === 'track' ? value.track.trackId : null;
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
              placeholder="Frank Sinatra Fly Me to the Moon — или ссылка Spotify / YouTube / Apple Music"
            />
            <button className="btn" onClick={find} disabled={busy || disabled}>
              {busy ? '…' : 'Найти'}
            </button>
          </div>
          {note && <div className="hint">{note}</div>}
          <div className="results">
            {res.map((t) => (
              <div key={t.trackId} className={'track' + (sel === t.trackId ? ' on' : '')} role="button" onClick={() => !disabled && onChange({ kind: 'track', track: t, link })} style={{ cursor: 'pointer' }}>
                {t.artwork ? <img src={t.artwork} alt="" /> : <span />}
                <div>
                  <b>{t.title}</b>
                  <small>
                    {t.artist} · {t.year ?? '—'} · {t.genre ?? ''}
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
            ))}
          </div>
          <div className="hint">Звучит официальный 30-секундный фрагмент из каталога Apple Music — песня целиком нигде не хранится. Его же система слушает: темп, тональность, энергию.</div>
        </>
      ) : (
        <>
          <label className="drop" style={{ display: 'block' }}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 21 }}>{value?.kind === 'file' ? value.file.name : 'Выберите mp3 / m4a / wav'}</div>
            <div className="hint">Система найдёт самые плотные 30 секунд (обычно припев) и сохранит в папке только их.</div>
            <input type="file" accept="audio/*" hidden disabled={disabled} onChange={(e) => e.target.files?.[0] && onChange({ kind: 'file', file: e.target.files[0] })} />
          </label>
        </>
      )}
      {value && (
        <div className="mono" style={{ marginTop: 12 }}>
          ♪ выбрано: {value.kind === 'track' ? `${value.track.artist} — ${value.track.title}` : value.kind === 'file' ? value.file.name : `${value.artist} — ${value.title}`}
        </div>
      )}
    </div>
  );
}
