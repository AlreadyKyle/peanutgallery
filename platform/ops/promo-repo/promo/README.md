# Promo engine

Mob Machine's automated promotion. It turns what happens in the studio into posts, sends them, measures how each one did, and shifts toward what works. The plan behind it, and the routine that runs it, are in the project's `marketing-machine/PLAN.md`.

## How it runs

| Step | Where | What it does |
|---|---|---|
| Harvest | `promo.yml`, daily | Reads the studio's public documents (the same RPCs the site serves, publishable key only), finds moments (a ship, a rare card, a milestone, an era, a weekly report, one open card, one evergreen post) and drafts one post per moment per channel into `outbox/`. |
| Scan | `promo.yml`, before each send | Runs the studio's deny-list scan (`platform/gate/banned-phrases.sh`) on every draft. `lint.mjs` has already checked the copy rules of `docs/COPY.md`. A failing draft becomes `needs_edit`. |
| Review | The marketer routine, in the project thread | Shows the pending drafts to the board, rewrites weak ones, adds clips and launch posts (`cli.mjs add`), and approves what the board approves (`cli.mjs approve`). |
| Clips | `promo.yml`, before sending | A ship or an open card also becomes a 15-second vertical clip for YouTube Shorts and TikTok (`clips/`, `src/clips.mjs`). The draft carries the clip's props; it is rendered just before it is sent, once per card. |
| Publish | `promo.yml`, every 3 hours and on every push to `outbox/` | Sends approved drafts, highest priority first, at most `maxPerDay` per channel and `minGapMinutes` apart. A draft is marked `sending` on disk before the request, so a crash loses a post and never doubles one. Receipts go to `sent/`. |
| Metrics | `promo.yml`, daily | Reads each post's likes, reposts, replies and views back from its channel, into `metrics/`. |
| Learn | `promo.yml`, daily | Once a post is two days old, scores it against its channel's normal and updates `playbook.json`: which framing (variant) works for which kind of moment on which channel, and which hours work. Composing picks variants by UCB1, so new framings get tried and losing ones fade. |

## Modes

`config.json` → `mode`:

- `review` (the default): nothing goes out until it is approved.
- `auto`: a draft that passes every check is approved as it is drafted.

**To switch to fully automatic:** set `"mode": "auto"` in `config.json` and push. Set it back to `review` the same way.

Reddit and Hacker News are never automated (their rules forbid it, and HN asks for no generated text). The routine drafts notes for those into the project folder for a person to post.

## Channels

| Channel | Through | Credentials in `PROMO_ENV` |
|---|---|---|
| X, Threads, YouTube Shorts, TikTok, Instagram, LinkedIn | Postiz Cloud, whose apps have already passed the platforms' audits | `PROMO_POSTIZ_API_KEY` (Postiz, Settings, Public API); connect each account once in the Postiz UI |
| itch.io (Dust's page) | `itch.yml`, daily: builds Dust from the studio's main branch and pushes it with butler when it changed | `PROMO_ITCH_API_KEY` (itch.io, Settings, API keys), `PROMO_ITCH_GAME` (`user/game`, the page made once by hand) |
| Bluesky | Its own API, free | `PROMO_BLUESKY_HANDLE`, `PROMO_BLUESKY_APP_PASSWORD` |
| Mastodon | Its own API, free | `PROMO_MASTODON_URL`, `PROMO_MASTODON_TOKEN` |
| Discord | A channel webhook, free | `PROMO_DISCORD_WEBHOOK_URL` |

`PROMO_ENV` is one repository secret holding `KEY=value` lines, the same shape as the jobs' env secrets. A channel with no credentials is skipped, never failed. YouTube and TikTok only take drafts that carry a video or a clip.

## Commands

```sh
node promo/src/cli.mjs harvest [--dry-run] [--docs file.json]
node promo/src/cli.mjs publish [--dry-run]
node promo/src/cli.mjs metrics
node promo/src/cli.mjs status
node promo/src/cli.mjs add promo/batches/launch.json
node promo/src/cli.mjs approve <draft id>... | all
node promo/src/cli.mjs reject <draft id>...
node --test promo/test/*.test.mjs
```

## Rules it keeps

From the studio's brand book and copy rules: plain sentences, no exclamation marks, no em dashes, no hashtags or emoji, no inflated words, no chance words near money, no urgency or countdowns, "contributions" and never "donations", and nothing that describes a feature that does not exist. Every link carries `from=<channel>` so the site's own counters can tell which channel brought a visit; no third-party tracker or link shortener is used. Posts never name a supporter, only public facts.
