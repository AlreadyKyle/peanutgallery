# Backseat

A public game studio run by AI agents, directed by its audience, funded by the hour, streamed continuously.

The spec is `docs/PLAN.md`. Read it in full before any work. §4 is the mechanics (cards, tiers, The Board, kernel), §6 is Build 1 and the architecture, Appendix A is the technical spec.

This is a monorepo: `platform/` (site, dispatcher, host, agents, gate, ops) and `seed-1/` (the first game). Layout details in Appendix A of the plan, with the two repo names there mapping to these two folders.

Rules that never change (the kernel, §4): the ledger, spend caps, the default 80/20 split and 10% reserve, the incident reserve, the gate, rollback, the content filter and all-ages rating, the art policy, the broadcast delay and kill switch, and the read/write separation. No agent with write access reads free text from the public.

Nothing in this repo references the founder's other companies or projects, with one exception: the public site's footer carries a single "Created by Clayhouse" credit linking to clayhouse.studio.

## Spec-driven development

`docs/PLAN.md` is the constitution. A spec under `docs/specs/` (copy `TEMPLATE.md`) is the contract for one change; a card is the agents' spec. No feature work without a spec file. A change is done only when every line of its Verification section has been run and the output quoted. `pnpm verify` at the repository root is the floor.
