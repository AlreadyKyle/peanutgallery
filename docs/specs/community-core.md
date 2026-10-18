# Community core

Status: built. Card: none. Owner: studio.

The data layer, the suggestion pipeline, the two new roles and the board's community admin for the final state (`docs/specs/final-state.md`, series branch `final-state/community-core`). The public pages that read it are the site's own work; the endpoint shapes and RPC names are `platform/site/src/lib/community-types.ts`.

## Problem

The final state gives supporters a profile, XP, badges, suggestions, seeds, goals and a studio that grows, and the board an admin for all of it. None of that had a table, a function, a role or a panel, and players' suggestions are public free text that must never reach an agent with write access.

## Scope

In: the `community` schema and its public RPCs; the cards' suit and rarity; the feed's triggers; the content filter and rate limits in SQL; the public read and player endpoints (`/api/community/*`); the Curator and Art Director roles, the triage schema and its eval cases; the dispatcher's `curator_triage` job and `draft_card`'s cluster input; the board's Community admin.
Out: the site's pages, the studio room and the broadcast overlay (other branches of the series); Discord and Twitch posts; a card's "close" admin action (the board's existing Reject card covers it); the replay runner for the Curator's eval set.

## Behaviour

### Data model

Three migrations, each idempotent: `20261017100000_community_core.sql`, `20261017100100_community_digests.sql` (the deny-list as SHA-256 digests only), `20261017100200_community_admin.sql`.

- `community.profiles` (one per auth user: handle, display name, avatar, frame, flair, public by default, suspended, email hash), `contribution_claims` (a payment claimed by the profile whose receipt email hashes to the same value), `xp_events` (unique per user, kind and source; XP is a record, never money), `badges` (from `platform/supabase/seed/badges.json`) and `badge_awards`.
- `suggestions`, `suggestion_clusters`, `suggestion_triage` (the Curator's answer only), `suggestion_votes`; `seeds` and `seed_votes`; `goals`; `studio_eras` (Garage, Workshop, Studio, Campus); `events` (append-only, the feed); `flags`; `admin_log` (append-only).
- `cards.suit` (game, new_game, studio, platform, machine) and `cards.rarity` (common, uncommon, rare, legendary), set on insert from the card's folder and a pure function of its id: the first four bytes of SHA-256 of the id over 2^32 against the published odds, the twin of `platform/site/src/lib/rarity.ts`. XP is `floor(dollars × 10 × rarity multiplier)`, levels and tiers the twin of `xp.ts`. Both are tested on one shared vector file. The Machine is the pool shown as a card: a payment with no card names the Machine.
- Triggers: a contribution posts to the feed and is claimed at once when its email hash matches a profile; a card opening, moving, shipping or reaching live posts to the feed, moves its suggestions' state and gives each suggester the shipped XP.
- Every list pages by keyset (`id`, `votes|micros|id`, `score|id`), and each has its index.
- `20261018000000_feed_backfill.sql` posts the feed lines the triggers would have posted for the cards and payments made before the feed existed (card opened, shipped, payment), at the time each happened and under the triggers' own dedupe keys, so the pipe opens on the studio's real history and no line is doubled.

### Quarantine

`community` is granted to no API role: not anon, authenticated or service_role. Every read and write is a security-definer function. The player RPCs and public documents are not executable by the service role, so the dispatcher's key reads no player text, with one exception: `curator_take_batch` hands it a batch of received suggestions for the Curator, and `curator_record_triage` writes only `suggestion_triage` and the suggestion's state. A migration test proves no role but the backup role can select `community.suggestions`.

### The suggestion pipeline

1. `submit_suggestion` strips links, code fences and markup, runs the content filter (1- to 4-grams of the gate's normalised words against the digests) and allows 3 a day per account.
2. `curator_triage` runs every 15 minutes while the `curator_triage` flag is on and a suggestion waits. The dispatcher's guard flags any suggestion that reads as an instruction to the agents, or asks about money or secrets, before any model reads it. The rest go to one Curator session (no tools, no repository, studio overhead with the role) as quoted JSON lines inside a delimited block. The answer must be valid against `platform/agents/schemas/suggestion-triage.schema.json`; only ids in the batch are kept and the guard's flags are restored; a summary the gate's banned-phrases scan refuses is withheld.
3. An `instruction_to_agents` or `money_or_secrets` flag declines the suggestion as `instruction_to_agents` with no summary; `not_all_ages` declines it; any other flag holds it for the board; the rest join a cluster by key.
4. The board's Draft from cluster queues `draft_card` with `{cluster}`: the cluster's id, key, area, kind, fit, the Curator's summary, votes and count. `draft_card` accepts exactly those keys and shows the Game Designer those fields, never a player's words.

### Endpoints

`platform/site/netlify/functions/community.mts`: the GET documents (feed, goals, studio, seeds, suggestions, profile) read with the publishable key and are kept by the CDN for 5 to 30 seconds with stale-while-revalidate; unknown query parameters answer 400. The POST routes (magic link, refresh, and the eight player RPCs: `my_profile`, `update_profile`, `claim_contributions`, `set_contribution_public`, `submit_suggestion`, `vote_suggestion`, `save_seed`, `vote_seed`) are never cached, refuse another origin, take at most 8 KB and are limited per address.

### Roles

The Curator (`web_only`, no tools, starts when the board turns on suggestion triage) and the Art Director (`reviewer`, Read, Glob and Grep, starts at the first box-art card). Both carry the kernel line and `You have no write tools`.

### Admin

The board's panel gains a Community region under the existing second factor: Users, Suggestions, Seeds, Card faces, Goals, Studio eras, Flags and Moderation log. Nothing loads until a tab is chosen, and every change needs a reason, written to `community.admin_log`.

## Acceptance criteria

- [x] No API role can select from `community.suggestions`; only the backup role can (`community_core_test.ts`, the quarantine).
- [x] Rarity and XP in SQL equal the site's TypeScript on the shared vectors, and the odds hold over 20,000 ids (`community_core_test.ts`, `test/community-vectors.test.ts`).
- [x] The deny-list ships as digests only and matches the gate's lists (`test/community-denylist.test.ts`).
- [x] Rate limits: 3 suggestions, 30 seeds and 200 votes a day per account; XP from suggestions, features and upvotes is capped at 100 a UTC day.
- [x] Every prompt-injection and money or secrets eval case is flagged by the guard and never reaches the model or gets a summary (`platform/dispatcher/test/curator-triage.test.ts`, `platform/agents/evals/cases/curator`).
- [x] The Curator's session holds no tools and is billed as overhead; an answer outside the schema writes nothing.
- [x] `draft_card` takes a cluster's structured fields and refuses any other key.
- [x] Every migration applies twice.
- [x] The feed backfill posts each earlier card opening, ship and payment once, oldest first, skips rejected cards and never doubles a trigger's line (`feed_backfill_test.ts`).
- [x] The board's Community admin reads nothing until a tab is chosen and sends the reason with each change (Board.test.tsx, e2e).

## Verification

- `pnpm test:functions`
- `pnpm --filter @backseat/supabase test`
- `pnpm test:agents`
- `pnpm --filter @backseat/dispatcher test`
- `pnpm --filter @backseat/board test` and the board e2e
- `npx vitest run netlify` in `platform/site`
- `pnpm verify:changed`

Production, from the Mac that holds `.env` (a cloud session cannot reach production):

1. Apply the three migrations in order, after any migration already merged before them.
2. `pnpm --filter @backseat/supabase seed`, which writes the Curator and Art Director rows; then apply `20261017100200_community_admin.sql` once more so the `curator_triage` job picks up the Curator's row.
3. In Supabase Auth, allow sign-ups and add the site's `/me` to the redirect URLs. Sign-in for players is open while the `profiles_open` flag is on; turning it off returns sign-in to board accounts only.
4. Deploy the site so `/api/community/*` is served.
5. When ready, turn on `curator_triage` from the board's Flags tab.

## Evidence

Quoted in the series pull request's report.

## Decisions

- 2026-10-17: the triage role is named Curator, so no retired role name returns.
- 2026-10-17: the role rows come from the seed, not the migration, as every role's does; the job takes the Curator's row when the migration runs again after the seed.
- 2026-10-17: the dispatcher flags injections and money or secrets requests in code before the model, so those texts never reach a session; the model's flags are kept as well.
- 2026-10-17: amended by `docs/specs/board-moderation-fixes.md` (`20261017230000_board_moderation_fix.sql`): a suspended player's seeds and suggestions leave the public lists, a merged cluster resolves to the root of its merge chain, a merge refuses a cluster that was already merged, and the admin's destructive actions ask a confirm first.
