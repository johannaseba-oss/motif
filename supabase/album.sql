-- Das private Album im Konto. Jede Person kommt nur an die eigenen Daten.

create table public.album_meta (
  user_id uuid primary key references auth.users(id) on delete cascade,
  page_titles jsonb not null default '{}',
  shared_map jsonb not null default '{}',
  avatar_version int not null default 0,
  updated_at timestamptz not null default now()
);

create table public.album_stamps (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  slot int not null check (slot >= 0),
  name text not null default '' check (char_length(name) <= 60),
  description text not null default '' check (char_length(description) <= 500),
  created_at timestamptz not null default now()
);
create index album_stamps_user on public.album_stamps (user_id);

alter table public.album_meta enable row level security;
alter table public.album_stamps enable row level security;

create policy "Nur eigene Albumdaten" on public.album_meta for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Nur eigene Marken" on public.album_stamps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Bilder: privat, Ordnername = Konto-ID
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('albums', 'albums', false, 8000000, array['image/png']);

create policy "Eigene Albumbilder sehen" on storage.objects for select to authenticated
  using (bucket_id = 'albums' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Eigene Albumbilder hochladen" on storage.objects for insert to authenticated
  with check (bucket_id = 'albums' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Eigene Albumbilder ersetzen" on storage.objects for update to authenticated
  using (bucket_id = 'albums' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'albums' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Eigene Albumbilder löschen" on storage.objects for delete to authenticated
  using (bucket_id = 'albums' and (storage.foldername(name))[1] = auth.uid()::text);
