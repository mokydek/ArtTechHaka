import type { VoiceProfile } from './types';

// Озвучка синтезированным голосом браузера. Голос, темп, высота и паузы — по правилам системы.
const FEMALE = /irina|svetlana|dariya|daria|milena|ekaterina|alena|anna|elena|google русский|tatyana|katya|female|женск/i;
const MALE = /pavel|dmitry|dmitri|yuri|maxim|nikita|aleksandr|male|мужск/i;

export function russianVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('ru'));
}

export function pickVoice(p: VoiceProfile): SpeechSynthesisVoice | null {
  const list = russianVoices();
  if (!list.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
    let s = 0;
    if (/natural|online|neural/i.test(v.name)) s += 3; // живые нейроголоса Edge/Windows
    if (p.gender === 'female' && FEMALE.test(v.name)) s += 2;
    if (p.gender === 'male' && MALE.test(v.name)) s += 2;
    if (p.gender === 'female' && MALE.test(v.name)) s -= 2;
    if (p.gender === 'male' && FEMALE.test(v.name)) s -= 1;
    return s;
  };
  return [...list].sort((a, b) => score(b) - score(a))[0];
}

let cancelled = false;
let timer: number | undefined;

export function stopSpeaking() {
  cancelled = true;
  clearTimeout(timer);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Читает текст по фразам с паузами («воздух» между предложениями зависит от энергии дня) */
export function speak(text: string, p: VoiceProfile, onEnd?: () => void, onStart?: () => void): boolean {
  if (!('speechSynthesis' in window)) return false;
  stopSpeaking();
  cancelled = false;
  const voice = pickVoice(p);
  const parts = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let i = 0;
  const next = () => {
    if (cancelled) return;
    if (i >= parts.length) {
      onEnd?.();
      return;
    }
    const u = new SpeechSynthesisUtterance(parts[i++]);
    u.lang = 'ru-RU';
    if (voice) u.voice = voice;
    u.rate = p.rate;
    u.pitch = p.pitch;
    u.volume = 1;
    u.onend = () => {
      timer = window.setTimeout(next, p.pauseMs);
    };
    u.onerror = () => {
      timer = window.setTimeout(next, 50);
    };
    speechSynthesis.speak(u);
  };
  onStart?.();
  next();
  return true;
}

export function voiceLabel(p: VoiceProfile): string {
  const v = pickVoice(p);
  return `${p.character}; ${p.gender === 'female' ? 'женский' : 'мужской'} голос${v ? ` (${v.name.replace(/Microsoft |Google /, '').replace(/ - .*/, '')})` : ''}, темп ×${p.rate.toFixed(2)}, паузы ${(p.pauseMs / 1000).toFixed(1)} с`;
}
