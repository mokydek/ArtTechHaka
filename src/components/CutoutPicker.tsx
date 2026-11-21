import { useRef, useState } from 'react';
import type { CutoutRt } from '../lib/render/engine';
import { newId } from '../lib/store';

export interface NewCut {
  rt: CutoutRt;
  blob: Blob;
  kind: 'cut' | 'whole';
}

/** «Вклеить момент»: своя картинка → вырезанная наклейка или фото целиком */
export default function CutoutPicker({ count, onAdded, compact }: { count: number; onAdded: (c: NewCut) => void; compact?: boolean }) {
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
        const { canvas, blob } = await S.makeSticker(f, mode);
        const spot = S.defaultSpot(i++);
        onAdded({ rt: { id: newId(), img: canvas, ...spot }, blob, kind: mode });
      } catch (e) {
        console.error(e);
        setErr('Не получилось вырезать, попробуйте «целиком».');
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };
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
