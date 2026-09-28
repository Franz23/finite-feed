-- One row per outbound post-link activation, separate from scroll-past reads.
create table public.post_clicks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  post_id text not null references public.posts(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  surface text not null check (surface in ('feed', 'history')),
  link_kind text not null check (link_kind in ('post', 'image', 'document', 'video'))
);

create index post_clicks_user_time_idx on public.post_clicks (user_id, clicked_at desc);
alter table public.post_clicks enable row level security;
revoke all on public.post_clicks from anon, authenticated;
