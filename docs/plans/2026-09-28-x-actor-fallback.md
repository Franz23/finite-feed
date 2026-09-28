# Plan: X actor replacement, actor chain with fallback, own watermark

Date: 2026-09-28. Author of plan: Claude (Fable). Implementer: Sol 6.
Status: ready to implement. Decisions on the open questions are recorded at the bottom.

## Why

X posts stopped arriving. Diagnosis from production data and the Apify run logs on 2026-09-28:

1. The X actor `nick.cheng~x-twitter-profile-tweets-scraper` is dead. Every target in every run since 2026-09-25 logs
   `Self-healing failed: harvested only 0 GraphQL operations from X's frontend ... X may have changed its bundle layout.`
   The run still ends `SUCCEEDED`, the dataset contains one `{error: true, reason, target, chargedForThis}` record per target,
   and our ingest silently drops those records, so `refresh_runs` shows success with `posts_received = 0`.
2. Before that, the actor's `incremental` mode was broken by pinned tweets. Its `LAST_SEEN` watermark in the
   `finite-feed-x-v1` key-value store recorded each account's pinned tweet as "newest seen" (naval: a tweet from 2025-10-01,
   garrytan: 2025-11-13, both written 2026-09-03). Every later run stopped at the pinned tweet immediately. That is why
   7 of 11 X profiles never received a single post while the actor was still alive.
3. `finalizeActorRun` advanced `profiles.last_scraped_at` on those junk runs, so the refresh window (`refreshSince`) now
   thinks X is up to date. After the fix, a one-time backfill is needed.

Verified replacement: `apidojo~tweet-scraper` (8k users in the last 30 days, updated 2026-09-28). A test run with
`{"twitterHandles":["alexandr_wang","garrytan"],"start":"2026-09-21","maxItems":12,"sort":"Latest"}` returned 12 tweets.
Output shape (top level): `author, bookmarkCount, card, conversationId, createdAt, entities, extendedEntities, fullText, id,
isConversationControlled, isPinned, isQuote, isReply, isRetweet, lang, likeCount, media, place, quoteCount, quoteId,
replyCount, retweet, retweetCount, source, text, twitterUrl, type, url, videos, viewCount`.
`author` includes `userName, name, description, profilePicture, pinnedTweetIds, id`.
`createdAt` is Twitter's legacy format, e.g. `Mon Sep 28 20:32:39 +0000 2026`; Node's `Date.parse` handles it (verified).
Two gotchas seen in the test: `maxItems` is a global cap consumed in handle order (12 items all went to garrytan and
alexandr_wang got none), and `media` was `[]` on text tweets while `extendedEntities` and `videos` exist, so media
normalization must be verified against a fixture that contains photos and a video.

Second-choice fallback: `xquik~x-tweet-scraper` (1.5k users/30d). Input mirrors apidojo (`twitterHandles`, `since` in
`YYYY-MM-DD_HH:MM:SS_UTC`, `since_id`, `maxItems`, `maxItemsPerTarget`). Output shape not yet verified; capture a fixture.

## Goals

- X refreshes and X discovery work again, via apidojo as primary.
- An ordered actor chain per platform, configured by env, with automatic fallback when a run fails or returns nothing usable.
- The refresh watermark lives in our database, derived from posts we actually stored, never in a vendor's state store.
- A "succeeded" run that produced error records or nothing usable is recorded as failed with a reason, and is visible.

## Non-goals

- A second LinkedIn actor. The chain abstraction must support it, but no LinkedIn fallback is validated yet, so the
  LinkedIn chain stays `harvestapi~linkedin-profile-posts` alone.
- Adaptive refresh cadence per profile. Separate plan.
- Any change to the feed UI beyond the refresh status text that already exists.

## Design

### 1. Actor adapters and chains, new file `api/_lib/actors.ts`

```ts
export type ActorTarget = { url: string; handle: string; profileId: string };
export type ActorAdapter = {
  id: string;                                   // Apify actor id, e.g. "apidojo~tweet-scraper"
  platform: SocialPlatform;
  maxTargetsPerRun: number;                     // split larger batches into several runs
  buildInput(targets: ActorTarget[], sinceIso: string): Record<string, unknown>;
  isErrorItem(item: unknown): boolean;          // vendor error record, not a post
  normalize(item: unknown, profiles: Map<string, { id: string; url: string }>): ActorPost | null;
};
export function actorChain(platform: SocialPlatform): ActorAdapter[];
export function adapterById(id: string): ActorAdapter | null;
```

Adapters to implement:

- `harvestapiLinkedInPosts`: move the existing LinkedIn input builder and `normalizeActorPost` here unchanged.
  `isErrorItem`: item has `error` truthy or no post URL and no content.
