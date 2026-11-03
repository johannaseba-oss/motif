-- Community-Challenges: Gruppen aus 3 bis 6 Personen spielen die Challenges der Reihe nach.
-- Eine Challenge wird frei, wenn alle Mitglieder die vorige eingereicht haben.
-- Jede Person ist höchstens in einer Gruppe.

create table public.challenge_groups (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.challenge_members (
  group_id uuid not null references public.challenge_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'invited' check (status in ('invited', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index challenge_members_user on public.challenge_members (user_id);

create table public.challenge_entries (
  group_id uuid not null references public.challenge_groups(id) on delete cascade,
  challenge int not null check (challenge between 1 and 5),
  user_id uuid not null references auth.users(id) on delete cascade,
  stamp_id uuid not null references public.album_stamps(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, challenge, user_id)
);

alter table public.challenge_groups enable row level security;
alter table public.challenge_members enable row level security;
alter table public.challenge_entries enable row level security;

create function public.in_challenge_group(g uuid, accepted_only boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.challenge_members m
    where m.group_id = g and m.user_id = auth.uid() and (not accepted_only or m.status = 'accepted'));
$$;

-- Freigeschaltet: Gruppe hat mindestens 3 angenommene Einladungen und alle haben die vorige Challenge eingereicht
create function public.challenge_unlocked(g uuid, n int) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.challenge_members m
            where m.group_id = g and m.status = 'accepted' and m.user_id <> (select owner from public.challenge_groups where id = g)) >= 3
    and (n = 1 or not exists (
      select 1 from public.challenge_members m
      where m.group_id = g and m.status = 'accepted'
        and not exists (select 1 from public.challenge_entries e where e.group_id = g and e.challenge = n - 1 and e.user_id = m.user_id)));
$$;

create policy "Gruppe sehen" on public.challenge_groups for select to authenticated using (public.in_challenge_group(id, false));
create policy "Mitglieder sehen" on public.challenge_members for select to authenticated using (public.in_challenge_group(group_id, false));
create policy "Ablehnen oder verlassen" on public.challenge_members for delete to authenticated using (user_id = auth.uid());
create policy "Einreichungen sehen" on public.challenge_entries for select to authenticated using (public.in_challenge_group(group_id, true));
create policy "Eigene Einreichung zurückziehen" on public.challenge_entries for delete to authenticated using (user_id = auth.uid());

-- Eingereichte Marken dürfen die anderen Gruppenmitglieder samt Bild sehen
create policy "Challenge-Marken lesen" on public.album_stamps for select to authenticated using (
  exists (select 1 from public.challenge_entries e where e.stamp_id = id and public.in_challenge_group(e.group_id, true)));

create or replace function public.can_view_album_file(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    split_part(path, '/', 2) = 'avatar.png'
    or exists (
      select 1 from public.featured f
      where f.user_id::text = split_part(path, '/', 1)
        and split_part(path, '/', 2) in (f.stamp_id || '_thumb.png', f.stamp_id || '_full.png')
        and public.can_view_profile(f.user_id))
    or exists (
      select 1 from public.challenge_entries e
      where e.user_id::text = split_part(path, '/', 1)
        and split_part(path, '/', 2) in (e.stamp_id || '_thumb.png', e.stamp_id || '_full.png')
        and public.in_challenge_group(e.group_id, true))
  );
$$;

create function public.my_challenge_group() returns uuid
language sql stable security definer set search_path = '' as $$
  select group_id from public.challenge_members where user_id = auth.uid() and status = 'accepted' limit 1;
$$;

-- Neue Gruppe mit eingeladenen Personen (3 bis 5, dazu man selbst)
create function public.create_challenge_group(invitees uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g uuid; n int := coalesce(array_length(invitees, 1), 0);
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if public.my_challenge_group() is not null then raise exception 'already in group'; end if;
  if n < 3 or n > 5 or auth.uid() = any(invitees) then raise exception 'invalid invitees'; end if;
  if (select count(*) from public.profiles where user_id = any(invitees)) <> n then raise exception 'unknown user'; end if;
  insert into public.challenge_groups (owner) values (auth.uid()) returning id into g;
  insert into public.challenge_members (group_id, user_id, status) values (g, auth.uid(), 'accepted');
  insert into public.challenge_members (group_id, user_id) select g, unnest(invitees);
  return g;
end $$;

-- Weitere Person einladen, solange die Gruppe unter 6 bleibt
create function public.invite_to_challenge(g uuid, invitee uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.in_challenge_group(g, true) then raise exception 'not a member'; end if;
  if (select count(*) from public.challenge_members where group_id = g) >= 6 then raise exception 'group full'; end if;
  if not exists (select 1 from public.profiles where user_id = invitee) then raise exception 'unknown user'; end if;
  insert into public.challenge_members (group_id, user_id) values (g, invitee) on conflict do nothing;
end $$;

create function public.accept_challenge(g uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if public.my_challenge_group() is not null then raise exception 'already in group'; end if;
  update public.challenge_members set status = 'accepted' where group_id = g and user_id = auth.uid();
  if not found then raise exception 'no invitation'; end if;
end $$;

create function public.submit_challenge(g uuid, n int, stamp uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.in_challenge_group(g, true) then raise exception 'not a member'; end if;
  if not public.challenge_unlocked(g, n) then raise exception 'locked'; end if;
  if not exists (select 1 from public.album_stamps where id = stamp and user_id = auth.uid()) then raise exception 'not your stamp'; end if;
  insert into public.challenge_entries (group_id, challenge, user_id, stamp_id) values (g, n, auth.uid(), stamp)
    on conflict (group_id, challenge, user_id) do update set stamp_id = excluded.stamp_id, created_at = now();
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'in_challenge_group(uuid, boolean)', 'challenge_unlocked(uuid, int)', 'my_challenge_group()',
    'create_challenge_group(uuid[])', 'invite_to_challenge(uuid, uuid)', 'accept_challenge(uuid)', 'submit_challenge(uuid, int, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
