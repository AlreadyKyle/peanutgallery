# Dispatcher on the VPS: runbook

The dispatcher runs unattended on a small Ubuntu server in a Docker container under systemd, on the studio's Anthropic key (`docs/specs/vps.md`). Each card's agent runs as a Claude Managed Agents session in a container Anthropic hosts (`docs/specs/launch-managed.md`): the VPS holds the session's event stream, meters it, applies the patch the agent hands back, and drives the gate, merge and deploy. No agent-written code runs on the VPS. This page is how the board provisions it, cuts over from the Mac, deploys, rotates keys, reads logs, pauses and rolls back.

**The host is GitHub Actions** (`docs/PLAN.md` §10 decision 61, `docs/specs/actions-host.md`): since 6 October 2026 the repository is public, its Actions minutes are free, and the dispatcher runs there one run of up to about six hours after another; [The GitHub Actions host](#the-github-actions-host) is its runbook. The daily jobs run on Actions in the board's private repository AlreadyKyle/mobmachine-ops (`ops-repo/README.md`). The board's Mac host is retired and its LaunchAgents are removed; [The Mac host](#the-mac-host) is kept for the record, and `backup-mac.sh` is the backup the ops repository runs. The server sections are kept for a paid always-on host once player money pays the overhead, which reuses this Ubuntu provisioning (`docs/BACKLOG.md`, Move the dispatcher off the Mac); the Oracle-specific parts are kept for the record and are not run.

## What runs where

- **Host.** Ubuntu 24.04, arm64 or x86, with Docker from Docker's apt repository, ufw, unattended upgrades and key-only SSH. The planned server is a Google Cloud Compute Engine e2-micro (1 GB of memory, so the container's memory limit drops with it); the Oracle Cloud Always Free Ampere shape this page was written for, 2 cores and 12 GB, is dropped. Everything below is the same on any Ubuntu 24.04 host.
- **Two clones and a worktree folder** (`docs/specs/ops-separation.md`). The dispatcher runs as uid 10001 and writes agent-supplied files into card worktrees, so nothing uid 10001 can write is ever run by root or loaded as the dispatcher's code.

  | Host path | Owner | In the container | Holds |
  |---|---|---|---|
  | `/srv/peanutgallery-code` | root, not writable by others | `/opt/peanutgallery`, read-only | the code clone: the dispatcher's code, `node_modules` and the pnpm store (`.pnpm-store`, excluded from git). Only `deploy.sh` and `provision.sh` change it. |
  | `/srv/peanutgallery` | uid 10001 | same path, read-write | the work clone: the git state the dispatcher fetches, pushes and adds worktrees from. Nothing runs from it, and root runs no git in it. |
  | `/srv/peanutgallery-worktrees` | uid 10001, 0700 | same path, read-write | card worktrees, where accepted patches are applied and committed. Their metadata lives in the work clone's `.git`, so both survive restarts. |

  The dispatcher starts with `DISPATCHER_CODE_READONLY=required` and exits 78 when it can write to its code root or its `node_modules`.
- **Image.** `peanutgallery/dispatcher:current` (also tagged with the commit it was built or deployed at), built from `git archive <sha>:platform/ops`, never from a working tree. It holds Node 22, git, tini and pnpm 11.0.9, and no claude CLI: no agent runs on the VPS. Its entrypoint checks the code clone and the work clone's https origin, and starts `platform/dispatcher/src/main.ts` from the code clone. It installs nothing.
- **Managed Agents.** One agent (`platform/agents/managed/agent.yaml`: bash, the five file tools and `submit_patch`; no web tool, MCP server or skill) and one environment (`environment.yaml`: a cloud container whose only egress is the package registries) in the studio's Console organization. The dispatcher runs with their ids and the agent's pinned version, and at every start refuses to run unless both match the files, the read-only token cannot write, and a probe session passes.
- **Secrets.** `/etc/peanutgallery/dispatcher.env`, root 0600, read only by `docker run --env-file`. Format: `KEY=value`, no quotes, no `export`, JSON on one line.
- **Units.** `dispatcher.service` runs the container. `dispatcher-alert.service` posts to ntfy when the dispatcher unit fails for good; it reads the topic URL from `/etc/peanutgallery/ntfy.url`.

| File | Runs on | Does |
|---|---|---|
| `make-dispatcher-env.sh` | the Mac | writes the env file from `.env` and four exported values |
| `provision.sh` | the VPS, as root | prepares the host, creates both clones and the worktree folder, validates the env file, builds, installs `node_modules`, installs and enables the units |
| `deploy.sh` | the VPS, as root, piped over ssh from the Mac's checkout | refuses a dirty or altered code clone, checks the gate on GitHub, prints a review and waits for a confirmed sha, fast-forwards the code clone to `origin/main` (or checks out `--ref <sha>`), rebuilds if `platform/ops` changed, reinstalls `node_modules`, restarts, waits for the probe |
| `Dockerfile.dispatcher`, `dispatcher-entrypoint.sh` | the VPS | the image |
| `platform/agents/managed/*.yaml`, `pnpm --filter @backseat/dispatcher managed:apply` | the Mac | the Managed Agents agent and environment, applied to the studio organization |
| `dispatcher.service`, `dispatcher-alert.service` | the VPS | the units |
| `make-jobs-env.sh` | the Mac | writes the three jobs' env files (Backups and the Controller, below) |
| `backup/backup.sh`, `peanutgallery-backup.service`, `.timer` | the VPS, as root | the nightly encrypted database backup and the weekly restore check |
| `jobs/main.mjs`, `peanutgallery-controller.service`, `.timer` | the VPS, in the image, as nobody | the Controller: the daily reconciliation with Stripe |
| `jobs/main.mjs`, `peanutgallery-quota.service`, `.timer` | the VPS, in the image, as nobody | the quota check: database size and Actions minutes |
| `peanutgallery-job-alert@.service` | the VPS | posts to ntfy when a job fails |
| `actions/run-dispatcher.sh`, `.github/workflows/dispatcher.yml` | GitHub Actions, this repository | the dispatcher's host (The GitHub Actions host, below) |
| `ops-repo/` | the private repository AlreadyKyle/mobmachine-ops | the daily jobs' workflow template and its README |
| `after-restore.sql` | the Mac, on a restored copy | what the migrations make outside the dumped schemas: the sign-in trigger, Realtime's tables, the backup login's reads and the pg_cron jobs |

## Operator inputs

The board supplies these; nothing in the repository holds them. Export them in the Mac shell for the steps below.

| Variable | What it is |
|---|---|
| `VPS_IP` | the instance's public IPv4 address |
| `VPS_GITHUB_TOKEN` | a fine-grained GitHub token for the VPS (below), not the Mac's `GITHUB_TOKEN` |
| `GITHUB_READ_TOKEN` | a second fine-grained GitHub token, Contents read only, that Managed Agents sessions clone with (below) |
| `HEALTHCHECK_URL` | the healthchecks.io ping URL for the VPS check |
| `NTFY_TOPIC_URL` | the ntfy topic URL, `https://ntfy.sh/<topic>` |

## Provision

1. **Create the instance.** Oracle Cloud, region `ca-toronto-1` (or `ca-montreal-1`): Always Free, shape `VM.Standard.A1.Flex` with 2 OCPUs and 12 GB (the Always Free limit; a larger shape is refused on a free tenancy and billed on Pay As You Go), image Ubuntu 24.04, the board's SSH key, no root password. `platform/ops/oracle-launch.sh` does all of this after one `oci session authenticate --region ca-toronto-1 --profile-name peanutgallery` (docs/specs/oracle-launch.md): it builds the network, retries "Out of host capacity" across availability domains, checks the firewall, gives root the same key as `ubuntu` so the `ssh root@` steps below work, and prints `VPS_IP=<address>`. Export that address as `VPS_IP`. On any other Ubuntu 24.04 host, which works unchanged, root may refuse ssh: run the steps as `ssh ubuntu@$VPS_IP sudo ...` there.
2. **Provider firewall.** Inbound: TCP 22 only. Outbound: everything. On Oracle that is the subnet's security list (its default already allows SSH only); leave the instance's pre-installed iptables rules alone. The dispatcher publishes no port, and Docker's `-p` would bypass ufw, so this firewall matches ufw rather than trusting it.
3. **The GitHub tokens.** Two fine-grained tokens, both limited to this one repository; unattended mode refuses any other kind (a classic `ghp_` or OAuth `gho_` token).
   - **The dispatcher's token.** Start from the pre-filled form, https://github.com/settings/personal-access-tokens/new?name=peanutgallery-vps&description=Mob+Machine+VPS+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&actions=read , then choose the repository and add Actions read-only by hand (GitHub offers no Checks permission to these tokens and the dispatcher reads the gate through the Actions API). By hand: GitHub, Settings, Developer settings, Fine-grained tokens: resource owner AlreadyKyle, only the `peanutgallery` repository. Permissions: Contents read and write, Pull requests read and write, Checks read, Metadata read. No Workflows, no Actions. Export it as `VPS_GITHUB_TOKEN`.
   - **The sessions' read-only token.** Managed Agents sessions clone the repository through Anthropic's git proxy with this token, and the proxy also forwards GitHub REST calls, so it must carry no write permission of any kind: main has no branch protection. Start from https://github.com/settings/personal-access-tokens/new?name=peanutgallery-managed-read&description=Mob+Machine+Managed+Agents+sessions,+read+only&target_name=AlreadyKyle&expires_in=366&contents=read , choose "Only select repositories" and this repository, and add nothing else (Metadata read comes with it). Export it as `GITHUB_READ_TOKEN`, and put the same value in the Mac's `.env` for the check in step 5. The dispatcher, `make-dispatcher-env.sh` and `provision.sh` each refuse it when it equals a token that can write, and the dispatcher and `provision.sh` refuse it unless GitHub denies it a write (a ref write at the all-zero sha, which changes nothing).
