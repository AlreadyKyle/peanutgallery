# The dispatcher on a VPS, unattended, with alerts

Status: built. Card: none. Owner: board.

## Problem

The dispatcher runs on the founder's Mac in attended mode. A public studio needs it running around the clock on the studio's API key, spending only funded money, restarting on its own, and telling the board when it stops or a card fails.

## Scope

In:
- An always-free Oracle Cloud instance with Docker and systemd.
- The dispatcher image ~~with the `claude` CLI pinned~~ (superseded: the image holds no claude CLI, and unattended cards run as Claude Managed Agents sessions, `launch-managed.md`, 22 September 2026), ~~over a bind-mounted clone of the repository~~. Superseded: `ops-separation.md` runs it from a read-only code clone beside a work clone (2026-09-16).
- Startup exit codes that stop systemd from restarting a failure that cannot recover.
- Child processes and git hooks that cannot read the dispatcher's secrets. Under `launch-managed.md` no agent-written code runs on the VPS at all.
- A seed that cannot flip the live agent mode.
- A provisioning script, an env file generator, a deploy script and two systemd units.
- The healthchecks.io check and the ntfy topic.
- Cutover from the Mac, and a 24-hour soak.
- A runbook in `platform/ops/README.md`.

Out: OBS, the stream, the host, Twitch, a separate OS user for agent sessions (see Known risk).

## Behaviour

**Host.** Ubuntu 24.04 with systemd 255, which supports `RestartSteps`. The board's instance is an Oracle Cloud Always Free Ampere shape in Toronto (`ca-toronto-1`): 2 arm64 cores and 12 GB of memory, the Always Free limit, at no cost, in Canada (corrected by `money-safety.md`: Oracle's allowance is 1,500 OCPU-hours and 9,000 GB-hours a month, which it equates to 2 OCPUs and 12 GB; the shape this spec first named was larger than that). The image, the units and the scripts are the same on arm64 and x86, so any Ubuntu 24.04 host with Docker works.

**Repository.** ~~The repository is cloned over https at `/srv/peanutgallery`, owned by uid 10001, and bind-mounted at the same path in the container. Git worktree metadata lives in the clone's `.git`, so it survives container restarts, and a code update is a fast-forward plus a restart.~~ Superseded: `ops-separation.md` keeps `/srv/peanutgallery` as uid 10001's work clone for git state only, runs the dispatcher from a root-owned code clone at `/srv/peanutgallery-code` mounted read-only at `/opt/peanutgallery`, and puts worktrees in `/srv/peanutgallery-worktrees` (2026-09-16). The image holds only the toolchain.

**GitHub access.** A fine-grained token for this repository only: Contents read/write, Pull requests read/write, Checks read, Metadata read, no Workflows. `launch-managed.md` adds a second fine-grained token, `GITHUB_READ_TOKEN`, Contents read only, which Managed Agents sessions clone with; the dispatcher and `provision.sh` refuse it unless GitHub denies it a write. The dispatcher already pushes with a one-off https extraheader; the clone and the deploy fetch use the same header for one command and never store it on disk.

**Image.** `platform/ops/Dockerfile.dispatcher`, built with `platform/ops` as the context:
- `FROM node:22-bookworm-slim`, not alpine: the claude CLI's bundled ripgrep needs glibc. The README records how to pin the base by digest at provision time.
- ~~`ARG CLAUDE_CODE_VERSION=2.1.139`, the version on the Mac and in the probe fixture;~~ (superseded: no claude CLI, `launch-managed.md`) `ARG PNPM_VERSION=11.0.9`.
- apt installs git, ca-certificates and tini. `npm install -g` installs ~~the claude CLI and~~ pnpm at ~~those versions~~ its version (not corepack: a root corepack cache is invisible to the non-root user).
- User `agent`, uid and gid 10001, with the git identity "Peanut Gallery agents" <agents@peanutgallery.games>.
- ~~`CLAUDE_BIN=/usr/local/bin/claude`, `DISABLE_AUTOUPDATER=1`,~~ (superseded: no claude CLI, `launch-managed.md`) `CI=true`, and ~~the pnpm store on the bind mount at `/srv/peanutgallery/.pnpm-store`~~ (superseded: `ops-separation.md` puts it in the code clone at `/opt/peanutgallery/.pnpm-store`, 2026-09-16). No `NODE_ENV=production`, which drops devDependencies such as tsx.
- ~~`WORKDIR /srv/peanutgallery`~~ (superseded: `WORKDIR /opt/peanutgallery`, `ops-separation.md`, 2026-09-16); tini runs `platform/ops/dispatcher-entrypoint.sh`, copied into the image.

