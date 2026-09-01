alter table public.profiles
  add column if not exists platform text not null default 'linkedin'
  check (platform in ('linkedin', 'x'));

alter table public.posts
  add column if not exists platform text not null default 'linkedin'
  check (platform in ('linkedin', 'x'));

alter table public.refresh_runs
  add column if not exists platform text not null default 'linkedin'
  check (platform in ('linkedin', 'x')),
  add column if not exists batch_id uuid;

update public.refresh_runs set batch_id = id where batch_id is null;

create index if not exists refresh_runs_batch_idx on public.refresh_runs (batch_id, started_at desc);
