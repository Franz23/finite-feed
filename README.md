# Fieldnotes

A private daily reading list for public LinkedIn posts from a small group of people.

The current build is local-first. It supports CSV list management, a responsive feed, aggregate engagement metrics, scroll-past read tracking, link-only history, and demo posts. The Apify integration is implemented but remains inactive until credentials and a public callback URL are configured.

## Run locally

Requirements: Node.js 22+ and Corepack.

```bash
corepack pnpm install
corepack pnpm run types
corepack pnpm run db:migrate
corepack pnpm run dev
```

Open `http://localhost:5173`. Choose **Preview sample posts** to exercise the feed without Apify.

## Import people

Upload a CSV under 500 KB with a `linkedin_url` column. `name` is optional.

```csv
name,linkedin_url
Example Person,https://www.linkedin.com/in/example-person
```

Each upload becomes the complete active list. Existing profiles remain linked to their history, omitted profiles stop refreshing, duplicates are collapsed, and invalid rows are reported.

## Connect Apify later

1. Copy `.dev.vars.example` to `.dev.vars` for a local integration test.
2. Add `APIFY_API_TOKEN` and a long random `APIFY_WEBHOOK_SECRET`.
3. Set `APP_BASE_URL` in `wrangler.jsonc` to an HTTPS URL Apify can reach. A localhost callback cannot receive Apify webhooks.
4. Restart the app and run a small test refresh.

The backend starts `harvestapi~linkedin-profile-posts` asynchronously with a three-day overlap, a maximum of three posts per profile, reposts enabled, and full comments/reaction identities disabled. Apify calls `/api/apify/webhook` with the secret in an authorization header. The token never enters frontend code.

## Verification

```bash
corepack pnpm run check
corepack pnpm run test
corepack pnpm run build
corepack pnpm run deploy:dry
```

## Before any public deployment

- Add an owner-only access layer. The current local prototype intentionally has no login and must not be published as-is.
- Replace `APP_BASE_URL` in `wrangler.jsonc` with the final HTTPS URL.
- Remove any local `.dev.vars` before a production build; add deployed secrets through Wrangler instead.
- Create or provision the production D1 database, then apply migrations remotely.
- Add the two secrets with interactive `wrangler secret put` commands; never put secret values in the repository or command arguments.
- Test the Actor with five profiles and inspect repost detection, returned fields, actual cost, and failure behavior.
- Review LinkedIn's terms and decide whether to accept the scraping-policy risk.
- Enable the daily Cron Trigger only after the above checks pass.

## Data behavior

- D1 is authoritative for tracked people and read state.
- Feed records are deduplicated by LinkedIn post ID.
- Scrolling a card fully above the viewport marks it read.
- The current browser session keeps the card visible; the next reload hides it.
- Marking a post read deletes its stored text and keeps only its link and identifying metadata.
- Unread posts older than 14 days are compacted to history during scheduled cleanup.
- Failed refreshes do not clear previously collected posts.
