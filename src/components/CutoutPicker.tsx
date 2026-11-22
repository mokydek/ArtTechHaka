import { useRef, useState } from 'react';
import type { CutoutRt } from '../lib/render/engine';
import { newId } from '../lib/store';

export interface NewCut {
  rt: CutoutRt;
  blob: Blob;
  kind: 'cut' | 'whole';
}

/** «Вклеить момент»: своя картинка → вырезанная наклейка или фото целиком */
export default function CutoutPicker({ count, onAdded, compact, tool, disabled }: { count: number; onAdded: (c: NewCut) => void; compact?: boolean; tool?: boolean; disabled?: boolean }) {
  const inp = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'cut' | 'whole'>('cut');
  const [busy, setBusy] = useState(0);
  const [err, setErr] = useState('');
  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    setErr('');
    const list = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 6);
    const S = await import('../lib/live/sticker');
    let i = count;
    for (const f of list) {
      setBusy((b) => b + 1);
      try {
        let kind = mode;
        let made = await S.makeSticker(f, kind).catch((e) => {
          // в панели страницы без лишних вопросов: не вырезалось — вклеиваем целиком
          if (!tool) throw e;
          return null;
        });
        if (!made) {
          kind = 'whole';
          made = await S.makeSticker(f, 'whole');
        }
        const spot = S.defaultSpot(i++);
        onAdded({ rt: { id: newId(), img: made.canvas, ...spot }, blob: made.blob, kind });
      } catch (e) {
        console.error(e);
        setErr('Не получилось вырезать, попробуйте «целиком».');
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };
  if (tool)
    return (
      <>
        <button className="nd-tool" onClick={() => inp.current?.click()} disabled={disabled || busy > 0} title="Вырезать главное из фото и вклеить стикером">
          <svg viewBox="0 0 24 24" aria-hidden>
            <circle cx="6.5" cy="17.5" r="2.6" />
            <circle cx="17.5" cy="17.5" r="2.6" />
            <path d="M8.4 15.6L18 4M15.6 15.6L6 4" />
          </svg>
          <span>{busy ? 'Вырезаю…' : 'Стикер'}</span>
        </button>
        <input ref={inp} type="file" accept="image/*" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
      </>
    );
  return (
    <div className={'cut-picker' + (compact ? ' compact' : '')}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn ghost small" onClick={() => inp.current?.click()} disabled={busy > 0}>
          {busy ? `✂ вырезаю… ${busy}` : '＋ Вклеить момент'}
        </button>
        <div className="seg" style={{ margin: 0 }}>
          <button className={'tab' + (mode === 'cut' ? ' on' : '')} onClick={() => setMode('cut')}>
            вырезать главное
          </button>
          <button className={'tab' + (mode === 'whole' ? ' on' : '')} onClick={() => setMode('whole')}>
            целиком
          </button>
        </div>
      </div>
      <input ref={inp} type="file" accept="image/*" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
      {err && <div className="hint">{err}</div>}
    </div>
  );
}