- `apidojoTweets`: input `{ twitterHandles, start: YYYY-MM-DD of (since minus 24h), maxItems: targets.length * 40, sort: "Latest" }`.
  `maxTargetsPerRun: 25`. `isErrorItem`: `item.error === true` or `item.type === "error"` or no `id`.
  `normalize`: current `normalizeXPost` logic with these changes: prefer `fullText` over `text`; for retweets, if
  `retweet.fullText` exists, use it and keep the `RT @user:` prefix behaviour consistent with today's cards; read author from
  `author.userName`; media from `extendedEntities.media[]` first, then `media[]`, then `videos[]`: photos use
  `media_url_https`, videos take the highest-bitrate `video/mp4` variant from `video_info.variants` with
  `media_url_https` as thumbnail. Drop items where `isReply === true`. Keep `isPinned` items (dedup by URL makes them harmless).
- `xquikTweets`: input `{ twitterHandles, since: YYYY-MM-DD_HH:MM:SS_UTC, maxItemsPerTarget: 40, maxItems: targets.length * 40 }`.
  `normalize`: start from the apidojo normalizer; verify against a captured fixture and adjust field names.
- Keep `nickChengTweets` only if trivially cheap to keep; otherwise delete it. Default: delete.

Chain config: `APIFY_X_ACTOR_CHAIN` (default `apidojo~tweet-scraper,xquik~x-tweet-scraper`) and
`APIFY_LINKEDIN_ACTOR_CHAIN` (default `harvestapi~linkedin-profile-posts`). Comma-separated actor ids; unknown ids throw at
startup of the request that reads them. Remove `APIFY_X_ACTOR_ID`; if it is still set, treat it as a one-element chain and log a
deprecation warning, so the deploy cannot break on a stale env var.

### 2. Own watermark, `api/_lib/refresh-window.ts`

Replace `refreshSince(targets)` input with rows that include the newest stored post per profile:

```ts
type WindowTarget = { last_scraped_at: string | null; newest_post_at: string | null };
export function refreshSince(targets: WindowTarget[], now = Date.now()): string
```

Rule per target: `anchor = newest_post_at ?? last_scraped_at ?? (now - 30 days)`; `since = min(anchor over targets) - overlap`.
Set `REFRESH_OVERLAP_HOURS` to 24 by default for the first week; make it configurable so it can be reduced to 6 after
reviewing completeness and Apify spend. Do not tighten it automatically by calendar date.
Callers (`api/cron-refresh.ts`, `api/refresh.ts`) fetch `max(published_at)` per profile in one query alongside the follows.
Do not send `incremental`, `stateStoreName`, or `sinceId` to any actor. Overlap is absorbed by the existing upsert on `linkedin_url`.

### 3. Run outcome and fallback, `api/_lib/apify.ts`

`startActorRun` gains `adapter: ActorAdapter` and `attempt: number` and writes `actor_id` and `attempt` on the `refresh_runs`
row. It splits targets into chunks of `adapter.maxTargetsPerRun` and starts one Apify run per chunk under the same `batch_id`.

`ingestDataset` returns `{ rawItems, errorItems, posts }` and takes the adapter (it must not guess the platform from the item).

New pure function, unit tested:

```ts
export function decideRunOutcome(input: {
  apifyStatus: "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED";
  rawItems: number; errorItems: number; posts: number;
  targetsWithPostInLast14Days: number;
  attempt: number; chainLength: number;
}): { outcome: "succeeded" | "failed" | "fallback"; reason: string | null }
```

Rules, in order:
- Apify status not SUCCEEDED: failed, or fallback if `attempt < chainLength`.
- `errorItems > 0 && posts === 0`: "actor returned only error records": fallback if possible, else failed.
- `rawItems === 0 && targetsWithPostInLast14Days > 0`: "actor returned nothing for accounts that posted recently": fallback if
  possible, else failed.
- Otherwise succeeded, including a genuine zero for quiet accounts.

`finalizeActorRun`:
- computes the decision, stores `items_received`, `error_items`, `posts_received`, `status`, `error` on the run row.
- on `fallback`: marks this run `failed` with `error = "fallback: <reason>"`, then starts a new run with the next adapter in
  the chain, same `target_urls`, same `batch_id`, `attempt + 1`.
- updates `profiles.last_scraped_at` only on `succeeded`. Never on failed or fallback.

`reconcileActorRun` (used by `api/feed.ts` when a webhook was missed) goes through the same `finalizeActorRun` path so both
entry points share the decision logic.

### 4. Discovery, `api/_lib/discovery.ts`

`actorId()` and `actorInput()` for X currently target the dead actor. Change them to use `actorChain("x")[0]` with a discovery
input variant: apidojo `{ twitterHandles: [handle], maxItems: 80, start: <30 or 365 days ago>, sort: "Latest" }`. Replies are
included by default in apidojo output, which discovery wants. Verify `xSignalsFromItem` against the apidojo fixture: it needs
the author handle, reply target handle, quoted author handle, retweeted author handle, and mentions. Expected sources in apidojo
items: `author.userName`, `inReplyToUsername` (verify name), `quote.author.userName`, `retweet.author.userName`,
`entities.user_mentions[].screen_name`. On discovery actor failure, fall back through the same chain using the existing
`failDiscoveryActor` path; cap at chain length.

