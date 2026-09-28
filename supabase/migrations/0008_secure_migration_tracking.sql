-- Migration bookkeeping must not be accessible through the client Data API.
-- The table owner / privileged migration runner retains access without policies.
alter table public.finite_feed_migrations enable row level security;
revoke all privileges on table public.finite_feed_migrations from public, anon, authenticated;
