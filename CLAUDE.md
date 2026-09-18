# Peanut Gallery

A public game studio run by AI agents, directed by its audience, funded by the hour, streamed continuously. The working name is Backseat, which the package names (`@backseat/*`) still use.

Read before any work, in this order: `docs/ROADMAP.md` (status and standing facts); then the sections of `docs/PLAN.md` the work touches (§4 mechanics and kernel, §6 Build 1 and architecture, Appendix A technical spec); then the specs under `docs/specs/` that the work touches.

This is a monorepo: `platform/` (site, dispatcher, gate, supabase, agents, ops) and `seed-1/` (the first game).

Rules that never change (the kernel, §4): the ledger, spend caps, the default 80/20 split and 10% reserve, the incident reserve, the gate, rollback, the content filter and all-ages rating, the art policy, the broadcast delay and kill switch, and the read/write separation. No agent with write access reads free text from the public.

Nothing in this repo references the founder's other companies or projects, with one exception: the public site's footer carries a single "Created by Clayhouse" credit linking to clayhouse.studio.

## Spec-driven development

`docs/PLAN.md` is the constitution. A spec under `docs/specs/` (copy `TEMPLATE.md`) is the contract for one change; a card is the agents' spec. No feature work without a spec file. A change is done only when every line of its Verification section has been run and the output quoted. `pnpm verify` at the repository root is the floor.
