# Roadmap to live

The ordered list of what stands between today and the public announcement, each item pointing at its spec. `docs/PLAN.md` is the constitution; this file is the index. It is updated in the same pull request that changes a spec's status.

Last updated 16 September 2026.

## What "live" means

The studio is live, and the board may announce it, when all of the following hold with evidence quoted in the specs:

1. **The loop works.**
   - Three week-1 runs have shipped through the dispatcher.
   - Three board directives are live in Dust: the unlock list, save and resume, and the game shell.
   - A real contribution is credited on the meter.
2. **The dispatcher runs unattended.** It runs on a VPS on the studio's API key, restarts on its own, and alerts the board. Before any unattended card runs, agent sessions are contained and a proxy keeps the studio key out of them (PLAN.md §10 default 20). A card funded by a supporter builds with no one at the keyboard, billed to the studio.
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
| 1 | Dispatcher and ledger hardening | `specs/launch-hardening.md` | built (the week-1 runs and D1–D3 are done: 65 founder-billed ledger rows, pool unchanged) | none |
| 2 | Prove the loop: week-1 runs, directives D1–D3 | `specs/week1-runs.md` | built (a real contribution closes it) | stay signed in at /board during runs; a real contribution to prove `charge.updated` |
| 3 | Launch pages: Shipped, legal, previews, two-factor | `specs/launch-pages.md` | built (merged 3a08226; live steps pending: apply the two-factor migration, enrol TOTP and file a test note, run the live check and the `og:image` check against production) | review the legal text; create hello@peanutgallery.games; enrol TOTP on /board |
| 4 | Refunds, disputes, daily hold | `specs/refunds-and-holds.md` | done | none |
| 5 | VPS, unattended, alerts | `specs/vps.md` | built (merged 49d6e33; cutover pending, and session containment with the API-key proxy lands first) | Oracle Cloud Always Free instance (Toronto) and IP, healthchecks.io URL, ntfy topic, a fine-grained GitHub token for this repository, studio Console prepaid credit |
| 6 | Announcement | `specs/announcement.md` | draft | record or approve the clip, press Go live, post |

Phases 3 and 4 can run in parallel with 2. Phase 5 needs 1 and 2, and session containment (in review below). Phase 6 needs every other phase.

## Done

Every Verification line has been run and its output quoted.

| Spec | Status |
|---|---|
| `specs/working-method.md` | done |
| `specs/card-summary.md` | done |
| `specs/site-mark.md` | done |
| `specs/site-design.md` | done |
| `specs/site-layout.md` | done |
| `specs/panel-gap.md` | done |

## Built, live check pending

Merged, with every criterion a test can prove ticked.

| Spec | Status |
|---|---|
| `specs/live-cut.md` | built (criterion 7, an unattended build, closes with phase 5) |
| `specs/unattended-mode.md` | built (the unattended probe and a funded card with no board session, on the VPS in phase 5) |
| `specs/stripe-late-fee.md` | built (`charge.updated` crediting a fresh payment, on the next real contribution) |
| `specs/next-cards.md` | built (two Verification lines without quoted output: the guarded select and delete of the four retired cards, and a real contribution moving a card's bar) |
| `specs/stale-tab.md` | built (the live check: a tab held open across a site deploy reloads into the new build) |

## Agreed, in review

This pass's specs. A spec that is not on `main` yet is linked by its pull request; its file arrives when the pull request merges.

| Spec | Status |
|---|---|
| `specs/docs-truth.md` | agreed |
| [webhook-hardening](https://github.com/AlreadyKyle/peanutgallery/pull/31) | agreed (PR #31) |
| [card-columns-and-open-funding](https://github.com/AlreadyKyle/peanutgallery/pull/32) | agreed (PR #32) |
| [gate-hardening](https://github.com/AlreadyKyle/peanutgallery/pull/33) | agreed (PR #33) |
| [site-truth-pass](https://github.com/AlreadyKyle/peanutgallery/pull/34) | agreed (PR #34) |
| metering-reconciliation | agreed (PR link to come) |
| merge-safety | agreed (PR link to come) |
| session-containment | agreed (PR link to come) |
| ops-separation | agreed (PR link to come) |

## After live

Through cards and votes, in PLAN.md order: Twitch and the Dev Cam, the host with its filter and TTS, the kill switch, the scheduler jobs (note triage, nightly rebalance, Monday report), personal decisions, display names through the name pipeline, Meet the Team and Board Decisions pages, the image adapter, the public seed-1 mirror, and a board rollback button.

## Standing facts for any session

- **Production.**
  - Site https://peanutgallery.games (Netlify `peanutgallerygames`, base `platform/site`); game https://peanutgallery-seed-1.netlify.app (Netlify `peanutgallery-seed-1`, base `seed-1`).
  - Supabase project `lyxndueoeisyqzewflpu`.
  - Stripe webhook `we_1UFd0XICmyTP81VUCeACUWhc`.
  - The dispatcher runs attended on the founder's Mac until the VPS cutover in phase 5.
- **Money.** The pool holds customer money only. Pre-launch agent work runs attended on the founder's Max subscription, billed to the founder. There is no founding budget.
- **Production changes.** Migrations are applied through the Supabase Management API query endpoint. Functions deploy from `platform/` with `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`. Both need the board's allow in auto mode. A spec that needs production steps lists them under "Production steps (need the board's allow)".
- **Merging.** `main` has no branch protection; the repository is private on a plan without it. Every change reaches `main` through a pull request, except the revert commit the dispatcher writes after a merged card fails its deploy or smoke. The dispatcher merges a card only after the `gate` check has succeeded on the pull request's exact head sha, and its squash merge passes that sha, so a head that moved is refused. Board changes merge the same way, with the gate green at the head sha.
