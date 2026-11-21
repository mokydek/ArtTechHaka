// Ссылки на выбранные записи (как веб-ссылки в Journey).
// Набор дней кладётся в облако одним JSON; если задан код доступа, JSON шифруется в браузере
// (PBKDF2 → AES-GCM), и даже подписанные ссылки на фото видны только тому, кто знает код.
import type { DayRecord } from './types';

export interface SharedDay {
  rec: DayRecord;
  photos: string[];
  cover?: string;
  excerpt?: string;
  voice?: string;
}
export interface SharedAlbum {
  v: 2;
  kind: 'album';
  title: string;
  days: SharedDay[];
  sentAt: string;
}
export interface Sealed {
  v: 2;
  kind: 'album';
  enc: { salt: string; iv: string; data: string };
}

const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Код доступа: 6 знаков без похожих букв и цифр (нет O/0, I/1, L) */
export function newCode(n = 6) {
  const r = crypto.getRandomValues(new Uint8Array(n));
  return [...r].map((x) => ABC[x % ABC.length]).join('');
}
export const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(code: string, salt: Uint8Array) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(normCode(code)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 200_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function seal(album: SharedAlbum, code: string): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(code, salt);
  // большие JSON кодируем по кускам, чтобы не упереться в лимит аргументов
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(album))));
  let data = '';
  for (let i = 0; i < ct.length; i += 0x8000) data += String.fromCharCode(...ct.subarray(i, i + 0x8000));
  return { v: 2, kind: 'album', enc: { salt: b64(salt), iv: b64(iv), data: btoa(data) } };
}

/** Расшифровать; неверный код — исключение */
export async function unseal(s: Sealed, code: string): Promise<SharedAlbum> {
  const key = await keyFrom(code, unb64(s.enc.salt));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(s.enc.iv) }, key, unb64(s.enc.data));
  return JSON.parse(new TextDecoder().decode(pt)) as SharedAlbum;
}

export const isSealed = (x: unknown): x is Sealed => !!x && typeof x === 'object' && 'enc' in (x as object);
