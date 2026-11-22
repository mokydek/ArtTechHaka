import { useEffect, useRef, useState } from 'react';
import { fetchShared } from '../lib/store/cloud';
import { isSealed, normCode, unseal, type Sealed, type SharedAlbum } from '../lib/share';
import { humanDate } from '../lib/render/engine';
import { play as sfx } from '../lib/feel';

/** Записи по ссылке (как веб-ссылка в Journey): открываются в браузере без входа, при необходимости — по коду */
export default function ShareView({ token }: { token: string }) {
  const [album, setAlbum] = useState<SharedAlbum | null>(null);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [err, setErr] = useState('');
  const [code, setCode] = useState('');
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchShared(token)
      .then((j) => (isSealed(j) ? setSealed(j) : setAlbum(j as SharedAlbum)))
      .catch((e) => {
        console.error(e);
        setErr('Ссылка не открылась, возможно, она устарела.');
      });
  }, [token]);

  const open = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!sealed || normCode(code).length < 4) return;
    setBusy(true);
    setBad(false);
    try {
      setAlbum(await unseal(sealed, code));
      sfx('chime');
    } catch {
      setBad(true);
      sfx('nope');
    } finally {
      setBusy(false);
    }
  };

  if (err) return <p className="muted">{err}</p>;
  if (!album && !sealed) return <p className="mono muted blink">Открываю записи…</p>;

  if (!album)
    return (
      <form className={'sv-lock' + (bad ? ' bad' : '')} onSubmit={open}>
        <span className="sv-lock-ic" aria-hidden />
        <h1 className="h2">Записи под кодом</h1>
        <p className="muted">Введи код доступа, который тебе прислали вместе со ссылкой.</p>
        <input
          className="inp sv-code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Код доступа"
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={12}
          aria-label="Код доступа"
        />
        {bad && <p className="sv-bad">Код не подошёл, проверь ещё раз.</p>}
        <button className="btn" disabled={busy || normCode(code).length < 4}>
          {busy ? 'Проверяю…' : 'Открыть'}
        </button>
      </form>
    );

  const first = album.days[0];
  const hero = first?.photos[0] ?? first?.cover;
  const dates = album.days.map((d) => d.rec.date).sort();
  const span = dates.length ? (dates[0] === dates[dates.length - 1] ? humanDate(dates[0]).split(' · ')[0] : `${humanDate(dates[0]).split(' · ')[0]} – ${humanDate(dates[dates.length - 1]).split(' · ')[0]}`) : '';

  return (
    <div className="sv">
      <header className="sv-hero">
        {hero && <img src={hero} alt="" />}
        <div className="sv-hero-t">
          <h1>{album.title}</h1>
          <p>
            {album.days.length} {plural(album.days.length, 'запись', 'записи', 'записей')} · {span}
          </p>
          <button className="btn light" onClick={() => list.current?.scrollIntoView({ behavior: 'smooth' })}>
            Открыть записи
          </button>
        </div>
      </header>

      <div className="sv-list" ref={list}>
        {album.days.map((d) => (
          <article key={d.rec.id} className="sv-day">
            {d.photos.length > 0 && (
              <div className={'sv-photos n' + Math.min(d.photos.length, 3)}>
                {d.photos.slice(0, 3).map((p, i) => (
                  <img key={i} src={p} alt="" loading="lazy" />
                ))}
              </div>
            )}
            <div className="sv-body">
              <div className="mono muted">{humanDate(d.rec.date)}</div>
              <h2>{d.rec.title}</h2>
              {d.rec.text && <p className="sv-text">{d.rec.text}</p>}
              {(d.rec.music.title || d.rec.music.artist) && (
                <div className="sv-song">
                  ♪ {[d.rec.music.artist, d.rec.music.title].filter(Boolean).join(' · ')}
                </div>
              )}
              {(d.excerpt || d.voice) && (
                <div className="sv-audio">
                  {d.excerpt && <audio controls preload="none" src={d.excerpt} />}
                  {d.voice && <audio controls preload="none" src={d.voice} />}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      <a className="sv-own" href="#/">
        Завести свой дневник атмосферы →
      </a>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 10,
    b = n % 100;
  return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many;
}
