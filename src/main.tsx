import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/caveat/500.css';
import '@fontsource/marck-script/400.css';
import '@fontsource/pt-mono/400.css';
import './styles.css';
import App from './App';
import { initI18n } from './lib/i18n';
import { initReveal } from './lib/reveal';
import { buzz, play, type Sound } from './lib/feel';
import { analyzeAudio, bestExcerpt, excerptToWav } from './lib/analysis/audio';
import { analyzeText, makeTitle } from './lib/analysis/text';

// отладочный доступ к анализаторам (для проверки на реальных песнях)
(window as unknown as Record<string, unknown>).__ottisk = { analyzeAudio, bestExcerpt, excerptToWav, analyzeText, makeTitle, live: () => import('./lib/live/segment'), scene: () => import('./lib/scene/context'), depth: () => import('./lib/scene/depth') };

// шрифты нужны холсту заранее
const preload = [
  'italic 500 40px "Imprint Serif"',
  '500 40px "Imprint Serif"',
  '500 40px Caveat',
  '400 16px "Imprint Text"',
  '700 16px "Imprint Text"',
  'italic 400 16px "Imprint Text"',
];
Promise.all(preload.map((f) => document.fonts.load(f, 'Аа Zz 1'))).catch(() => {});

// язык интерфейса: до первого рендера, чтобы английский режим сразу перехватывал текст и холсты
initI18n();
initReveal();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: оболочка работает офлайн и ставится на телефон как приложение
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

/* ——— отклик на каждое нажатие: звук, вибрация, оттиск краски ——— */
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
const TICK = '.tab, [role="radio"], [role="tab"], .more > button, .tabbar > a, .tabbar > button, .tab-sheet a, .more-pop a, .ce-dots button, .cc-sw, .ce-item, .ce-slide, .jr-arrow, .ask-more, .bun-x, .ss-bars i, .thumbs button, summary, input[type="checkbox"], input[type="radio"], input[type="color"], select';
function respond(t: Element, x: number, y: number, touch: boolean) {
  const el = t.closest('[data-sfx], .btn, .tab-new, ' + TICK + ', a[href]') as HTMLElement | null;
  if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return;
  const own = el.dataset.sfx;
  if (own === 'none' || el.closest('.bun-me, .bun-moods, .jr-arrow')) return; // у них свои звуки
  if (own) play(own as Sound);
  else if (el.matches('.btn, .tab-new')) {
    play('press');
    if (touch) buzz(7);
    if (!calm) {
      const cs = getComputedStyle(el);
      const c = (el.classList.contains('ghost') ? cs.getPropertyValue('--fg') : cs.getPropertyValue('--bg')).trim();
      const d = document.createElement('i');
      d.className = 'inkprint';
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      if (c) d.style.setProperty('--c', c);
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 800);
    }
  } else if (el.matches(TICK)) {
    play('tick');
    if (touch) buzz(4);
  } else if (el.matches('a[href^="#"]')) play('page');
}
// мышь отвечает сразу на нажатие; палец — на отпускание, чтобы не звенеть при прокрутке
let byPointer = 0;
addEventListener(
  'pointerdown',
  (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    byPointer = performance.now();
    respond(e.target as Element, e.clientX, e.clientY, false);
  },
  { passive: true, capture: true },
);
addEventListener(
  'click',
  (e) => {
    if (performance.now() - byPointer < 600) return;
    const r = (e.target as Element).getBoundingClientRect?.();
    const x = e.clientX || (r ? r.left + r.width / 2 : 0),
      y = e.clientY || (r ? r.top + r.height / 2 : 0);
    respond(e.target as Element, x, y, (e as PointerEvent).pointerType === 'touch');
  },
  { capture: true },
);
// карандаш: тихий шорох, пока пишешь в дневнике
addEventListener(
  'input',
  (e) => {
    const t = e.target as HTMLElement;
    if (t.tagName === 'TEXTAREA' && (e as InputEvent).inputType?.startsWith('insert')) play('pencil');
  },
  { capture: true },
);

/* ——— фото проявляются мягко, а не выскакивают ——— */
const mark = (img: HTMLImageElement) => img.classList.add('loaded');
// «load» картинок не доходит до window — слушаем на document
document.addEventListener('load', (e) => e.target instanceof HTMLImageElement && mark(e.target), true);
document.addEventListener('error', (e) => e.target instanceof HTMLImageElement && mark(e.target), true);
new MutationObserver((list) => {
  for (const m of list)
    m.addedNodes.forEach((n) => {
      if (!(n instanceof Element)) return;
      const imgs = n instanceof HTMLImageElement ? [n] : [...n.querySelectorAll('img')];
      for (const i of imgs) if (i.complete && i.naturalWidth) mark(i);
    });
}).observe(document.documentElement, { childList: true, subtree: true });
