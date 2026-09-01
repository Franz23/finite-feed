alter table public.refresh_runs
add column if not exists target_urls jsonb not null default '[]'::jsonb;
