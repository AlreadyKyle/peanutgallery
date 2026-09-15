# The dispatcher on a VPS, unattended, with alerts

Status: agreed. Card: none. Owner: board.

## Problem

The dispatcher runs on the founder's Mac in attended mode. A public studio needs it running around the clock on the studio's API key, spending only funded money, restarting on its own, and telling the board when it stops or a card fails.

## Scope

In:
- A Hetzner VPS with Docker and systemd.
- The dispatcher image with the `claude` CLI pinned, over a bind-mounted clone of the repository.
- Startup exit codes that stop systemd from restarting a failure that cannot recover.
- Child processes and git hooks that cannot read the dispatcher's secrets.
- A seed that cannot flip the live agent mode.
- A provisioning script, an env file generator, a deploy script and two systemd units.
- The healthchecks.io check and the ntfy topic.
- Cutover from the Mac, and a 24-hour soak.
- A runbook in `platform/ops/README.md`.

Out: OBS, the stream, the host, Twitch, a separate OS user for agent sessions (see Known risk).

## Behaviour

**Host.** Ubuntu 24.04 on x86 (Hetzner CX22 or CPX21). Its systemd 255 supports `RestartSteps`.

**Repository.** The repository is cloned over https at `/srv/peanutgallery`, owned by uid 10001, and bind-mounted at the same path in the container. Git worktree metadata lives in the clone's `.git`, so it survives container restarts, and a code update is a fast-forward plus a restart. The image holds only the toolchain.

**GitHub access.** A fine-grained token for this repository only: Contents read/write, Pull requests read/write, Checks read, Metadata read, no Workflows. The dispatcher already pushes with a one-off https extraheader; the clone and the deploy fetch use the same header for one command and never store it on disk.

**Image.** `platform/ops/Dockerfile.dispatcher`, built with `platform/ops` as the context:
- `FROM node:22-bookworm-slim`, not alpine: the claude CLI's bundled ripgrep needs glibc. The README records how to pin the base by digest at provision time.
- `ARG CLAUDE_CODE_VERSION=2.1.139`, the version on the Mac and in the probe fixture; `ARG PNPM_VERSION=11.0.9`.
- apt installs git, ca-certificates and tini. `npm install -g` installs the claude CLI and pnpm at those versions (not corepack: a root corepack cache is invisible to the non-root user).
- User `agent`, uid and gid 10001, with the git identity "Peanut Gallery agents" <agents@peanutgallery.games>.
- `CLAUDE_BIN=/usr/local/bin/claude`, `DISABLE_AUTOUPDATER=1`, `CI=true`, and the pnpm store on the bind mount at `/srv/peanutgallery/.pnpm-store`. No `NODE_ENV=production`, which drops devDependencies such as tsx.
- `WORKDIR /srv/peanutgallery`; tini runs `platform/ops/dispatcher-entrypoint.sh`, copied into the image.

**Entrypoint.** Checks that `claude --version` is `$CLAUDE_CODE_VERSION` and that `origin` is an https github.com URL, runs `pnpm install --frozen-lockfile --prefer-offline` with no secret in its environment, then execs the dispatcher from `platform/dispatcher`.

**Service.** `platform/ops/dispatcher.service` runs the container with `docker run --rm` as 10001:10001, all capabilities dropped, no new privileges, 3 GB of memory, 512 pids and 10 MB logs. It restarts always, with a delay growing from 30 seconds to 30 minutes over 6 steps, at most 8 starts in 6 hours, and never after exit 78. It waits 90 seconds to stop. On failure it starts `dispatcher-alert.service`, a oneshot that posts "Peanut Gallery dispatcher unit failed on <hostname>" to the URL in `/etc/peanutgallery/ntfy.url`, and does nothing when that file is absent.

