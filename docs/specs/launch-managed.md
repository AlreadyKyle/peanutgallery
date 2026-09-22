# Unattended cards on Claude Managed Agents

Status: built. Card: none. Owner: board.

## Problem

Unattended card sessions ran the Claude Code command line on the VPS with the studio key, so code an agent wrote (its tests, the smoke bot) ran on the same host as the dispatcher's secrets, the risk `vps.md` names. On the Mac, attended sessions run card test code beside the repository's `.env`, the GitHub credentials and the SSH keys. The board chose Anthropic's Managed Agents for unattended work, so card code runs in a container Anthropic hosts and the VPS only orchestrates.

## Scope

In:
- The managed adapter (`platform/dispatcher/src/adapters/managed.ts`), with its client, metering and config checks.
- The agent and environment files under `platform/agents/managed/`, and `managed:apply` to apply them.
- The patch path: the agent's patch as a session output file, `submit_patch`, the validation, the `card_patches` store, and the re-apply on re-queue.
- Session metering to the ledger, the budget in cents, and orphan recovery.
- The containment check and the read-token write probe, in the dispatcher and in `provision.sh`.
- The managed startup probe, billed as overhead, and a one-off toolchain check.
- Production smoke that runs no card code.
- The claude CLI and its sandbox tools removed from the image.
- A CI audit of the workflows that run card code.
- The attended sandbox through `--settings`, and `sandbox:check`, which proves it on the Mac.
- The runbook, the env file tooling, and the `vps.md` and `unattended-mode.md` wording.

Out:
- The `card_patches` table and the overhead ledger value. Those are migrations owned by the DB workstream; the adapter assumes `card_patches (card_id, base_sha, diff, created_at)` and that `record_usage` does not debit the pool for `overhead`.
- The throttle and the formula for the budget the adapter receives (owned by the dispatcher workstream).
- Gate changes beyond `persist-credentials: false`.
- The role prompts, ROADMAP and BOARD-SETUP.
- Any live run. Those need studio Console credit, which comes after the first payout.

## Behaviour

**One agent, one environment.** `agent.yaml` declares one writing agent: bash, read, write, edit, glob, grep and a custom `submit_patch` tool. The web tools are off, and it has no MCP server, skill, sub-agent roster or model. `environment.yaml` declares one cloud container whose networking is limited to the package registries: no MCP egress and no extra host.

That networking stops the container from reaching arbitrary hosts. Keeping the repository's contents confidential is not its goal. A session holds the whole repository, and the package registries it can reach accept uploads, so anything it can read could leave that way. The repository therefore holds no secret: `.env` files are untracked, and the secret scan in `pnpm verify` refuses token shapes in tracked files.

`pnpm --filter @backseat/dispatcher managed:apply` creates or updates both in the studio organization and prints `MANAGED_AGENT_ID`, `MANAGED_AGENT_VERSION` and `MANAGED_ENVIRONMENT_ID`. It sets the agent's model from `MODEL_BUILDER`, and refuses the founder's key. With `--check` it also creates one session with a one-cent budget and no message, prints it and archives it.

**Startup refuses unless contained.** Unattended mode requires the following, or `config.ts` refuses to load:
- `GITHUB_READ_TOKEN`, different from `GITHUB_TOKEN`;
- the three managed ids, the version a whole number of 1 or more;
- both tokens fine-grained (`github_pat_`).

Before any card, the dispatcher checks three things:
- The read token can read the repository and GitHub denies it a write, for want of permission. The write attempted is a ref at the all-zero sha, which changes nothing.
- The agent at its pinned version matches `agent.yaml`.
- The environment matches `environment.yaml`.

A drifted config or a token that can write exits 78. An API that does not answer exits 1. Then one minimal probe session runs, billed as `overhead` with no card and no role, and the journal shows `containment verified`, `session metered` and `startup probe passed`. `provision.sh` runs the same write probe with curl before it builds anything.

