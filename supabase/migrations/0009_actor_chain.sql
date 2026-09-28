alter table public.refresh_runs
  add column actor_id text,
  add column attempt integer not null default 1,
  add column items_received integer not null default 0,
  add column error_items integer not null default 0,
  add column since_iso timestamptz,
  add column callback_url text;

alter table public.discovery_actor_runs
  add column actor_id text,
  add column attempt integer not null default 1,
  add column mode text not null default 'initial',
  add column callback_url text;

create view public.profile_post_watermarks with (security_invoker = true) as
select profile_id, max(published_at) as newest_post_at
from public.posts
group by profile_id;
