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
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/800.css';
import '@fontsource/pt-mono/400.css';
import './styles.css';
import App from './App';
import { analyzeAudio, bestExcerpt, excerptToWav } from './lib/analysis/audio';
import { analyzeText, makeTitle } from './lib/analysis/text';

// отладочный доступ к анализаторам (для проверки на реальных песнях)
(window as unknown as Record<string, unknown>).__ottisk = { analyzeAudio, bestExcerpt, excerptToWav, analyzeText, makeTitle };

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