**A card session.** In order:
1. The dispatcher closes any earlier session for the card and re-checks the read token.
2. It refuses a base commit that carries repository skills.
3. It builds the system prompt: the role prompt, then the root `CLAUDE.md` and the card folder's `CLAUDE.md`, both read at the base sha.
4. It creates the session. The session starts idle, with metadata (purpose, card, role, base sha, run), the repository checked out at the base sha through the read-only token, the model and system prompt as overrides, and a budget in whole cents:
   `floor(100 × (the card's budget − one request's margin))`
   The margin is 150,000 cache-read tokens plus 8,192 output tokens at the model's price. Under one cent, no session is created.
5. It checks the agent the session reports, puts the session id on the card's start event, and only then sends the card prompt as the first `user.message`.

Each connection opens the event stream, then lists the history and drops events it has already seen, so a dropped stream loses nothing. When the dispatcher aborts (a pause, the ceiling, the wall clock or SIGTERM), it sends `user.interrupt`, waits for idle, then meters and archives the session. `budget_reached` ends the card at its ceiling, and a list cost over the budget alerts the board.

**The patch.** The agent runs the export command from its card message. That writes `git diff --cached --no-renames --full-index <base>` to `/mnt/session/outputs/card.patch`. The agent then calls `submit_patch({summary, sha256, bytes})`, which carries no diff.

The dispatcher fetches the file through the Files API. It refuses a file over 1 MiB without downloading it, and refuses a sha256 or byte count that does not match. It then runs `git apply --check --numstat --summary -z` and refuses:
- a rename, a symlink or a gitlink;
- a mode other than 100644 or 100755;
- a binary file, or more than 100 files;
- a path with `..` or `.git`, a path outside the card's lane, or a path on a kernel path;
- a patch that does not apply at the base.

A refusal writes nothing and goes back to the agent as an error tool result, with one retry, after which the session ends `patch_rejected`. An accepted patch is applied to the card's worktree and stored in `card_patches`. From there the existing lane checks, commit, PR, gate, merge and deploy run.

A card re-queued after an interruption is rebuilt from its stored patch with no new session and no new ledger row. A stored patch that no longer applies pauses the card as `patch_conflict` and is discarded.

**Metering.** Each `span.model_request_end` becomes one ledger row, billed to the studio, with the event id as its request id, so a re-meter writes nothing twice. Cache writes are priced at the five-minute rate. Each session then gets a runtime row at $0.08 per active hour, and a settle row that brings the session's rows up to its reported list cost. `session.ts` writes no rows of its own for such a session. If any row stays unwritten, the session stays unsettled and unarchived for recovery.

**Recovery.** At start, recovery lists every open session and handles each one before pausing cards:
- it interrupts the session and meters its history once;
- it stores a patch left unanswered;
- it settles and archives the session.

If the sessions cannot be listed or settled, every building card is paused as `session_unsettled` and the board is alerted. No second session starts for a card while an earlier one is unsettled.

**Smoke runs no card code.** After a merge, `smoke.ts` checks four things:
1. The served build sha.
2. The served config checks.
3. Every served `seed-1/config` and `seed-1/content` file equals, byte for byte, its git blob at the merge sha.
4. The gate is green at the merge sha, waited on for up to 12 minutes. A gate still running at the end of the wait is no verdict, not a pass.

The headless bot no longer runs on the VPS.

**The image.** `Dockerfile.dispatcher` installs git, ca-certificates, tini and pnpm. It has no claude CLI, no bubblewrap or socat, and no Claude Code settings. No managed module imports `child_process`.

**CI.** Every workflow that runs card code reads contents only, persists no checkout credential, uses no secret, and has no `pull_request_target` or `workflow_run` trigger. `ops.test.mjs` asserts this over every file in `.github/workflows`.

**Attended on the Mac.** Sessions still use the Claude Code command line on the founder's plan, but with `--settings` that turn Claude Code's sandbox on. The sandbox refuses to start rather than run unsandboxed, and a command may not ask to leave it. Bash has:
- no network, and one unix socket: tsx's IPC folder;
- read access to the worktree, the repository's `.git`, the pnpm store, the corepack cache and the temp folder, and nothing else under the home folder or the repository;
- write access to the worktree and the temp folder only;
- git with no global or system configuration.