### 5. Schema, `supabase/migrations/0009_actor_chain.sql`

```sql
alter table public.refresh_runs
  add column actor_id text,
  add column attempt integer not null default 1,
  add column items_received integer not null default 0,
  add column error_items integer not null default 0;
alter table public.discovery_actors add column actor_id text;   -- verify table name in 0004_discovery.sql
```

Extend the `status` check constraint if a new value is needed; the plan above reuses `failed` with a `fallback:` error prefix
so no new status value is required.

### 6. One-time backfill (run after deploy, by Franz, in the Supabase SQL editor)

```sql
update public.profiles set last_scraped_at = now() - interval '30 days' where platform = 'x';
```

Then trigger `/api/cron-refresh` once with the cron secret. Expect a burst of X posts for the ten followed accounts.
The Apify key-value store `finite-feed-x-v1` is now unused and can be deleted in the Apify console.

### 7. Visibility

- `api/feed.ts` already surfaces the latest failed run's error text; make sure a `fallback:` error is shown as a warning, not a
  failure, when a later attempt in the same batch is running or succeeded.
- Log one structured line per outcome decision (`platform, actor_id, attempt, outcome, reason, rawItems, errorItems, posts`).
- Optional, only if cheap: in `cron-refresh`, if the last 4 succeeded runs for a platform all have `posts_received = 0` and
  there are targets with posts in the last 14 days, log an error line. No alerting infra exists; the log line is enough for now.

## Fixtures and tests (vitest, existing setup in `vitest.config.ts`)

Fixtures live in `api/_lib/__fixtures__/`. Capture them with `scripts/apify-sample.mjs` (added with this plan). Franz runs it
outside the sandbox with the Apify token in `APIFY_TOKEN`:

```bash
APIFY=$(security find-generic-password -s "claude-apify-api-key" -a "franzschrepf" -w) && APIFY_TOKEN="$APIFY" node scripts/apify-sample.mjs apidojo~tweet-scraper garrytan,levelsio 2026-09-21 30 > api/_lib/__fixtures__/apidojo-tweets.json
APIFY=$(security find-generic-password -s "claude-apify-api-key" -a "franzschrepf" -w) && APIFY_TOKEN="$APIFY" node scripts/apify-sample.mjs xquik~x-tweet-scraper garrytan,levelsio 2026-09-21 30 > api/_lib/__fixtures__/xquik-tweets.json
```

levelsio posts photos and videos, so those fixtures should exercise media. Also add a hand-written
`nickcheng-error-items.json` with two `{error: true, reason, target, chargedForThis}` records for the error-detection test.

Tests to add:
- `actors.test.ts`: each adapter normalizes its fixture into `ActorPost`s with correct kind, counts, media, and profile match;
  error records are detected; `actorChain` parses env, rejects unknown ids, honours the deprecated single-id var.
- `apify.test.ts`: `decideRunOutcome` table test covering every rule above, including "genuine zero for quiet accounts succeeds".
- `refresh-window.test.ts`: extend for `newest_post_at` precedence and the 24h overlap.
- `discovery.test.ts`: `xSignalsFromItem` on the apidojo fixture yields the expected signal kinds.

## Verification

```bash
corepack pnpm run check && corepack pnpm run test && corepack pnpm run build
```

Then on the deployed app: set `APIFY_X_ACTOR_CHAIN` in Vercel, apply migration 0009, run the backfill SQL, hit
`/api/cron-refresh` with the cron secret, and confirm in `refresh_runs` that the X rows show `actor_id = apidojo~tweet-scraper`,
`attempt = 1`, `posts_received > 0`, and that the feed shows posts from alexandr_wang and garrytan dated this week.
To exercise fallback for real, temporarily set the chain to `nick.cheng~x-twitter-profile-tweets-scraper,apidojo~tweet-scraper`
and confirm a `failed` row with `error` starting `fallback:` followed by a succeeded `attempt = 2` row in the same batch.

## Cost note

apidojo charges per returned tweet; the price is not exposed on the public API, check the actor page in the Apify console before
deploy. `maxItems = targets * 40` bounds spend per run. With ten X profiles refreshed four times a day and a 24h overlap window,
expect on the order of tens to a few hundred tweets per day, mostly duplicates that the upsert discards but that are still charged.
If the invoice looks high, reduce the overlap from 24h to 6h; the 24h default is chosen for safety during the first week.

## Implementation decisions

1. Delete the dead `nick.cheng` adapter. Keep the deprecated `APIFY_X_ACTOR_ID` compatibility behavior for a stale
   deployment setting, but do not include that actor in the default chain.
2. Start with a 24-hour overlap. After one week, review feed completeness and Apify spend, then set
   `REFRESH_OVERLAP_HOURS=6` if the results support it. This is an operational change, not an automatic timer.
3. Keep the current quote-tweet presentation: show the followed author's own text. Inline quoted text is a separate
   feed feature and is outside this actor recovery change.
