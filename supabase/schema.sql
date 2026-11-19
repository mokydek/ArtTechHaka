-- Оттиск: схема Supabase. Каждый пользователь (в т.ч. анонимный) видит только свои дни.

create table if not exists public.days (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  day_date date not null,
  title text not null,
  folder text not null,
  page_no int,
  record jsonb not null
);

create index if not exists days_user_date on public.days (user_id, day_date desc);

alter table public.days enable row level security;

drop policy if exists "days: read own" on public.days;
drop policy if exists "days: insert own" on public.days;
drop policy if exists "days: update own" on public.days;
drop policy if exists "days: delete own" on public.days;
create policy "days: read own" on public.days for select to authenticated using (auth.uid() = user_id);
create policy "days: insert own" on public.days for insert to authenticated with check (auth.uid() = user_id);
create policy "days: update own" on public.days for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "days: delete own" on public.days for delete to authenticated using (auth.uid() = user_id);

grant select, insert, update, delete on public.days to authenticated;

-- Приватный бакет: diary/{uid}/{dayId}/photo-1.jpg, cover.jpg, excerpt.wav, memory.webm
insert into storage.buckets (id, name, public, file_size_limit)
values ('diary', 'diary', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "diary: read own" on storage.objects;
drop policy if exists "diary: insert own" on storage.objects;
drop policy if exists "diary: update own" on storage.objects;
drop policy if exists "diary: delete own" on storage.objects;
create policy "diary: read own" on storage.objects for select to authenticated using (bucket_id = 'diary' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "diary: insert own" on storage.objects for insert to authenticated with check (bucket_id = 'diary' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "diary: update own" on storage.objects for update to authenticated using (bucket_id = 'diary' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "diary: delete own" on storage.objects for delete to authenticated using (bucket_id = 'diary' and (storage.foldername(name))[1] = auth.uid()::text);
