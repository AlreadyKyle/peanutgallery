# Marketing engine: the studio's news on Bluesky, Mastodon and Discord

Status: agreed. Card: none. Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

`docs/PLAN.md` §10 decision 77 says the marketing engine starts on Bluesky, Mastodon and Discord, with no paid posting tool until one month of the studio share covers it, and X posted by hand. In this repository only the dispatcher's Discord lanes post anything (`platform/dispatcher/src/outbound.ts`, `announce.ts`). The promo engine in the private repository AlreadyKyle/mobmachine-ops stopped when that account's private Actions minutes ran out (§10 decision 78), and it reaches X and the video channels through Postiz, a paid tool. So nothing tells Bluesky or Mastodon when a card ships or opens for funding.

## Scope

In: an ops job, `marketing`, on the existing `ops-jobs.yml` workflow, every hour; three posters (Bluesky through the AT Protocol, Mastodon through its statuses API, Discord through the existing ships webhook); three kinds of post (a card shipped, a card opened for funding, the weekly report); the migration with the posts table and its three functions; the job's env keys in `platform/ops/jobs/lib.mjs`, `jobs-env.mjs`, `make-jobs-env.sh` and `.env.example`; the runbook in `platform/ops/ops-repo/README.md`.
Out: X, Threads, YouTube, TikTok, Instagram and LinkedIn; any paid posting tool; reading anything back from a channel (replies, mentions, timelines, direct messages, likes or counts); images, clips and media uploads; the dispatcher's own Discord lanes, which are unchanged; the private repository's promo engine, which this does not touch; new channel tags, since `bsky`, `mastodon` and `discord` are already on the list (`docs/specs/channel-counters.md`).

## Behaviour

**Outbound only.** The job makes POST requests that create a post, and for Bluesky the session that post needs, and nothing else. It never reads a reply, a mention, a timeline, a notification or a direct message, and it keeps nothing from an answer but the new post's id. This keeps the kernel rule that no agent with write access reads free text from the public: the job is not an agent, and it reads no public text either.

**What it posts.** Every post is built from the fields `marketing_posts_due()` returns, all written by the studio or its agents: a card's id, folder, title, amounts and supporter count, and a weekly report's counts and titles. No player's text reaches the job. The texts, with `<ch>` the channel's tag:

- A card shipped: "Shipped in Dust: <title>, funded by 3 supporters. Play: https://play.mobmachine.games/?from=<ch> Card: https://mobmachine.games/card/<id>?from=<ch>". With no supporter the funded clause is left out; with one it says "1 supporter"; a card outside `seed-1` says "Shipped at Mob Machine:" and has no Play link. The play address is `VITE_PLAY_URL` in `platform/site/netlify.toml`, as the ship notices read it.
- A card opened for funding: "New in Dust, open for funding: <title> ($1.50 of $4.00). https://mobmachine.games/card/<id>?from=<ch>", or "New at Mob Machine, open for funding:" outside `seed-1`.
- The weekly report: "The week of 12 October at Mob Machine: 2 cards shipped (<title>, <title>). 5 cards were open for funding when the report was published. Read the report: https://mobmachine.games/reports?from=<ch>", naming at most five titles and the rest as "and n more".

No post uses an em dash (`docs/COPY.md`), names a supporter or gives a figure beyond the card's own bar and the report's own counts.

**Channels.** Bluesky (`bsky`) and Mastodon (`mastodon`) carry all three kinds. Discord (`discord`) carries openings only, because the dispatcher already posts ships and the weekly report there, and a rare or legendary opening is left to the dispatcher's announcements lane; each such skip is recorded with its reason (`dispatcher_lane`, `announce_lane`). A channel whose keys are not set is skipped with a line naming the missing keys and never fails the run; with no channel set the run makes no request at all.

