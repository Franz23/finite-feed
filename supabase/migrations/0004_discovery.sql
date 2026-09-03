create table public.discovery_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_url text not null,
  status text not null check (status in ('starting', 'running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);

create table public.discovery_actor_runs (
  id uuid primary key default gen_random_uuid(),
  discovery_run_id uuid not null references public.discovery_runs(id) on delete cascade,
  actor_run_id text unique,
  kind text not null check (kind in ('posts', 'comments', 'reactions')),
  status text not null check (status in ('starting', 'running', 'succeeded', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_received integer not null default 0,
  error text
);

create table public.discovery_signals (
  discovery_run_id uuid not null references public.discovery_runs(id) on delete cascade,
  signal_type text not null check (signal_type in ('repost', 'comment', 'reaction')),
  source_id text not null,
  candidate_url text not null,
  candidate_name text,
  candidate_headline text,
  candidate_avatar_url text,
  occurred_at timestamptz,
  primary key (discovery_run_id, signal_type, source_id)
);

create index discovery_runs_user_idx on public.discovery_runs (user_id, started_at desc);
create index discovery_actor_runs_parent_idx on public.discovery_actor_runs (discovery_run_id);
create index discovery_signals_parent_idx on public.discovery_signals (discovery_run_id, candidate_url);

alter table public.discovery_runs enable row level security;
alter table public.discovery_actor_runs enable row level security;
alter table public.discovery_signals enable row level security;

revoke all on public.discovery_runs from anon, authenticated;
revoke all on public.discovery_actor_runs from anon, authenticated;
revoke all on public.discovery_signals from anon, authenticated;
