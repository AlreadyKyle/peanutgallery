# Mob Machine

Mob Machine is a public game studio run by AI agents and funded by its supporters. Supporters contribute through Stripe and choose how their money splits between the agents' compute and the studio. Funding a card on the site is how supporters choose what gets built: when a card's bar is full, the dispatcher starts an agent session that builds the change, the gate checks it, and it ships to the live game. Every studio-billed dollar lands on a public ledger. The first game is Dust, an idle game.

Backseat is the working name. The package names (`@backseat/*`) still use it.

## Where each piece runs

| Piece | Where | Notes |
|---|---|---|
| Site | https://mobmachine.games | Netlify site `peanutgallerygames`, base `platform/site`. Vite and React. It has no `/board`. |
| Board site | Its own `*.netlify.app` address, given to the board and kept out of the repository | A separate Netlify site, base `platform/board`, created as a production step of `docs/specs/board-site.md`. Vite and React, under an enforced Content Security Policy, not indexed and not linked from the public site. |
| Game | https://play.mobmachine.games | Netlify site `peanutgallery-seed-1`, base `seed-1`. Phaser 3 and Vite. |
| Database | Supabase project `lyxndueoeisyqzewflpu` | Postgres holds the money logic (crediting, usage, reversals, the daily hold), the `stripe-webhook` edge function, and pg_cron, which releases held credit hourly. |
| Payments | Stripe | A Payment Link with a split dropdown, and a webhook to the edge function. |
| Dispatcher | The founder's Mac, attended | At the cutover it runs unattended on the board's Mac under launchd (`docs/specs/mac-host.md`), and card sessions run as Claude Managed Agents sessions. It moves to a free Google Cloud server once the studio has one (`docs/BACKLOG.md`); the server's image, units and runbook are kept for that. The cutover is on the launch checklist in `docs/ROADMAP.md`. |
| Gate | GitHub Actions workflow `gate` | Runs on every pull request and every push to `main`. |

The repository is private. `main` has no branch protection; the dispatcher merges a card only after the `gate` check has succeeded on the pull request's exact head sha.

## Repository map

- `platform/site`: the public site.
- `platform/board`: the board's own site, a kernel folder: the Needs you inbox and every board control.
- `platform/dispatcher`: the Node service that claims funded cards, runs agent sessions, and merges, deploys, smoke-tests and rolls back.
- `platform/gate`: `ship-gate.sh` and its scans, the deny-lists, the headless bot runner and the kernel path list.
- `platform/supabase`: migrations, the `stripe-webhook` function, the seed and the operator scripts.
- `platform/agents`: the sixteen role specs (JSON) and their prompts.
- `platform/ops`: the dispatcher's Docker image, systemd units, provisioning and deploy scripts, and the VPS runbook.
- `seed-1`: Dust, with its simulation, config, content, renderer, bot and tests. It never imports from `platform/`.
- `BOARD-SETUP.md`: the board's steps, the one list of what only Kyle can do. It sits at the repository root so it is the first thing visible.
- `docs`: the constitution (`PLAN.md`), the launch checklist (`ROADMAP.md`), the backlog (`BACKLOG.md`) and the specs.

## How a card ships

This is what `platform/dispatcher/src/pipeline.ts` does with one card.

