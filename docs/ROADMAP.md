# Roadmap to live

The ordered list of what stands between today and the public announcement, each item pointing at its spec. `docs/PLAN.md` is the constitution; this file is the index. It is updated in the same pull request that changes a spec's status.

Last updated 16 September 2026, main at 49d6e33.

## What "live" means

The studio is live, and the board may announce it, when all of the following hold with evidence quoted in the specs:

1. **The loop works.**
   - Three week-1 runs have shipped through the dispatcher.
   - Three board directives are live in Dust: the unlock list, save and resume, and the game shell.
   - A real contribution is credited on the meter.
2. **The dispatcher runs unattended.** It runs on a VPS on the studio's API key, restarts on its own, and alerts the board. A card funded by a supporter builds with no one at the keyboard, billed to the studio.
3. **The money is safe.** Refunds and disputes reverse cleanly, and credit above $50 a day per contributor is held for 14 days.
4. **The site is ready for strangers.**
   - Shipped work is visible, and the Terms, Privacy, Refunds and Contact pages exist.
   - Link previews render, and /board requires a second factor.
   - Nothing on the site describes a feature that does not exist.
5. **The board has pressed Go live.** The launch clip and post drafts exist.

The stream, the host, Twitch, personal decisions, display names, the name pipeline, Meet the Team and the image adapter are not part of live. They come after, through the system.

## Phases

| # | Phase | Spec | Status | Needs the board |
|---|---|---|---|---|
| 1 | Dispatcher and ledger hardening | `specs/launch-hardening.md` | built (live runs pending in 2) | none |
| 2 | Prove the loop: week-1 runs, directives D1–D3 | `specs/week1-runs.md` | built (a real contribution closes it) | stay signed in at /board during runs; a real contribution to prove `charge.updated` |
| 3 | Launch pages: Shipped, legal, previews, two-factor | `specs/launch-pages.md` | draft | review legal text; a contact address at peanutgallery.games |
| 4 | Refunds, disputes, daily hold | `specs/refunds-and-holds.md` | done | none |
| 5 | VPS, unattended, alerts | `specs/vps.md` | built (cutover pending) | Oracle Cloud Always Free instance (Toronto) and IP, healthchecks.io URL, ntfy topic, a fine-grained GitHub token for this repository, studio Console prepaid credit |
| 6 | Announcement | `specs/announcement.md` | draft | record or approve the clip, press Go live, post |

Phases 3 and 4 can run in parallel with 2. Phase 5 needs 1 and 2. Phase 6 needs every other phase.

## Done

| Spec | Status |
|---|---|
| `specs/working-method.md` | done |
| `specs/card-summary.md` | done |
| `specs/next-cards.md` | done |
| `specs/site-mark.md` | done |
| `specs/stripe-late-fee.md` | done |
| `specs/site-design.md` | done |
| `specs/site-layout.md` | done |
| `specs/unattended-mode.md` | built (live on the VPS in 5) |
| `specs/live-cut.md` | agreed (criteria 2 and 7 close with phases 2 and 5) |
| `specs/stale-tab.md` | built (live check on the next deploy) |

## After live

Through cards and votes, in PLAN.md order: Twitch and the Dev Cam, the host with its filter and TTS, the kill switch, the scheduler jobs (note triage, nightly rebalance, Monday report), personal decisions, display names through the name pipeline, Meet the Team and Board Decisions pages, the image adapter, the public seed-1 mirror, and a board rollback button.

## Standing facts for any session

- **Production.**
  - Site https://peanutgallery.games (Netlify `peanutgallerygames`); game https://peanutgallery-seed-1.netlify.app.
  - Supabase project `lyxndueoeisyqzewflpu`.
  - Stripe webhook `we_1UFd0XICmyTP81VUCeACUWhc`.
- **Money.** The pool holds customer money only. Pre-launch agent work runs attended on the founder's Max subscription, billed to the founder. There is no founding budget.
- **Production changes.** Migrations are applied through the Supabase Management API query endpoint. Functions deploy from `platform/` with `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`. Both need the board's allow in auto mode.
- **Merging.** Merges to main go through a PR with the gate green at the exact head sha; the repo has no branch protection.
