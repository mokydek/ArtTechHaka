import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDiary } from '../App';
import { tr } from '../lib/i18n';
import type { Notebook, NotebookMember } from '../lib/types';

type Sharing = {
  uid: string;
  members: (id: string) => Promise<NotebookMember[]>;
  invite: (id: string, ownerName: string, fresh?: boolean) => Promise<string>;
  stopInvites: (id: string) => Promise<void>;
  removeMember: (id: string, uid: string) => Promise<void>;
  leave: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
};

export const myName = () => {
  try {
    return localStorage.getItem('ottisk:name') ?? '';
  } catch {
    return '';
  }
};
export const saveMyName = (n: string) => {
  try {
    localStorage.setItem('ottisk:name', n);
  } catch {
    /* без хранилища */
  }
};

const HUES = ['#b9a8f4', '#f49b83', '#f4d77d', '#a9d7c2', '#9bc8e8'];
export function Avatar({ name, i }: { name: string; i: number }) {
  return (
    <span className="mb-av" style={{ background: `linear-gradient(140deg, ${HUES[i % 5]}, ${HUES[(i + 2) % 5]})` }} aria-hidden>
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

/** Общая тетрадь (как Shared Journal в Journey): участники, код приглашения, выход */
export default function Members({ nb, onClose }: { nb: Notebook; onClose: () => void }) {
  const { store, reload, toast } = useDiary();
  const cloud = store?.kind === 'cloud' ? (store as unknown as Sharing) : null;
  const owner = !nb.shared;
  const [list, setList] = useState<NotebookMember[] | null>(null);
  const [code, setCode] = useState(nb.inviteCode ?? '');
  const [name, setName] = useState(myName());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!cloud) return;
    cloud
      .members(nb.id)
      .then(setList)
      .catch(() => setList([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nb.id]);

  const link = code ? `${location.origin}/#/join/${code}` : '';

  const makeCode = async (fresh: boolean) => {
    if (!cloud) return;
    if (!name.trim()) {
      toast('Сначала напиши, как тебя подписать');
      return;
    }
    setBusy(true);
    try {
      saveMyName(name.trim());
      setCode(await cloud.invite(nb.id, name.trim(), fresh));
      await reload();
    } catch (e) {
      console.warn(e);
      toast('Не получилось создать код');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const text = `${tr('Приглашаю в общую тетрадь')} «${nb.title}»: ${link}\n${tr('Код приглашения')}: ${code}`;
    try {
      if (navigator.share) await navigator.share({ title: nb.title, text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Приглашение скопировано');
      }
    } catch {
      /* закрыли окно */
    }
  };

  const kick = async (m: NotebookMember) => {
    if (!cloud || !confirm(`Убрать ${m.name || 'участника'} из тетради?`)) return;
    await cloud.removeMember(nb.id, m.userId);
    setList((l) => l?.filter((x) => x.userId !== m.userId) ?? null);
  };

  const leave = async () => {
    if (!cloud || !confirm('Выйти из общей тетради? Твои дни в ней останутся у тебя, но тетрадь пропадёт с полки.')) return;
    await cloud.leave(nb.id);
    await reload();
    location.hash = '#/';
  };

  const keepName = async () => {
    saveMyName(name.trim());
    if (cloud && nb.shared) await cloud.rename(nb.id, name.trim()).catch(() => {});
    toast('Имя сохранено');
  };

  // окно — в body: у страниц есть анимация с transform, и fixed внутри неё съезжает
  return createPortal(
    <div className="sl-back" onClick={onClose}>
      <div className="sl mb" role="dialog" aria-label="Общая тетрадь" onClick={(e) => e.stopPropagation()}>
        <button className="sl-x" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <h2 className="h2">Общая тетрадь</h2>
        <p className="muted mb-lead">Пишите вместе с семьёй и друзьями: все участники видят дни этой тетради и добавляют свои.</p>
        {!cloud ? (
          <p className="muted">Общие тетради работают в облачном режиме.</p>
        ) : (
          <>
            <label className="sl-lab">
              Как тебя подписать
              <span className="mb-name">
                <input className="inp" value={name} maxLength={30} placeholder="Имя" onChange={(e) => setName(e.target.value)} />
                {name.trim() && name.trim() !== myName() && (
                  <button className="btn ghost small" onClick={keepName}>
                    Сохранить
                  </button>
                )}
              </span>
            </label>

            <div className="mb-list">
              <div className="mb-row">
                <Avatar name={nb.ownerName || (owner ? name : '') || '?'} i={0} />
                <span className="mb-t">
                  <b>{owner ? name || 'Ты' : nb.ownerName || 'Владелец'}</b>
                  <small>Владелец</small>
                </span>
              </div>
              {(list ?? []).map((m, i) => (
                <div className="mb-row" key={m.userId}>
                  <Avatar name={m.name || '?'} i={i + 1} />
                  <span className="mb-t">
                    <b>{m.userId === cloud.uid ? name || m.name || 'Ты' : m.name || 'Участник'}</b>
                    <small>Участник</small>
                  </span>
                  {owner && (
                    <button className="mb-kick" onClick={() => kick(m)} aria-label="Убрать участника" title="Убрать участника">
                      −
                    </button>
                  )}
                </div>
              ))}
              {list && !list.length && <p className="muted mb-empty">Пока ты здесь один. Пригласи кого-нибудь по коду.</p>}
            </div>

            {owner ? (
              <div className="mb-invite">
                <b>Пригласить</b>
                {code ? (
                  <>
                    <div className="sl-code">
                      <span>Код приглашения</span>
                      <b>{code}</b>
                      <small>Кто введёт код, станет участником тетради.</small>
                    </div>
                    <input className="inp" readOnly value={link} onFocus={(e) => e.target.select()} />
                    <div className="sl-actions">
                      <button className="btn" onClick={share}>
                        Отправить приглашение
                      </button>
                      <button className="btn ghost" disabled={busy} onClick={() => makeCode(true)}>
                        Новый код
                      </button>
                      <button
                        className="btn ghost"
                        onClick={async () => {
                          await cloud.stopInvites(nb.id);
                          setCode('');
                          await reload();
                        }}
                      >
                        Закрыть вход
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="btn" disabled={busy} onClick={() => makeCode(false)}>
                    {busy ? 'Создаю код…' : 'Создать код приглашения'}
                  </button>
                )}
              </div>
            ) : (
              <button className="btn ghost mb-leave" onClick={leave}>
                Выйти из тетради
              </button>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
