import { useEffect, useState } from 'react';
import { useDiary } from '../App';
import type { DayMedia, DayRecord } from '../lib/types';
import { download, folderZip, loadAssets } from '../lib/pipeline';
import { humanDate } from '../lib/render/engine';
import { keyName } from '../lib/analysis/audio';
import { voiceLabel } from '../lib/voice';
import Stage from '../components/Stage';
import Why from '../components/Why';
import { LocalStore } from '../lib/store/local';
import { placeLine } from '../lib/place';
import { AMB_NAMES } from '../lib/ambience';

const demoLocal = new LocalStore();

export default function DayView({ id }: { id: string }) {
  const { store, days: allDays, covers, toast, reload, notebookOf, notebooks } = useDiary();
  const rec0 = allDays.find((d) => d.id === id) ?? null;
  const nbId = rec0 ? notebookOf(rec0) : '';
  const nb = notebooks.find((n) => n.id === nbId);
  const days = rec0 ? allDays.filter((d) => notebookOf(d) === nbId) : allDays;
  const rec = days.find((d) => d.id === id) ?? null;
  const [media, setMedia] = useState<DayMedia | null>(null);
  const [assets, setAssets] = useState<{ bitmaps: ImageBitmap[]; audio: AudioBuffer | null } | null>(null);
  const [video, setVideo] = useState<Blob | null>(null);
  const [zipping, setZipping] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!rec || !store) return;
    let dead = false;
    (async () => {
      try {
        const m: DayMedia = rec.demo ? { photos: [], cover: covers[rec.id] } : await store.media(rec);
        if (dead) return;
        setMedia(m);
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
          extra={
            <button className="btn ghost small" onClick={zip} disabled={zipping || !media}>
              {zipping ? 'Собираю…' : '⇩ Папка дня .zip'}
            </button>
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
          <a className="mono muted" href={`#/nb/${nb.id}`} style={{ display: 'inline-block', marginBottom: 10 }}>
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

        <Why rec={rec} />

        <div className="navdays">
          {older ? <a href={`#/day/${older.id}`}>← {older.title}</a> : <span />}
          {newer ? <a href={`#/day/${newer.id}`} style={{ textAlign: 'right' }}>{newer.title} →</a> : <span />}
        </div>
        {!rec.demo && (
          <p style={{ marginTop: 30 }}>
            <button className="btn ghost small" onClick={remove}>
              Удалить день
            </button>
          </p>
        )}
        <p className="hint" style={{ marginTop: 24 }}>
          Настроение здесь — художественная интерпретация записи, а не психологическая оценка.
        </p>
      </div>
    </div>
  );
}

export type { DayRecord };