- Bluesky: `com.atproto.server.createSession` with the handle and an app password, once a run and only when there is something to post, then `com.atproto.repo.createRecord` of an `app.bsky.feed.post` with a link facet over each link (by UTF-8 byte) and an `app.bsky.embed.external` card for the main link. No SDK.
- Mastodon: `POST /api/v1/statuses` on the configured instance with a bearer token whose only scope is `write:statuses`, public, in English, with an `Idempotency-Key` of the kind, ref and channel.
- Discord: the existing ships webhook (`DISCORD_WEBHOOK_SHIPS`, the same address the dispatcher posts to), as the studio's username, with no mention allowed.

**Titles and length.** A title is made one line with control characters removed. On Discord its markdown and mention characters are escaped as the dispatcher escapes them; on Mastodon a zero-width space follows each `@` and `#`, so a title can name no account and start no hashtag. A post never exceeds its channel's limit: 300 graphemes on Bluesky, 500 characters on Mastodon (counted in full, though Mastodon counts a link as 23), 2000 on Discord. Only the title is cut, on a whole grapheme and with an ellipsis, so the links and figures are never cut; a weekly post drops titles into "and n more" before it cuts one.

**Content scan.** Card titles are agent-written and already passed the deny-list when they were written. The job scans every text of an item again with the gate's own scripts, `platform/gate/banned-phrases.sh` (as a commit message, so every list applies, trademarks included) and `secret-scan.sh`, as the dispatcher's `public-text.ts` does. A hit records the item skipped (`deny_list`) on every channel it was due on and tells the board; a scan that cannot run stops the run before anything is posted. The workflow checks out `platform/gate` for this.