The Read, Glob and Grep tools, which the sandbox does not cover, are denied the credential paths, the repository's `.env` files and `platform/dispatcher`. Edit and Write are allowed only in the worktree. Dependencies are installed before the session, outside it.

`pnpm --filter @backseat/dispatcher sandbox:check` runs real sessions against the installed CLI to prove this. With `--positive`, it also runs the seed-1 test, typecheck and bot inside the sandbox.

**The toolchain check.** `probe.ts --toolchain` runs one overhead-billed session at main's head. The session runs node, pnpm, `pnpm install --frozen-lockfile` and the seed bot, and the check passes only on node 22 or later, pnpm 11.0.9 and both commands exiting 0.

**Why the VPS stays.** The VPS no longer builds anything, but something must hold each session's event stream, meter it, apply and check the patch with the dispatcher's own write token, and drive the gate, merge and deploy. None of that belongs in the agent's container, and the Mac sleeps.

The Oracle Always Free box is now mostly idle, which is the pattern Oracle reclaims. The runbook states this and names the board's choice: upgrade the account to pay-as-you-go, which stays free within the Always Free limits, or accept reclaim. `oracle-launch.sh` starts a stopped instance, and healthchecks.io alerts on one.

## Acceptance criteria

- [x] `agent.yaml` turns on bash, read, write, edit, glob, grep and `submit_patch` and nothing else. The web tools are off by name, and it declares no MCP server, skill, sub-agent roster, model or MCP toolset.
- [x] `environment.yaml` is a cloud container with limited networking: package managers only, no MCP egress, no extra host.
- [x] `managed:apply` plans a create for a missing agent or environment, an update for a drifted model, tool set or `submit_patch` schema, and nothing when both match.
- [x] Unattended config requires `GITHUB_READ_TOKEN` and the three managed ids, refuses a read token equal to the write token in either mode, and refuses a token that is not fine-grained.
- [x] Startup exits 78 on any of: an enabled web tool, an MCP server or toolset, a skill, fast mode, another agent version, unrestricted networking, MCP egress, an extra host, or a read token GitHub would let write. A rate limit or 5xx retries instead.
- [x] A card session is created idle with its metadata and a budget in whole cents, and its id is on the start event before the first `user.message`.
- [x] The session's system prompt holds the role prompt and the root and folder `CLAUDE.md` read at the base sha.
- [x] A base commit that carries repository skills gets no session, and neither does a card with less than a cent of budget.
- [x] A read token that turns out able to write halts the dispatcher before any session is created.
- [x] `budget_reached` ends the card as `error_max_budget_usd`, and a list cost over the budget alerts the board.
- [x] An abort becomes `user.interrupt`, the session drains to idle, and it is settled and archived.
- [x] A dropped stream reconnects, meters every request once, and still answers a pending submission.
- [x] A submission whose sha256 does not match is refused and the corrected one accepted; an oversize patch file is refused without being downloaded.
- [x] A second refused patch ends the session as `patch_rejected`, with nothing written.
- [x] `validateAndApply` refuses, writing nothing, each of: a file outside the lane, a kernel path, a symlink, a gitlink, a rename, a binary, a patch that does not apply, an empty patch, a `..` or `.git` segment, too many bytes, too many files.
- [x] A re-queued card with a stored patch is rebuilt and merged with no session and no new ledger row. A stored patch that no longer applies pauses the card as `patch_conflict`, is discarded, and starts no session.
- [x] Each model request is one ledger row under its event id, with a runtime row and a settle row up to the list cost. A re-meter writes nothing twice, an overcount writes nothing, and a session with an unwritten row is left for recovery.
- [x] `runAgentSession` on the managed adapter bills from the adapter's rows alone, with no settle of its own.
- [x] The startup probe is one minimal session billed as `overhead` with no card and no role. The probe is fatal when the agent drifted and transient when the API is overloaded.
- [x] Recovery interrupts, meters, stores an unanswered patch, settles and archives every open session before it pauses cards, and a second pass writes nothing. When the sessions cannot be listed, it pauses every building card as `session_unsettled` and alerts.
- [x] Production smoke runs no card code. A seed card passes only when every served file equals the merge commit byte for byte and the gate is green at the merge sha; one differing byte rolls it back.
- [x] The dispatcher image installs no claude CLI, no sandbox tools and no Claude Code settings.
- [x] Every workflow that runs card code reads contents only, persists no checkout credential and uses no secret.
- [x] `provision.sh` requires `GITHUB_READ_TOKEN` and the managed ids, refuses an equal or non-fine-grained token, and proves the read token is denied a write.
- [x] Attended sessions pass `--settings` with the sandbox on and no way out, reads and writes limited as above, git with no global configuration, and Edit and Write scoped to the worktree.
- [x] On the Mac with Claude Code 2.1.139, a real attended session cannot do any of the following, even when it asks to leave the sandbox:
  - read the SSH key, `.env` or `.env.vps`;
  - read the GitHub token in the keychain;
  - reach an external host.

  The Read tool is denied `.env`, and the seed-1 test, typecheck and bot pass inside the sandbox.
