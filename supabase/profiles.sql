-- Öffentliche Profile ("About me"): @Name, Bio, Sichtbarkeit, Folgen und gezeigte Marken.
-- Sichtbarkeit: public = alle angemeldeten Nutzer, followers = bestätigte Follower, private = nur man selbst.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 30),
  bio text not null default '' check (char_length(bio) <= 160),
  visibility text not null default 'private' check (visibility in ('public', 'followers', 'private')),
  created_at timestamptz not null default now()
);

create table public.follows (
  follower uuid not null references auth.users(id) on delete cascade,
  followee uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (follower, followee),
  check (follower <> followee)
);
create index follows_followee on public.follows (followee);

create table public.featured (
  stamp_id uuid primary key references public.album_stamps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index featured_user on public.featured (user_id);

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.featured enable row level security;

create function public.can_view_profile(owner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    owner = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.user_id = owner and (
        p.visibility = 'public'
        or (p.visibility = 'followers' and exists (
          select 1 from public.follows f
          where f.follower = auth.uid() and f.followee = owner and f.status = 'accepted'))
      )
    )
  );
$$;

-- Profilkopf (Name, @Name, Bio) sehen alle Angemeldeten, wie bei Instagram
create policy "Profile sehen" on public.profiles for select to authenticated using (true);
create policy "Eigenes Profil anlegen" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "Eigenes Profil ändern" on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Eigenes Profil löschen" on public.profiles for delete to authenticated using (user_id = auth.uid());

create policy "Eigene Folgen sehen" on public.follows for select to authenticated using (follower = auth.uid() or followee = auth.uid());
create policy "Entfolgen oder entfernen" on public.follows for delete to authenticated using (follower = auth.uid() or followee = auth.uid());
create policy "Anfrage annehmen" on public.follows for update to authenticated
  using (followee = auth.uid()) with check (followee = auth.uid() and status = 'accepted');

create policy "Gezeigte Marken sehen" on public.featured for select to authenticated using (public.can_view_profile(user_id));
create policy "Eigene Marke zeigen" on public.featured for insert to authenticated with check (
  user_id = auth.uid() and exists (select 1 from public.album_stamps s where s.id = stamp_id and s.user_id = auth.uid()));
create policy "Eigene Marke nicht mehr zeigen" on public.featured for delete to authenticated using (user_id = auth.uid());

-- Gezeigte Marken dürfen Berechtigte samt Name und Beschreibung lesen
create policy "Gezeigte Marken lesen" on public.album_stamps for select to authenticated using (
  exists (select 1 from public.featured f where f.stamp_id = id) and public.can_view_profile(user_id));

create function public.follow_user(target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare vis text; st text;
begin
  if auth.uid() is null or target = auth.uid() then raise exception 'invalid'; end if;
  select visibility into vis from public.profiles where user_id = target;
  if vis is null then raise exception 'no profile'; end if;
  insert into public.follows (follower, followee, status)
    values (auth.uid(), target, case when vis = 'public' then 'accepted' else 'pending' end)
    on conflict (follower, followee) do nothing;
  select status into st from public.follows where follower = auth.uid() and followee = target;
  return st;
end $$;

create function public.profile_stats(target uuid) returns table (posts int, followers int, following int)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::int from public.featured where user_id = target),
    (select count(*)::int from public.follows where followee = target and status = 'accepted'),
    (select count(*)::int from public.follows where follower = target and status = 'accepted')
  where auth.uid() is not null;
$$;

-- Bilder gezeigter Marken und Profilbilder für Berechtigte
create function public.can_view_album_file(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    split_part(path, '/', 2) = 'avatar.png'
    or exists (
      select 1 from public.featured f
      where f.user_id::text = split_part(path, '/', 1)
        and split_part(path, '/', 2) in (f.stamp_id || '_thumb.png', f.stamp_id || '_full.png')
        and public.can_view_profile(f.user_id))
  );
$$;
create policy "Gezeigte Bilder und Profilbilder" on storage.objects for select to authenticated
  using (bucket_id = 'albums' and public.can_view_album_file(name));

revoke all on function public.can_view_profile(uuid) from public, anon;
revoke all on function public.follow_user(uuid) from public, anon;
revoke all on function public.profile_stats(uuid) from public, anon;
revoke all on function public.can_view_album_file(text) from public, anon;
grant execute on function public.can_view_profile(uuid) to authenticated;
grant execute on function public.follow_user(uuid) to authenticated;
grant execute on function public.profile_stats(uuid) to authenticated;
grant execute on function public.can_view_album_file(text) to authenticated;
