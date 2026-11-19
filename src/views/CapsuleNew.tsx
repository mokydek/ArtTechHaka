import { useState } from 'react';
import { useDiary } from '../App';
import { newId } from '../lib/store';
import { moonPhase } from '../lib/sky';
import { todayISO } from '../lib/prompts';
import { humanDate } from '../lib/render/engine';
import VoiceNote from '../components/VoiceNote';
import Envelope from '../components/Envelope';
import { stamp } from '../lib/sfx';
import type { Capsule } from '../lib/types';

const PRESETS: [string, () => Date][] = [
  ['через месяц', () => addMonths(1)],
  ['через полгода', () => addMonths(6)],
  ['через год', () => addMonths(12)],
  ['через 5 лет', () => addMonths(60)],
  ['через минуту — попробовать', () => new Date(Date.now() + 60_000)],
];
function addMonths(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  d.setHours(9, 0, 0, 0);
  return d;
}

const ASKS = ['Что сейчас кажется самым важным?', 'Чего ты боишься и на что надеешься?', 'Какая песня крутится в голове?', 'С кем ты проводишь вечера?', 'Что бы ты хотел спросить у себя будущего?'];

/** Письмо себе в будущее: пишешь, выбираешь дату, запечатываешь сургучом */
export default function CapsuleNew() {
  const { store, saveCapsule, days, toast } = useDiary();
  const [text, setText] = useState('');
  const [preset, setPreset] = useState(2);
  const [custom, setCustom] = useState('');
  const [voice, setVoice] = useState<Blob | null>(null);
  const [phase, setPhase] = useState<'write' | 'seal'>('write');
  const [id] = useState(newId);
  const openAt = custom ? new Date(custom + 'T09:00:00') : PRESETS[preset][1]();
  const last = days.find((d) => !d.demo) ?? days[0];

  const seal = async () => {
    if (!store) return;
    const today = todayISO();
    const m = moonPhase(today);
    const c: Capsule = {
      kind: 'capsule',
      id,
      createdAt: new Date().toISOString(),
      openAt: openAt.toISOString(),
      text: text.trim(),
      context: {
        date: today,
        moon: `${m.name}, ${Math.round(m.illum * 100)}%`,
        lastDay: last?.title,
        song: last ? [last.music.artist, last.music.title].filter(Boolean).join(' — ') : undefined,
        place: last?.place?.name,
      },
      hasVoice: !!voice,
      voiceName: voice ? `voice.${voice.type.includes('mp4') ? 'mp4' : 'webm'}` : undefined,
    };
    setPhase('seal');
    try {
      await saveCapsule(c);
      if (voice) await store.saveBlob(id, 'voice', voice);
      setTimeout(stamp, 450);
      setTimeout(() => {
        toast(`Запечатано до ${openAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}`);
        location.hash = '#/';
      }, 2200);
    } catch (e) {
      console.error(e);
      toast('Не сохранилось');
      setPhase('write');
    }
  };

  if (phase === 'seal')
    return (
      <div className="cap-seal">
        <div className="cap-seal-env">
          <Envelope due={false} label={`вскрыть ${openAt.toLocaleDateString('ru-RU')}`} />
        </div>
        <p className="mono muted">запечатываю…</p>
      </div>
    );

  return (
    <div className="cap-new">
      <div>
        <div className="sec">
          <b>✉</b> Капсула времени
        </div>
        <h1 className="h1" style={{ fontSize: 44, marginBottom: 10 }}>
          Письмо себе в будущее
        </h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Конверт ляжет на полку под сургучом и откроется только в назначенный день. До этого его не прочитать — даже тебе.
        </p>
        <div className="letter">
          <div className="letter-date pt">{humanDate(todayISO())}</div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Привет, я из ${new Date().getFullYear()} года…\n\n${ASKS[new Date().getDate() % ASKS.length]}`} autoFocus />
        </div>
        <VoiceNote onText={(t) => setText((p) => (p.trim() ? p.trimEnd() + ' ' : '') + t.charAt(0).toUpperCase() + t.slice(1) + '.')} voice={voice} onVoice={setVoice} />
      </div>
      <div className="cap-side">
        <div className="sec">Когда открыть</div>
        <div className="cap-presets">
          {PRESETS.map(([l], i) => (
            <button key={l} className={'tab' + (!custom && preset === i ? ' on' : '')} onClick={() => (setPreset(i), setCustom(''))}>
              {l}
            </button>
          ))}
        </div>
        <label className="mono muted" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 22px' }}>
          или дата
          <input type="date" className="inp" style={{ width: 170, padding: '6px 10px' }} min={todayISO()} value={custom} onChange={(e) => setCustom(e.target.value)} />
        </label>
        <div className="cap-preview">
          <Envelope due={false} label={`вскрыть ${openAt.toLocaleDateString('ru-RU')}`} />
        </div>
        <p className="hint">
          В конверт сам вложится «снимок момента»: дата, фаза луны{last ? `, последний день в дневнике — «${last.title}» и его песня` : ''}.
        </p>
        <button className="btn" onClick={seal} disabled={text.trim().length < 3 && !voice} style={{ padding: '14px 26px' }}>
          Запечатать сургучом
        </button>
      </div>
    </div>
  );
}
