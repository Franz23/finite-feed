create unique index if not exists discovery_runs_one_active_per_user
  on public.discovery_runs (user_id)
  where status in ('starting', 'running');
