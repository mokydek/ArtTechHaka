import type { Capsule, DayMedia, DayRecord, Notebook } from '../types';
import { LocalStore } from './local';
import { CloudStore } from './cloud';

export interface DayFiles {
  photos: Blob[];
  cover: Blob;
  excerpt?: Blob;
}

export interface DiaryStore {
  kind: 'cloud' | 'local';
  list(): Promise<DayRecord[]>;
  get(id: string): Promise<DayRecord | null>;
  media(rec: DayRecord): Promise<DayMedia>;
  covers(recs: DayRecord[]): Promise<Record<string, string>>;
  photos(recs: DayRecord[]): Promise<Record<string, string[]>>;
  save(rec: DayRecord, files: DayFiles): Promise<void>;
  update(rec: DayRecord): Promise<void>;
  saveBlob(id: string, name: string, blob: Blob): Promise<void>;
  remove(id: string): Promise<void>;
  listNotebooks(): Promise<Notebook[]>;
  saveNotebook(nb: Notebook): Promise<void>;
  removeNotebook(id: string): Promise<void>;
  listCapsules(): Promise<Capsule[]>;
  saveCapsule(c: Capsule): Promise<void>;
  removeCapsule(id: string): Promise<void>;
}

let storePromise: Promise<DiaryStore> | null = null;

/** Облако (Supabase) с анонимным входом; если недоступно — локальный дневник в IndexedDB */
export function getStore(): Promise<DiaryStore> {
  if (!storePromise) {
    storePromise = (async () => {
      try {
        const c = await CloudStore.connect();
        if (c) return c;
      } catch (e) {
        console.warn('[Echo] облако недоступно, работаем локально', e);
      }
      return new LocalStore();
    })();
  }
  return storePromise;
}

export function newId(): string {
  return crypto.randomUUID();
}