4. **The Managed Agents agent and environment.** On the Mac, with `STUDIO_ANTHROPIC_API_KEY` and `MODEL_BUILDER` in `.env`:
   ```sh
   pnpm --filter @backseat/dispatcher managed:apply
   ```
   It creates `peanutgallery-writer` and `peanutgallery-cards` in the studio's organization, or updates them when `platform/agents/managed/*.yaml` changed, and prints `MANAGED_AGENT_ID`, `MANAGED_AGENT_VERSION` and `MANAGED_ENVIRONMENT_ID`. Put the three lines in the Mac's `.env`. It refuses the founder's `ANTHROPIC_API_KEY`.
5. **The pre-credit check.** `pnpm --filter @backseat/dispatcher managed:apply -- --check` then creates one session with the repository mounted at main's head, a one-cent budget and no message, prints it and archives it. A session with no message starts no work and spends nothing. It proves the ids, that the read token reaches the repository and that the model has a list price (a budgeted session on an unpriced model is refused). It proves neither the checkout nor the toolchain; the cutover's toolchain check does. If the API refuses to create anything for an organization with no credit, the refusal is quoted and this step moves to the cutover, after the credit purchase.
6. **Alerts.** Create a healthchecks.io check for the VPS with a 1-minute period and a 5-minute grace, email to the board; export its ping URL as `HEALTHCHECK_URL`. Choose an ntfy topic, subscribe to it on the board's phones, and export its URL as `NTFY_TOPIC_URL`.
7. **Write the env file on the Mac,** at the repository root:
   ```sh
   platform/ops/make-dispatcher-env.sh
   ```
   It prints the path it wrote (a new temporary folder) and the key names, never the values. It refuses when an exported value is missing, when `VPS_GITHUB_TOKEN` equals the Mac's token, when `GITHUB_READ_TOKEN` equals a token that can write, when either token is not fine-grained, when a `MANAGED_*` id from step 4 is missing, or when `MODEL_BUILDER`, or a `MODEL_DIRECTOR` or `MODEL_HOST` that `.env` sets, has no row in `PRICE_TABLE_JSON`. It copies no `ANTHROPIC_API_KEY`, `CLAUDE_BIN` or `DISPATCHER_WORKTREE_ROOT` from the Mac, and uses `SUPABASE_SECRET_KEY` as the service key when `.env` has one.
8. **Upload it** (replace `<path>` with the printed path), then delete the local copy:
   ```sh
   ssh root@$VPS_IP 'install -d -m 0700 /etc/peanutgallery'
   scp <path> root@$VPS_IP:/etc/peanutgallery/dispatcher.env
   ssh root@$VPS_IP 'chown root:root /etc/peanutgallery/dispatcher.env && chmod 600 /etc/peanutgallery/dispatcher.env'
   rm -r "$(dirname <path>)"
   ```
9. **The ntfy URL for the alert unit:**
   ```sh
   printf '%s\n' "$NTFY_TOPIC_URL" | ssh root@$VPS_IP 'umask 077 && cat > /etc/peanutgallery/ntfy.url'
   ```
10. **Provision:**
   ```sh
   ssh root@$VPS_IP 'bash -s' < platform/ops/provision.sh
   ```
   It clones the code clone as root with the token from the env file and refuses it if it has uncommitted or untracked files. It validates the env file (root 0600, no quoted value, `AGENT_MODE=unattended`, every required key including `GITHUB_READ_TOKEN` and the three `MANAGED_*` ids, two different fine-grained GitHub tokens, `PRICE_TABLE_JSON` parsed by node with a row for `MODEL_BUILDER` and any `MODEL_DIRECTOR` or `MODEL_HOST`, none of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, and none of the `DISPATCHER_*_ROOT` or `DISPATCHER_CODE_READONLY` values the unit sets). It proves `GITHUB_READ_TOKEN` reads the repository and is denied a write. It builds the image from the commit, installs `node_modules` into the code clone in a throwaway container with no secret, and makes the code clone root-owned and not writable by others. It clones the work clone inside the image as uid 10001, creates `/srv/peanutgallery-worktrees`, installs both units from the commit, runs `systemd-analyze verify` and enables the dispatcher without starting it. Run it a second time: the last line must read `provision: done: 0 change(s)`.

### Pin the base image by digest

The Dockerfile builds `FROM node:22-bookworm-slim` unless told otherwise. To pin the exact base at provision time, on the VPS:

```sh
docker pull node:22-bookworm-slim
docker image inspect --format '{{index .RepoDigests 0}}' node:22-bookworm-slim
```

Pass the printed `node@sha256:...` reference with its tag, as `NODE_IMAGE=node:22-bookworm-slim@sha256:<digest>`, to `provision.sh` and every later `deploy.sh` (for example `ssh root@$VPS_IP 'NODE_IMAGE=node:22-bookworm-slim@sha256:<digest> bash -s' < platform/ops/provision.sh`). Record the digest in the spec's evidence.

## Cutover

1. **Pause** from /board.
2. **Stop the Mac dispatcher** (Ctrl-C in its terminal) and confirm no `dispatcher` process is left.
3. **Set agent mode to unattended** from /board. Once the two-factor migration from `docs/specs/launch-pages.md` is applied to the live project, this needs the board's second factor.
4. **The toolchain check,** once, before the first card, and again whenever `environment.yaml` or the agent's version changes. A session with the repository mounted at main's head runs node, pnpm, `pnpm install --frozen-lockfile` and the seed bot once; the dispatcher reads their output back and fails unless node is 22 or later, pnpm is 11.0.9 and both commands exit 0. It is billed as overhead:
   ```sh
   ssh root@$VPS_IP 'docker run --rm --pull never --env-file /etc/peanutgallery/dispatcher.env --user 10001:10001 \
     --volume /srv/peanutgallery-code:/opt/peanutgallery:ro --volume /srv/peanutgallery:/srv/peanutgallery \
     --env DISPATCHER_CODE_ROOT=/opt/peanutgallery --env DISPATCHER_REPO_ROOT=/srv/peanutgallery \
     --env DISPATCHER_WORKTREE_ROOT=/srv/peanutgallery-worktrees --env TSX_DISABLE_CACHE=1 \
     --workdir /opt/peanutgallery/platform/dispatcher --entrypoint node peanutgallery/dispatcher:current \
     --import tsx src/probe.ts --toolchain'
   ```
   The first line must read `PASS: toolchain`. Quote it in the spec. A `FAIL:` stops the cutover here, before any funded card runs.
5. **Start the service:** `ssh root@$VPS_IP 'systemctl start dispatcher'`.
6. **The probe.** `ssh root@$VPS_IP 'journalctl -u dispatcher -n 50 --no-pager'` must show `containment verified`, then `startup probe passed` with `"apiKeySource":"ANTHROPIC_API_KEY"` and `"billed_to":"overhead"`, after a `session metered` line. Quote it in the spec.
7. **Heartbeat.** /board shows the dispatcher seen under 3 minutes ago; the healthchecks.io check is green.
8. **Resume** from /board.
9. **Restart check.** `ssh root@$VPS_IP 'systemctl restart dispatcher'`, then as the service role `select paused, dispatcher_seen_at from studio_state`: `paused` is still false and `dispatcher_seen_at` moves within 2 minutes. Then `ssh root@$VPS_IP reboot` and run the same query.
10. **Liveness alert.** `ssh root@$VPS_IP 'systemctl stop dispatcher'` and wait out the check's grace: healthchecks.io emails the board. Start it again. Stopping sends each running card session an interrupt, meters it and archives it before the container exits.
11. **Soak for 24 hours** with no restart loop (`systemctl show dispatcher -p NRestarts`) and no unexpected alert. The first funded card built in this window must have `billed_to = 'studio'` ledger rows.

After cutover, running `pnpm --filter @backseat/supabase seed` from the Mac leaves `studio_state` alone and prints a warning when `.env` still says attended.

## Deploy an update

1. Merge to main as usual (the gate green on the head sha).
2. Pause from /board and let any building card finish.
3. On the Mac, bring your checkout to the reviewed main: `git switch main && git pull --ff-only`. Read `git log` and the diff of `platform/ops/deploy.sh` since you last deployed. The script root runs is the one in this checkout, never a file on the VPS: the copy in `/srv/peanutgallery-code` sits in the clone the script exists to distrust.
4. From the repository root, run the review:
   ```sh
   ssh root@$VPS_IP 'bash -s' < platform/ops/deploy.sh
   ```
   It stops after printing the target sha, the commits it adds and removes, and a diff stat of `platform/ops`, `platform/dispatcher`, `package.json`, `pnpm-lock.yaml` and `.github`.
5. Read that output. If every commit is one the board merged, deploy it:
   ```sh
   ssh root@$VPS_IP 'bash -s -- --confirm <first 12 characters of the target sha>' < platform/ops/deploy.sh
   ```
   When `deploy.sh` has a terminal, it asks for the 12 characters at a prompt instead.