1. **Funded.** A card on horizon `now` reaches stage `funded`: its bar fills from contributions, or the board files it as a directive.
2. **Claimed.** On its one-minute tick the dispatcher checks that the studio is not paused and that its mode matches `studio_state`. In attended mode it needs a board member signed in on the board site; in unattended mode the pool and the caps must cover the card. Then it claims the card and sets it to `building`.
3. **Session.** If the card has a `check:` line, the check must be false before the session. In attended mode a Claude Code session on the founder's Mac makes the change in a worktree on branch `card/<id>-<lane>`; in unattended mode a Claude Managed Agents session makes it against a read-only copy of the repository and hands back a patch, which the dispatcher applies in its own worktree on that branch. The session gets the card, the CLAUDE.md files and the role prompt, and every turn is metered to the ledger. Afterwards the check must be true.
4. **Lane check.** Any change outside the card's lane, or to a kernel path, rejects the card.
5. **Pull request.** The dispatcher commits the lane's paths, pushes `card/<id>-<lane>`, opens a pull request and sets the card to `gated`.
6. **Gate.** It waits for the `gate` check on the head sha. A failure rejects the card.
7. **Merge.** It re-reads the pause and the card, then squash-merges, passing the head sha, so a head that moved is refused. If `main` moved since the card's base, the card goes back to be gated again.
8. **Deploy.** It waits for the Netlify deploy of the merge commit.
9. **Smoke.** It checks that the deployed page's `version.json` names the merge commit, that the card's check holds on the served config, that each served config file matches the merge commit, and that the gate is green at the merge sha. It runs no card code.
10. **Live, or rolled back.** On a pass it records a green deploy and the card goes `live`. When the deploy fails, a revert commit goes on `main`. When the smoke test fails, the last green deploy is restored first, then the revert commit is written. Either way the card is rejected with the failing check.

## Prerequisites

- Node 22 (`.node-version`).
- pnpm 11.0.9 (`packageManager` in `package.json`).
- Deno, for `pnpm test:functions`.
- Playwright Chromium, for the site's end-to-end suite: `pnpm --filter @backseat/site exec playwright install chromium`.

Install with `pnpm install --frozen-lockfile`. The dispatcher, the seed and the scripts read `.env` at the repository root; `.env.example` lists every key and says which ones no code reads yet. Never commit `.env`.

## Commands

`pnpm verify` at the repository root is the floor for every change. It runs, in order:

1. `pnpm typecheck`: every package's typecheck.
2. `pnpm test`: every package's tests (site, board, dispatcher, gate, supabase, seed-1).
3. `pnpm test:agents`: the role specs and prompts.
4. `pnpm test:ops`: the ops scripts and env file.
5. `pnpm test:functions`: the edge function and the migrations in PGlite, under Deno.
6. `pnpm gate:dry-run`: the ship gate for `seed-1` and `platform`, locally.
7. `pnpm secret-scan`: tracked files.
8. `pnpm test:docs`: the docs drift guard (`docs/docs.test.mjs`).

Per package:

- `pnpm --filter @backseat/site test`, and `pnpm --filter @backseat/site build && pnpm --filter @backseat/site e2e`.
- `pnpm --filter @backseat/board test`, and `pnpm --filter @backseat/board e2e`.
- `pnpm --filter @backseat/dispatcher test`.
- `pnpm --filter @backseat/supabase test`.
- `pnpm --filter @backseat/seed-1 test`, and the bot: `pnpm --filter @backseat/seed-1 bot -- --config-dir seed-1/config --hours 10 --seed 20260914`.
- `pnpm --filter @backseat/gate test`.

## Running things locally

- The site: `pnpm --filter @backseat/site dev`. Without the `VITE_` values it renders with no data.
- The game: `pnpm --filter @backseat/seed-1 dev`.
- The dispatcher: `pnpm --filter @backseat/dispatcher start`, with `.env` filled in. In attended mode a tick starts nothing until a board member is signed in on the board site. It reads and writes the Supabase project `.env` names, and the studio has one project, the live one, so run it only when you mean to build cards.

## Other guides

- `platform/site/DESIGN.md`: the site's style guide and copy rules.
- `platform/agents/README.md`: the role spec schema and what each prompt must say.
- `platform/ops/README.md`: the VPS runbook (provision, cutover, deploy, roll back, rotate keys).
- `seed-1/CLAUDE.md`: Dust's layout, rules, lanes and protected paths.

## How work is done here

- **Spec first.** Every change has a spec under `docs/specs/`, copied from [`TEMPLATE.md`](docs/specs/TEMPLATE.md). A change is done only when every line of its Verification section has been run and the output quoted.
- **Production needs the board.** Migrations, function deploys, Stripe endpoint changes and anything else that touches production run only with the board's explicit allow. A spec lists them under "Production steps (need the board's allow)".
- **Pull requests.** Every change reaches `main` through a pull request with the `gate` check green. The one exception is the revert commit the dispatcher writes after a merged card fails its deploy or smoke.
- **The kernel.** The files listed in `platform/gate/kernel-paths.txt` enforce the rules no card can change. No agent may edit them; the board does.

