# Mob Machine

A public game studio run by AI agents, directed by its audience and funded by the hour; a continuous stream is planned (`docs/BACKLOG.md`). This is a monorepo: `platform/` (site, dispatcher, gate, supabase, agents, ops) and `seed-1/` (the first game, Dust; its own rules are in `seed-1/CLAUDE.md`).

## Read first, in this order

1. `docs/ROADMAP.md`: the launch checklist and standing facts.
2. The sections of `docs/PLAN.md` the work touches: §4 mechanics, work, kernel and The Board; §5 money; §6 architecture; §10 decisions; Appendix A technical spec.
3. The specs under `docs/specs/` the work touches.

`docs/BACKLOG.md` lists what is planned and not built.

## Rules that never change

Rules that never change (the kernel, PLAN.md §4 Kernel): the ledger, spend caps, the default 80/20 split and 10% reserve, the incident reserve, the gate, rollback, the content filter and all-ages rating, the art policy, the broadcast delay and kill switch, and the read/write separation. No agent with write access reads free text from the public.

- Nothing in this repo references the founder's other companies or projects, with two exceptions: the public site's footer carries a single "Created by Clayhouse" credit linking to clayhouse.studio, and the public contact address is hello@clayhouse.studio (`docs/PLAN.md` §10 decision 37).
- Secrets live in the gitignored `.env` and `.env.vps`. Never print, paste or commit a value; check a key by prefix and length instead.
- Ask the board before any Stripe call, reads included, and before anything that spends money.

## Names

The name is the board's call (`docs/PLAN.md` §10 decision 43). The domain is mobmachine.games, with peanutgallery.games kept as a redirect (§10 decision 59). Internal identifiers keep the old `peanutgallery` spelling (`docs/specs/rename.md`). The package names (`@backseat/*`) use the earlier working name, Backseat.

## Spec-driven development

- `docs/PLAN.md` is the constitution. A spec under `docs/specs/` (copy `TEMPLATE.md`) is the contract for a new feature or for any change to the kernel, money, migrations or the gate; a card is the agents' spec. A bug fix, a small tooling change or a copy fix needs no spec file: its pull request description is the contract and carries a Verification section.
- A change is done only when every line of its Verification section (the spec's, or the pull request's) has been run and the output quoted. `pnpm verify` at the repository root is the floor.
- No dates, deadlines, week numbers or day numbers in plans, docs or prompts unless the board set them; work is ordered, not scheduled. Dates that record history (decision dates, evidence timestamps) are fine.
- In docs, name the backup folder's owner as "the board's Google Drive", never by account address; the docs guards refuse the address.

## Commands

- `pnpm verify`: typecheck, tests, agents, ops, functions, gate dry-run, secret scan, docs and rename checks. Run it from the repository root, once before pushing. The checks run at once (`scripts/verify.sh`), about 3 minutes on the Mac.
- `pnpm verify:changed`: typecheck and tests for only the packages the branch touches, plus the docs, secret and rename checks. Use it while iterating.
- `pnpm test:docs` and `pnpm secret-scan`: the fast checks for a docs-only change. `test:docs` guards the kernel line, schedules, company names and `PLAN.md §` references.
- Site e2e: `E2E_PORT=<port> npx playwright test <specs>` in `platform/site`.
- Live check of a running site: `node platform/site/scripts/live-check.mjs [baseUrl]`. Quote its first line, which must read `PASS ... failed=0`. From a cloud session, run the `live-check` workflow instead (Cloud sessions, below).
- Local gate for a board pull request, the fallback if Actions cannot start jobs (the gate workflow runs on Actions again since the repository went public on 6 October 2026): `bash scripts/local-gate.sh <pr> [port-base]`, from main's checkout and never a pull request's own copy. It prints `LOCAL GATE PASS pr=... head=... base=...`. It runs on the Mac only.

## Long runs and merging

Sessions that died mid-run (a usage limit or the machine shutting down stops a session and every agent it runs at once) left pull requests half-shipped. Work so that a new session can pick up from git alone.

- Keep multi-agent runs small. Reviewers: none for a fix under about 50 changed lines outside the kernel, one by default, up to three only for kernel, money, migration or gate changes. One review round a pull request, a second only after a blocker fix, and several short workflows in sequence rather than one long one.
- Never wait in the foreground: run the gate watch, `pnpm verify` and e2e in the background and act on the notification, not on `sleep` or `until` loops.
- Every agent commits and pushes its branch at least every 20 minutes. Nothing lives only in a worktree or in `/tmp`.
- At most three agents run `pnpm verify` or e2e at once, each on its own port (`E2E_PORT`, 4400 to 4499).
- Before pushing, run the e2e specs the change touches; the Actions gate is the full check, so do not also run the local gate. A full gate run takes about 8 minutes on Actions and 8 to 9 locally (`docs/ROADMAP.md`, Merging), so a predictable failure is expensive.
- One session merges to `main` at a time, on a green gate workflow run at the pull request's exact head (or, when Actions is down, a local gate PASS whose `base=` is still `origin/main`, quoted in the merge body): `gh api -X PUT repos/AlreadyKyle/peanutgallery/pulls/<pr>/merge -f merge_method=squash -f sha=<head>`, then `gh api -X DELETE repos/AlreadyKyle/peanutgallery/git/refs/heads/<branch>`. The REST form works in cloud sessions, whose GitHub proxy refuses the GraphQL `gh pr` commands; `sha` refuses a head that moved. If `main` moved, run the gate again.
- After each merge, comment on the merged pull request with the merge sha and the live-check line (`gh api repos/AlreadyKyle/peanutgallery/issues/<pr>/comments -f body=...`). Merged branches and their worktrees are deleted. (`~/peanutgallery-launch/STATUS.md` is history up to #149.)

## Cloud sessions

Code work runs in Claude Code cloud sessions; `scripts/cloud-setup.sh` (the SessionStart hook) installs the packages, Deno and Playwright's Chromium there. `.env` and `.env.vps` never go to the cloud, so production migrations, database dumps and anything else that reads a secret run in a local session on the board's Mac.

- The cloud environment's default network level (Limited) reaches the package registries and GitHub but not mobmachine.games, peanutgallery.games, deno.land or cdn.playwright.dev. So `scripts/cloud-setup.sh` installs Deno from npm and, when Playwright's Chromium cannot download, points the Playwright configs at the Chromium the cloud image ships (`PW_CHROMIUM_PATH`).
- For the live check from a cloud session, start the `live-check` workflow (`.github/workflows/live-check.yml`, workflow_dispatch) and quote the first line of its log; run `live-check.mjs` directly only when the session can reach the site (the board added the domains under the environment's Allowed domains).
