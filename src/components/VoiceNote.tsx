import { useEffect, useRef, useState } from 'react';

// Диктовка: речь → текст записи (Web Speech API) и одновременно запись своего голоса (MediaRecorder)

type SR = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const SRClass = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function VoiceNote({ onText, voice, onVoice, disabled }: { onText: (t: string) => void; voice: Blob | null; onVoice: (b: Blob | null) => void; disabled?: boolean }) {
  const [on, setOn] = useState(false);
  const [sec, setSec] = useState(0);
  const [interim, setInterim] = useState('');
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState(false);
  const rec = useRef<MediaRecorder | null>(null);
  const sr = useRef<SR | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef('');

  useEffect(
    () => () => {
      stop();
      audio.current?.pause();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const start = async () => {
    setErr('');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const b = new Blob(chunks, { type: (type || 'audio/webm').split(';')[0] });
        if (b.size > 2000) onVoice(b);
        s.getTracks().forEach((t) => t.stop());
      };
      r.start(500);
      rec.current = r;
    } catch {
      setErr('Нет доступа к микрофону.');
      return;
    }
    if (SRClass) {
      const r = new SRClass();
      r.lang = 'ru-RU';
      r.continuous = true;
      r.interimResults = true;
      r.onresult = (e) => {
        let fin = '',
          mid = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (res.isFinal) fin += res[0].transcript;
          else mid += res[0].transcript;
        }
        if (fin.trim()) onText(fin.trim());
        setInterim(mid);
      };
      r.onerror = (e) => e.error !== 'no-speech' && e.error !== 'aborted' && setErr('Распознавание речи недоступно, голос всё равно записывается.');
      r.onend = () => {
        // Chrome сам останавливает распознавание после паузы — перезапускаем, пока идёт запись
        if (rec.current?.state === 'recording') {
          try {
            r.start();
          } catch {
            /* */
          }
        }
      };
      try {
        r.start();
        sr.current = r;
      } catch {
        /* */
      }
    }
    setOn(true);
    setSec(0);
    const t0 = Date.now();
    timer.current = window.setInterval(() => setSec((Date.now() - t0) / 1000), 250);
  };

  function stop() {
    clearInterval(timer.current);
    const r = rec.current;
    rec.current = null;
    if (r && r.state !== 'inactive') r.stop();
    sr.current?.stop();
    sr.current = null;
    setInterim('');
    setOn(false);
  }

  const play = () => {
    if (!voice) return;
    if (playing) {
      audio.current?.pause();
      setPlaying(false);
      return;
    }
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = URL.createObjectURL(voice);
    const a = new Audio(url.current);
    a.onended = () => setPlaying(false);
    a.play();
    audio.current = a;
    setPlaying(true);
  };

  return (
    <div className="voice-note">
      {on ? (
        <button className="btn small rec-on" onClick={stop}>
          ■ Стоп · {fmt(sec)}
        </button>
      ) : (
        <button className="btn ghost small" onClick={start} disabled={disabled}>
          🎙 {voice ? 'Перезаписать' : 'Надиктовать'}
        </button>
      )}
      {voice && !on && (
        <>
          <button className="btn ghost small" onClick={play}>
            {playing ? '❚❚' : '▶'} свой голос
          </button>
          <button className="ask-more" onClick={() => onVoice(null)} title="удалить голос" disabled={disabled}>
            ×
          </button>
        </>
      )}
      {on && interim && <span className="interim">{interim}</span>}
      {err && <span className="hint">{err}</span>}
    </div>
  );
}