## Reading order

1. `docs/ROADMAP.md`: what stands between today and live, and the standing facts.
2. `docs/PLAN.md`, the sections the work touches: §4 the mechanics, the work definitions and the kernel, §5 the money, §6 the architecture, §10 the decisions, Appendix A the technical spec. `docs/BACKLOG.md` lists what is planned and not built.
3. The specs under `docs/specs/` that the work touches.

[`docs/SYSTEM.md`](docs/SYSTEM.md) is the map of the running system: every role with its class, job, tools and what it may and may not do, a card's life with approvals and dealing, the job queue, what pays for each kind of work and where the board steps in.

## Glossary

- **Board.** Kyle and whoever joins him. The board acts through its own site (`platform/board`, not linked from the public site): the Needs you inbox, pause, the agent mode, directives, cards and their vetoes, notes, the caps, the cooling window, role pauses, the job list and credit purchases.
- **Card.** One unit of work: a title, a public summary, the agents' brief, an acceptance test, an estimate, a funding target, a lane, a folder, an executor role, a stage (proposed, designing, voted, funded, building, gated, live, rejected, paused) and a horizon (now, next, later).
- **Lane.** Config lane: data under `seed-1/config/` and `seed-1/content/` only; the gate runs the scans, the bot and the build. Code lane: everything else outside the kernel paths; the full gate runs. Platform cards are code lane, in `platform/site` outside its kernel paths only, and that lane opens when the board sets `studio_state.platform_lane_open` once its own site is live (PLAN.md §4 Work).
- **Horizon and backlog.** Only a card on `now` can take money or run. `next` and `later` are the backlog: planned, not built, listed on /roadmap and seeded from `docs/BACKLOG.md`.
- **Gate.** The checks a change passes before it merges: `platform/gate/ship-gate.sh` run by the `gate` workflow. It covers the secret scan, the deny-list, the runtime-token scan, typecheck and tests, the headless bot and the build.
- **Kernel.** The rules no card or role change can edit (PLAN.md §4 Kernel). The **kernel paths** are the files that enforce them, listed in `platform/gate/kernel-paths.txt`. The dispatcher refuses a card that changes one, and the gate fails a card branch that does.
- **Pool.** Customer money available for agent compute, in `pool.balance_usd`. There is no founding budget.
- **Reserve.** 10% of every contribution after Stripe's fee, taken before the split. Agents never spend it; it covers disputes first.
- **Emergency fund.** The site's name for the incident reserve: 5% of the agents' share of each contribution, until it holds $500, for urgent bug fixes.
- **Attended and unattended.** Attended: Claude Code sessions run on the founder's subscription only while a board member is signed in on the board site, billed to the founder. Unattended: Claude Managed Agents sessions run with no one present on the studio's own Anthropic organization (`STUDIO_ANTHROPIC_API_KEY`), billed to the studio and paid from the pool, within the Console credit bought from Stripe payouts.
- **Directive.** A card the board forces to stage `funded` at priority 0. It skips funding and still passes the gate.
- **Founder-billed and studio-billed.** Every ledger row's `billed_to`. Founder-billed rows are attended work, tracked privately and never taken from the pool. Studio-billed rows are paid from the pool and shown on the public ledger.
- **Held.** Agent credit above $50 per contributor per New York day, held 14 days before it reaches the pool (`docs/specs/refunds-and-holds.md`).
- **D1–D3.** The first three board directives, built by agents through the pipeline (`docs/specs/week1-runs.md`): D1 the unlock list that fits any count, D2 save and resume, D3 the game shell (tab title, icon, studio link and all-ages label).
- **Live cut.** The smallest set of features needed to go live (`docs/specs/live-cut.md`): the money loop, funding a card, unattended mode, and what is building and what is next on the site. `docs/ROADMAP.md` is the current checklist.
- **`studio_state`.** The single row of studio settings and status: pause, the agent mode, the spend caps, the launch time, the daily credit limits and hold length, and the dispatcher's heartbeat. The board sets pause, the agent mode, the caps and Go live from the board site.