**Entrypoint.** Checks ~~that `claude --version` is `$CLAUDE_CODE_VERSION` and~~ (superseded: no claude CLI, `launch-managed.md`) that `origin` is an https github.com URL, ~~runs `pnpm install --frozen-lockfile --prefer-offline` with no secret in its environment, then execs the dispatcher from `platform/dispatcher`~~. Superseded: `ops-separation.md` installs nothing in the entrypoint, checks the work clone's origin, and execs the dispatcher from the read-only code clone (2026-09-16).

**Service.** `platform/ops/dispatcher.service` runs the container with `docker run --rm` as 10001:10001, all capabilities dropped, no new privileges, 3 GB of memory, 512 pids and 10 MB logs. It restarts always, with a delay growing from 30 seconds to 30 minutes over 6 steps, at most 8 starts in 6 hours, and never after exit 78. It waits 90 seconds to stop. `docker stop` gives the container 60 of them, and the dispatcher waits up to 50 for a running card: SIGINT to the session, SIGTERM 15 seconds later, SIGKILL 5 after that, then the settle rows and the pause. On failure it starts `dispatcher-alert.service`, a oneshot that posts "Peanut Gallery dispatcher unit failed on <hostname>" to the URL in `/etc/peanutgallery/ntfy.url`, and does nothing when that file is absent.

