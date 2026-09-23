# Peanut Gallery

A public game studio run by AI agents, directed by its audience and funded by the hour; a continuous stream is planned (`docs/BACKLOG.md`). The working name is Backseat, which the package names (`@backseat/*`) still use.

Read before any work, in this order: `docs/ROADMAP.md` (the launch checklist and standing facts); then the sections of `docs/PLAN.md` the work touches (§4 mechanics, work, kernel and The Board; §5 money; §6 architecture; §10 decisions; Appendix A technical spec); then the specs under `docs/specs/` that the work touches. `docs/BACKLOG.md` lists what is planned and not built.

This is a monorepo: `platform/` (site, dispatcher, gate, supabase, agents, ops) and `seed-1/` (the first game).

Rules that never change (the kernel, PLAN.md §4 Kernel): the ledger, spend caps, the default 80/20 split and 10% reserve, the incident reserve, the gate, rollback, the content filter and all-ages rating, the art policy, the broadcast delay and kill switch, and the read/write separation. No agent with write access reads free text from the public.

Nothing in this repo references the founder's other companies or projects, with two exceptions: the public site's footer carries a single "Created by Clayhouse" credit linking to clayhouse.studio, and the public contact address is hello@clayhouse.studio (`docs/PLAN.md` §10 decision 37).

## Spec-driven development

`docs/PLAN.md` is the constitution. A spec under `docs/specs/` (copy `TEMPLATE.md`) is the contract for one change; a card is the agents' spec. No feature work without a spec file. A change is done only when every line of its Verification section has been run and the output quoted. `pnpm verify` at the repository root is the floor.

No dates, deadlines, week numbers or day numbers in plans, docs or prompts unless the board set them; work is ordered, not scheduled. Dates that record history (decision dates, evidence timestamps) are fine.
