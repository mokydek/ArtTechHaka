import { useEffect, useRef, useState } from 'react';

/** «Что здесь прямо сейчас?» — снимок с камеры прямо в запись */
export default function Camera({ onShot, onClose }: { onShot: (f: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [err, setErr] = useState('');
  const [flash, setFlash] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    let s: MediaStream | null = null;
    let dead = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then((st) => {
        if (dead) return st.getTracks().forEach((t) => t.stop());
        s = st;
        if (video.current) {
          video.current.srcObject = st;
          video.current.play().catch(() => {});
        }
      })
      .catch(() => setErr('Камера недоступна — разрешите доступ в браузере или добавьте фото из галереи.'));
    return () => {
      dead = true;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  const shoot = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    if (facing === 'user') {
      g.translate(c.width, 0);
      g.scale(-1, 1);
    }
    g.drawImage(v, 0, 0);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    c.toBlob(
      (b) => {
        if (!b) return;
        const d = new Date();
        onShot(new File([b], `camera-${d.getHours()}${String(d.getMinutes()).padStart(2, '0')}.jpg`, { type: 'image/jpeg' }));
        setCount((n) => n + 1);
      },
      'image/jpeg',
      0.9,
    );
  };

  return (
    <div className="cam" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cam-box">
        {err ? <p className="cam-err">{err}</p> : <video ref={video} playsInline muted style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }} />}
        {flash && <div className="cam-flash" />}
        <div className="cam-bar">
          <button className="btn ghost small cam-light" onClick={onClose}>
            {count ? `Готово · ${count}` : 'Закрыть'}
          </button>
          <button className="cam-shutter" onClick={shoot} disabled={!!err} aria-label="снять" />
          <button className="btn ghost small cam-light" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} disabled={!!err}>
            ⟲ камера
          </button>
        </div>
      </div>
    </div>
  );
}
