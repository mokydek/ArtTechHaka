import { useState } from 'react';
import { useDiary } from '../App';
import { DEMO_INPUTS, buildDemoDay } from '../lib/demo';

/** Служебная страница: собирает демо-дни конвейером и кладёт их в облако (потом помечаются is_demo) */
export default function Seed() {
  const { store, reload } = useDiary();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!store) return;
    setBusy(true);
    const ordered = [...DEMO_INPUTS].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < ordered.length; i++) {
      const inp = ordered[i];
      try {
        const { record, cover } = await buildDemoDay(inp, i + 1);
        await store.save(record, { photos: [], cover });
        setLog((l) => [...l, `✓ ${record.id} · ${record.folder} · ${record.design.mode} · ${record.analysis.music.audio ? Math.round(record.analysis.music.audio.bpm) + ' BPM' : 'без аудио'}`]);
      } catch (e) {
        setLog((l) => [...l, `✗ ${inp.id}: ${e instanceof Error ? e.message : e}`]);
      }
    }
    await reload();
    setBusy(false);
    setLog((l) => [...l, 'готово']);
  };
  return (
    <div>
      <h1 className="h2">Сборка демо-дней</h1>
      <p className="muted">Хранилище: {store?.kind ?? '…'}</p>
      <button className="btn" onClick={run} disabled={busy || !store}>
        {busy ? 'Собираю…' : 'Собрать и сохранить'}
      </button>
      <pre className="mono" id="seed-log" style={{ whiteSpace: 'pre-wrap', textTransform: 'none' }}>
        {log.join('\n')}
      </pre>
    </div>
  );
}
