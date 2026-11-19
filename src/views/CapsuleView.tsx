import { useEffect, useState } from 'react';
import { useDiary } from '../App';
import Envelope, { countdown, useNow } from '../components/Envelope';
import { humanDate } from '../lib/render/engine';
import type { DayRecord } from '../lib/types';
import { plural } from '../lib/prompts';

function ago(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return 'совсем недавно';
  if (days < 45) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  const m = Math.round(days / 30.4);
  if (m < 12) return `${m} ${plural(m, 'месяц', 'месяца', 'месяцев')} назад`;
  const y = Math.round(days / 365.25);
  return `${y} ${plural(y, 'год', 'года', 'лет')} назад`;
}

/** Капсула: до срока — конверт с обратным отсчётом; в срок — ритуал вскрытия и письмо из прошлого */
export default function CapsuleView({ id }: { id: string }) {
  const { capsules, saveCapsule, store, loading } = useDiary();
  const c = capsules.find((x) => x.id === id);
  const now = useNow(1000);
  const [justOpened, setJustOpened] = useState(false);
  const [shown, setShown] = useState(0);
  const [voiceUrl, setVoiceUrl] = useState<string | undefined>();

  // письмо проявляется буква за буквой
  useEffect(() => {
    if (!justOpened || !c) return;
    const t = setInterval(() => setShown((n) => (n >= c.text.length ? n : n + 2)), 28);
    return () => clearInterval(t);
  }, [justOpened, c]);

  useEffect(() => {
    if (!c?.hasVoice || !c.openedAt || !store) return;
    store
      .media({ id: c.id, photoCount: 0, hasVoice: true, voiceName: c.voiceName ?? 'voice.webm' } as DayRecord)
      .then((m) => setVoiceUrl(m.voice))
      .catch(() => {});
  }, [c?.id, c?.hasVoice, c?.openedAt, store]);

  if (!c) return <p className="muted">{loading ? 'Ищу конверт…' : 'Капсула не найдена.'}</p>;
  const cd = countdown(c.openAt, now);
  const due = cd.done;
  const written = humanDate(c.context.date);

  if (!c.openedAt)
    return (
      <div className="cap-view">
        <a className="mono muted" href="#/" style={{ textDecoration: 'none' }}>
          ← полка
        </a>
        <div className="cap-big">
          <Envelope
            due={due}
            label={`от себя · ${c.context.date.split('-').reverse().join('.')}`}
            onOpened={async () => {
              await saveCapsule({ ...c, openedAt: new Date().toISOString() });
              setJustOpened(true);
            }}
          />
        </div>
        {due ? (
          <p className="cap-msg">Пора. Сломайте печать.</p>
        ) : (
          <>
            <p className="cap-msg">Откроется через</p>
            <div className="cap-count">{cd.text}</div>
            <p className="mono muted">
              {new Date(c.openAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · написано {written}
            </p>
          </>
        )}
      </div>
    );

  const txt = justOpened ? c.text.slice(0, shown) : c.text;
  return (
    <div className="cap-view">
      <a className="mono muted" href="#/" style={{ textDecoration: 'none' }}>
        ← полка
      </a>
      <div className="letter letter-open">
        <div className="letter-date pt">{written}</div>
        <div className="letter-text">
          {txt}
          {justOpened && shown < c.text.length && <span className="blink">▌</span>}
        </div>
        <div className="letter-sign">— ты, {ago(c.createdAt)}</div>
      </div>
      {voiceUrl && (
        <p>
          <audio src={voiceUrl} controls />
        </p>
      )}
      <div className="box cap-ctx">
        <div className="sec">Когда это писалось</div>
        <div className="kv">
          <span className="k">дата</span>
          <span>{written}</span>
          {c.context.moon && (
            <>
              <span className="k">луна</span>
              <span>{c.context.moon}</span>
            </>
          )}
          {c.context.lastDay && (
            <>
              <span className="k">в дневнике</span>
              <span>последний день — «{c.context.lastDay}»</span>
            </>
          )}
          {c.context.song && (
            <>
              <span className="k">звучало</span>
              <span>{c.context.song}</span>
            </>
          )}
          <span className="k">вскрыто</span>
          <span>{new Date(c.openedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>
  );
}