**Env file.** `/etc/peanutgallery/dispatcher.env`, root 0600, read only by docker's `--env-file`: `KEY=value`, no quotes, no `export`, JSON minified on one line. No systemd `EnvironmentFile`, which strips quotes and would corrupt `PRICE_TABLE_JSON`. It carries:
- `AGENT_MODE=unattended` and `STUDIO_ANTHROPIC_API_KEY`
- `GITHUB_REPO` and the VPS's own `GITHUB_TOKEN`, and (`launch-managed.md`) `GITHUB_READ_TOKEN`
- the Netlify token and both site ids
- the Supabase URL and service key (the secret key when the Mac's `.env` has one)
- `PRICE_TABLE_JSON`, `MODEL_BUILDER`
- (`launch-managed.md`) `MANAGED_AGENT_ID`, `MANAGED_AGENT_VERSION`, `MANAGED_ENVIRONMENT_ID`
- `HEALTHCHECK_URL`, `NTFY_TOPIC_URL`
- any optional dispatcher setting the Mac's `.env` sets, except the two paths that exist only on the Mac (`CLAUDE_BIN`, `DISPATCHER_WORKTREE_ROOT`)

It never carries `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_ACCESS_TOKEN` or `ANTHROPIC_API_KEY`. `platform/ops/make-dispatcher-env.sh` writes it on the Mac from the repository `.env` and the operator's `VPS_GITHUB_TOKEN`, `HEALTHCHECK_URL` and `NTFY_TOPIC_URL`, and never prints a secret.

**Exit codes.** A startup failure that cannot change on retry exits 78, so systemd does not restart it and re-meter the probe:
- a `ConfigError` from `loadConfig`
- ~~a probe verdict of forbidden tools, registered memory paths, the wrong `apiKeySource`, or no tools~~ (superseded, `launch-managed.md`: a managed agent or environment that differs from `platform/agents/managed/`, a read token GitHub would let write, a probe session whose agent drifted, an unpriced probe model, or probe rows the ledger refused)

A transient failure exits 1 and backs off: ~~a probe with no stream, no init line or an error result, a spawn failure,~~ (superseded: an API that does not answer, or a probe session that stops without a reply, `launch-managed.md`) and a `studio_state.agent_mode` mismatch (fixing it from /board costs nothing).

**Secrets and child processes.** ~~The smoke test's headless bot runs agent-written seed code, so it runs with the same allowlisted environment as an agent session.~~ Superseded: production smoke runs no card code, only the served build, the served config, the served bytes against the merge commit and the gate at the merge sha (`launch-managed.md`). Every git command the dispatcher runs passes `-c core.hooksPath=/dev/null`, so a hook planted by agent-written code never runs with the dispatcher's environment.

**Seed.** `seed.ts` inserts `studio_state` row 1 only when it is missing, reads it back and logs the live values. When `.env`'s `AGENT_MODE` or caps differ from the live row it prints a warning and writes nothing. Running the seed from the Mac after cutover never flips the VPS back to attended.

**Provisioning.** `platform/ops/provision.sh` runs as root over SSH. It is idempotent: every step checks before it acts.
1. apt installs git, ufw, unattended-upgrades, curl and jq.
2. A 2 GB swapfile when there is no swap.
3. Docker from Docker's apt repository when absent, enabled.
4. ufw denies incoming and limits OpenSSH. No container port is published; Docker's `-p` bypasses ufw, so the provider's own firewall (an Oracle security list) matches it, and the instance's pre-installed iptables rules are left as they are.
5. An sshd drop-in: no password authentication, root by key only.
6. unattended-upgrades with no automatic reboot, and needrestart listing only.
7. ~~The https clone at `/srv/peanutgallery` when missing, with `.pnpm-store` and `.worktrees` in `.git/info/exclude`.~~ Superseded: `ops-separation.md` creates the root-owned code clone, the uid 10001 work clone (cloned inside the image) and the worktree folder, installs `node_modules` in a throwaway container, and builds the image and installs the units from the commit (2026-09-16).
8. It stops and asks for the env file when it is missing, then validates it: root 0600, no quoted value, `AGENT_MODE=unattended`, the keys `config.ts` requires, `PRICE_TABLE_JSON` parsing in node, and none of the four forbidden keys.
9. It builds `peanutgallery/dispatcher:<sha>` and `:current`, installs both units, reloads systemd and enables the dispatcher. It never starts it: starting is the cutover.

**Deploy.** `platform/ops/deploy.sh` runs as root on the VPS. It refuses unless `studio_state.paused` is true and no card is `building` or `gated`, read through the service key. ~~It fast-forwards the clone to `origin/main` inside the image as uid 10001, rebuilds the image only when `platform/ops` changed, reinstalls changed units,~~ Superseded: `ops-separation.md` works in the code clone only, refuses it when dirty, fast-forwards it (or checks out `--ref`), builds from `git archive`, installs `node_modules` in a throwaway container and units from `git show` (2026-09-16). It restarts the service, waits for `startup probe passed` in the journal, and reminds the operator to resume from /board.

**Cutover.**
1. Pause from /board.
2. Stop the Mac dispatcher.
3. Set agent mode to unattended from /board, with the board's second factor once the `launch-pages.md` migration is applied to the live project.
4. `systemctl start dispatcher`.
5. The startup probe passes with `apiKeySource` `ANTHROPIC_API_KEY` and ~~bills the studio~~ (superseded: after the containment check and the toolchain check, it is a managed session billed as `overhead`, `launch-managed.md`).
6. Resume from /board.

**Money guardrail.** The studio Console organization holds prepaid credit with auto-reload off and a $500 monthly limit. The board tops it up by hand as Stripe payouts arrive, so API spend can never outrun customer money.

**Known risk.** ~~Agent-written test code runs as the dispatcher's OS user and could read the dispatcher's environment from `/proc`. In place: the allowlisted child environment for sessions, the smoke bot and the install; git hooks off; the Console limit. The follow-up, a separate uid for agent sessions through a sudo wrapper at `CLAUDE_BIN`, is specified before any card source other than the board opens.~~ Superseded by `launch-managed.md` (22 September 2026): agent-written code runs only in a Managed Agents container Anthropic hosts, and the VPS applies the returned patch as data and runs none of it. The VPS is now mostly idle, which is the pattern Oracle reclaims on Always Free; `platform/ops/README.md` (Oracle idle reclaim) names the board's choice.

## Acceptance criteria

- [x] A `ConfigError` exits 78; ~~a probe failure for forbidden tools, memory paths, the wrong `apiKeySource` or no tools exits 78; a probe with no stream, no init line or an error result, a spawn failure~~ (superseded: the managed containment and probe exit codes, `launch-managed.md`) and a mode mismatch exit 1.
- [x] ~~The smoke bot's environment is the allowlisted child environment, and `GITHUB_TOKEN` and the Supabase keys are absent from it.~~ Superseded: no smoke bot runs on the VPS (`launch-managed.md`).
- [x] Every git command in `worktree.ts` passes `core.hooksPath=/dev/null`, and a hook planted in a repository does not run on commit.
- [x] `seed.ts` inserts `studio_state` with ignore-duplicates, never updates it, and warns without writing when `.env`'s mode or caps differ from the live row.
- [x] `make-dispatcher-env.sh` writes exactly the dispatcher's keys at mode 0600, with `AGENT_MODE=unattended`, the VPS token, the secret key preferred and one-line `PRICE_TABLE_JSON`; it prints no secret value and refuses when an operator variable is missing or the VPS token equals the Mac's.
- [x] The new shell scripts pass `bash -n`, and `shellcheck` where it is installed.
- [x] `provision.sh`'s required keys equal the keys `config.ts` requires plus the studio key and both alert URLs (with `launch-managed.md`, the read token and the three managed ids among them).
- [x] Every file under `platform/ops` is under a kernel path.
- [x] `platform/ops/README.md` covers provision, cutover, deploy an update, rotate a key, read logs, pause from /board, roll back, the money guardrail and the known risk.
- [ ] On the VPS, `provision.sh` runs twice and the second run changes nothing, and `systemd-analyze verify` passes on both units.
- [ ] The /board heartbeat shows under 3 minutes after cutover, and the healthchecks.io check is green.
- [ ] `systemctl restart dispatcher` leaves `studio_state.paused` false and the heartbeat resumes within 2 minutes; a reboot does the same.
- [ ] Stopping the container triggers the healthchecks.io alert email within its grace period.
- [ ] An env file without `PRICE_TABLE_JSON` leaves the unit failed after one start, with no restart, and posts the unit-failed ntfy message.
- [ ] A card funded by a real contribution builds with no board session and its ledger rows are `billed_to = 'studio'`.
- [ ] A rejected card posts one ntfy message.
- [ ] 24 hours pass with no restart loop and no unexpected alert.

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/dispatcher test` (exit-code, probe-core, startup, smoke and worktree tests) and `pnpm --filter @backseat/supabase test` (studio-state tests).
- `pnpm test:ops` (`node --test platform/ops/test/ops.test.mjs`, part of the root verify): the env file transform, provision.sh's env file checks, deploy.sh's refusal rule and request headers, `bash -n` on every script, the required key list and kernel coverage.
- On the VPS: `provision.sh` output from two runs, `systemd-analyze verify /etc/systemd/system/dispatcher.service /etc/systemd/system/dispatcher-alert.service`, quoted.
- `journalctl -u dispatcher -n 50`, quoted, showing `startup probe passed` with `apiKeySource` `ANTHROPIC_API_KEY`.
- The restart and reboot checks, with `select paused, dispatcher_seen_at from studio_state` quoted.
- The healthchecks.io alert email and the ntfy messages, screenshotted.
- The first unattended card's ledger rows quoted.

## Evidence

2026-09-15, built on branch `vps`, since merged as 49d6e33 (PR 22). Not yet deployed; no VPS exists:
- Exit codes: `exit-code.test.ts` (the mapping; `main.ts` spawned the way the entrypoint runs it exits 78 on a configuration error and logs `restart: false`), `probe-core.test.ts` (`verdict` marks no tools, forbidden tools, memory paths and the wrong `apiKeySource` fatal, and no stream, no init line and an error result not), `startup.test.ts` (a fatal probe failure and an unpriced model exit 78; a transient probe failure, a spawn failure and a mode mismatch exit 1).
- Smoke bot: `smoke.test.ts` "runs the bot with the agent session's allowlisted environment and none of the dispatcher's secrets".
- Hooks: `worktree.test.ts` "git hooks" (a planted hook runs without the switch, and none runs on add, diff, commit, rev-parse, status or worktree add with it, from `.git/hooks` or a configured hooks path).
- Seed: `studio-state.test.ts` drives supabase-js against a PostgREST stand-in: one POST with `resolution=ignore-duplicates` and one GET, a live unattended row stays unattended, and each difference prints a warning.
- Env file: `platform/ops/test/ops.test.mjs` "make-dispatcher-env.sh" (exact keys and order, mode 0600, the secret key preferred, one-line JSON, no value in the output, the refusals).
- Shell scripts: `ops.test.mjs` "parse with bash -n" (all four scripts; the entrypoint with `sh -n` and `dash -n` too). `shellcheck` is not installed on the machine that built this, so that test skipped.
- Required keys: `ops.test.mjs` "require the keys config.ts requires, plus the studio key and both alert URLs"; provision.sh's checks accept the generator's output and refuse ten bad variants.
- Kernel paths: `ops.test.mjs` "every file under platform/ops is under a kernel path"; `worktree.test.ts` keeps the dispatcher's list equal to `platform/gate/kernel-paths.txt`.
- Runbook: `platform/ops/README.md` has Provision, Cutover, Deploy an update, Roll back, Rotate a key, Read logs, Pause from /board, Exit codes and restarts, The money guardrail and Known risk.
- Pending live, on the VPS: the image build, both provision runs and `systemd-analyze verify`, the cutover probe, restart and reboot, both alerts, the exit-78 check, the first studio-billed card, the rejected-card message and the 24-hour soak.

## Decisions

- 2026-09-14: a small VPS rather than the Mac (board). The agents stop when a Mac sleeps.
- 2026-09-14: healthchecks.io for liveness, ntfy for events (`launch-hardening.md`).
- 2026-09-15: Ubuntu 24.04 with systemd 255, which has `RestartSteps` (board).
- ~~2026-09-15: a bind-mounted host clone, not a `COPY` of the repository (board). Worktree metadata survives restarts and an update is a fast-forward plus a restart.~~ Superseded: `ops-separation.md` (2026-09-16). The container ran the dispatcher from that clone, which uid 10001 owned, so agent-written code could change the code the next start ran with every secret, and root's deploy acted on the same tree. Still no `COPY`: the code is a root-owned host clone mounted read-only, and the work clone and worktree folder stay bind-mounted.
- 2026-09-15: a fine-grained GitHub token for this repository replaces the deploy key (board). The dispatcher's https push already needs a token, and no Workflows permission means no agent branch can change the gate workflow through it.
- 2026-09-15: `node:22-bookworm-slim`, ~~the claude CLI and~~ pnpm through `npm install -g` at ~~pinned versions~~ a pinned version, and no `NODE_ENV=production` (board). The CLI's ripgrep needs glibc, corepack's root cache is invisible to uid 10001, and tsx is a devDependency. (The claude CLI left the image with `launch-managed.md`, 22 September 2026.)
- 2026-09-15: docker's env file is the only reader of the secrets (board). systemd's `EnvironmentFile` strips quotes.
- 2026-09-15: exit 78 for startup failures that cannot recover, and `RestartPreventExitStatus=78` (board). A restart loop would re-meter the probe on every start.
- 2026-09-15: ~~the smoke bot runs with the child allowlist and~~ git runs with hooks off (board). Both run agent-written code or files next to the dispatcher's secrets. (Superseded for the smoke bot: none runs on the VPS, `launch-managed.md`.)
- 2026-09-15: the seed inserts `studio_state` only when missing (board). The board sets the mode from /board; a stale `.env` on the Mac must not undo it.
- ~~2026-09-15: the separate uid for agent sessions is a follow-up, specified before any card source other than the board opens (board). Today every card comes from the board.~~ Superseded: `launch-managed.md` (22 September 2026) moves agent sessions off the VPS.
- 2026-09-15: the image sets `pnpm_config_store_dir`, not `npm_config_store_dir`. pnpm 11.0.9 ignores the npm name: with it set, `pnpm store path` still printed the default store; with `pnpm_config_store_dir` it printed the override.
- 2026-09-15: a model missing from `PRICE_TABLE_JSON` at the startup probe exits 78, and a malformed `PRICE_TABLE_JSON` is a `ConfigError`. Both are the same on every start, and each start spends on a probe it cannot meter.
- 2026-09-15: the entrypoint's own checks (~~the claude CLI version,~~ the clone, the https origin) exit 78; ~~a failed `pnpm install` exits non-zero otherwise and is retried~~ (superseded: the entrypoint installs nothing, `ops-separation.md`, 2026-09-16).
- 2026-09-15: the unit runs `docker run --pull never` and its `ExecStop` ignores a container already gone. A same-named image is never fetched from a registry, and a stop after the container exited on its own does not fail the unit.
- 2026-09-15: the env file generator copies no `CLAUDE_BIN` or `DISPATCHER_WORKTREE_ROOT` from the Mac (paths on the Mac do not exist on the VPS), and refuses a `MODEL_BUILDER` with no price row. provision.sh also refuses duplicate keys, CRLF lines, a `GITHUB_REPO` other than the clone's, non-https URLs and an unpriced `MODEL_BUILDER`.
- 2026-09-15: the one-off GitHub header reaches git through `GIT_CONFIG_COUNT` variables, not `-c` on the command line, in provision.sh and deploy.sh, so the token is in no process list. provision.sh clones with the env file's `GITHUB_TOKEN` when none is passed, so the operator never types it on an ssh command line.
- 2026-09-15: deploy.sh also refuses while the unit is stopped (before the cutover a start would run a second dispatcher beside the Mac's) ~~and while the clone is off `main` (after a rollback)~~ (superseded: a roll back is `deploy.sh --ref <sha>`, and a plain deploy returns the code clone to `main`, `ops-separation.md`, 2026-09-16).
- 2026-09-15: the dispatcher's git commands keep the dispatcher's environment; only hooks are turned off. With hooks off git runs no program the repository supplies, and an allowlisted environment would drop the variables git needs on the Mac and in the tests.
- 2026-09-16: the host is an Oracle Cloud Always Free Ampere instance in Toronto rather than a paid Hetzner box (board). The studio has no budget and the pool holds customer money only, so a standing server cost cannot be funded yet; the free tier is in Canada and large enough. The cost of a paid host becomes a standing card if the free tier stops being enough.

## Needs the board

An Oracle Cloud Always Free Ubuntu 24.04 instance (Ampere, `ca-toronto-1`) and its IP, the healthchecks.io check URL, the ntfy topic, a fine-grained GitHub token for this repository, a second read-only one for Managed Agents sessions (`launch-managed.md`), and prepaid credit on the studio Console organization.
