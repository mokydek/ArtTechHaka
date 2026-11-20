import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/cormorant-garamond/400-italic.css';
import '@fontsource/cormorant-garamond/500-italic.css';
import '@fontsource/caveat/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import '@fontsource/pt-mono/400.css';
import './styles.css';
import App from './App';
import { analyzeAudio, bestExcerpt, excerptToWav } from './lib/analysis/audio';
import { analyzeText, makeTitle } from './lib/analysis/text';

// отладочный доступ к анализаторам (для проверки на реальных песнях)
(window as unknown as Record<string, unknown>).__ottisk = { analyzeAudio, bestExcerpt, excerptToWav, analyzeText, makeTitle, live: () => import('./lib/live/segment'), scene: () => import('./lib/scene/context'), depth: () => import('./lib/scene/depth') };

// шрифты нужны холсту заранее
const preload = [
  '500 italic 40px "Cormorant Garamond"',
  '400 italic 40px "Cormorant Garamond"',
  '400 40px "Cormorant Garamond"',
  '500 40px "Cormorant Garamond"',
  '600 40px "Cormorant Garamond"',
  '500 40px Caveat',
  '400 16px "JetBrains Mono"',
  '500 16px "JetBrains Mono"',
  '800 40px Manrope',
  '600 16px Manrope',
  '400 16px "PT Mono"',
];
Promise.all(preload.map((f) => document.fonts.load(f, 'Аа Zz 1'))).catch(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: оболочка работает офлайн и ставится на телефон как приложение
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* оттиск: каждое нажатие на кнопку-штамп оставляет на бумаге расходящийся след краски */
if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  addEventListener(
    'pointerdown',
    (e) => {
      const t = (e.target as Element | null)?.closest?.('.btn, .tab-new') as HTMLElement | null;
      if (!t || (t as HTMLButtonElement).disabled) return;
      const cs = getComputedStyle(t);
      const c = (t.classList.contains('ghost') ? cs.getPropertyValue('--fg') : cs.getPropertyValue('--bg')).trim();
      const d = document.createElement('i');
      d.className = 'inkprint';
      d.style.left = e.clientX + 'px';
      d.style.top = e.clientY + 'px';
      if (c) d.style.setProperty('--c', c);
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 800);
    },
    { passive: true },
  );
}
