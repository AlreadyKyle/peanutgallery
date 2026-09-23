# Dispatcher on the VPS: runbook

The dispatcher runs unattended on a small Ubuntu server in a Docker container under systemd, on the studio's Anthropic key (`docs/specs/vps.md`). Each card's agent runs as a Claude Managed Agents session in a container Anthropic hosts (`docs/specs/launch-managed.md`): the VPS holds the session's event stream, meters it, applies the patch the agent hands back, and drives the gate, merge and deploy. No agent-written code runs on the VPS. This page is how the board provisions it, cuts over from the Mac, deploys, rotates keys, reads logs, pauses and rolls back.

## What runs where

- **Host.** Ubuntu 24.04, arm64 or x86, with Docker from Docker's apt repository, ufw, unattended upgrades and key-only SSH. The board's instance is an Oracle Cloud Always Free Ampere shape in Toronto: free, in Canada, 2 cores and 12 GB of memory, the Always Free limit (`docs/specs/money-safety.md`). Everything below is the same on any Ubuntu 24.04 host.
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
| `backups-repo/` | a separate private repository | the weekly fallback backup's workflow template |

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
   - **The dispatcher's token.** Start from the pre-filled form, https://github.com/settings/personal-access-tokens/new?name=peanutgallery-vps&description=Peanut+Gallery+VPS+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&checks=read , then choose the repository. By hand: GitHub, Settings, Developer settings, Fine-grained tokens: resource owner AlreadyKyle, only the `peanutgallery` repository. Permissions: Contents read and write, Pull requests read and write, Checks read, Metadata read. No Workflows, no Actions. Export it as `VPS_GITHUB_TOKEN`.
   - **The sessions' read-only token.** Managed Agents sessions clone the repository through Anthropic's git proxy with this token, and the proxy also forwards GitHub REST calls, so it must carry no write permission of any kind: main has no branch protection. Start from https://github.com/settings/personal-access-tokens/new?name=peanutgallery-managed-read&description=Peanut+Gallery+Managed+Agents+sessions,+read+only&target_name=AlreadyKyle&expires_in=366&contents=read , choose "Only select repositories" and this repository, and add nothing else (Metadata read comes with it). Export it as `GITHUB_READ_TOKEN`, and put the same value in the Mac's `.env` for the check in step 5. The dispatcher, `make-dispatcher-env.sh` and `provision.sh` each refuse it when it equals a token that can write, and the dispatcher and `provision.sh` refuse it unless GitHub denies it a write (a ref write at the all-zero sha, which changes nothing).
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
   `--ref` takes a full 40-character sha. It must be on `origin/main`, at or after `ROLLBACK_FLOOR` in `deploy.sh`, and its `platform/ops/dispatcher.service` must mount the code clone read-only, so a roll back never returns to a commit where the dispatcher ran from a clone it could write. `ROLLBACK_FLOOR` is empty until this layout merges: the board then sets it to the merge sha of `docs/specs/ops-separation.md` and only ever moves it forward. While it is empty, every `--ref` is refused.

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

- **Exit 78** is a startup failure no restart can fix: a configuration error (a missing managed id, a read token equal to a write token, a GitHub token that is not fine-grained), a code root the dispatcher can write to (the unit's `:ro` mount or the code clone's owner is wrong; run `deploy.sh` or `provision.sh` again), a containment failure (a read token GitHub does not deny a write, an agent whose tools, MCP servers, skills, model speed or version differ from `agent.yaml`, an environment whose networking differs from `environment.yaml`), a probe session whose agent differs or that the API refuses outright, a model missing from `PRICE_TABLE_JSON` (the configured models, a writing role's model, or the probe's), or a clone without an https origin. systemd does not restart it; the unit fails and ntfy gets "Peanut Gallery dispatcher unit failed on <hostname>". Fix the cause, then `systemctl reset-failed dispatcher && systemctl start dispatcher`.
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

Oracle stops an Always Free instance whose CPU (at the 95th percentile), network and memory all stay under 20% for 7 days, and the dispatcher is idle by design between funded cards. When that happens the healthchecks.io checks alert the board.

**Recovery needs no laptop.** On a phone, sign in at cloud.oracle.com, then Compute, Instances, `peanutgallery-dispatcher`, Start. `dispatcher.service` and the job timers are enabled, so the dispatcher comes back on boot, and each timer's `Persistent=` runs the backup, the Controller or the quota check it missed while the instance was stopped. If Oracle answers that it has no capacity, try again later. From the Mac, `platform/ops/oracle-launch.sh` after `oci session authenticate` does the same and retries capacity by itself.

Oracle's documentation does not say that moving the tenancy to Pay As You Go ends idle reclaim, so nothing here relies on it; it would also put a card on file, which is the board's call (`docs/BOARD-SETUP.md`).

## Backups and the Controller

