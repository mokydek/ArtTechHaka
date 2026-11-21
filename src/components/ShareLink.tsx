import { useState } from 'react';
import { useDiary } from '../App';
import { humanDate } from '../lib/render/engine';
import { newCode } from '../lib/share';
import { tr } from '../lib/i18n';
import type { DayRecord } from '../lib/types';

type Sharer = { shareDays: (r: DayRecord[], title: string, code?: string) => Promise<string> };

/** «Поделиться ссылкой»: выбрать дни → ссылка, которую откроют в браузере без входа; по желанию — под кодом */
export default function ShareLink({ title, days, onClose }: { title: string; days: DayRecord[]; onClose: () => void }) {
  const { store, photos, covers, toast } = useDiary();
  const [pick, setPick] = useState<Set<string>>(() => new Set(days.map((d) => d.id)));
  const [name, setName] = useState(title);
  const [lock, setLock] = useState(true);
  const [code] = useState(newCode);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const cloud = store?.kind === 'cloud';
  const chosen = days.filter((d) => pick.has(d.id));

  const toggle = (id: string) =>
    setPick((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const make = async () => {
    if (!cloud || !chosen.length) return;
    setBusy(true);
    try {
      const tok = await (store as unknown as Sharer).shareDays(chosen, name.trim() || title, lock ? code : undefined);
      setLink(`${location.origin}/#/s/${tok}`);
    } catch (e) {
      toast('Не получилось создать ссылку');
      console.warn(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const text = lock ? `${link}\n${tr('Код доступа')}: ${code}` : link;
    try {
      if (navigator.share) await navigator.share({ title: name, text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Ссылка скопирована');
      }
    } catch {
      /* закрыли окно «поделиться» */
    }
  };

  return (
    <div className="sl-back" onClick={onClose}>
      <div className="sl" role="dialog" aria-label="Поделиться ссылкой" onClick={(e) => e.stopPropagation()}>
        <button className="sl-x" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <h2 className="h2">Поделиться ссылкой</h2>
        {!cloud ? (
          <p className="muted">Ссылки работают в облачном режиме.</p>
        ) : link ? (
          <div className="sl-done">
            <p>Друзья откроют записи прямо в браузере, без регистрации. Ссылка живёт год.</p>
            <input className="inp" readOnly value={link} onFocus={(e) => e.target.select()} />
            {lock && (
              <div className="sl-code">
                <span>Код доступа</span>
                <b>{code}</b>
                <small>Отправь его отдельно от ссылки.</small>
              </div>
            )}
            <div className="sl-actions">
              <button className="btn" onClick={copy}>
                Скопировать / поделиться
              </button>
              <a className="btn ghost" href={link.slice(location.origin.length)}>
                Открыть
              </a>
            </div>
          </div>
        ) : (
          <>
            <label className="sl-lab">
              Название
              <input className="inp" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="sl-bar">
              <span>
                Выбрано {chosen.length} из {days.length}
              </span>
              <button className="sl-all" onClick={() => setPick(pick.size === days.length ? new Set() : new Set(days.map((d) => d.id)))}>
                {pick.size === days.length ? 'Снять все' : 'Выбрать все'}
              </button>
            </div>
            <div className="sl-list">
              {days.map((d) => {
                const src = photos[d.id]?.[0] ?? d.photoUrls?.[0] ?? covers[d.id];
                const on = pick.has(d.id);
                return (
                  <button key={d.id} className={'sl-day' + (on ? ' on' : '')} onClick={() => toggle(d.id)} aria-pressed={on}>
                    {src ? <img src={src} alt="" /> : <span className="sl-ph" />}
                    <span className="sl-t">
                      <b>{d.title}</b>
                      <small>{humanDate(d.date)}</small>
                    </span>
                    <i className="sl-check" aria-hidden />
                  </button>
                );
              })}
            </div>
            <button className={'sl-lock' + (lock ? ' on' : '')} onClick={() => setLock(!lock)} role="switch" aria-checked={lock}>
              <span className="sl-tog" aria-hidden />
              <span>
                <b>Защитить кодом доступа</b>
                <small>{lock ? `Код: ${code}` : 'Откроет любой, у кого есть ссылка'}</small>
              </span>
            </button>
            <button className="btn sl-go" disabled={!chosen.length || busy} onClick={make}>
              {busy ? 'Создаю ссылку…' : 'Создать ссылку'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
