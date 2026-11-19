import type { DayMedia, DayRecord, Notebook } from '../types';
import type { DayFiles, DiaryStore } from './index';

const DB = 'ottisk';
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('days')) db.createObjectStore('days', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((res, rej) => {
        const t = db.transaction(store, mode);
        const s = t.objectStore(store);
        const req = fn(s);
        t.oncomplete = () => res(req ? (req.result as T) : (undefined as T));
        t.onerror = () => rej(t.error);
      }),
  );
}

const urlCache = new Map<string, string>();
async function blobUrl(key: string): Promise<string | undefined> {
  if (urlCache.has(key)) return urlCache.get(key);
  const b = await tx<Blob | undefined>('blobs', 'readonly', (s) => s.get(key));
  if (!b) return undefined;
  const u = URL.createObjectURL(b);
  urlCache.set(key, u);
  return u;
}

export class LocalStore implements DiaryStore {
  kind = 'local' as const;

  async list(): Promise<DayRecord[]> {
    const all = await tx<DayRecord[]>('days', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string) {
    return tx<DayRecord | null>('days', 'readonly', (s) => s.get(id)).then((r) => r ?? null);
  }

  async media(rec: DayRecord): Promise<DayMedia> {
    const photos: string[] = [];
    for (let i = 0; i < rec.photoCount; i++) {
      const u = await blobUrl(`${rec.id}/photo-${i + 1}`);
      if (u) photos.push(u);
    }
    return {
      photos,
      cover: await blobUrl(`${rec.id}/cover`),
      excerpt: rec.hasExcerpt ? await blobUrl(`${rec.id}/excerpt`) : undefined,
      video: rec.hasVideo ? await blobUrl(`${rec.id}/video`) : undefined,
    };
  }

  async covers(recs: DayRecord[]) {
    const out: Record<string, string> = {};
    for (const r of recs) {
      const u = await blobUrl(`${r.id}/cover`);
      if (u) out[r.id] = u;
    }
    return out;
  }

  async photos(recs: DayRecord[]) {
    const out: Record<string, string[]> = {};
    for (const r of recs) {
      if (r.photoUrls?.length) {
        out[r.id] = r.photoUrls;
        continue;
      }
      const list: string[] = [];
      for (let i = 0; i < r.photoCount; i++) {
        const u = await blobUrl(`${r.id}/photo-${i + 1}`);
        if (u) list.push(u);
      }
      out[r.id] = list;
    }
    return out;
  }

  async save(rec: DayRecord, files: DayFiles) {
    await tx('days', 'readwrite', (s) => s.put(rec));
    for (let i = 0; i < files.photos.length; i++) await this.saveBlob(rec.id, `photo-${i + 1}`, files.photos[i]);
    await this.saveBlob(rec.id, 'cover', files.cover);
    if (files.excerpt) await this.saveBlob(rec.id, 'excerpt', files.excerpt);
  }

  async update(rec: DayRecord) {
    await tx('days', 'readwrite', (s) => s.put(rec));
  }

  async saveBlob(id: string, name: string, blob: Blob) {
    urlCache.delete(`${id}/${name}`);
    await tx('blobs', 'readwrite', (s) => s.put(blob, `${id}/${name}`));
  }

  async listNotebooks(): Promise<Notebook[]> {
    const all = await tx<Notebook[]>('notebooks', 'readonly', (s) => s.getAll());
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async saveNotebook(nb: Notebook) {
    await tx('notebooks', 'readwrite', (s) => s.put(nb));
  }

  async removeNotebook(id: string) {
    await tx('notebooks', 'readwrite', (s) => s.delete(id));
  }

  async remove(id: string) {
    await tx('days', 'readwrite', (s) => s.delete(id));
    const keys = await tx<IDBValidKey[]>('blobs', 'readonly', (s) => s.getAllKeys());
    for (const k of keys) if (String(k).startsWith(id + '/')) await tx('blobs', 'readwrite', (s) => s.delete(k));
  }
}