It refuses unless `studio_state.paused` is true and no card is building or gated, and while the dispatcher unit is stopped (before the cutover, a start would run a second dispatcher beside the Mac's). Then, in the code clone only, with `core.fsmonitor` and hooks off and no system or global git configuration:
- It refuses the clone when it has any uncommitted or untracked file, or git state a fresh clone does not have: index flags other than `H`, configuration keys git does not write for a clone, `.git/info/attributes`, `.git/info/grafts`, `.git/commondir` or `.git/objects/info/alternates`, a setuid or setgid file, or a symlink that is absolute, does not resolve or resolves outside the clone. The refusal prints what it found.
- It fetches `main` from `https://github.com/AlreadyKyle/peanutgallery.git` by name, not from whatever `remote.origin.url` says, with a one-off token header.
- It checks through the GitHub API that the target's latest `gate` check run from GitHub Actions concluded `success`, prints the review, and moves only when `--confirm` (or the prompt) matches the target. If main moved since the review, the prefix no longer matches and nothing happens.
- It fast-forwards to the target (checking out `main` first after a roll back) and checks that `HEAD` is the target.
- It rebuilds the image from `git archive` of the new commit only when `platform/ops` changed (otherwise it tags `:current` with the new sha too).
- It runs `pnpm install --frozen-lockfile` into the code clone in a throwaway container as the build uid 10002, with no capability, no env file, and `.git` mounted read-only. The build uid owns only the `node_modules` folders and the store while it runs. Then it strips setuid and setgid bits, makes the clone root-owned and not writable by others, and runs both clone checks again.
- It installs changed units from `git show <new sha>:platform/ops/<unit>`.

It restarts and waits up to 10 minutes for this start's `code root is read-only` line followed by its `startup probe passed` line. It reads only the journal of the unit's new invocation, so a line printed by the previous container while it stopped does not count. Then resume from /board. If the build or the install fails, the code clone is already at the new commit: fix main and run `deploy.sh` again, or roll back.

`deploy.sh` never touches the work clone: the dispatcher fetches `main` there itself before every card.

## Roll back

When a deploy leaves the dispatcher failing or misbehaving:

1. Pause from /board.
2. Find the previous commit:
   ```sh
   ssh root@$VPS_IP 'git -c safe.directory=/srv/peanutgallery-code -c core.fsmonitor=false -c core.hooksPath=/dev/null -C /srv/peanutgallery-code log --oneline -5 origin/main; docker image ls peanutgallery/dispatcher'
   ```
3. From the Mac checkout (Deploy an update, step 3), review and then deploy it by its full sha (replace `<previous-sha>`):
   ```sh
   ssh root@$VPS_IP 'bash -s -- --ref <previous-sha>' < platform/ops/deploy.sh
   ssh root@$VPS_IP 'bash -s -- --ref <previous-sha> --confirm <first 12 characters of previous-sha>' < platform/ops/deploy.sh
   ```
   `--ref` takes a full 40-character sha. It must be on `origin/main`, at or after `ROLLBACK_FLOOR` in `deploy.sh`, and its `platform/ops/dispatcher.service` must mount the code clone read-only, so a roll back never returns to a commit where the dispatcher ran from a clone it could write. It must also carry every unit `deploy.sh` installs and `backup/backup.sh` (`docs/specs/money-safety.md`), so a roll back never goes behind the jobs and never stops halfway, with the code clone moved and the units not. To take out a change older than that, merge a revert on main and deploy it. `ROLLBACK_FLOOR` is empty until this layout merges: the board then sets it to the merge sha of `docs/specs/ops-separation.md` and only ever moves it forward. While it is empty, every `--ref` is refused.

   The gate check and the review apply as for a plain deploy. `deploy.sh` checks the sha out detached in the code clone and reuses `peanutgallery/dispatcher:<previous-sha>` when that image exists (else builds it from the commit). It installs that commit's `node_modules` and units, restarts, and waits for the probe. A failed unit (exit 78) is fine; a stopped one is refused as usual.
4. Resume from /board.
5. Fix forward on main. The next plain `deploy.sh` checks out `main` again and fast-forwards to `origin/main`, so do not run it until the fix is merged.

If `deploy.sh` refuses a dirty code clone, do not clean it by hand and deploy over it. Inspect the files it lists, find out how they changed, and if in doubt move the clone aside (`mv /srv/peanutgallery-code /root/peanutgallery-code.suspect`) and run `provision.sh` again, which clones it fresh.

A card that failed after merge is reverted on main by the dispatcher itself (`docs/specs/launch-hardening.md`); this section is for the dispatcher's own code.

## Rotate a key

Each rotation: pause from /board, change the value in `/etc/peanutgallery/dispatcher.env` on the VPS (for example `ssh -t root@$VPS_IP 'nano /etc/peanutgallery/dispatcher.env'`; the file keeps its owner and mode), run `provision.sh` again to validate it (it reports 0 changes), `systemctl restart dispatcher`, check `startup probe passed` and the heartbeat, resume, and only then revoke the old key.

- **GitHub token.** Create a new fine-grained token with the same repository and permissions (Provision, step 3), set `GITHUB_TOKEN`, restart, and check the next card pushes its branch from the work clone. The next `deploy.sh` fetches the code clone with the same value. Revoke the old token on GitHub. The token lives only in the env file on the VPS; neither clone stores it.
- **The read-only GitHub token.** Create a new token from the read-only form (Provision, step 3), set `GITHUB_READ_TOKEN`, run `provision.sh` (it proves the token is denied a write), restart, and check `containment verified` in the log. Revoke the old token on GitHub. The dispatcher also re-checks the token before every session and halts, with an ntfy alert, if it ever finds it can write.
- **Studio Anthropic key.** In the studio's Console organization (never the founder's), create a key, set `STUDIO_ANTHROPIC_API_KEY`, restart: the probe must pass with `apiKeySource` `ANTHROPIC_API_KEY`. Delete the old key in the Console. Update the Mac's `.env` too.
- **The managed agent or environment.** After a change to `platform/agents/managed/*.yaml` merges, run `pnpm --filter @backseat/dispatcher managed:apply` on the Mac, set the printed `MANAGED_AGENT_VERSION` (and the ids, if they changed) in the env file, restart, check `containment verified`, and run the toolchain check again (Cutover, step 4). A dispatcher still pinned to the old version refuses to start once the files on main no longer match it.
- **Supabase secret key.** Supabase dashboard, project settings, API keys: create a secret key, set `SUPABASE_SERVICE_ROLE_KEY` to it, restart, and check the heartbeat moves. Delete the old secret key. Update `SUPABASE_SECRET_KEY` in the Mac's `.env`.
- **Netlify token.** Netlify, user settings, applications, personal access tokens: create one, set `NETLIFY_AUTH_TOKEN`, restart. Revoke the old token after the next card's deploy is read. Update the Mac's `.env`.

## Read logs

```sh
ssh root@$VPS_IP 'journalctl -u dispatcher -f'                         # follow
ssh root@$VPS_IP 'journalctl -u dispatcher -n 200 --no-pager'           # recent
ssh root@$VPS_IP "journalctl -u dispatcher --since '1 hour ago' -o cat | jq -cR 'fromjson? | select(.level != \"info\")'"
ssh root@$VPS_IP 'systemctl status dispatcher; systemctl show dispatcher -p NRestarts; docker ps'
ssh root@$VPS_IP 'journalctl -u dispatcher-alert -n 20 --no-pager'     # unit-failed alerts
```

Dispatcher lines are JSON with `ts`, `level`, `scope` and `msg`; the entrypoint prints plain text before them only when a check fails. `agent_events` and `ledger` remain the record of what each card did.

## Pause from /board

/board's Pause stops new cards at the next tick, and a running session ends at its next check with the card paused. The dispatcher keeps running, pinging healthchecks.io and writing its heartbeat. Stopping the service does not pause the studio: `studio_state.paused` stays as it was, so a restart resumes work unless the board paused first.

## Exit codes and restarts

- **Exit 78** is a startup failure no restart can fix: a configuration error (a missing managed id, a read token equal to a write token, a GitHub token that is not fine-grained), a code root the dispatcher can write to (the unit's `:ro` mount or the code clone's owner is wrong; run `deploy.sh` or `provision.sh` again), a containment failure (a read token GitHub does not deny a write, an agent whose tools, MCP servers, skills, model speed or version differ from `agent.yaml`, an environment whose networking differs from `environment.yaml`), a probe session whose agent differs or that the API refuses outright, a model missing from `PRICE_TABLE_JSON` (the configured models, a writing role's model, or the probe's), or a clone without an https origin. systemd does not restart it; the unit fails and ntfy gets "Mob Machine dispatcher unit failed on <hostname>". Fix the cause, then `systemctl reset-failed dispatcher && systemctl start dispatcher`.
- **Any other exit** restarts after 30 seconds, the delay growing over 6 steps to 30 minutes: the Managed Agents or GitHub API not answering, rate limited or overloaded, a probe session that stopped without a reply, a failed install, a mode mismatch with /board. After 8 starts in 6 hours the unit fails and ntfy is posted the same way.

## The money guardrail

The studio's Console organization holds prepaid credit with auto-reload off and a $500 monthly limit. The board tops it up by hand as Stripe payouts arrive, so API spend can never outrun customer money. Inside that, the dispatcher's own caps apply: the pool balance, the daily cap and the per-card ceiling. Each Managed Agents session also carries a platform-enforced dollar budget of what its card may still spend, less one model request, so a session keeps to its card's money even if the dispatcher stops. The platform lets the request that crosses the budget finish; the ledger records the true amount and the board is alerted to any overshoot.

## What the VPS holds, and what reaches it

The VPS holds every secret the dispatcher runs with. Since `docs/specs/launch-managed.md`, no agent-written code runs there:
- **Card sessions run elsewhere.** Each card's agent runs as a Claude Managed Agents session in a container Anthropic hosts, with the repository mounted at the card's base commit through `GITHUB_READ_TOKEN`, which the dispatcher proves cannot write before every start and every session. The container reaches the package registries and nothing else, and holds no dispatcher secret.
- **What comes back is a patch, checked before it is written.** The dispatcher fetches the agent's patch file, refuses anything outside the card's lane, on a kernel path, binary, renamed, a symlink or a submodule, or over the size limit, and only then applies it with git (hooks and fsmonitor off, symlinks off) in a worktree. The acceptance check reads regular files only.
- **The smoke test runs no card code.** It compares the served build and config with the merge commit and waits for the gate at the merge sha; the headless bot runs only in CI.
- **Git runs with hooks and fsmonitor off** in the dispatcher, `deploy.sh` and `provision.sh`, so a planted hook or fsmonitor never runs.
- **The Console limit** caps what a leaked studio key can spend, and each session carries its own budget.

