# Mob Machine

Mob Machine is a public game studio run by AI agents, directed by its audience and funded by the hour; a continuous stream is planned (`docs/BACKLOG.md`). The name is the board's call (`docs/PLAN.md` §10 decision 43): the domain stays peanutgallery.games until the board registers a new one, and internal identifiers keep the old `peanutgallery` spelling (`docs/specs/rename.md`). The working name before both was Backseat, which the package names (`@backseat/*`) still use.

Read before any work, in this order: `docs/ROADMAP.md` (the launch checklist and standing facts); then the sections of `docs/PLAN.md` the work touches (§4 mechanics, work, kernel and The Board; §5 money; §6 architecture; §10 decisions; Appendix A technical spec); then the specs under `docs/specs/` that the work touches. `docs/BACKLOG.md` lists what is planned and not built.

This is a monorepo: `platform/` (site, dispatcher, gate, supabase, agents, ops) and `seed-1/` (the first game).

Rules that never change (the kernel, PLAN.md §4 Kernel): the ledger, spend caps, the default 80/20 split and 10% reserve, the incident reserve, the gate, rollback, the content filter and all-ages rating, the art policy, the broadcast delay and kill switch, and the read/write separation. No agent with write access reads free text from the public.

Nothing in this repo references the founder's other companies or projects, with two exceptions: the public site's footer carries a single "Created by Clayhouse" credit linking to clayhouse.studio, and the public contact address is hello@clayhouse.studio (`docs/PLAN.md` §10 decision 37).

## Spec-driven development

`docs/PLAN.md` is the constitution. A spec under `docs/specs/` (copy `TEMPLATE.md`) is the contract for one change; a card is the agents' spec. No feature work without a spec file. A change is done only when every line of its Verification section has been run and the output quoted. `pnpm verify` at the repository root is the floor.

No dates, deadlines, week numbers or day numbers in plans, docs or prompts unless the board set them; work is ordered, not scheduled. Dates that record history (decision dates, evidence timestamps) are fine.

## Long runs and merging

Sessions that died mid-run (a usage limit or the Mac shutting down stops a session and every agent it runs at once) left pull requests half-shipped. Every session works so that a new one can pick up from git alone:

- Keep multi-agent runs small: at most three reviewers and one review round a pull request, a second round only after a blocker fix, and several short workflows in sequence rather than one long one.
- Every agent commits and pushes its branch at least every 20 minutes; nothing lives only in a worktree or in `/tmp`.
- After each merge, append one line to `~/peanutgallery-launch/STATUS.md` (pull request, merge sha, live-check line).
- At most three agents run `pnpm verify` or e2e at once, each on its own port (`E2E_PORT`, 4400 to 4499).
- Before starting the local gate, run the e2e specs the change touches (`E2E_PORT=<port> npx playwright test <specs>` in `platform/site`); a full gate run takes about ten minutes, so a predictable failure costs one.
- One session merges to `main` at a time, on a local gate PASS whose `base=` is still `origin/main` (`docs/ROADMAP.md`, Merging). Merged branches and their worktrees are deleted.
