# Finite Feed

A calm, private LinkedIn reader for the people you actually care about.

Finite Feed collects public original posts and reposts without asking for a LinkedIn login. It renders images, videos, documents, and aggregate engagement; lets readers sort by recency or engagement; and remembers posts once they have been scrolled past.

## Product behavior

- Passwordless email-link and Google authentication through Supabase Auth
- At least three LinkedIn profile URLs during onboarding
- Add more profiles later by pasting comma- or newline-separated URLs
- Sort by **Most recent** or **Most engaged**
- Inline images, videos, and document covers when the scraper returns them
- Scroll-past read tracking with a link-only personal history
- Daily refreshes through Vercel Cron
- Shared profile and post records so multiple users do not cause duplicate scrapes

## Stack

- React + Vite
- Vercel Functions and Cron Jobs
- Supabase Auth + Postgres with Row Level Security
- Apify using `harvestapi/linkedin-profile-posts`

## Local setup

Requirements: Node.js 22+ and Corepack.

```bash
corepack pnpm install
cp .env.example .env.local
```

Create a Supabase project, apply [`supabase/migrations/0001_finite_feed.sql`](supabase/migrations/0001_finite_feed.sql), and fill in `.env.local`. Never commit that file.

In Supabase Authentication, set the Site URL and allowed redirect URLs to your local and production origins. Email-link authentication works with the email provider. To show **Continue with Google**, enable the Google provider and set `VITE_GOOGLE_AUTH_ENABLED=true`. Configure custom SMTP before inviting production users because Supabase's built-in sender is intended for testing.

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
5. Deploy. The daily cron is declared in `vercel.json`.

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