What uid 10001 can and cannot change (`docs/specs/ops-separation.md`):
- **The files of the dispatcher's code and `node_modules`: closed, by the mount and the startup check.** The code clone is root-owned and mounted read-only, and the dispatcher exits 78 if it can write there. The install that fills `node_modules` runs as a separate build uid that cannot write tracked files or `.git`. Its output is checked for setuid files and escaping symlinks.
- **What root runs on the host: closed for the code clone, by `deploy.sh`.** Root runs git only in the code clone, with no system, global or planted hook or fsmonitor configuration. It refuses a dirty clone or unexpected git state, reads the image and units from the commit, and runs `deploy.sh` from the operator's checkout rather than the VPS. Root runs no git or program in the work clone or the worktree folder.
- **Which commit becomes the code: a human check, not a closed path.** A commit that reaches `main` runs as the dispatcher once someone confirms it. `deploy.sh` requires the gate to have passed on it and a person to read the review and confirm the sha. It does not stop a person who confirms without reading.
- **The work clone's `.git`: git state only.** uid 10001 owns it and the dispatcher's own git calls read it; a patch cannot write there, since the patch check refuses any `.git` path and git applies only to the worktree.

## Oracle idle reclaim

Kept for the record: Oracle is dropped (`docs/PLAN.md` §10 decision 38), and nothing here is run.

Oracle stops an Always Free instance whose CPU (at the 95th percentile), network and memory all stay under 20% for 7 days, and the dispatcher is idle by design between funded cards. When that happens the healthchecks.io checks alert the board.

**Recovery needs no laptop.** On a phone, sign in at cloud.oracle.com, then Compute, Instances, `peanutgallery-dispatcher`, Start. `dispatcher.service` and the job timers are enabled, so the dispatcher comes back on boot, and each timer's `Persistent=` runs the backup, the Controller or the quota check it missed while the instance was stopped. If Oracle answers that it has no capacity, try again later. From the Mac, `platform/ops/oracle-launch.sh` after `oci session authenticate` does the same and retries capacity by itself.

Oracle's documentation does not say that moving the tenancy to Pay As You Go ends idle reclaim, so nothing here relies on it; it would also put a card on file, which is the board's call (`BOARD-SETUP.md`).

## Backups and the Controller

Three jobs run on the VPS beside the dispatcher and outside it (`docs/specs/money-safety.md`), each a oneshot unit started by its own timer, each with its own env file in `/etc/peanutgallery`, root 0600, holding only that job's keys. They do not need the dispatcher running, so they run before the cutover too. A job that cannot run posts "Mob Machine job <unit> failed" to ntfy through `peanutgallery-job-alert@.service`.

| Job | When (UTC) | Env file | Does |
|---|---|---|---|
| `peanutgallery-backup` | daily, 06:17 | `backup.env` | `backup/backup.sh`: dumps the database through the Session pooler as the read-only `peanutgallery_backup` login, encrypts the dumps to the board's age public key, uploads them to the backup bucket, pings the backup check. Once a week it first restores the plaintext into a scratch Postgres with no network and checks the ledger identity on it. |
| `peanutgallery-controller` | daily, 07:07 | `controller.env` | the Controller: reconciles the books with Stripe, puts back won disputes, computes the next Console credit purchase and the Minimum balance, writes a `controller_runs` row, and alerts on any mismatch |
| `peanutgallery-quota` | daily, 07:37 | `quota.env` | the database's size (alert at 350 MB) and this month's Actions minutes (alert under 400 left), written to `controller_runs` |

Supabase egress and Netlify bandwidth and build minutes are not measured here: they come from the providers' own usage emails to the board, so no account-wide token sits on the VPS.

### What the Controller reads from Stripe

Only these requests, all GET, with `STRIPE_READ_KEY`, the restricted `rk_live_` key the board created with read on Balance, Balance transactions, Payouts, Charges and Refunds, Checkout Sessions, Payment Links, Events and Disputes and nothing else. The key cannot refund, charge or pay out.

- `GET /v1/checkout/sessions?status=complete`: every completed Checkout Session, to find payments the webhook missed;
- `GET /v1/charges` with each charge's balance transaction expanded: amounts, fees and refunded totals;
- `GET /v1/disputes`: every dispute, its status, its due date and its balance movements;
- `GET /v1/payouts?status=paid`, then `GET /v1/balance_transactions?payout=<id>` for each: what each payout carried;
- `GET /v1/events?delivery_success=false`, for the webhook's five event types over the last 30 days: events Stripe could not deliver;
- `GET /v1/balance`: the account's balance, against the Minimum balance figure.

It holds no key that could re-send an event, so a missed event is named in the alert with the fix: resend it from the Stripe Dashboard (Developers, Events) while it is under 30 days old.

### Set them up

On the board's Mac, use [The Mac host](#the-mac-host) instead: the Oracle bucket and its requests below are dropped with Oracle, and a server's store waits on the Google Cloud move.

With `oci session authenticate --region ca-toronto-1 --profile-name peanutgallery` done on the Mac, and the tenancy's OCID as `TENANCY` (the `tenancy=` line of `~/.oci/config`):

1. **The bucket**, private and versioned, once: `oci os bucket create --auth security_token --profile peanutgallery -c "$TENANCY" --name peanutgallery-backups --public-access-type NoPublicAccess --versioning Enabled`. For a bucket made without it: `oci os bucket update --auth security_token --profile peanutgallery --bucket-name peanutgallery-backups --versioning Enabled`, then check that `oci os bucket get --auth security_token --profile peanutgallery --bucket-name peanutgallery-backups --query 'data.versioning'` prints `"Enabled"`. Versioning is what keeps a written backup: a write to a name that already exists becomes the object's new version and the old one stays as a previous version, which only the board's own sign-in can delete. Always Free Object Storage holds 20 GB, far more than these dumps.
2. **Two write-only pre-authenticated requests**, one for the VPS and one for the backups repository, so either can be revoked alone: `oci os preauth-request create --auth security_token --profile peanutgallery --bucket-name peanutgallery-backups --name vps-backup --access-type AnyObjectWrite --time-expires <the expiry the board chooses>`, and again with `--name actions-backup`. Each prints a `full-path`; the whole URL, ending in `/o/`, is the secret. Put the VPS's in `.env` as `BACKUP_PAR_URL=` with `BACKUP_BUCKET=peanutgallery-backups`. When a request expires, uploads fail and the backup check alerts; create a new one then. A request with `AnyObjectWrite` can add objects and cannot read, list or delete any. It can write to a name that already exists, and backup names are predictable, so without versioning a stolen request could replace every past backup; with it, a replaced backup is still there as a previous version.
3. **The board's age public key** in `.env` as `BACKUP_AGE_RECIPIENT=age1...` (`BOARD-SETUP.md`). The private key never comes near the VPS or the repository.
4. **The backup login's password.** Migration `20260923000010_backup_role.sql` creates `peanutgallery_backup` with no password. Set one once through the Management API query endpoint (`alter role peanutgallery_backup with password '<a new random password>'`), never in a file in the repository, and put the Session pooler string in `.env` as `BACKUP_DB_URL=postgresql://peanutgallery_backup.<project ref>:<password>@<the Session pooler host from Dashboard, Connect>:5432/postgres`. Read back what it can do: `select rolbypassrls, rolconfig from pg_roles where rolname = 'peanutgallery_backup'` and `select has_table_privilege('peanutgallery_backup', 'auth.users', 'select')`. Every dump runs as this login. The database owner's password never goes to the VPS or the backups repository: the owner can drop the append-only triggers. If the login cannot read the auth schema, put `BACKUP_SKIP_AUTH=1` in `.env` (and the same variable in the backups repository): the dumps then leave `auth` out, and a restore signs the board in afresh (Restore the database, step 6). The auth schema holds only the board's accounts; board membership itself is `board_members`, by email, in the public data.
5. **The env files.** On the Mac, with `.env.vps` exported: `platform/ops/make-jobs-env.sh`. It prints the folder it wrote. Upload each file and delete the local copies:
   ```sh
   scp <folder>/backup.env <folder>/controller.env <folder>/quota.env root@$VPS_IP:/etc/peanutgallery/
   ssh root@$VPS_IP 'chown root:root /etc/peanutgallery/*.env && chmod 600 /etc/peanutgallery/*.env'
   rm -r <folder>
   ```
   A job whose keys are not all in `.env` yet (the Stripe read key, say) is refused and named, and the others are written.