**Once only.** `marketing_posts` holds one row per (channel, kind, ref). Before a post the job claims the row as `sending` (`marketing_post_claim`, true once only); after it the row is settled `posted` (with the post's id) or `failed` (`marketing_post_settle`, which moves only a `sending` row). A row is never posted again, whatever its state, so a rerun never double-posts and a lost answer loses that post rather than doubling it; a failure is told to the board through ntfy and not retried.

**What is due.** `marketing_posts_due(channels, since, limit)` lists, oldest first: each public live card that went live at or after `since`; each public card open for funding now (stage proposed, designing or voted, on now, not vetoed, with a target and room left on its bar) whose `opens_at`, or its creation when it has none, is at or after `since`; and the newest weekly report while its week is the last one ended in New York. Each item lists the asked channels it is already claimed on, and an item claimed on every asked channel is left out. The job asks for the last 12 hours, at most 20 items, and posts at most 3 a run on each channel; the rest wait for the next run, unclaimed. Switching a channel on therefore posts at most the last 12 hours.

**Stopped.** The due list carries the studio's stop: `kill_switch` once the kill switch has fired, `paused` while the studio is paused, read from `studio_state` as the dispatcher's lanes read it. While stopped nothing is posted, and every item due is recorded skipped with that reason, so it is never posted after the studio resumes.

**Dry run.** `node platform/ops/jobs/main.mjs marketing --dry-run` reads the due list and prints each post it would make, in full, with its channel and length; it claims, posts and alerts nothing. Its first line, like the other jobs', is `PASS:` or `FAIL:`.

**Schedule and secrets.** The job runs at minute 23 of every hour on `ops-jobs.yml`, in the main-only environment `ops`, with its own env secret `MARKETING_ENV` written by `make-jobs-env.sh marketing`; its output goes to the encrypted log, as the other jobs' does. Its keys: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `NTFY_TOPIC_URL` (required), and `MARKETING_HEALTHCHECK_URL`, `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`, `BLUESKY_PDS_URL`, `MASTODON_INSTANCE_URL`, `MASTODON_ACCESS_TOKEN` and `DISCORD_WEBHOOK_SHIPS` (optional). A value of the wrong shape is refused by the env check, naming the key only: an app password must look like one, so the account's own password is refused.

**The private promo engine.** Before this job gets Bluesky, Mastodon or Discord keys, those channels' credentials come out of the private repository's `PROMO_ENV`, so the two engines never post the same news twice.

## Acceptance criteria

- [x] The ship, opening and weekly texts read as above, with every link tagged `from=<channel>` and no em dash (`platform/ops/test/marketing.test.mjs`, the marketing messages).
- [x] Each channel's post stays within its limit, the title cut on a whole grapheme with an ellipsis and every link kept whole; Bluesky counts graphemes (marketing.test.mjs, length trimming).
- [x] The Bluesky record carries a link facet over each link by UTF-8 byte and an external card (marketing.test.mjs, the Bluesky record).
- [x] Every request to a channel is a POST to createSession, createRecord, statuses or the webhook, and nothing else; no credential reaches the output (marketing.test.mjs, a marketing run).
- [x] A rerun posts nothing again; a claim held elsewhere is not posted; a failed post is settled failed, told and not retried (marketing.test.mjs).
- [x] A channel missing its keys is skipped with a line and the run passes; with no channel set the run makes no request (marketing.test.mjs).
- [x] While paused or after the kill switch nothing is posted and each due item is recorded skipped with the reason (marketing.test.mjs).
- [x] A deny-list hit skips the item on every channel and fails the run's line; a scan that cannot run posts nothing; the gate's scans pass a clean post and refuse a deny-list term and a credential shape (marketing.test.mjs).
- [x] Discord takes openings only, and leaves a rare or legendary opening to the announcements lane (marketing.test.mjs).
- [x] At most 3 posts a run on each channel; the rest wait unclaimed (marketing.test.mjs).
- [x] `--dry-run` prints each post in full and claims, posts and alerts nothing (marketing.test.mjs).
- [x] The env check refuses a malformed handle, app password, instance or PDS address, token or webhook, naming the key only (marketing.test.mjs, the marketing env).
- [x] `marketing_posts_due` lists ships, openings and the fresh weekly report with their claims, leaves out what every asked channel claimed, and carries the stop; the claim answers true once; the settle moves only a sending row; only the service role may call the three functions; the migration runs twice (`platform/supabase/functions/_shared/marketing_posts_test.ts`, `migration_test.ts`).
- [x] `ops-jobs.yml` runs `marketing` at minute 23 of every hour and on dispatch, hands it `MARKETING_ENV` alone and checks out `platform/gate` (`platform/ops/test/ops.test.mjs`, the daily jobs on GitHub Actions).
- [ ] After merge, the migration applied in production and `MARKETING_ENV` set with at least one channel: the job's next run ends `ops-job: marketing exited 0 (PASS)`, and its encrypted log lists what it posted.

## Verification

- `node --test platform/ops/test/marketing.test.mjs`
- `pnpm test:ops`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/marketing_posts_test.ts platform/supabase/functions/_shared/migration_test.ts`
- A dry run of the message builders over production's current cards, read with the publishable key through `site_cards()` (the due function does not exist in production until the migration is applied), printing each post and its length.
- `pnpm verify`
- After merge: the migration applied in production (`supabase_migrations.schema_migrations` lists `20261020200000`), then `gh workflow run ops-jobs.yml --repo AlreadyKyle/peanutgallery -f job=marketing` with no channel keys set prints `PASS: marketing: no channel has its keys; nothing to post` in the encrypted log.

## Evidence

Quoted in the pull request.

## Decisions

- 2026-10-20: a table of its own, `marketing_posts`, keyed by channel, rather than a channel column on `outbound_posts`, so the dispatcher's Discord outbox and its primary key stay as they are.
- 2026-10-20: Discord carries openings only, because the dispatcher's ships and weekly lanes already post the other two kinds there, and the engine reuses the ships webhook rather than asking for a new one.
- 2026-10-20: the existing tags `bsky` and `mastodon` rather than a new `bluesky`, so no counter, migration or site change is needed.
- 2026-10-20: every hour rather than with the daily notices, so a ship reaches Bluesky within about an hour; at most 3 posts a channel a run and a 12-hour window keep a first run from flooding a channel.
- 2026-10-20: the ship text uses a comma where a draft had an em dash, because `docs/COPY.md` rule 8 forbids em dashes in public copy.
