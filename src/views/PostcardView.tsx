import { useEffect, useState } from 'react';
import { fetchPostcard } from '../lib/store/cloud';
import { loadAssets } from '../lib/pipeline';
import { humanDate } from '../lib/render/engine';
import { stampArt, type StampDef } from '../lib/stamps';
import { stickersFor } from '../lib/render/stickers';
import Stage from '../components/Stage';
import { unfold } from '../lib/sfx';

type Card = Awaited<ReturnType<typeof fetchPostcard>>;

/** Открытка от друга: сначала лицевая сторона с маркой и словами, потом — живая страница дня */
export default function PostcardView({ token }: { token: string }) {
  const [card, setCard] = useState<Card | null>(null);
  const [err, setErr] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [assets, setAssets] = useState<{ bitmaps: ImageBitmap[]; audio: AudioBuffer | null } | null>(null);

  useEffect(() => {
    fetchPostcard(token)
      .then((c) => {
        setCard(c);
        return loadAssets(c.rec, { photos: c.photos, excerpt: c.excerpt, cover: c.cover });
      })
      .then(setAssets)
      .catch((e) => {
        console.error(e);
        setErr('Открытка не открылась — возможно, ссылка устарела.');
      });
  }, [token]);

  if (err) return <p className="muted">{err}</p>;
  if (!card) return <p className="mono muted blink">Почтальон несёт открытку…</p>;
  const rec = card.rec;
  const icon = stickersFor(rec.analysis.text)[0] ?? 'heart';
  const def: StampDef = { id: 'pc-' + rec.id, title: rec.design.mode === 'nocturne' ? 'Ноктюрн' : 'Оттиск', hint: '', icon, bg: rec.design.palette.colors[3] ?? '#d9c7a3', test: () => null };

  return (
    <div className="pc-wrap">
      {!flipped ? (
        <>
          <div className="pc" onClick={() => (unfold(), setFlipped(true))} role="button">
            <div className="pc-img">{card.cover && <img src={card.cover} alt="" />}</div>
            <div className="pc-back">
              <div className="pc-stamp">
                <img src={stampArt(def, 1)} alt="" />
                <span className="postmark">{rec.date.split('-').reverse().join('.')}</span>
              </div>
              <div className="pc-note">{card.note || 'Хочу, чтобы ты увидел этот день.'}</div>
              <div className="pc-lines">
                <i />
                <i />
                <i />
              </div>
              <div className="pc-from pt">«{rec.title}» · {humanDate(rec.date).split(' · ')[0]}</div>
            </div>
          </div>
          <button className="btn" onClick={() => (unfold(), setFlipped(true))} disabled={!assets}>
            {assets ? 'Перевернуть и оживить ▶' : 'Проявляю…'}
          </button>
        </>
      ) : (
        <div className="day pc-day">
          {assets && <Stage rec={rec} bitmaps={assets.bitmaps} audio={assets.audio} autoplay develop voiceUrl={card.voice} />}
          <div className="panel">
            <div className="sec">
              <b>✉</b> Открытка · {humanDate(rec.date)}
            </div>
            <h1>{rec.title}</h1>
            {card.note && <div className="pc-note inline">{card.note}</div>}
            <div className="box">
              <div className="sec">Запись</div>
              <div className="entry">{rec.text}</div>
            </div>
            <p style={{ marginTop: 26 }}>
              <a className="btn" href="#/">
                Завести свой дневник атмосферы →
              </a>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