- [ ] `managed:apply` creates `peanutgallery-writer` and `peanutgallery-cards` in the studio organization and prints the three ids. (waits on: the board's allow)
- [ ] `managed:apply --check` creates and archives a one-cent session with the repository mounted at main. (waits on: GITHUB_READ_TOKEN creation; Console credit if the API refuses an organization with none)
- [ ] `provision.sh` on the VPS proves the real read token is denied a write. (waits on: GITHUB_READ_TOKEN creation, cutover)
- [ ] `probe.ts --toolchain` prints `PASS: toolchain`. (waits on: Console credit, cutover)
- [ ] The VPS journal shows `containment verified`, then `startup probe passed` with `"billed_to":"overhead"`. (waits on: Console credit, cutover, TOTP)
- [ ] The first funded card runs as a managed session, and its ledger rows are one per request plus a runtime row and a settle row, all `billed_to = 'studio'`. (waits on: Console credit, cutover)

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/dispatcher test`, which runs the managed, managed-meter, managed-config, patch, recovery-managed, smoke, unattended, startup, attended, factory, config, pipeline and tick tests.
- `pnpm test:ops`, which runs the env file keys, provision's read-token checks, `read_token_verdict`, `check_ref`, the image with no claude, and the workflow audit.
- `SANDBOX_CHECK_REPO_ROOT=<the Mac's checkout> pnpm --filter @backseat/dispatcher sandbox:check --positive` on the Mac. The first line must read `PASS: attended sandbox`.
- Live, in the order of Production steps: the `managed:apply` output, the `--check` output, `provision.sh`'s read-token line, `PASS: toolchain`, the journal lines, and the first card's ledger rows, each quoted here.

## Evidence

The card-session fixture `test/fixtures/managed-session.json` is derived from the Managed Agents documentation's event shapes, not recorded from a live session. No live session has run: the studio organization has no credit.

`pnpm verify` at the worktree root exited 0. The result lines:

```
platform/supabase test:       Tests  146 passed (146)
seed-1 test:       Tests  77 passed (77)
platform/site test:       Tests  163 passed (163)
platform/dispatcher test:       Tests  463 passed (463)
platform/gate test: PASS: gate tests passed=213
$ node --test platform/agents/specs.test.mjs        ℹ pass 64  ℹ fail 0
$ node --test platform/ops/test/ops.test.mjs        ℹ pass 44  ℹ fail 0
$ deno test ... platform/supabase/functions         ok | 71 passed (47 steps) | 0 failed
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=331
$ node --test docs/docs.test.mjs                    ℹ pass 4  ℹ fail 0
```

`bash platform/gate/secret-scan.sh --working-tree`, which also covers the files this change adds before they are committed: `PASS: secret-scan files=350`.

The files this change adds or rewrites, run alone:

```
 Test Files  11 passed (11)
      Tests  158 passed (158)
```

Criteria to tests:
- Agent and environment files, and the `managed:apply` planner: `managed-config.test.ts` (the `agent.yaml`, `environment.yaml` and `managed:apply` groups).
- Config: `config.test.ts` "the managed agent settings" (required one by one, equal tokens refused in either mode, non-fine-grained refused).
- Containment: `managed.test.ts` "containment", eleven tests, one per refusal. The read-token probe itself is in `managed-config.test.ts` "checkReadToken".
- Card sessions: `managed.test.ts` "a card session". It covers idle creation, id before spend, the sha256 retry, `patch_rejected`, the oversize refusal, the budget in cents, `budget_reached`, interrupt, reconnect, web-tool refusal, repository skills, and the read token that can write.
- Patch checks: `patch.test.ts` (`validateAndApply`, `patchTextProblem`, `reportProblem`, `applyStoredPatch`).
- Stored patches in the pipeline: `pipeline.test.ts` "is rebuilt from the patch at the new base and merged with no session and no new ledger row", and "pauses as patch_conflict, discards the patch and starts no session when the patch no longer applies".
- Metering: `managed-meter.test.ts`, and `managed.test.ts` "runAgentSession on the managed adapter".
- Probe: `managed.test.ts` "the startup probe"; `startup.test.ts` "in unattended mode checks containment, then runs the managed probe" and "refuses, exit 78, an adapter that is not the managed one".
- Recovery: `managed.test.ts` "orphan sessions" and `recovery-managed.test.ts`.
- Smoke: `smoke.test.ts` (the build, gate and seed config groups, and `mergedServedFiles`); `pipeline.test.ts` "smokes a seed card without running card code" and "rolls a seed card back when a served file differs from the merge commit by one byte".
- Image, provision and CI: `ops.test.mjs` "the image installs no claude CLI, no sandbox tools and no Claude Code settings", "provision.sh read_token_verdict", and "the CI workflows that run card code"; `unattended.test.ts` "has no process-spawn path".
- Attended settings: `attended.test.ts` "the attended sandbox", five tests.

The attended sandbox, live on the Mac, `sandbox:check --positive` against Claude Code 2.1.139 with `claude-haiku-4-5`. The attempts are listed twice: first as plain Bash, then retried with `dangerouslyDisableSandbox`:

```
PASS: attended sandbox
targets present outside the sandbox: id_ed25519=true, .env=true, .env.vps=true
bash sandbox: attempt=ssh-key outcome=blocked detail=EPERM
bash sandbox: attempt=repo-env outcome=blocked detail=EPERM
bash sandbox: attempt=repo-env-vps outcome=blocked detail=EPERM
bash sandbox: attempt=keychain-gh-token outcome=blocked detail=exit-44
bash sandbox: attempt=external-fetch outcome=blocked detail=ENOTFOUND
bash sandbox: attempt=ssh-key outcome=blocked detail=EPERM
bash sandbox: attempt=repo-env outcome=blocked detail=EPERM
bash sandbox: attempt=repo-env-vps outcome=blocked detail=EPERM
bash sandbox: attempt=keychain-gh-token outcome=blocked detail=exit-44
bash sandbox: attempt=external-fetch outcome=blocked detail=ENOTFOUND
bash calls the session made: 2
read tool: 1 call(s), blocked; permission denials reported: 0; result: <tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>
positive: seed-1 tests passed:  Test Files  9 passed (9) |       Tests  77 passed (77)
positive: seed-1 typecheck exited 0
positive: seed-1 bot passed: PASS: 4 of 4 invariants hold over 36000 simulated seconds
positive: node_modules installed before the session: true
```

Outside the sandbox, the same keychain item read exits 0 and the same fetch returns HTTP 200, so the blocks above are the sandbox's.

## Production steps (need the board's allow)

Nothing below has run. Each writes to the studio's Anthropic organization, GitHub or the VPS.

1. Create `GITHUB_READ_TOKEN`: fine-grained, this repository only, Contents read only (`platform/ops/README.md`, Provision step 3). Put it in the Mac's `.env` and export it for `make-dispatcher-env.sh`.
2. On the Mac, `pnpm --filter @backseat/dispatcher managed:apply`. Put the printed `MANAGED_AGENT_ID`, `MANAGED_AGENT_VERSION` and `MANAGED_ENVIRONMENT_ID` in the Mac's `.env`, and quote the output here.
3. `pnpm --filter @backseat/dispatcher managed:apply -- --check`, quoted. If the API refuses an organization with no credit, the refusal is quoted and this step moves to after the credit purchase.
4. Regenerate the VPS env file with `make-dispatcher-env.sh`, which now carries `GITHUB_READ_TOKEN` and the three ids. Upload it and run `provision.sh` again. It must prove the read token is denied a write and end with `0 change(s)` on its second run.
5. At the cutover, after the studio organization has credit, run the toolchain check (README, Cutover step 4). Quote `PASS: toolchain`.
6. `systemctl start dispatcher`, and quote the journal's `containment verified` and `startup probe passed` lines.
7. Quote the ledger rows of the first funded card's session.

After any change to `platform/agents/managed/*.yaml`, run `managed:apply` again, set the new `MANAGED_AGENT_VERSION` in both env files, and rerun the toolchain check.

## Decisions

- 22 September 2026: unattended cards run as Claude Managed Agents sessions, not the Claude Code command line on the VPS (board). No agent-written code runs where the dispatcher's secrets are, and the container never holds the Anthropic key. This replaces the separate-uid follow-up in `vps.md`.
- 22 September 2026: one agent with per-session overrides (the model, and the system prompt from the repository at the base sha), not one agent per role. The role prompts and `CLAUDE.md` change with the repository; a per-role agent would drift from the commit a card builds on.
- 22 September 2026: the patch travels as a session output file and `submit_patch` carries its sha256 and byte count, not the diff. A diff in a tool call is bounded by the model's output and can be cut off; a file with a checksum cannot be half-delivered unnoticed.
- 22 September 2026: no `smoke.yml`. Production smoke checks the served build, the served config, served bytes against the merge commit and the gate at the merge sha. The gate already ran the bot on the same bytes, so running it again anywhere only repeats card code.
- 22 September 2026: the smoke's gate wait is bounded at 12 minutes and the card's smoke window at 15. A gate still running at the end is no verdict, and the card stays gated for the next start rather than being rolled back or passed.
- 22 September 2026: the budget keeps back one request: 150,000 cache-read and 8,192 output tokens at the model's price. The platform stops a session only after the request that crosses the limit, so the card's ceiling holds only if that request fits under it.
- 22 September 2026: cache writes are metered at the five-minute rate, and the settle row brings each session to its reported list cost. The request events do not say which cache duration was written; the list cost is the amount billed.
- 22 September 2026: unattended mode requires both GitHub tokens to be fine-grained (`github_pat_`), and refuses a read token GitHub would let write. `main` has no branch protection, and the sessions' git proxy forwards REST calls with the read token.
- 22 September 2026: a toolchain check (`probe.ts --toolchain`) runs once at the cutover and after any environment or agent change, billed as overhead. The startup probe proves the agent answers; only a session that installs and runs the bot proves the environment can build a card.
- 22 September 2026: `platform/ops/managed-settings.json` is deleted with the CLI. `deploy.sh`'s roll-back check now requires the read-only code mount string in the target's unit instead of the settings file.
- 22 September 2026: the attended sandbox also allows reading the repository's `.git` and one unix socket, tsx's IPC folder. The card's scripts run git in a worktree whose data lives in `.git`, and the seed bot's tsx needs the socket. Neither holds a credential: the dispatcher's token travels in git's environment, never in a file.
- 22 September 2026: the installed Claude Code 2.1.139 supports every sandbox setting this uses, as `sandbox:check` shows, so no update is needed before attended runs.
- 22 September 2026: `sandbox:check` is a script run by hand on the Mac, not part of `pnpm verify`. It spends on the founder's plan and needs a real CLI, keychain and SSH key.
