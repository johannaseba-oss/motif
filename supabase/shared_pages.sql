-- Gemeinsame Seiten: Nur Marken auf diesen Seiten liegen auf dem Server.
-- Zugriff haben ausschließlich Mitglieder der jeweiligen Seite.

create table public.shared_pages (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  title text not null default '' check (char_length(title) <= 40),
  invite_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

create table public.shared_members (
  page_id uuid not null references public.shared_pages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 30),
  primary key (page_id, user_id)
);

create table public.shared_stamps (
  id uuid primary key,
  page_id uuid not null references public.shared_pages(id) on delete cascade,
  owner uuid not null references auth.users(id) on delete cascade,
  cell int not null check (cell between 0 and 15),
  name text not null default '' check (char_length(name) <= 60),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now(),
  unique (page_id, cell)
);

alter table public.shared_pages enable row level security;
alter table public.shared_members enable row level security;
alter table public.shared_stamps enable row level security;

create function public.is_shared_member(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shared_members m where m.page_id = p and m.user_id = auth.uid());
$$;

create function public.is_shared_owner(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.shared_pages s where s.id = p and s.owner = auth.uid());
$$;

create policy "Mitglieder sehen die Seite" on public.shared_pages for select to authenticated using (public.is_shared_member(id));
create policy "Besitzer ändert die Seite" on public.shared_pages for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy "Besitzer löscht die Seite" on public.shared_pages for delete to authenticated using (owner = auth.uid());

create policy "Mitglieder sehen Mitglieder" on public.shared_members for select to authenticated using (public.is_shared_member(page_id));
create policy "Eigenen Namen ändern" on public.shared_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Verlassen oder entfernen" on public.shared_members for delete to authenticated using (user_id = auth.uid() or public.is_shared_owner(page_id));

create policy "Mitglieder sehen Marken" on public.shared_stamps for select to authenticated using (public.is_shared_member(page_id));
create policy "Mitglieder kleben Marken ein" on public.shared_stamps for insert to authenticated with check (owner = auth.uid() and public.is_shared_member(page_id));
create policy "Eigene Marken ändern" on public.shared_stamps for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid() and public.is_shared_member(page_id));
create policy "Eigene Marken löschen, Besitzer alle" on public.shared_stamps for delete to authenticated using (owner = auth.uid() or public.is_shared_owner(page_id));

create function public.create_shared_page(page_title text, member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into public.shared_pages (owner, title) values (auth.uid(), coalesce(page_title, '')) returning id into new_id;
  insert into public.shared_members (page_id, user_id, display_name) values (new_id, auth.uid(), coalesce(member_name, ''));
  return new_id;
end $$;

create function public.join_shared_page(token text, member_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select id into target from public.shared_pages where invite_token = token;
  if target is null then raise exception 'invalid invite'; end if;
  insert into public.shared_members (page_id, user_id, display_name)
    values (target, auth.uid(), coalesce(member_name, ''))
    on conflict (page_id, user_id) do nothing;
  return target;
end $$;

revoke all on function public.create_shared_page(text, text) from public, anon;
revoke all on function public.join_shared_page(text, text) from public, anon;
revoke all on function public.is_shared_member(uuid) from public, anon;
revoke all on function public.is_shared_owner(uuid) from public, anon;
grant execute on function public.create_shared_page(text, text) to authenticated;
grant execute on function public.join_shared_page(text, text) to authenticated;
grant execute on function public.is_shared_member(uuid) to authenticated;
grant execute on function public.is_shared_owner(uuid) to authenticated;

-- Bilder: privat, Ordnername = Seiten-ID
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shared', 'shared', false, 8000000, array['image/png']);

create policy "Mitglieder sehen Bilder" on storage.objects for select to authenticated
  using (bucket_id = 'shared' and public.is_shared_member(((storage.foldername(name))[1])::uuid));
create policy "Mitglieder laden Bilder hoch" on storage.objects for insert to authenticated
  with check (bucket_id = 'shared' and public.is_shared_member(((storage.foldername(name))[1])::uuid));
create policy "Eigene Bilder löschen, Besitzer alle" on storage.objects for delete to authenticated
  using (bucket_id = 'shared' and (owner_id = auth.uid()::text or public.is_shared_owner(((storage.foldername(name))[1])::uuid)));