**Env file.** `/etc/peanutgallery/dispatcher.env`, root 0600, read only by docker's `--env-file`: `KEY=value`, no quotes, no `export`, JSON minified on one line. No systemd `EnvironmentFile`, which strips quotes and would corrupt `PRICE_TABLE_JSON`. It carries:
- `AGENT_MODE=unattended` and `STUDIO_ANTHROPIC_API_KEY`
- `GITHUB_REPO` and the VPS's own `GITHUB_TOKEN`
- the Netlify token and both site ids
- the Supabase URL and service key (the secret key when the Mac's `.env` has one)
- `PRICE_TABLE_JSON`, `MODEL_BUILDER`
- `HEALTHCHECK_URL`, `NTFY_TOPIC_URL`
- any optional dispatcher setting the Mac's `.env` sets

It never carries `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_ACCESS_TOKEN` or `ANTHROPIC_API_KEY`. `platform/ops/make-dispatcher-env.sh` writes it on the Mac from the repository `.env` and the operator's `VPS_GITHUB_TOKEN`, `HEALTHCHECK_URL` and `NTFY_TOPIC_URL`, and never prints a secret.

**Exit codes.** A startup failure that cannot change on retry exits 78, so systemd does not restart it and re-meter the probe:
- a `ConfigError` from `loadConfig`
- a probe verdict of forbidden tools, registered memory paths, the wrong `apiKeySource`, or no tools

A transient failure exits 1 and backs off: a probe with no stream, no init line or an error result, a spawn failure, and a `studio_state.agent_mode` mismatch (fixing it from /board costs nothing).

**Secrets and child processes.** The smoke test's headless bot runs agent-written seed code, so it runs with the same allowlisted environment as an agent session. Every git command the dispatcher runs passes `-c core.hooksPath=/dev/null`, so a hook planted by agent-written code never runs with the dispatcher's environment.

**Seed.** `seed.ts` inserts `studio_state` row 1 only when it is missing, reads it back and logs the live values. When `.env`'s `AGENT_MODE` or caps differ from the live row it prints a warning and writes nothing. Running the seed from the Mac after cutover never flips the VPS back to attended.

**Provisioning.** `platform/ops/provision.sh` runs as root over SSH. It is idempotent: every step checks before it acts.
1. apt installs git, ufw, unattended-upgrades, curl and jq.
2. A 2 GB swapfile when there is no swap.
3. Docker from Docker's apt repository when absent, enabled.
4. ufw denies incoming and limits OpenSSH. No container port is published; Docker's `-p` bypasses ufw, so the Hetzner Cloud firewall matches it.
5. An sshd drop-in: no password authentication, root by key only.
6. unattended-upgrades with no automatic reboot, and needrestart listing only.
7. The https clone at `/srv/peanutgallery` when missing, with `.pnpm-store` and `.worktrees` in `.git/info/exclude`.
8. It stops and asks for the env file when it is missing, then validates it: root 0600, no quoted value, `AGENT_MODE=unattended`, the keys `config.ts` requires, `PRICE_TABLE_JSON` parsing in node, and none of the four forbidden keys.
9. It builds `peanutgallery/dispatcher:<sha>` and `:current`, installs both units, reloads systemd and enables the dispatcher. It never starts it: starting is the cutover.

**Deploy.** `platform/ops/deploy.sh` runs as root on the VPS. It refuses unless `studio_state.paused` is true and no card is `building` or `gated`, read through the service key. It fast-forwards the clone to `origin/main` inside the image as uid 10001, rebuilds the image only when `platform/ops` changed, reinstalls changed units, restarts the service, waits for `startup probe passed` in the journal, and reminds the operator to resume from /board.

**Cutover.**
1. Pause from /board.
2. Stop the Mac dispatcher.
3. Set agent mode to unattended from /board (with the board's second factor once `launch-pages.md` ships it).
4. `systemctl start dispatcher`.
5. The startup probe passes with `apiKeySource` `ANTHROPIC_API_KEY` and bills the studio.
6. Resume from /board.

**Money guardrail.** The studio Console organization holds prepaid credit with auto-reload off and a $500 monthly limit. The board tops it up by hand as Stripe payouts arrive, so API spend can never outrun customer money.

**Known risk.** Agent-written test code runs as the dispatcher's OS user and could read the dispatcher's environment from `/proc`. In place: the allowlisted child environment for sessions, the smoke bot and the install; git hooks off; the Console limit. The follow-up, a separate uid for agent sessions through a sudo wrapper at `CLAUDE_BIN`, is specified before any card source other than the board opens.

## Acceptance criteria

- [ ] A `ConfigError` exits 78; a probe failure for forbidden tools, memory paths, the wrong `apiKeySource` or no tools exits 78; a probe with no stream, no init line or an error result, a spawn failure and a mode mismatch exit 1.
- [ ] The smoke bot's environment is the allowlisted child environment, and `GITHUB_TOKEN` and the Supabase keys are absent from it.
- [ ] Every git command in `worktree.ts` passes `core.hooksPath=/dev/null`, and a hook planted in a repository does not run on commit.
- [ ] `seed.ts` inserts `studio_state` with ignore-duplicates, never updates it, and warns without writing when `.env`'s mode or caps differ from the live row.
- [ ] `make-dispatcher-env.sh` writes exactly the dispatcher's keys at mode 0600, with `AGENT_MODE=unattended`, the VPS token, the secret key preferred and one-line `PRICE_TABLE_JSON`; it prints no secret value and refuses when an operator variable is missing or the VPS token equals the Mac's.
- [ ] The new shell scripts pass `bash -n`, and `shellcheck` where it is installed.
- [ ] `provision.sh`'s required keys equal the keys `config.ts` requires plus the studio key and both alert URLs.
- [ ] Every file under `platform/ops` is under a kernel path.
- [ ] `platform/ops/README.md` covers provision, cutover, deploy an update, rotate a key, read logs, pause from /board, roll back, the money guardrail and the known risk.
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
- `node --test platform/ops/test/*.test.mjs` through the root verify: the env file transform, `bash -n` on every script, the required key list and kernel coverage.
- On the VPS: `provision.sh` output from two runs, `systemd-analyze verify /etc/systemd/system/dispatcher.service /etc/systemd/system/dispatcher-alert.service`, quoted.
- `journalctl -u dispatcher -n 50`, quoted, showing `startup probe passed` with `apiKeySource` `ANTHROPIC_API_KEY`.
- The restart and reboot checks, with `select paused, dispatcher_seen_at from studio_state` quoted.
- The healthchecks.io alert email and the ntfy messages, screenshotted.
- The first unattended card's ledger rows quoted.

## Decisions

- 2026-09-14: a small Hetzner VPS rather than the Mac (board). The agents stop when a Mac sleeps.
- 2026-09-14: healthchecks.io for liveness, ntfy for events (`launch-hardening.md`).
- 2026-09-15: Ubuntu 24.04 on x86, Hetzner CX22 or CPX21 (board). systemd 255 has `RestartSteps`.
- 2026-09-15: a bind-mounted host clone, not a `COPY` of the repository (board). Worktree metadata survives restarts and an update is a fast-forward plus a restart.
- 2026-09-15: a fine-grained GitHub token for this repository replaces the deploy key (board). The dispatcher's https push already needs a token, and no Workflows permission means no agent branch can change the gate workflow through it.
- 2026-09-15: `node:22-bookworm-slim`, the claude CLI and pnpm through `npm install -g` at pinned versions, and no `NODE_ENV=production` (board). The CLI's ripgrep needs glibc, corepack's root cache is invisible to uid 10001, and tsx is a devDependency.
- 2026-09-15: docker's env file is the only reader of the secrets (board). systemd's `EnvironmentFile` strips quotes.
- 2026-09-15: exit 78 for startup failures that cannot recover, and `RestartPreventExitStatus=78` (board). A restart loop would re-meter the probe on every start.
- 2026-09-15: the smoke bot runs with the child allowlist and git runs with hooks off (board). Both run agent-written code or files next to the dispatcher's secrets.
- 2026-09-15: the seed inserts `studio_state` only when missing (board). The board sets the mode from /board; a stale `.env` on the Mac must not undo it.
- 2026-09-15: the separate uid for agent sessions is a follow-up, specified before any card source other than the board opens (board). Today every card comes from the board.

## Needs the board

A Hetzner Ubuntu 24.04 instance and its IP, the healthchecks.io check URL, the ntfy topic, a fine-grained GitHub token for this repository, and prepaid credit on the studio Console organization.
