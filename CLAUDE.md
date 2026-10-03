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

- `docs/PLAN.md` is the constitution. A spec under `docs/specs/` (copy `TEMPLATE.md`) is the contract for one change; a card is the agents' spec. No feature work without a spec file.
- A change is done only when every line of its spec's Verification section has been run and the output quoted. `pnpm verify` at the repository root is the floor.
- No dates, deadlines, week numbers or day numbers in plans, docs or prompts unless the board set them; work is ordered, not scheduled. Dates that record history (decision dates, evidence timestamps) are fine.
- In docs, name the backup folder's owner as "the board's Google Drive", never by account address; the docs guards refuse the address.

## Commands

- `pnpm verify`: typecheck, tests, agents, ops, functions, gate dry-run, secret scan, docs and rename checks. Run it from the repository root.
- `pnpm test:docs` and `pnpm secret-scan`: the fast checks for a docs-only change. `test:docs` guards the kernel line, schedules, company names and `PLAN.md §` references.
- Site e2e: `E2E_PORT=<port> npx playwright test <specs>` in `platform/site`.
- Live check of a running site: `node platform/site/scripts/live-check.mjs [baseUrl]`. Quote its first line, which must read `PASS ... failed=0`.
- Local gate for a board pull request (while Actions cannot start jobs): `bash scripts/local-gate.sh <pr> [port-base]`, from main's checkout and never a pull request's own copy. It prints `LOCAL GATE PASS pr=... head=... base=...`.

## Long runs and merging

Sessions that died mid-run (a usage limit or the Mac shutting down stops a session and every agent it runs at once) left pull requests half-shipped. Work so that a new session can pick up from git alone.

- Keep multi-agent runs small: at most three reviewers and one review round a pull request, a second round only after a blocker fix, and several short workflows in sequence rather than one long one.
- Every agent commits and pushes its branch at least every 20 minutes. Nothing lives only in a worktree or in `/tmp`.
- At most three agents run `pnpm verify` or e2e at once, each on its own port (`E2E_PORT`, 4400 to 4499).
- Before starting the local gate, run the e2e specs the change touches. A full gate run takes about 8 minutes on Actions and 8 to 9 locally (`docs/ROADMAP.md`, Merging), so a predictable failure is expensive.
- One session merges to `main` at a time, on a local gate PASS whose `base=` is still `origin/main`: `gh pr merge <pr> --squash --match-head-commit <head> --delete-branch`, with the PASS line quoted in the merge body. If `main` moved, run the gate again.
- After each merge, append one line to `~/peanutgallery-launch/STATUS.md`: the pull request, the merge sha and the live-check line. Merged branches and their worktrees are deleted.
