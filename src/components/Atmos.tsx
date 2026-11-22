import { useEffect, useRef } from 'react';
import type { HourWeather } from '../lib/scene/context';

// Атмосфера поверх настоящей картинки (снимка или панорамы): время суток и погода того часа.
// Ничего не дорисовывает в самом месте — только свет, дождь, снег и туман сверху.

/** Насколько темно и насколько «золотой час» при такой высоте солнца */
export function lightAt(sunAlt: number) {
  const dark = sunAlt >= 6 ? 0 : sunAlt <= -10 ? 1 : (6 - sunAlt) / 16;
  const warm = sunAlt > 14 || sunAlt < -4 ? 0 : sunAlt > 4 ? (14 - sunAlt) / 10 : (sunAlt + 4) / 8;
  return { dark, warm };
}

export default function Atmos({ sunAlt, base, weather }: { sunAlt: number; base?: number | null; weather: HourWeather | null }) {
  const cv = useRef<HTMLCanvasElement>(null);
  // свет относительно картинки: на снимке уже его собственный свет, у панорамы — дневной
  const cur = lightAt(sunAlt),
    was = base == null ? { dark: 0, warm: 0 } : lightAt(base);
  const dark = Math.max(0, cur.dark - was.dark),
    warm = Math.max(0, cur.warm - was.warm);
  const code = weather?.code ?? 0;
  const snow = (weather?.snow ?? 0) > 0.05 || (code >= 71 && code <= 77) || code === 85 || code === 86;
  const rain = !snow && ((weather?.rain ?? 0) > 0.1 || (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95);
  const fog = code === 45 || code === 48;
  const cloud = Math.min(1, (weather?.cloud ?? 0) / 100);
  const heavy = (weather?.precip ?? 0) > 2 || code === 65 || code === 75 || code === 82 || code >= 95;

  useEffect(() => {
    const c = cv.current;
    if (!c || (!rain && !snow)) return;
    const g = c.getContext('2d')!;
    let raf = 0;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const fit = () => {
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(c.clientHeight * dpr);
    };
    fit();
    window.addEventListener('resize', fit);
    const N = snow ? (heavy ? 260 : 140) : heavy ? 420 : 220;
    const ps = Array.from({ length: N }, () => ({ x: Math.random(), y: Math.random(), z: 0.35 + Math.random() * 0.65, s: Math.random() }));
    const wind = ((weather?.wind ?? 8) / 40) * (Math.sin(((weather?.windDir ?? 220) * Math.PI) / 180) || 0.3);
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const W = c.width,
        H = c.height;
      g.clearRect(0, 0, W, H);
      if (snow) {
        g.fillStyle = `rgba(255,255,255,${0.75 - dark * 0.35})`;
        for (const p of ps) {
          p.y += dt * (0.05 + p.z * 0.07);
          p.x += dt * (wind * 0.06 + Math.sin(t / 900 + p.s * 9) * 0.01);
          if (p.y > 1.02) (p.y = -0.02), (p.x = Math.random());
          if (p.x > 1.02) p.x -= 1.04;
          if (p.x < -0.02) p.x += 1.04;
          g.beginPath();
          g.arc(p.x * W, p.y * H, (1 + p.z * 2.2) * dpr, 0, Math.PI * 2);
          g.fill();
        }
      } else {
        g.strokeStyle = `rgba(210,225,240,${0.32 - dark * 0.12})`;
        g.lineWidth = dpr;
        g.beginPath();
        for (const p of ps) {
          p.y += dt * (0.9 + p.z * 0.9);
          p.x += dt * wind * 0.25;
          if (p.y > 1.05) (p.y = -0.05), (p.x = Math.random());
          if (p.x > 1.02) p.x -= 1.04;
          if (p.x < -0.02) p.x += 1.04;
          const len = (14 + p.z * 22) * dpr;
          g.moveTo(p.x * W, p.y * H);
          g.lineTo(p.x * W + wind * len * 0.4, p.y * H + len);
        }
        g.stroke();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
    };
  }, [rain, snow, heavy, dark, weather?.wind, weather?.windDir]);

  return (
    <div className="atmos" aria-hidden>
      {cloud > 0.6 && base == null && <div className="atmos-grey" style={{ opacity: (cloud - 0.6) * 0.5 }} />}
      {warm > 0 && <div className="atmos-warm" style={{ opacity: warm * 0.5 }} />}
      {dark > 0 && <div className="atmos-dark" style={{ opacity: dark * 0.78 }} />}
      {fog && <div className="atmos-fog" />}
      {(rain || snow) && <canvas ref={cv} />}
    </div>
  );
}
