# Replays: a shipped card's before and after clip

Status: agreed. Card: none. Owner: studio. QUEUE: Q-051 (Kyle's row).

A spec is for a new feature or a change to the kernel, money, migrations or the gate; a bug fix, a small tooling change or a copy fix needs none, and its pull request description carries the Verification section instead (CLAUDE.md, Spec-driven development).

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

No stranger has yet seen the pitch happen: a card funded, built and shipped (`docs/build/NOW.md`). A shipped card's page shows its milestones as an animated card (`platform/site/src/components/Replay.tsx`), but nothing shows what changed in the game, and nothing gives the marketing engine or the weekly video a picture of a ship. The capture tool (`seed-1/scripts/capture.ts`) already draws Dust before and after from the same seed, states and camera; nothing turns that into a clip.

## Scope

In, in steps, each a green pull request into `next`:

1. **The composer** (`platform/explainer/scripts/replay.mjs`, plan in `platform/explainer/src/replay/plan.ts`): two capture folders and the card's public document in, a 24 second mp4, a poster and a manifest out.
2. **Unattended**: a workflow on a push to `main` whose commit carries a `Card-Id:` trailer (the dispatcher's commit, `platform/dispatcher/src/worktree.ts`) and changes something Dust draws (`seed-1/config/`, `seed-1/content/`, `seed-1/render/`, `seed-1/sim/`). It captures the commit and its parent, reads the card's document once the card is live, runs the composer and stores the files. No hand step.
3. **Stored and served**: the files go to a public storage bucket the studio already pays nothing extra for, named in this spec's Decisions when chosen; the card's document names the clip when one exists (a kernel change, `docs/specs/supporter-pages.md`, with an add-only migration if it needs one).
4. **On the card page**: a shipped card with a clip shows it under the card, muted, with controls and its poster, never autoplaying under reduced motion. The animated replay stays.
5. **Handed on**: the marketing engine's ship post links the clip (`docs/specs/marketing-engine.md`), and the weekly video's props can name it.

Out: site cards (only Dust is captured for now), sound, a vertical cut (the capture tool draws 390 px pages; a 9:16 cut is a later step), and any money figure the card's document does not carry.

## Behaviour

- **True facts only.** The clip states only what the card's public document records: its title; Funded, only when players put money on it ("$0.78 from 3 players"); Built, from the agent starting to the checks ("by an AI agent in 2 hours 5 minutes"); Checked, when its checks passed; Live, the day; Cost, the agent work the ledger shows. A step the document does not record has no row. A card that is not live has no replay.
- **A real change.** The composer shows at most two states whose page pictures differ byte for byte between the two captures (the capture tool's drawing is deterministic). When nothing differs it refuses, since a before and after that look the same says nothing.
- **The clip.** 1280 by 720 at 30 fps, H.264 with no sound, about 0.5 MB: the title (3 s), Before and After twice (3 s each, labelled in a pill; one changed state is shown twice so the change flips in and out), the timeline (6 s), and "Fund the card you want built next." with the address (3 s). 24 seconds; the plan holds it to 20 to 30.
- **The studio's look.** The site's font and tokens (ink, paper, muted, Live green, the Dust suit magenta), plain words with no dashes or exclamation marks, as the weekly video's rules (`docs/specs/weekly-video.md`).
- **Files.** `replay-<card id's first 8>.mp4`, the timeline slide as `replay-<id8>.png` for the poster, and `replay-<id8>.json` with the card id, both commits, the width, the states and the length.

## Acceptance criteria

- [x] Step 1: `factsFrom` reads a live card's document and refuses a card that is not live (`replay.test.ts`).
- [x] Step 1: the timeline leaves out what the document does not record, and never says Funded without players.
- [x] Step 1: the composer refuses captures with no differing picture, no shared state or a missing width.
- [x] Step 1: the clip runs 20 to 30 seconds whether one state changed or two.
- [x] Step 1: the clip uses the site's tokens (`replay.test.ts` holds them equal to `theme.ts`).
- [x] Step 2: a dispatcher ship of a Dust card makes its clip with no hand step (`.github/workflows/replay.yml`; `ship.test.ts`: only a squash commit with a Card-Id trailer that changes what Dust draws goes on, never a revert; the job waits for the card to be live and stops quietly on a card taken back out).
- [x] Step 2: the replay job holds no credential, since it builds and draws card code (`platform/ops/test/ops.test.mjs`, as the gate).
- [ ] Step 3: the card's document names the clip, and a card without one is unchanged.
- [ ] Step 4: a replay plays on a shipped card's page on a deploy preview (Q-051's done line).
- [ ] Step 5: the ship post links the clip.

## Verification

- `pnpm --filter @backseat/explainer typecheck` and `pnpm --filter @backseat/explainer test`
- Two captures, one with a change, then `node scripts/replay.mjs --before <dir> --after <dir> --card <card.json> --out <dir>` in `platform/explainer`, and `ffprobe` on the clip: 1280 by 720, 30 fps, h264, about 24 s. Every slide looked at.
- The same run with two captures of one commit: refused with "nothing to show before and after".
- Step 2: `node scripts/replay-ship.mjs check --sha <commit>` on a card commit and on a plain one; `card` against a document that goes live, one taken back out and an address that answers nothing; the workflow's draw and compose steps run by hand on a card commit.
- `pnpm verify:changed`

## Evidence

Step 1 (the composer), in a cloud session on `origin/next` at 7aa4923:

- `vitest run src/replay`: `Tests 13 passed (13)`; `tsc -p tsconfig.json --noEmit` clean.
- Captures at 600 s and 3,600 s, 1280 px: `next` as before, and the same checkout with the Gatherer's rate raised from 0.25 to 0.4 (a stand-in for a config card) as after. The composer printed `replay: .../replay-00000000.mp4, 24 s, states 600, 3600`, and `ffprobe` read `codec_name=h264|width=1280|height=720|pix_fmt=yuv420p|r_frame_rate=30/1` and `duration=24.033333`; the file is 427 KB. The card document was a sample with the public document's shape, since the session cannot reach the site.
- Captures of 86a43da and 44f2698 (a Dust change that draws no differently at those states): refused with `no picture differs between the captures: nothing to show before and after`.

Step 2 (unattended), in a cloud session on `origin/next` at bf36ebc:

- `vitest run src/replay`: `Tests 20 passed (20)`; `tsc -p tsconfig.json --noEmit` clean; `node --test test/ops.test.mjs` in `platform/ops`: `ok 3 - replay.yml reads contents only, persists no checkout credential and uses no secret`, `# pass 239`, `# fail 0`.
- A local test commit with the dispatcher's message shape and the Gatherer's rate raised from 0.25 to 0.4: `check` printed `card=e1ee4792-abc0-4dc3-95fa-159b82ac38db`; its parent printed `skip: no Card-Id trailer, so not a card` and wrote `card=` (empty).
- `card` against a local server that answered 503, then gated, then live: `card e1ee4792-... is live` and `live=true`; one that went rejected: `skip: card e1ee4792-... was taken back out, so this commit did not ship it` and `live=false`, exit 0; an address that answers nothing, 2 tries: `the card was not live after 2 tries: fetch failed`, exit 1.
- The workflow's draw step run by hand (two worktrees, each with its own install, drawn by this checkout's capture tool): `capture: 6 pictures of 3 states at 1280x720` for each side. Its compose step: `replay: .../replay-e1ee4792.mp4, 24 s, states 600, 3600, 43ab598 to da25ac6` and `name=replay-e1ee4792`; ffprobe `codec_name=h264|width=1280|height=720|pix_fmt=yuv420p|r_frame_rate=30/1`, `duration=24.033333`, 417 KB. The same step with two captures of one commit: `skip: no picture differs`, exit 0, no artifact name.
- Not yet run on Actions: no dispatcher card has shipped to `main` since the workflow landed. The first Dust card after the release is its live proof.

## Decisions

- 2026-10-26: the composer lives in `platform/explainer`, not `seed-1/scripts/`. `seed-1/scripts/` is a protected path, and the explainer already owns the studio's video tooling and its tokens.
- 2026-10-26: slides are drawn as pages by headless Chromium and joined by ffmpeg, not rendered by Remotion. A replay is a few held pictures, made unattended on a runner; Remotion's bundle and render would cost minutes for no motion the clip needs.
- 2026-10-27: until step 3, the clip is kept as the run's artifact for 90 days. A commit that is not a card ship, a card taken back out and captures that draw the same each end the run green with a `skip:` line, so a red run means the clip should have been made and was not.
- 2026-10-26: Dust only, captured at 1280 px. A site card's before and after is the gate's own frame pairs (`docs/PLAN.md` Appendix A, frames), which a later step can reuse.
