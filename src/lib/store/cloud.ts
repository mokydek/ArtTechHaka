import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DayMedia, DayRecord } from '../types';
import type { DayFiles, DiaryStore } from './index';

// Публикуемый (publishable) ключ рассчитан на браузер: доступ ограничен RLS-политиками (см. supabase/schema.sql)
const URL_ = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://byxaagbqhpzaskteyxkh.supabase.co';
const KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? 'sb_publishable_0nX8qMQZPziAVgrlwAHRUw_YBKx6Fcj';
const BUCKET = 'diary';

const ext = (b: Blob) => (b.type.includes('png') ? 'png' : b.type.includes('wav') ? 'wav' : b.type.includes('mp4') ? 'mp4' : b.type.includes('webm') ? 'webm' : 'jpg');

/** Облачный дневник: таблица days + приватный бакет diary/{uid}/{dayId}/… (RLS по auth.uid()) */
export class CloudStore implements DiaryStore {
  kind = 'cloud' as const;
  sb: SupabaseClient;
  uid: string;
  private signed = new Map<string, { url: string; exp: number }>();

  private constructor(sb: SupabaseClient, uid: string) {
    this.sb = sb;
    this.uid = uid;
  }

  static async connect(): Promise<CloudStore | null> {
    if (!URL_ || !KEY) return null;
    const sb = createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'ottisk-auth' } });
    let { data } = await sb.auth.getSession();
    if (!data.session) {
      const r = await sb.auth.signInAnonymously();
      if (r.error) throw r.error;
      data = { session: r.data.session! };
    }
    const uid = data.session!.user.id;
    // проверяем, что схема на месте
    const probe = await sb.from('days').select('id', { head: true, count: 'exact' }).limit(1);
    if (probe.error) throw probe.error;
    return new CloudStore(sb, uid);
  }

  private path(id: string, name: string) {
    return `${this.uid}/${id}/${name}`;
  }

  async list(): Promise<DayRecord[]> {
    const { data, error } = await this.sb.from('days').select('record').order('day_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => r.record as DayRecord);
  }

  async get(id: string) {
    const { data } = await this.sb.from('days').select('record').eq('id', id).maybeSingle();
    return (data?.record as DayRecord) ?? null;
  }

  private async sign(paths: string[]): Promise<Record<string, string>> {
    const now = Date.now();
    const out: Record<string, string> = {};
    const need = paths.filter((p) => {
      const c = this.signed.get(p);
      if (c && c.exp > now + 60_000) {
        out[p] = c.url;
        return false;
      }
      return true;
    });
    if (need.length) {
      const { data } = await this.sb.storage.from(BUCKET).createSignedUrls(need, 3600);
      for (const d of data ?? []) {
        if (d.signedUrl && d.path) {
          out[d.path] = d.signedUrl;
          this.signed.set(d.path, { url: d.signedUrl, exp: now + 3600_000 });
        }
      }
    }
    return out;
  }

  private files(rec: DayRecord): Record<string, string> {
    // имена файлов с расширениями храним в record.analysis? — нет, держим простую схему
    const m: Record<string, string> = {};
    for (let i = 0; i < rec.photoCount; i++) m[`photo-${i + 1}`] = this.path(rec.id, `photo-${i + 1}.jpg`);
    m.cover = this.path(rec.id, 'cover.jpg');
    if (rec.hasExcerpt) m.excerpt = this.path(rec.id, 'excerpt.wav');
    if (rec.hasVideo) m.video = this.path(rec.id, rec.videoName ?? 'memory.webm');
    return m;
  }

  async media(rec: DayRecord): Promise<DayMedia> {
    const f = this.files(rec);
    const s = await this.sign(Object.values(f));
    const photos: string[] = [];
    for (let i = 0; i < rec.photoCount; i++) {
      const u = s[f[`photo-${i + 1}`]];
      if (u) photos.push(u);
    }
    return { photos, cover: s[f.cover], excerpt: f.excerpt ? s[f.excerpt] : undefined, video: f.video ? s[f.video] : undefined };
  }

  async covers(recs: DayRecord[]) {
    const paths = recs.map((r) => this.path(r.id, 'cover.jpg'));
    const s = await this.sign(paths);
    const out: Record<string, string> = {};
    recs.forEach((r, i) => s[paths[i]] && (out[r.id] = s[paths[i]]));
    return out;
  }

  private async upload(id: string, name: string, blob: Blob) {
    const { error } = await this.sb.storage.from(BUCKET).upload(this.path(id, name), blob, { upsert: true, contentType: blob.type || undefined });
    if (error) throw error;
    this.signed.delete(this.path(id, name));
  }

  async save(rec: DayRecord, files: DayFiles) {
    await Promise.all(files.photos.map((p, i) => this.upload(rec.id, `photo-${i + 1}.jpg`, p)));
    await this.upload(rec.id, 'cover.jpg', files.cover);
    if (files.excerpt) await this.upload(rec.id, 'excerpt.wav', files.excerpt);
    await this.update(rec);
  }

  async update(rec: DayRecord) {
    const { error } = await this.sb.from('days').upsert({ id: rec.id, user_id: this.uid, day_date: rec.date, title: rec.title, folder: rec.folder, page_no: rec.pageNo, record: rec });
    if (error) throw error;
  }

  async saveBlob(id: string, name: string, blob: Blob) {
    const fname = name === 'video' ? `memory.${ext(blob)}` : name === 'cover' ? 'cover.jpg' : `${name}.${ext(blob)}`;
    await this.upload(id, fname, blob);
  }

  async remove(id: string) {
    const { data } = await this.sb.storage.from(BUCKET).list(`${this.uid}/${id}`);
    if (data?.length) await this.sb.storage.from(BUCKET).remove(data.map((f) => `${this.uid}/${id}/${f.name}`));
    await this.sb.from('days').delete().eq('id', id);
  }
}