6. **Provision again:** `ssh root@$VPS_IP 'bash -s' < platform/ops/provision.sh`. It installs `age` and the pinned Supabase CLI (checked against its release's checksum file), installs the backup script from the commit, checks each job env file in the image, and enables each timer whose file passes.
7. **The first runs, by hand, quoted in the spec:**
   ```sh
   ssh root@$VPS_IP '/usr/local/lib/peanutgallery/backup.sh --restore-check'
   ssh root@$VPS_IP 'docker run --rm --pull never --env-file /etc/peanutgallery/controller.env --user 65534:65534 --read-only --cap-drop ALL \
     --volume /srv/peanutgallery-code:/opt/peanutgallery:ro --entrypoint node peanutgallery/dispatcher:current \
     /opt/peanutgallery/platform/ops/jobs/main.mjs controller --dry-run'
   ssh root@$VPS_IP 'systemctl start peanutgallery-quota.service; journalctl -u peanutgallery-quota -n 5 --no-pager'
   ```
   The backup's output must include `PASS: restore check`, and each job's first line must read `PASS:`. The Controller's dry run reads everything and writes, reinstates and alerts nothing; run it only after the board has been told what it reads (above).

Before the cutover `deploy.sh` refuses to run while the dispatcher is stopped, so the jobs' code in the code clone moves only when `provision.sh` makes a fresh clone (move the old one aside first, as in Roll back). After the cutover every deploy updates it.

### What the board does with the Controller's run

- **After each payout:** buy the Console credit the run names ("Credit to buy now") and raise Stripe's Minimum balance to the figure it names, in the settlement currency. The purchase is never more than the agent money Stripe has paid out and not yet converted, plus the overhead, so it never needs anyone's own money.
- **A dispute to answer:** answer it in Stripe before the due date the alert names.
- **A fee Stripe kept that the books do not carry:** record the adjustment the alert names with `record_adjustment` at /board.
- **A missed or undelivered webhook event:** resend it from the Stripe Dashboard.

Read the runs as the service role: `select job, started_at, ok, mismatches, figures from controller_runs order by created_at desc limit 5`, or `journalctl -u peanutgallery-controller -n 50 --no-pager` on the VPS.

## Restore the database

The encrypted backups are in the `peanutgallery-backups` bucket, and only the board's offline age key opens them. Every step runs on the Mac.

1. **Fetch a backup.** `oci os object list-object-versions --auth security_token --profile peanutgallery --bucket-name peanutgallery-backups --query 'data.items[].[name, "version-id", "time-created"]' --output table`, then `oci os object get --auth security_token --profile peanutgallery --bucket-name peanutgallery-backups --name <object> --version-id <version> --file <object>`. Each backup is written once, so a name with more than one version was written to again: take its oldest version, and treat the upload request that wrote the newer one as stolen (revoke it and make a new one, Set them up, step 2).
2. **Decrypt it** with the key the board brings: `age -d -i <path to the key> -o backup.tar <object> && tar -xf backup.tar`. It holds `roles.sql`, `schema.sql`, `data.sql`, `auth.sql` (absent when `BACKUP_SKIP_AUTH=1`), `history_schema.sql` and `history_data.sql`.
3. **Pick the target.** For the restore drill, a scratch database: a second free Supabase project, or Supabase's Postgres image in local Docker, as the weekly check uses. For a real recovery, a new Supabase project in the same region.
4. **Restore**, as Supabase documents it, with the target's owner connection string:
   ```sh
   psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' --file data.sql --dbname "<target>"
   psql --single-transaction --variable ON_ERROR_STOP=1 --command 'SET session_replication_role = replica' --file auth.sql --dbname "<target>"
   psql --single-transaction --variable ON_ERROR_STOP=1 --file history_schema.sql --file history_data.sql --dbname "<target>"
   ```
   Skip the `auth.sql` line when the backup has none. Then run `platform/ops/after-restore.sql` on the target, as [Restore a Mac backup](#restore-a-mac-backup), step 4, does: no dump carries what it makes.
5. **Check it:** `psql --dbname "<target>" -At -c "select public.ledger_identity()->>'holds'"` must print exactly `true`; then `psql --dbname "<target>" -At -c 'select public.ledger_identity()'` for the lines. Only the top-level `holds` counts: each line carries its own. Quote both.
6. **For a real recovery, then:**
   - put the new project's URL and keys in `.env` and in the VPS's env files, and set the stripe-webhook function's secrets there;
   - deploy the webhook to the new project and create its Stripe endpoint with `platform/supabase/scripts/create-webhook-endpoint.ts`, which gives a new signing secret;
   - change the project ref in `platform/site/netlify.toml`, a kernel file, through a board pull request;
   - the board signs in again and re-enrols its second factor if the new project asks; with no `auth.sql`, each board member signs in afresh by email, which `board_members` allows, and enrols a second factor;
   - resend from the Stripe Dashboard every event since the backup's time (Developers, Events), then run the Controller to find anything still missing;
   - set a password for `peanutgallery_backup` in the new project and update `BACKUP_DB_URL`.
7. **Delete the decrypted copy** (`rm -r backup.tar peanutgallery-*`) and put the key back offline.

## Migration history

Production's migrations were applied through the Management API query endpoint, which records nothing in `supabase_migrations.schema_migrations`. Once, with the board's allow, `npx supabase@2.117.0 migration repair --status applied <each applied version> --linked` (after `npx supabase link --project-ref lyxndueoeisyqzewflpu`) records every applied file, and `npx supabase migration list --linked` must then show local and remote in step. Later migrations can then go through `supabase db push`. The nightly dump carries the history (`history_schema.sql`, `history_data.sql`), so a restore keeps it.

## The GitHub Actions host

Since 6 October 2026 the repository is public, so standard GitHub-hosted runners are free in it, and the dispatcher runs there (`docs/PLAN.md` §10 decision 61, `docs/specs/actions-host.md`). A run lasts at most 355 minutes, so the host is a chain of runs: `.github/workflows/dispatcher.yml` runs `platform/ops/actions/run-dispatcher.sh`, which runs the dispatcher with `DISPATCHER_DRAIN_AT` set 300 minutes after the run started. From then the dispatcher claims no card and starts no job, and it exits 0 once nothing it started is still running; the run then starts the next one with `gh workflow run`. At 350 minutes a card still running gets SIGTERM, which interrupts, meters and archives its session, and the next start's recovery pauses it; that pause (`dispatcher_restart`) resumes on its own, within bounds (`docs/specs/unattended-roles.md`). A schedule every 30 minutes is the backstop, and the concurrency group `dispatcher` keeps one run at a time with at most one waiting; the dispatcher lease keeps a second process from ticking in any case.

### What runs where

| Path on the runner | Holds |
|---|---|
| `$GITHUB_WORKSPACE` | the code clone: the checkout of main at the run's sha, with no credential kept, its `node_modules` installed by a step that holds no secret, and the `.env` the dispatcher reads. `chmod -R a-w` before the dispatcher starts, so `DISPATCHER_CODE_READONLY=required` passes. |
| `$RUNNER_TEMP/host/work` | the work clone (`DISPATCHER_REPO_ROOT`): a fresh clone of main, made with the env file's `GITHUB_TOKEN` through a one-off header, never on a command line or in `.git/config`. |
| `$RUNNER_TEMP/host/work-worktrees` | card worktrees (`DISPATCHER_WORKTREE_ROOT`). |
| `$RUNNER_TEMP/host/env/dispatcher.env` | the env file, 0600, written from the environment secret `DISPATCHER_ENV` and checked with `provision.sh`'s `check_env_lines`. |
| `$RUNNER_TEMP/host/logs/dispatcher.log` | the dispatcher's output, encrypted with age before it leaves the runner. |

Each run is a fresh virtual machine, so nothing carries over between runs but the database, GitHub and the Managed Agents organisation: the work clone and the worktrees are made again, and a card a run left mid-flight is recovered by the next start as after any restart.

**Secrets and the public log.** The job runs in the GitHub environment `dispatcher`, which only main may deploy to, so a card branch, a pull request or a fork never receives `DISPATCHER_ENV`; the job also runs only on main in this repository and only while the repository variable `DISPATCHER_HOST` is `on`. Only the step that runs the dispatcher and the alert step read the secret, every value of eight characters or more in it is masked, and the token the job holds can read the repository and start a workflow run, nothing else. Actions logs of a public repository are public, so the dispatcher's output never reaches the run's log: the log shows the script's own lines and, for a fixed list of lifecycle messages, the message alone (`dispatcher: code root is read-only`, `dispatcher: containment verified`, `dispatcher: startup probe passed`, `dispatcher: dispatcher drained` and so on). The full log is encrypted to `vars.BACKUP_AGE_RECIPIENT`, the board's age public key, and kept as the run's artifact `dispatcher-log-<run id>-<attempt>` for 14 days; with no recipient set the log is deleted, not uploaded.

**Exits.** Exit 78, or a failed check in the script (no `DISPATCHER_ENV`, an env file `check_env_lines` refuses, a dotenv that misreads a line, a checkout still writable), is fatal: ntfy hears "Mob Machine dispatcher stopped on GitHub Actions: fatal startup error", the run fails, and it does not start the next one. The 30-minute schedule tries again and fails the same way until the cause is fixed, so fix it or switch the host off. A drain, a hard stop, or any run of 10 minutes or more starts the next run at once; a shorter failed run posts to ntfy and waits for the schedule, which is the restart delay.

### Set it up (the operator, once)

Each step is a command from the board's checkout of main. Nothing here sets a value into the repository's files.

1. **The environment.** Create `dispatcher` with a deployment branch policy that allows main alone:
   ```sh
   gh api -X PUT repos/AlreadyKyle/peanutgallery/environments/dispatcher \
     -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/AlreadyKyle/peanutgallery/environments/dispatcher/deployment-branch-policies -f name=main -f type=branch
   gh api repos/AlreadyKyle/peanutgallery/environments/dispatcher/deployment-branch-policies --jq '.branch_policies[].name'
   ```
   The last line must print `main` and nothing else.
2. **The env file.** With the managed agent's ids in `.env` (The cutover, step 3, below) and `VPS_GITHUB_TOKEN`, `GITHUB_READ_TOKEN`, `HEALTHCHECK_URL` and `NTFY_TOPIC_URL` exported from `.env.vps`: `platform/ops/make-dispatcher-env.sh "$HOME/dispatcher.env"`. It writes the server's format, which `run-dispatcher.sh` checks with `check_env_lines` at every start.
3. **The secret.** `gh secret set DISPATCHER_ENV --env dispatcher --repo AlreadyKyle/peanutgallery < "$HOME/dispatcher.env"`, then `rm "$HOME/dispatcher.env"`. GitHub never shows it again; to change a key, write the file and set the secret again.
4. **The variables.** `gh variable set BACKUP_AGE_RECIPIENT --repo AlreadyKyle/peanutgallery --body '<the age1... public key>'` (the backup key's public half; it is public). `DISPATCHER_HOST` stays unset until the cutover.
5. **The healthchecks.io check.** Give the dispatcher's check a grace of at least 15 minutes, so the minute or two between one run and the next never alerts.

### The cutover on GitHub Actions

`BOARD-SETUP.md` step 23, in place of The cutover on the Mac. Only one dispatcher ever ticks: the lease guarantees it, and the attended dispatcher must not run while the host runs.

1. **Pause** from /board.
2. **Stop the attended dispatcher** (Ctrl-C in its terminal) and confirm `pgrep -fl 'src/main.ts'` prints nothing. The Mac's LaunchAgents are already removed (`platform/ops/mac/uninstall.sh`).
3. **The managed agent and environment:** `pnpm --filter @backseat/dispatcher managed:apply` in the board's checkout; put the printed ids in `.env`, then write the env file and set the secret again (Set it up, steps 2 and 3).
4. **Set the agent mode to unattended** at /board (second factor).
5. **The toolchain check,** once, from the board's checkout of main, with the env file written again as in step 2 (its values come before `.env`'s, which dotenv never overrides):
   ```sh
   cd platform/dispatcher && node --env-file="$HOME/dispatcher.env" --import tsx src/probe.ts --toolchain; cd -
   rm "$HOME/dispatcher.env"
   ```
   The first line must read `PASS: toolchain`. A `FAIL:` stops the cutover here.
6. **Switch the host on and start it:**
   ```sh
   gh variable set DISPATCHER_HOST --repo AlreadyKyle/peanutgallery --body on
   gh workflow run dispatcher.yml --ref main --repo AlreadyKyle/peanutgallery
   gh run watch "$(gh run list --workflow dispatcher.yml --repo AlreadyKyle/peanutgallery --limit 1 --json databaseId --jq '.[0].databaseId')" --repo AlreadyKyle/peanutgallery
   ```
   Stop watching once the step "Run the dispatcher" shows them, and quote these lines from the run's log: `actions-host: the code clone is read-only`, `dispatcher: code root is read-only`, `dispatcher: containment verified` and `dispatcher: startup probe passed`. `gh run view <run id> --log --repo AlreadyKyle/peanutgallery | grep -E 'actions-host:|dispatcher:'` prints them.
7. **Heartbeat.** /board shows the dispatcher seen under 3 minutes ago; the healthchecks.io check is green.
8. **The alert path:** `curl -fsS -H 'Title: Mob Machine test' -d "Test alert from the Actions host" "$NTFY_TOPIC_URL"` with the value from `.env.vps`; the board's phone shows it.
9. **Resume** from /board.
10. **Restart check.** `gh run cancel <run id> --repo AlreadyKyle/peanutgallery`, then `gh workflow run dispatcher.yml --ref main --repo AlreadyKyle/peanutgallery`; as the service role, `select paused, dispatcher_seen_at from studio_state`: `paused` is still false and `dispatcher_seen_at` moves within 5 minutes of the new run starting. A cancelled run starts no next run.
11. **Liveness alert.** `gh variable set DISPATCHER_HOST --repo AlreadyKyle/peanutgallery --body off`, cancel the run, and wait out the check's grace: healthchecks.io emails the board. Set it `on` again and start a run as in step 6.
12. **Soak for 24 hours**, across at least four drains: `gh run list --workflow dispatcher.yml --repo AlreadyKyle/peanutgallery --limit 10` shows each run succeeding and the next starting within minutes, each run's log ends with `dispatcher: dispatcher drained`, and no unexpected alert arrives. The first funded card built in this window must have `billed_to = 'studio'` ledger rows.

### Deploy an update

Every run checks out main at its own start, so a merge reaches the host at the next run, at most about five hours later. To deploy at once: pause from /board and let any building card finish, `gh run cancel <run id>`, `gh workflow run dispatcher.yml --ref main`, and check the probe lines as in the cutover's step 6; resume. When the merge changes `platform/ops`, move the ops repository's `STUDIO_REF` to the new main sha after reviewing its `platform/ops` diff (`ops-repo/README.md`).

### Roll back

There is no `--ref` on this host: runs start from main only, which the environment enforces. Pause, revert the change on main with a pull request (gate green), then deploy as above. Resume.

### Rotate a key

Pause from /board. Write the env file again with `make-dispatcher-env.sh`, `gh secret set DISPATCHER_ENV --env dispatcher` from it, delete the file, then cancel the run and start one; check `startup probe passed` and the heartbeat. Resume, and only then revoke the old key.

### Read logs

```sh
gh run list --workflow dispatcher.yml --repo AlreadyKyle/peanutgallery --limit 10
gh run view <run id> --log --repo AlreadyKyle/peanutgallery | grep -E 'actions-host:|dispatcher:'   # the public lifecycle lines
gh run download <run id> --repo AlreadyKyle/peanutgallery --name dispatcher-log-<run id>-1 --dir dispatcher-log
age -d -i <path to the backup key> dispatcher-log/dispatcher-log.age | grep -v '"level":"info"' | tail -n 50
```

The full log needs the board's offline age key, the same one that opens a backup. Delete the decrypted copy afterwards.

### Stop the host

`gh variable set DISPATCHER_HOST --repo AlreadyKyle/peanutgallery --body off`, then `gh run cancel <run id>` for a run in progress (`gh run list --workflow dispatcher.yml --status in_progress`). No run starts while it is off: the schedule and a re-dispatch both skip the job.

### What is weaker than a server

- **Gaps between runs.** Each handover leaves a minute or two with no dispatcher, and a card claimed shortly before a drain may still be running at the hard stop, where it is interrupted and paused for the board to resume. Ticks resume with the next run.
- **GitHub decides when a run starts.** A scheduled run can start late or be dropped under load, GitHub disables the schedule of a public repository after 60 days with no activity in it, and an Actions outage stops the host. healthchecks.io alerts on all of them.
- **The secret is in GitHub.** Anyone who can change the environment's branch policy, or push to main, can reach `DISPATCHER_ENV`; on a server only root could. Branch protection on main is not set yet.
- **Every merge to main deploys itself.** On a server or the Mac a deploy needed the gate green and the board's confirmed sha; here the next run runs whatever main holds. What stands between a card and the dispatcher's own code is the kernel paths: no card may change `.github`, `platform/dispatcher`, `platform/ops`, the lockfile or the workspace files (`platform/gate/kernel-paths.txt`), so only a board pull request changes what this host runs.
- **The code clone is read-only by its mode bits,** as on the Mac: the runner's user could `chmod` it back. No agent-written code runs on the runner, which is what makes this enough.

## The Mac host

Retired on 6 October 2026 (`docs/PLAN.md` §10 decision 61): the dispatcher runs on GitHub Actions ([The GitHub Actions host](#the-github-actions-host)) and the daily jobs in the private ops repository (`ops-repo/README.md`), and the Mac's LaunchAgents were removed with `uninstall.sh`. This section is kept for the record; `backup-mac.sh` and the restore steps below are still the ones the backups use.

Until the studio has a server, the dispatcher runs unattended on the board's Mac, a MacBook Pro on Apple Silicon kept plugged in, under launchd (`docs/PLAN.md` §10 decision 38, `docs/specs/mac-host.md`). The daily jobs run there too. It keeps the server's rules where a single-user Mac can: the dispatcher runs from a code clone it cannot write, git state lives in a separate work clone, card worktrees sit outside both, every git call runs with hooks and fsmonitor off, a deploy needs the gate green and the board's confirmed sha, and no agent-written code runs on the Mac at all (card sessions are Managed Agents sessions). What is weaker is at the end of this section.

### What runs where

Everything lives in `~/peanutgallery-host`, outside the board's own checkout, which the board keeps using for attended work and for running these scripts.

| Path | Holds |
|---|---|
| `code/` | the code clone: a clone of main, its `node_modules`, the pnpm store (`.pnpm-store`) and the `.env` the dispatcher reads. `chmod -R a-w` after every install, so the dispatcher's `DISPATCHER_CODE_READONLY=required` check passes; only `install.sh` and `deploy.sh` make it writable, and only while they run. |
| `work/` | the work clone (`DISPATCHER_REPO_ROOT`): the git state the dispatcher fetches, pushes and adds worktrees from. Nothing runs from it. |
| `work-worktrees/` | card worktrees (`DISPATCHER_WORKTREE_ROOT`), where checked patches are applied and committed. |
| `env/` | 0700: `dispatcher.env` (written by `make-dispatcher-env.sh`), `controller.env`, `quota.env` and `backup-mac.env` (written by `make-jobs-env.sh`), and `ntfy.url`. Each file 0600. |
| `state/` | the dispatcher's recent starts and failures in a row, each job's last run date, and the backup's run folder while it runs. |
| `logs/` | `dispatcher.log` (rotated at 10 MB, three kept), one log per job (rotated at 5 MB), and launchd's own small logs. |

| LaunchAgent (`~/Library/LaunchAgents`) | Runs | When |
|---|---|---|
| `studio.peanutgallery.dispatcher` | `code/platform/ops/mac/run-dispatcher.sh` | at login, and again after any exit but 0 |
| `studio.peanutgallery.backup` | `run-job.sh backup`: `backup-mac.sh` | once per UTC day at 06:17, or at the first wake after it |
| `studio.peanutgallery.controller` | `run-job.sh controller`: `jobs/main.mjs controller` | once per UTC day at 07:07, or at the first wake after it |
| `studio.peanutgallery.quota` | `run-job.sh quota`: `jobs/main.mjs quota` | once per UTC day at 07:37, or at the first wake after it |

launchd's calendar is in local time, which moves with daylight saving, so each job's LaunchAgent wakes `run-job.sh` every hour at the job's minute and the script runs the job once per UTC day at its UTC time, the same times as the server's timers. A wake missed while the Mac slept runs as soon as it wakes, as the timers' `Persistent=` makes up a run at boot. A job that fails posts "Mob Machine job <job> failed on <host>" to ntfy and is tried again the next UTC day.

| File in `platform/ops/mac` | Does |
|---|---|
| `install.sh` | creates the layout, clones both clones with the env file's token, installs `node_modules`, copies `env/dispatcher.env` to `code/.env` and checks the dispatcher's dotenv reads it as written, makes the code clone read-only and runs the dispatcher's read-only check, writes and loads the LaunchAgents; `--start` is the cutover; `--jobs-only` installs only the jobs, before the cutover. A second run reports `install: done: 0 change(s)`. It prints key names and paths, never a value. |
| `deploy.sh` | the Mac's `platform/ops/deploy.sh`, with the same checks |
| `uninstall.sh` | unloads and removes the four LaunchAgents, leaving `~/peanutgallery-host` |
| `run-dispatcher.sh` | the dispatcher's wrapper: the entrypoint's checks, `caffeinate`, the exit codes and restarts |
| `run-job.sh` | the jobs' wrapper: the UTC schedule, the env file checks, the ntfy alert |
| `backup-mac.sh` | the nightly backup with Homebrew's libpq, to the board's backup folder |
| `studio.peanutgallery.dispatcher.plist`, `studio.peanutgallery.job.plist` | the LaunchAgent templates `install.sh` fills in |
| `lib.sh` | what `install.sh`, `deploy.sh` and `uninstall.sh` share, including the server's `deploy.sh` checks |

### Prepare the Mac (the board, once)

These are `BOARD-SETUP.md` step 3.

1. **Power.** Keep it plugged in and the lid open: `caffeinate -i -s`, which the wrapper holds, keeps a Mac on power from sleeping, but closing the lid sleeps it anyway. In System Settings, Battery, Options, turn on "Prevent automatic sleeping on power adapter when the display is off". The display may sleep.
2. **Restarts.** In System Settings, General, Software Update, Automatic updates, turn off installing macOS updates, so the Mac never restarts on its own; install them by hand while the studio is paused. With FileVault on, a restart or a power cut stops at the login screen and nothing runs until the board logs in: healthchecks.io emails when the dispatcher goes quiet.
3. **Tools.** `brew install libpq age` (Homebrew's libpq has `pg_dump`, `pg_dumpall` and `psql`; `backup-mac.sh` uses them from `/opt/homebrew/opt/libpq/bin`). Node 22 or later and pnpm 11.0.9 are already on the Mac.
4. **The backup folder.** Install Google Drive for desktop, sign in, and create a folder `peanutgallery-backups` in My Drive. Its path, something like `~/Library/CloudStorage/GoogleDrive-<account>/My Drive/peanutgallery-backups` written out in full, goes in `.env` as `BACKUP_DIR=`. Drive copies each backup off the Mac.
5. **The age key.** `age-keygen -o ~/Desktop/peanutgallery-backup-key.txt`. The `# public key: age1...` line goes in `.env` as `BACKUP_AGE_RECIPIENT=`. Keep the file itself offline (a USB stick kept apart, and a copy in the board's password manager), then delete it from the Mac: only that key opens a backup.
6. **The backup check.** At healthchecks.io, a check named `peanutgallery backup` with a period of 1 day and a grace of 12 hours (the Mac may make a run up at its next wake). Its ping URL goes in `.env.vps` as `BACKUP_HEALTHCHECK_URL=`.

### The jobs before the cutover

The full install needs `env/dispatcher.env`, and that needs the managed agent's ids, which `managed:apply` makes only once the studio's Anthropic organisation has Console credit (`BOARD-SETUP.md` step 22). Until then `install.sh --jobs-only` installs the nightly jobs alone (`docs/specs/jobs-only-install.md`), so the money database is backed up every night from the day contributions open. From the repository root of the board's checkout of reviewed main, with `GITHUB_READ_TOKEN` (or, failing it, `VPS_GITHUB_TOKEN`) and `NTFY_TOPIC_URL` exported from `.env.vps`:

```sh
mkdir -p ~/peanutgallery-host/env && chmod 700 ~/peanutgallery-host ~/peanutgallery-host/env
JOBS_ENV_DIR=~/peanutgallery-host/env platform/ops/make-jobs-env.sh backup-mac
platform/ops/mac/install.sh --jobs-only
platform/ops/mac/install.sh --jobs-only
~/peanutgallery-host/code/platform/ops/mac/run-job.sh backup --now; tail -n 10 ~/peanutgallery-host/logs/backup.log
```

It keeps the full install's refusals: macOS and never root, each env file the board's, 0600, not a symlink and passing `check-env.mjs`, a clean clone with nothing git would act on, the whole clone `chmod -R a-w`. `backup-mac.env` must exist; the Controller and the quota check are installed too when their env files exist (add `controller` and `quota` to `make-jobs-env.sh` once `STRIPE_READ_KEY` is in, then run `--jobs-only` again). It clones `code/` from main with the read-only token, never keeps it, and needs no dispatcher env file, `.env`, `node_modules` or work clone; it writes no dispatcher LaunchAgent. The second run must end `install: done: 0 change(s)`.

`deploy.sh` needs the dispatcher's LaunchAgent, so it does not update a jobs-only clone. To move the jobs to a newer main before the cutover, move the clone aside and install again:

```sh
chmod -R u+w ~/peanutgallery-host/code && mv ~/peanutgallery-host/code ~/peanutgallery-code.jobs-only
platform/ops/mac/install.sh --jobs-only
```

A plain `install.sh` refuses the clone `--jobs-only` made, printing the same two commands, so the cutover's install clones main afresh (The cutover on the Mac, step 3). Delete `~/peanutgallery-code.jobs-only` afterwards (`rm -rf`; it holds no secret).

### Install

From the repository root of the board's checkout of reviewed main, with the values in `.env.vps` exported (`VPS_GITHUB_TOKEN` is the host's own fine-grained token, `GITHUB_READ_TOKEN` the read-only one, `HEALTHCHECK_URL` the dispatcher check, `NTFY_TOPIC_URL`, `BACKUP_HEALTHCHECK_URL`):

```sh
mkdir -p ~/peanutgallery-host/env && chmod 700 ~/peanutgallery-host ~/peanutgallery-host/env
platform/ops/make-dispatcher-env.sh ~/peanutgallery-host/env/dispatcher.env
JOBS_ENV_DIR=~/peanutgallery-host/env platform/ops/make-jobs-env.sh backup-mac controller quota
platform/ops/mac/install.sh
platform/ops/mac/install.sh
```

`make-dispatcher-env.sh` writes the same file as for a server (`KEY=value`, no quotes, `PRICE_TABLE_JSON` on one line, `AGENT_MODE=unattended`); the dispatcher's dotenv reads every line of it as written, which `install.sh` checks. `install.sh` refuses the env file on the same rules `provision.sh` uses. The second run must end `install: done: 0 change(s)`. The dispatcher is installed and disabled, so a login does not start it: starting it is the cutover.

The first job runs, by hand, quoted in `docs/specs/mac-host.md`:

```sh
node --env-file="$HOME/peanutgallery-host/env/controller.env" ~/peanutgallery-host/code/platform/ops/jobs/main.mjs controller --dry-run
~/peanutgallery-host/code/platform/ops/mac/run-job.sh quota --now; tail -n 5 ~/peanutgallery-host/logs/quota.log
~/peanutgallery-host/code/platform/ops/mac/run-job.sh backup --now; tail -n 10 ~/peanutgallery-host/logs/backup.log
```

Each job's first line must read `PASS:`, and the backup must end `backup: done: peanutgallery-<time>.tar.age` with the file in the backup folder. Run the Controller's dry run only after the board has been told what it reads ([What the Controller reads from Stripe](#what-the-controller-reads-from-stripe)).

### The cutover on the Mac

`BOARD-SETUP.md` step 23. Only one dispatcher ever ticks: the lease guarantees it, and the attended dispatcher must not be started while the host runs (it would wait on the lease, and its attended mode would disagree with /board's).

1. **Pause** from /board.
2. **Stop the attended dispatcher** (Ctrl-C in its terminal) and confirm no `dispatcher` process is left: `pgrep -fl 'src/main.ts'` prints nothing.
3. **The managed agent and environment:** `pnpm --filter @backseat/dispatcher managed:apply` in the board's checkout; put the printed ids in `.env`, then rewrite the env file and run the install again (Install, above). If the jobs went in with `--jobs-only`, move that clone aside first (The jobs before the cutover, above); the install refuses it otherwise. It must end `0 change(s)` on its second run.
4. **Set the agent mode to unattended** at /board (second factor).
5. **The toolchain check,** once, as on a server, from the code clone:
   ```sh
   cd ~/peanutgallery-host/code/platform/dispatcher && env -i PATH="$PATH" HOME="$HOME" TSX_DISABLE_CACHE=1 \
     DISPATCHER_CODE_ROOT="$(cd ../.. && pwd -P)" DISPATCHER_REPO_ROOT="$HOME/peanutgallery-host/work" \
     DISPATCHER_WORKTREE_ROOT="$HOME/peanutgallery-host/work-worktrees" node --import tsx src/probe.ts --toolchain; cd -
   ```
   The first line must read `PASS: toolchain`.
6. **Start it:** `platform/ops/mac/install.sh --start`. It refuses unless /board shows unattended, then starts the dispatcher and waits for this start's `code root is read-only` and `startup probe passed` lines, which it prints. Quote them.
7. **Heartbeat.** /board shows the dispatcher seen under 3 minutes ago; the healthchecks.io check is green.
8. **The alert path:** `curl -fsS -H 'Title: Mob Machine test' -d "Test alert from the Mac host" "$(head -n 1 ~/peanutgallery-host/env/ntfy.url)"`; the board's phone shows it.
9. **Resume** from /board.
10. **Restart checks.** `launchctl kickstart -k gui/$(id -u)/studio.peanutgallery.dispatcher`, then as the service role `select paused, dispatcher_seen_at from studio_state`: `paused` is still false and `dispatcher_seen_at` moves within 2 minutes. Then `pkill -9 -f 'src/main.ts'`: the wrapper sees the exit, waits 30 seconds and exits, launchd starts it again, and the log shows `failure 1 in a row`. Then log out and back in (or restart and log in): the dispatcher is running again with no command.
11. **Liveness alert.** `launchctl bootout gui/$(id -u)/studio.peanutgallery.dispatcher` and wait out the check's grace: healthchecks.io emails the board. Start it again with `platform/ops/mac/install.sh --start`.
12. **Soak for 24 hours** with the lid open and no restart loop (`grep -c 'failure' ~/peanutgallery-host/logs/dispatcher.log`) and no unexpected alert. The first funded card built in this window must have `billed_to = 'studio'` ledger rows.

### Deploy an update

1. Merge to main as usual (the gate green on the head sha).
2. Pause from /board and let any building card finish.
3. In the board's checkout: `git switch main && git pull --ff-only`, and read the diff of `platform/ops/mac/deploy.sh` since the last deploy. The script that runs is this checkout's, never the copy in the code clone it moves.
4. `platform/ops/mac/deploy.sh`. It refuses unless the studio is paused with no card building or gated and the dispatcher's LaunchAgent is loaded; refuses a dirty or altered code clone as the server's does; fetches main by the repository's URL with a one-off token header; checks the target's `gate` check concluded `success`; prints the commits it adds and removes and a diff stat, and asks for the first 12 characters of the target sha (or takes `--confirm <them>`). Then it makes the clone writable, fast-forwards it, runs `pnpm install --frozen-lockfile` with no secret in its environment, makes it read-only again, runs the read-only, clone and dotenv checks, rewrites any LaunchAgent whose template changed, restarts the dispatcher and waits for this start's probe lines. On any exit the clone is made read-only again.
5. Resume from /board.

### Roll back

Pause, then from the board's checkout `platform/ops/mac/deploy.sh --ref <full sha>` (review, then again with `--confirm <first 12>`). The sha must be on `origin/main` and have the Mac host's files; the gate and review apply as for a deploy. Resume, and fix forward on main: the next plain `deploy.sh` returns the clone to main. If `deploy.sh` refuses a dirty code clone, do not clean it by hand: find out how it changed, then move it aside (`chmod -R u+w ~/peanutgallery-host/code && mv ~/peanutgallery-host/code ~/peanutgallery-code.suspect`) and run `install.sh`, which clones it fresh.

### Rotate a key

Pause from /board. Change the value in `~/peanutgallery-host/env/dispatcher.env` (or write it again with `make-dispatcher-env.sh`), run `platform/ops/mac/install.sh` (it copies it into the code clone and reports 1 change), then `launchctl kickstart -k gui/$(id -u)/studio.peanutgallery.dispatcher` and check `startup probe passed` in the log and the heartbeat. Resume, and only then revoke the old key. The keys are those of [Rotate a key](#rotate-a-key) above. A job's key changes in its own env file, written again with `make-jobs-env.sh`; the next run reads it.

### Read logs

```sh
tail -f ~/peanutgallery-host/logs/dispatcher.log                                   # follow
grep -v '"level":"info"' ~/peanutgallery-host/logs/dispatcher.log | tail -n 50    # warnings and errors
grep '^run-dispatcher:' ~/peanutgallery-host/logs/dispatcher.log | tail            # starts, stops, restarts
tail -n 20 ~/peanutgallery-host/logs/backup.log ~/peanutgallery-host/logs/controller.log ~/peanutgallery-host/logs/quota.log
launchctl print gui/$(id -u)/studio.peanutgallery.dispatcher | grep -E 'state|pid|last exit'
```

### Exit codes and restarts

- **Exit 78**, or a failed check in the wrapper (no code clone, no `node_modules`, no `.env`, a work clone without an https origin), is a startup failure no restart can fix. The wrapper posts "Mob Machine dispatcher stopped on <host>: fatal startup error" to ntfy and exits 0, which launchd does not restart. Fix the cause (the last lines of `dispatcher.log` say why), then `platform/ops/mac/install.sh --start`.
- **Any other exit** waits 30 seconds, doubling at each failure in a row to 30 minutes at the seventh, then exits 1 and launchd starts it again; a run of 10 minutes or more starts the count again. The ninth start within 6 hours is refused with an ntfy post, as on a server. After fixing the cause, `platform/ops/mac/install.sh --start` clears the counts and starts it.
- **A stop** (`launchctl bootout`, `kickstart -k`, logging out, shutting down) sends the wrapper SIGTERM, which it passes to the dispatcher; launchd gives it 90 seconds, and the dispatcher interrupts, meters and archives any running session within its 50.

### Backups on the Mac

`backup-mac.sh` dumps as the read-only `peanutgallery_backup` login through the Session pooler, with the same refusals as the server's `backup.sh`: no owner's connection string and no Stripe secret key, under any name, in its env file. The password reaches libpq in a service file inside the run's private folder, never on a command line. It needs `pg_dump` at least the server's major version, and says so otherwise (`brew upgrade libpq`). The dump set is `roles.sql` (`pg_dumpall --roles-only --no-role-passwords`, Supabase's own roles commented out as the Supabase CLI does; if the login is refused this, the run fails and says so), `schema.sql` and `data.sql` (the public and `money` schemas: every schema the migrations create, because `pg_dump --schema` leaves out what a named schema depends on), `auth.sql` (left out with `BACKUP_SKIP_AUTH=1`), `history_schema.sql`, `history_data.sql`, and `identity.json`, the live ledger identity when the dump was taken. They are tarred, encrypted to the board's age key, and written to `BACKUP_DIR` as `peanutgallery-<UTC time>.tar.age` under a hidden name first and then renamed, so Drive never copies half a file. The plaintext is deleted on every exit. Backups older than `BACKUP_KEEP_DAYS` (30 unless set) are deleted, keeping at least the newest 7; Drive keeps a deleted file in its trash for 30 days. Success pings `BACKUP_HEALTHCHECK_URL`; failure pings its `/fail`, and `run-job.sh` posts to ntfy.

There is no weekly restore check on the Mac: it needs a scratch Supabase Postgres, which the server ran in Docker and the Mac has not got. The restore drill below is the check, by hand.

### Restore a Mac backup

1. **Fetch it** from the backup folder, or from Google Drive on the web if the Mac is gone.
2. **Decrypt it** with the offline key: `age -d -i <path to the key> -o backup.tar peanutgallery-<time>.tar.age && tar -xf backup.tar`.
3. **Pick the target.** For the drill, a second free Supabase project; for a real recovery, a new project in the same region. In its Dashboard, Database, Extensions, turn on `pg_cron`.
4. **Restore,** with Homebrew's `psql` (the same major version as the `pg_dump` that wrote it: a newer `pg_dump` writes lines an older `psql` cannot read) and the target's owner connection string, which stays in the board's shell:
   ```sh
   PSQL=/opt/homebrew/opt/libpq/bin/psql
   $PSQL --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' --file data.sql --dbname "<target>"
   $PSQL --single-transaction --variable ON_ERROR_STOP=1 --command 'SET session_replication_role = replica' --file auth.sql --dbname "<target>"
   $PSQL --single-transaction --variable ON_ERROR_STOP=1 --file history_schema.sql --file history_data.sql --dbname "<target>"
   ```
   Skip the `auth.sql` line when the backup has none. Then, from the repository, make what the migrations make outside the dumped schemas, which no dump carries: the trigger that limits sign-in to board accounts, Realtime's tables, the backup login's reads and the pg_cron jobs:
   ```sh
   $PSQL --single-transaction --variable ON_ERROR_STOP=1 --file platform/ops/after-restore.sql --dbname "<target>"
   ```
5. **Check it:** `$PSQL --dbname "<target>" -At -c "select public.ledger_identity()->>'holds'"` must print exactly `true`, `select public.ledger_identity()` must show the same lines as `identity.json`, and `select jobname, schedule from cron.job order by jobname` must list every job `after-restore.sql` schedules. Quote all three in `docs/specs/mac-host.md`.
6. **A real recovery** then follows [Restore the database](#restore-the-database), step 6.
7. **Delete the decrypted copy** (`rm -r backup.tar peanutgallery-*`, leaving the `.tar.age`) and put the key back offline.

### Stop the host

To move to a server, or to stop for good: pause from /board, then `platform/ops/mac/uninstall.sh`, which unloads and removes the four LaunchAgents. It leaves `~/peanutgallery-host` and prints how to remove it (the code clone must be made writable first). A server's cutover starts only after this, so two dispatchers never run.

### What is weaker than a server

- **One user, not two.** On a server the dispatcher runs as uid 10001 from a root-owned clone mounted read-only, so it cannot change its own code. On the Mac it runs as the board's own user, and the code clone is read-only by its mode bits alone: that user could `chmod` it back. The dispatcher still refuses to start from a clone it can write. What keeps agent-written code from using this is that none runs on the Mac: card sessions run in Anthropic's containers, and their patches are checked and applied only into worktrees outside the code clone, with hooks and fsmonitor off.
- **The dispatcher can read the board's files.** A server holds only the dispatcher's secrets. On the Mac the same user owns the board's own checkout and its `.env` (the founder's key, the Stripe secret key, the Supabase access token), ssh keys and browser sessions. The dispatcher starts with only the environment it needs, but a flaw in it, or in a dependency, would reach all of that.
- **No container.** No memory or process limit, no dropped capabilities, no read-only root for the jobs; the Controller and the quota check run as the board's user, not as nobody.
- **The install runs as the board.** `pnpm install` runs with no secret in its environment and a HOME of its own, but not in a throwaway container: an install script could read the board's files. The workspace allows build scripts for `esbuild` only (`pnpm-workspace.yaml`).
- **It sleeps and restarts.** Closing the lid, a power cut, a network drop, or a restart that waits at the FileVault login screen stops the dispatcher until the board is back. healthchecks.io alerts on all of them; nothing restarts the Mac by itself.
- **The backups are not write-only.** The server could add backups and never read or delete one. The Mac writes to a folder it can read and delete; Drive's trash keeps a deleted file 30 days. The weekly restore check is a drill by hand, and the dump set is pg_dump's own rather than the Supabase CLI's, so the first drill is what proves it restores.
- **The attended dispatcher shares the machine.** It must not be started while the host runs. The lease keeps a second one from ticking, and its attended mode would stop it at startup, but it is one command away.
