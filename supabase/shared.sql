-- Общие тетради (как Shared Journal в Journey): участники, код приглашения, общий доступ к дням и файлам.
-- Повторный запуск безопасен.

alter table public.notebooks add column if not exists invite_code text unique;
alter table public.notebooks add column if not exists owner_name text not null default '';

create table if not exists public.notebook_members (
  notebook_id uuid not null references public.notebooks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default '',
  joined_at timestamptz not null default now(),
  primary key (notebook_id, user_id)
);
alter table public.notebook_members enable row level security;
grant select, update, delete on public.notebook_members to authenticated;

-- доступ к тетради: владелец или участник (security definer — чтобы политики не ссылались друг на друга по кругу)
create or replace function public.nb_access(nb uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select nb is not null and (
    exists (select 1 from notebooks n where n.id = nb and n.user_id = auth.uid())
    or exists (select 1 from notebook_members m where m.notebook_id = nb and m.user_id = auth.uid()));
$$;
create or replace function public.nb_owner(nb uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from notebooks n where n.id = nb and n.user_id = auth.uid());
$$;
-- id тетради из записи дня (если это не uuid — null)
create or replace function public.day_nb(rec jsonb) returns uuid
language sql immutable as $$
  select case when (rec->>'notebookId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (rec->>'notebookId')::uuid end;
$$;
grant execute on function public.nb_access(uuid) to authenticated;
grant execute on function public.nb_owner(uuid) to authenticated;
grant execute on function public.day_nb(jsonb) to authenticated;

-- тетради: читать свои и общие; создавать, менять и удалять — только владелец
drop policy if exists "notebooks: own" on public.notebooks;
drop policy if exists "notebooks: read" on public.notebooks;
drop policy if exists "notebooks: insert own" on public.notebooks;
drop policy if exists "notebooks: update own" on public.notebooks;
drop policy if exists "notebooks: delete own" on public.notebooks;
create policy "notebooks: read" on public.notebooks for select to authenticated using (auth.uid() = user_id or public.nb_access(id));
create policy "notebooks: insert own" on public.notebooks for insert to authenticated with check (auth.uid() = user_id);
create policy "notebooks: update own" on public.notebooks for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notebooks: delete own" on public.notebooks for delete to authenticated using (auth.uid() = user_id);

-- участники видят друг друга; владелец убирает любого, участник — себя; имя меняет только сам
drop policy if exists "members: read" on public.notebook_members;
drop policy if exists "members: delete" on public.notebook_members;
drop policy if exists "members: update self" on public.notebook_members;
create policy "members: read" on public.notebook_members for select to authenticated using (public.nb_access(notebook_id));
create policy "members: delete" on public.notebook_members for delete to authenticated using (user_id = auth.uid() or public.nb_owner(notebook_id));
create policy "members: update self" on public.notebook_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- вступить можно только по коду, через эту функцию
create or replace function public.join_notebook(code text, member_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nb uuid;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  select id into nb from notebooks where invite_code = upper(trim(code));
  if nb is null then raise exception 'invite code not found'; end if;
  if exists (select 1 from notebooks where id = nb and user_id = auth.uid()) then return nb; end if;
  insert into notebook_members (notebook_id, user_id, name) values (nb, auth.uid(), left(coalesce(member_name, ''), 40))
  on conflict (notebook_id, user_id) do update set name = excluded.name;
  return nb;
end $$;
revoke all on function public.join_notebook(text, text) from public;
grant execute on function public.join_notebook(text, text) to authenticated;

-- дни общих тетрадей видны всем участникам (менять по-прежнему может только автор)
drop policy if exists "days: read shared" on public.days;
create policy "days: read shared" on public.days for select to authenticated using (public.nb_access(public.day_nb(record)));

-- файлы этих дней (фото, обложка, отрывок песни, голос)
drop policy if exists "diary: read shared" on storage.objects;
create policy "diary: read shared" on storage.objects for select to authenticated
  using (bucket_id = 'diary' and exists (
    select 1 from public.days d
    where d.id::text = (storage.foldername(name))[2] and public.nb_access(public.day_nb(d.record))));
