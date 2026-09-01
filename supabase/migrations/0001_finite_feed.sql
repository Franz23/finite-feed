-- Finite Feed database schema
create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  linkedin_url text not null unique,
  name text,
  headline text,
  avatar_url text,
  last_scraped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, profile_id)
);

create table public.posts (
  id text primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  linkedin_url text not null unique,
  content text,
  post_kind text not null default 'original' check (post_kind in ('original', 'repost', 'quote')),
  published_at timestamptz not null,
  likes integer not null default 0,
  comments integer not null default 0,
  reposts integer not null default 0,
  media jsonb,
  first_seen_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now()
);

create table public.post_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id text not null references public.posts(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create table public.refresh_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  actor_run_id text unique,
  status text not null check (status in ('starting', 'running', 'succeeded', 'failed')),
  target_urls jsonb not null default '[]'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  posts_received integer not null default 0,
  error text
);

create index posts_feed_idx on public.posts (published_at desc);
create index posts_profile_idx on public.posts (profile_id, published_at desc);
create index user_follows_user_idx on public.user_follows (user_id);
create index post_reads_user_idx on public.post_reads (user_id, seen_at desc);
create index refresh_runs_started_idx on public.refresh_runs (started_at desc);

alter table public.profiles enable row level security;
alter table public.user_follows enable row level security;
alter table public.posts enable row level security;
alter table public.post_reads enable row level security;
alter table public.refresh_runs enable row level security;

create policy "authenticated users can view profiles"
  on public.profiles for select to authenticated using (
    exists (
      select 1 from public.user_follows
      where user_follows.user_id = auth.uid()
        and user_follows.profile_id = profiles.id
    )
  );

create policy "users can view their own follows"
  on public.user_follows for select to authenticated using (auth.uid() = user_id);

create policy "users can remove their own follows"
  on public.user_follows for delete to authenticated using (auth.uid() = user_id);

create policy "users can view posts from followed profiles"
  on public.posts for select to authenticated using (
    exists (
      select 1 from public.user_follows
      where user_follows.user_id = auth.uid()
        and user_follows.profile_id = posts.profile_id
    )
  );

create policy "users can view their own read state"
  on public.post_reads for select to authenticated using (auth.uid() = user_id);

create policy "users can create their own read state"
  on public.post_reads for insert to authenticated with check (auth.uid() = user_id);

create policy "users can update their own read state"
  on public.post_reads for update to authenticated using (auth.uid() = user_id);

create policy "users can delete their own read state"
  on public.post_reads for delete to authenticated using (auth.uid() = user_id);

revoke all on public.refresh_runs from anon, authenticated;
