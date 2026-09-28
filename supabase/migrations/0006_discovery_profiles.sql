alter table public.discovery_runs add column profile_urls text[] not null default '{}';
update public.discovery_runs set profile_urls = array[profile_url] where cardinality(profile_urls) = 0;
alter table public.discovery_actor_runs add column profile_url text;
update public.discovery_actor_runs actor set profile_url = run.profile_url
from public.discovery_runs run where run.id = actor.discovery_run_id;
