import { useState } from 'react';
import { useDiary } from '../App';
import { myName, saveMyName } from '../components/Members';
import { normCode } from '../lib/share';
import { play as sfx } from '../lib/feel';

type Joiner = { join: (code: string, name: string) => Promise<string> };

/** Вступить в общую тетрадь по коду приглашения */
export default function JoinView({ code: initial }: { code?: string }) {
  const { store, reload } = useDiary();
  const [code, setCode] = useState((initial ?? '').toUpperCase());
  const [name, setName] = useState(myName());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const cloud = store?.kind === 'cloud';

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloud || busy) return;
    if (normCode(code).length < 4 || !name.trim()) return;
    setBusy(true);
    setErr('');
    try {
      saveMyName(name.trim());
      const id = await (store as unknown as Joiner).join(normCode(code), name.trim());
      sfx('chime');
      await reload();
      location.hash = `#/nb/${id}`;
    } catch (x) {
      console.warn(x);
      sfx('nope');
      setErr('Такого кода нет или вход в тетрадь закрыт.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={'sv-lock jv' + (err ? ' bad' : '')} onSubmit={go}>
      <span className="jv-ic" aria-hidden />
      <h1 className="h2">Общая тетрадь</h1>
      <p className="muted">Тебя пригласили вести тетрадь вместе: ты увидишь дни участников и сможешь добавлять свои.</p>
      {!cloud && store && <p className="muted">Общие тетради работают в облачном режиме.</p>}
      <input className="inp sv-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Код приглашения" maxLength={12} autoCapitalize="characters" autoComplete="off" aria-label="Код приглашения" />
      <input className="inp jv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Как тебя подписать" maxLength={30} aria-label="Имя" />
      {err && <p className="sv-bad">{err}</p>}
      <button className="btn" disabled={busy || !cloud || normCode(code).length < 4 || !name.trim()}>
        {busy ? 'Вступаю…' : 'Вступить'}
      </button>
    </form>
  );
}
