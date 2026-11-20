import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Capsule, DayMedia, DayRecord, Notebook } from '../types';
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

  private path(id: string, name: string, owner?: string) {
    return `${owner ?? this.uid}/${id}/${name}`;
  }

  async list(): Promise<DayRecord[]> {
    const { data, error } = await this.sb.from('days').select('record, is_demo, user_id').order('day_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? [])
      .filter((r) => (r.record as { kind?: string }).kind !== 'capsule')
      .map((r) => ({ ...(r.record as DayRecord), demo: !!r.is_demo || !!(r.record as DayRecord).demo, ownerId: r.user_id as string }));
  }

  // капсулы времени живут в той же таблице (record.kind = 'capsule') — RLS уже защищает их
  async listCapsules(): Promise<Capsule[]> {
    const { data, error } = await this.sb.from('days').select('record').eq('user_id', this.uid).eq('record->>kind', 'capsule').order('day_date');
    if (error) throw error;
    return (data ?? []).map((r) => r.record as Capsule);
  }

  async saveCapsule(c: Capsule) {
    const { error } = await this.sb.from('days').upsert({ id: c.id, user_id: this.uid, day_date: c.openAt.slice(0, 10), title: 'капсула времени', folder: 'капсула', page_no: 0, record: c });
    if (error) throw error;
  }

  /** Открытка: снимок дня в JSON + ссылки на файлы, подписанные на год. Получателю не нужен вход */
  async sharePostcard(rec: DayRecord, note: string): Promise<string> {
    const YEAR = 60 * 60 * 24 * 365;
    const f = this.files(rec);
    const paths = Object.entries(f).filter(([k]) => k !== 'video');
    const { data } = await this.sb.storage.from(BUCKET).createSignedUrls(
      paths.map(([, p]) => p),
      YEAR,
    );
    const url: Record<string, string> = {};
    paths.forEach(([k], i) => data?.[i]?.signedUrl && (url[k] = data[i].signedUrl));
    const photos = rec.photoUrls?.length ? rec.photoUrls : Array.from({ length: rec.photoCount }, (_, i) => url[`photo-${i + 1}`]).filter(Boolean);
    const { ownerId: _o, ...clean } = rec;
    void _o;
    const card = { v: 1, rec: clean, note, photos, cover: url.cover, excerpt: url.excerpt, voice: url.voice, sentAt: new Date().toISOString() };
    const name = `postcards/${crypto.randomUUID()}.json`;
    const full = `${this.uid}/${name}`;
    const { error } = await this.sb.storage.from(BUCKET).upload(full, new Blob([JSON.stringify(card)], { type: 'application/json' }), { upsert: true, contentType: 'application/json' });
    if (error) throw error;
    const s = await this.sb.storage.from(BUCKET).createSignedUrl(full, YEAR);
    if (s.error || !s.data) throw s.error ?? new Error('sign');
    // в ссылке — только путь и подпись, хост известен
    const u = new URL(s.data.signedUrl);
    return btoa(JSON.stringify({ p: full, t: u.searchParams.get('token') })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  async removeCapsule(id: string) {
    await this.remove(id);
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
    const o = rec.ownerId;
    if (!rec.photoUrls?.length) for (let i = 0; i < rec.photoCount; i++) m[`photo-${i + 1}`] = this.path(rec.id, `photo-${i + 1}.jpg`, o);
    m.cover = this.path(rec.id, 'cover.jpg', o);
    if (rec.hasExcerpt) m.excerpt = this.path(rec.id, 'excerpt.wav', o);
    if (rec.hasVideo) m.video = this.path(rec.id, rec.videoName ?? 'memory.webm', o);
    if (rec.hasVoice) m.voice = this.path(rec.id, rec.voiceName ?? 'voice.webm', o);
    for (const c of rec.cutouts ?? []) m[`cutout-${c.id}`] = this.path(rec.id, `cutout-${c.id}.png`, o);
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
    return { photos, cover: s[f.cover], excerpt: f.excerpt ? s[f.excerpt] : undefined, video: f.video ? s[f.video] : undefined, voice: f.voice ? s[f.voice] : undefined, cutouts: Object.fromEntries((rec.cutouts ?? []).map((c) => [c.id, s[f[`cutout-${c.id}`]]]).filter(([, u]) => !!u)) };
  }

  async covers(recs: DayRecord[]) {
    const paths = recs.map((r) => this.path(r.id, 'cover.jpg', r.ownerId));
    const s = await this.sign(paths);
    const out: Record<string, string> = {};
    recs.forEach((r, i) => s[paths[i]] && (out[r.id] = s[paths[i]]));
    return out;
  }

  async photos(recs: DayRecord[]) {
    const out: Record<string, string[]> = {};
    const need: { id: string; paths: string[] }[] = [];
    for (const r of recs) {
      if (r.photoUrls?.length) out[r.id] = r.photoUrls;
      else need.push({ id: r.id, paths: Array.from({ length: r.photoCount }, (_, i) => this.path(r.id, `photo-${i + 1}.jpg`, r.ownerId)) });
    }
    if (need.length) {
      const s = await this.sign(need.flatMap((n) => n.paths));
      for (const n of need) out[n.id] = n.paths.map((p) => s[p]).filter(Boolean);
    }
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
    const { ownerId: _o, ...clean } = rec;
    void _o;
    const { error } = await this.sb.from('days').upsert({ id: rec.id, user_id: this.uid, day_date: rec.date, title: rec.title, folder: rec.folder, page_no: rec.pageNo, record: clean });
    if (error) throw error;
  }

  async saveBlob(id: string, name: string, blob: Blob) {
    const fname = name === 'video' ? `memory.${ext(blob)}` : name === 'cover' ? 'cover.jpg' : `${name}.${ext(blob)}`;
    await this.upload(id, fname, blob);
  }

  async listNotebooks(): Promise<Notebook[]> {
    const { data, error } = await this.sb.from('notebooks').select('id, title, cover, created_at').eq('user_id', this.uid).order('created_at');
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, title: r.title, cover: r.cover, createdAt: r.created_at }));
  }

  async saveNotebook(nb: Notebook) {
    const { error } = await this.sb.from('notebooks').upsert({ id: nb.id, user_id: this.uid, title: nb.title, cover: nb.cover, created_at: nb.createdAt });
    if (error) throw error;
  }

  async removeNotebook(id: string) {
    await this.sb.from('notebooks').delete().eq('id', id);
  }

  async remove(id: string) {
    const { data } = await this.sb.storage.from(BUCKET).list(`${this.uid}/${id}`);
    if (data?.length) await this.sb.storage.from(BUCKET).remove(data.map((f) => `${this.uid}/${id}/${f.name}`));
    await this.sb.from('days').delete().eq('id', id);
  }
}

/** Открыть открытку по токену из ссылки (без входа) */
export async function fetchPostcard(token: string) {
  const j = JSON.parse(atob(token.replace(/-/g, '+').replace(/_/g, '/')));
  const r = await fetch(`${URL_}/storage/v1/object/sign/${BUCKET}/${j.p}?token=${j.t}`);
  if (!r.ok) throw new Error('postcard ' + r.status);
  return (await r.json()) as { v: number; rec: DayRecord; note: string; photos: string[]; cover?: string; excerpt?: string; voice?: string; sentAt: string };
}
