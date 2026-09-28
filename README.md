# Finite Feed

A calm, private LinkedIn and X reader for the people you actually care about.

Finite Feed collects public original posts and reposts without asking for a LinkedIn or X login. It renders available media and aggregate engagement, lets readers sort by recency or engagement, and remembers posts once they have been scrolled past.

## Product behavior

- Passwordless email-link and Google authentication through Supabase Auth
- Separate LinkedIn and X (Twitter) profile fields that accept either or both and recommends people from public activity: LinkedIn comments, reactions, and reposts; X mentions, explicit reply targets, and reposts. X discovery uses the existing X actor, independently of feed refreshes, and does not use private likes.
- Explainable recommendations weighted toward comments and reposts, with manual LinkedIn or X URL entry as a fallback
- Combined activity-based suggestions in the People tab with both profiles saved and refreshed every two weeks with a one-month activity window
- Add more profiles later by pasting comma- or newline-separated URLs
- Sort by **Most recent** or **Most engaged**
- Inline images, videos, and document covers when the scraper returns them
- Scroll-past read tracking with a link-only personal history
- Background refreshes every six hours, plus on-demand checks when someone opens a stale feed, adds people, or explicitly refreshes
- Shared profile and post records so multiple users do not cause duplicate scrapes

## Stack

- React + Vite
- Vercel Functions
- Supabase Auth + Postgres with Row Level Security
- Apify using HarvestAPI's LinkedIn profile posts, comments, and reactions actors plus `nick.cheng/x-twitter-profile-tweets-scraper`

## Local setup

Requirements: Node.js 22+ and Corepack.

```bash
corepack pnpm install
cp .env.example .env.local
```

Create a Supabase project, fill in `.env.local`, and run `corepack pnpm db:migrate` to apply the SQL files in `supabase/migrations` in order. Never commit `.env.local`.

In Supabase Authentication, set the Site URL and allowed redirect URLs to your local and production origins. Email-link authentication works with the email provider. To show **Continue with Google**, enable the Google provider and set `VITE_GOOGLE_AUTH_ENABLED=true`. Configure custom SMTP with **Finite Feed** as the sender name before inviting production users because Supabase's built-in sender is intended for testing.

Run the frontend:

```bash
corepack pnpm dev
```

Run the frontend and Vercel Functions together:

```bash
corepack pnpm dev:full
```

## Deploy to Vercel

1. Import the GitHub repository into Vercel.
2. Add the Supabase integration or set the variables shown in `.env.example`.
3. Set `APP_BASE_URL` to the production URL.
4. Apply the Supabase migration.
5. Add a random `CRON_SECRET` of at least 16 characters to the Vercel project, then deploy. Four daily Vercel cron jobs refresh followed profiles at roughly six-hour intervals. Separate daily jobs keep the schedule compatible with Vercel's Hobby tier.

The Apify token, Supabase secret key, webhook secret, and cron secret are server-only. Only the Supabase URL and publishable key are exposed to the browser.

## Cost profile

The scraper is configured to skip individual comment and reaction identities. Costs are driven mainly by returned posts and profiles with no results. Exact pricing can change, so check the Actor’s current Apify pricing before operating a public service.

## Verification

```bash
corepack pnpm run check
corepack pnpm run test
corepack pnpm run build
```

## License

MIT

## Outbound post clicks

`post_clicks` records one event per post-link activation, with authenticated user, post, server timestamp, feed/history surface, and link kind. This covers Open on LinkedIn/X, linked images, history links, and media fallbacks that lead to the post. Profile links, direct document downloads, inline video playback, and scroll-past reads are excluded. Left/keyboard/modified clicks and middle clicks are tracked without delaying navigation. Right-click menu opens, copied links, and failed tracking requests cannot be counted.

Repeated clicks get separate event IDs; retrying an event ID does not double-count it. The server checks that the post belongs to the user's follows or read history. The table is service-role only and starts empty at rollout; there is no historical backfill.

Example owner query (dates in Pacific time):

```sql
select u.email, (c.clicked_at at time zone 'America/Los_Angeles')::date as day,
       count(*) as clicks, count(distinct c.post_id) as unique_posts
from public.post_clicks c
join auth.users u on u.id = c.user_id
group by u.email, day
order by day desc, u.email;
```
