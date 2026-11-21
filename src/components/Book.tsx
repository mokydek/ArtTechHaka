import { useEffect, useState } from 'react';
import type { Notebook } from '../lib/types';
import { renderCover } from '../lib/covers';
import { useDiary } from '../App';

/** Обложка тетради (для коллажа подтягивает обложки последних дней) */
export function useCoverUrl(nb: Pick<Notebook, 'id' | 'title' | 'cover'>, size = 600) {
  const { covers, daysOf } = useDiary();
  const [url, setUrl] = useState('');
  const days = daysOf(nb.id);
  const srcs = nb.cover.style === 'collage' ? days.slice(0, 4).map((d) => covers[d.id]).filter(Boolean) : nb.cover.style === 'custom' && nb.cover.image ? [nb.cover.image] : [];
  const ckey = nb.cover.image ? nb.cover.image.length + nb.cover.image.slice(-24) : '';
  const key = nb.cover.style + nb.title + (nb.cover.style === 'collage' ? srcs.join('|') : ckey) + (nb.cover.label ?? '');
  useEffect(() => {
    let dead = false;
    (async () => {
      const imgs: HTMLImageElement[] = [];
      for (const s of srcs) {
        try {
          const im = new Image();
          im.crossOrigin = 'anonymous';
          im.src = s;
          await im.decode();
          imgs.push(im);
        } catch {
          /* пропускаем */
        }
      }
      const u = await renderCover(nb.cover.style, nb.title, imgs, size, Math.round(size * 1.333), { label: nb.cover.label, key: ckey });
      if (!dead) setUrl(u);
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);
  return url;
}

export default function Book({ nb, count, onClick }: { nb: Notebook; count: number; onClick?: () => void }) {
  const url = useCoverUrl(nb);
  return (
    <div className="book">
      <div className="book-body">
        <span className="book-pages" aria-hidden />
        <a className="book-cover" href={`#/nb/${nb.id}`} onClick={onClick}>
          {url ? <img src={url} alt={nb.title} /> : <div className="book-ph" />}
        </a>
      </div>
      <div className="ledge" />
      <div className="book-meta">
        <div>
          <div className="book-title">{nb.title}</div>
          <div className="mono muted">
            {count} {count % 10 === 1 && count % 100 !== 11 ? 'запись' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'записи' : 'записей'}
          </div>
        </div>
        {!nb.demo && (
          <a className="book-more" href={`#/nb/${nb.id}/cover`} title="Обложка и название">
            ···
          </a>
        )}
      </div>
    </div>
  );
}