Three jobs run on the VPS beside the dispatcher and outside it (`docs/specs/money-safety.md`), each a oneshot unit started by its own timer, each with its own env file in `/etc/peanutgallery`, root 0600, holding only that job's keys. They do not need the dispatcher running, so they run before the cutover too. A job that cannot run posts "Peanut Gallery job <unit> failed" to ntfy through `peanutgallery-job-alert@.service`.

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

With `oci session authenticate --region ca-toronto-1 --profile-name peanutgallery` done on the Mac, and the tenancy's OCID as `TENANCY` (the `tenancy=` line of `~/.oci/config`):

1. **The bucket**, private, once: `oci os bucket create --auth security_token --profile peanutgallery -c "$TENANCY" --name peanutgallery-backups --public-access-type NoPublicAccess`. Always Free Object Storage holds 20 GB, far more than these dumps.
2. **Two write-only pre-authenticated requests**, one for the VPS and one for the backups repository, so either can be revoked alone: `oci os preauth-request create --auth security_token --profile peanutgallery --bucket-name peanutgallery-backups --name vps-backup --access-type AnyObjectWrite --time-expires <the expiry the board chooses>`, and again with `--name actions-backup`. Each prints a `full-path`; the whole URL, ending in `/o/`, is the secret. Put the VPS's in `.env` as `BACKUP_PAR_URL=` with `BACKUP_BUCKET=peanutgallery-backups`. When a request expires, uploads fail and the backup check alerts; create a new one then. A request with `AnyObjectWrite` can add objects and cannot read, list or delete any.
3. **The board's age public key** in `.env` as `BACKUP_AGE_RECIPIENT=age1...` (`docs/BOARD-SETUP.md`). The private key never comes near the VPS or the repository.
4. **The backup login's password.** Migration `20260923000010_backup_role.sql` creates `peanutgallery_backup` with no password. Set one once through the Management API query endpoint (`alter role peanutgallery_backup with password '<a new random password>'`), never in a file in the repository, and put the Session pooler string in `.env` as `BACKUP_DB_URL=postgresql://peanutgallery_backup.<project ref>:<password>@<the Session pooler host from Dashboard, Connect>:5432/postgres`. Read back what it can do: `select rolbypassrls, rolconfig from pg_roles where rolname = 'peanutgallery_backup'` and `select has_table_privilege('peanutgallery_backup', 'auth.users', 'select')`. If it cannot read the auth schema, the board resets the database password once and the owner's Session pooler string goes in `.env` as `BACKUP_OWNER_DB_URL=`; only the roles and auth dumps use it.
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

1. **Fetch a backup.** `oci os object list --auth security_token --profile peanutgallery --bucket-name peanutgallery-backups --query 'data[].name'`, then `oci os object get --auth security_token --profile peanutgallery --bucket-name peanutgallery-backups --name <object> --file <object>`.
2. **Decrypt it** with the key the board brings: `age -d -i <path to the key> -o backup.tar <object> && tar -xf backup.tar`. It holds `roles.sql`, `schema.sql`, `data.sql`, `auth.sql`, `history_schema.sql` and `history_data.sql`.
3. **Pick the target.** For the restore drill, a scratch database: a second free Supabase project, or Supabase's Postgres image in local Docker, as the weekly check uses. For a real recovery, a new Supabase project in the same region.
4. **Restore**, as Supabase documents it, with the target's owner connection string:
   ```sh
   psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' --file data.sql --dbname "<target>"
   psql --single-transaction --variable ON_ERROR_STOP=1 --command 'SET session_replication_role = replica' --file auth.sql --dbname "<target>"
   psql --single-transaction --variable ON_ERROR_STOP=1 --file history_schema.sql --file history_data.sql --dbname "<target>"
   ```
5. **Check it:** `psql --dbname "<target>" -At -c 'select public.ledger_identity()'` must show `"holds": true`. Quote it.
6. **For a real recovery, then:**
   - put the new project's URL and keys in `.env` and in the VPS's env files, and set the stripe-webhook function's secrets there;
   - deploy the webhook to the new project and create its Stripe endpoint with `platform/supabase/scripts/create-webhook-endpoint.ts`, which gives a new signing secret;
   - change the project ref in `platform/site/netlify.toml`, a kernel file, through a board pull request;
   - the board signs in again and re-enrols its second factor if the new project asks;
   - resend from the Stripe Dashboard every event since the backup's time (Developers, Events), then run the Controller to find anything still missing;
   - set a password for `peanutgallery_backup` in the new project and update `BACKUP_DB_URL`.
7. **Delete the decrypted copy** (`rm -r backup.tar peanutgallery-*`) and put the key back offline.

## Migration history

Production's migrations were applied through the Management API query endpoint, which records nothing in `supabase_migrations.schema_migrations`. Once, with the board's allow, `npx supabase@2.117.0 migration repair --status applied <each applied version> --linked` (after `npx supabase link --project-ref lyxndueoeisyqzewflpu`) records every applied file, and `npx supabase migration list --linked` must then show local and remote in step. Later migrations can then go through `supabase db push`. The nightly dump carries the history (`history_schema.sql`, `history_data.sql`), so a restore keeps it.
