# Dispatcher on the VPS: runbook

The dispatcher runs unattended on a small Ubuntu server in a Docker container under systemd, on the studio's Anthropic key (`docs/specs/vps.md`). This page is how the board provisions it, cuts over from the Mac, deploys, rotates keys, reads logs, pauses and rolls back.

## What runs where

- **Host.** Ubuntu 24.04, arm64 or x86, with Docker from Docker's apt repository, ufw, unattended upgrades and key-only SSH. The board's instance is an Oracle Cloud Always Free Ampere shape in Toronto: free, in Canada, 4 cores and 24 GB of memory. Everything below is the same on any Ubuntu 24.04 host.
- **Two clones and a worktree folder** (`docs/specs/ops-separation.md`). Agent-written code runs as uid 10001, so nothing uid 10001 can write is ever run by root or loaded as the dispatcher's code.

  | Host path | Owner | In the container | Holds |
  |---|---|---|---|
  | `/srv/peanutgallery-code` | root, not writable by others | `/opt/peanutgallery`, read-only | the code clone: the dispatcher's code, `node_modules` and the pnpm store (`.pnpm-store`, excluded from git). Only `deploy.sh` and `provision.sh` change it. |
  | `/srv/peanutgallery` | uid 10001 | same path, read-write | the work clone: the git state the dispatcher fetches, pushes and adds worktrees from. Nothing runs from it, and root runs no git in it. |
  | `/srv/peanutgallery-worktrees` | uid 10001, 0700 | same path, read-write | card, smoke and probe worktrees. Their metadata lives in the work clone's `.git`, so both survive restarts. |

  The dispatcher starts with `DISPATCHER_CODE_READONLY=required` and exits 78 when it can write to its code root or its `node_modules`.
- **Image.** `peanutgallery/dispatcher:current` (also tagged with the commit it was built or deployed at), built from `git archive <sha>:platform/ops`, never from a working tree. It holds Node 22, git, tini, bubblewrap, socat, pnpm 11.0.9 and the claude CLI 2.1.139, plus Claude Code's managed settings at `/etc/claude-code/managed-settings.json` (root, 0644: hooks off, reads of `/proc`, the env files and credential folders denied, edits to both clones denied). Its entrypoint checks the CLI version, the code clone and the work clone's https origin, and starts `platform/dispatcher/src/main.ts` from the code clone. It installs nothing.
- **Secrets.** `/etc/peanutgallery/dispatcher.env`, root 0600, read only by `docker run --env-file`. Format: `KEY=value`, no quotes, no `export`, JSON on one line.
- **Units.** `dispatcher.service` runs the container. `dispatcher-alert.service` posts to ntfy when the dispatcher unit fails for good; it reads the topic URL from `/etc/peanutgallery/ntfy.url`.

| File | Runs on | Does |
|---|---|---|
| `make-dispatcher-env.sh` | the Mac | writes the env file from `.env` and three exported values |
| `provision.sh` | the VPS, as root | prepares the host, creates both clones and the worktree folder, validates the env file, builds, installs `node_modules`, installs and enables the units |
| `deploy.sh` | the VPS, as root | refuses a dirty code clone, fast-forwards it to `origin/main` (or checks out `--ref <sha>`), rebuilds if `platform/ops` changed, reinstalls `node_modules`, restarts, waits for the probe |
| `Dockerfile.dispatcher`, `dispatcher-entrypoint.sh`, `managed-settings.json` | the VPS | the image |
| `dispatcher.service`, `dispatcher-alert.service` | the VPS | the units |

## Operator inputs

The board supplies these; nothing in the repository holds them. Export them in the Mac shell for the steps below.

| Variable | What it is |
|---|---|
| `VPS_IP` | the instance's public IPv4 address |
| `VPS_GITHUB_TOKEN` | a fine-grained GitHub token for the VPS (below), not the Mac's `GITHUB_TOKEN` |
| `HEALTHCHECK_URL` | the healthchecks.io ping URL for the VPS check |
| `NTFY_TOPIC_URL` | the ntfy topic URL, `https://ntfy.sh/<topic>` |

## Provision

1. **Create the instance.** Oracle Cloud, region `ca-toronto-1` (or `ca-montreal-1`): Always Free, shape `VM.Standard.A1.Flex` with 4 OCPUs and 24 GB, image Ubuntu 24.04, the board's SSH key, no root password. Export its address as `VPS_IP`. The default user is `ubuntu`, so run the steps below with `ssh ubuntu@$VPS_IP sudo ...`. Any other Ubuntu 24.04 host works unchanged.
2. **Provider firewall.** Inbound: TCP 22 only. Outbound: everything. On Oracle that is the subnet's security list (its default already allows SSH only); leave the instance's pre-installed iptables rules alone. The dispatcher publishes no port, and Docker's `-p` would bypass ufw, so this firewall matches ufw rather than trusting it.
3. **The GitHub token.** GitHub, Settings, Developer settings, Fine-grained tokens: resource owner AlreadyKyle, only the `peanutgallery` repository. Permissions: Contents read and write, Pull requests read and write, Checks read, Metadata read. No Workflows. Export it as `VPS_GITHUB_TOKEN`.
4. **Alerts.** Create a healthchecks.io check for the VPS with a 1-minute period and a 5-minute grace, email to the board; export its ping URL as `HEALTHCHECK_URL`. Choose an ntfy topic, subscribe to it on the board's phones, and export its URL as `NTFY_TOPIC_URL`.
5. **Write the env file on the Mac,** at the repository root:
   ```sh
   platform/ops/make-dispatcher-env.sh
   ```
   It prints the path it wrote (a new temporary folder) and the key names, never the values. It refuses when an exported value is missing, when `VPS_GITHUB_TOKEN` equals the Mac's token, or when `MODEL_BUILDER`, or a `MODEL_DIRECTOR` or `MODEL_HOST` that `.env` sets, has no row in `PRICE_TABLE_JSON`. It copies no `ANTHROPIC_API_KEY`, `CLAUDE_BIN` or `DISPATCHER_WORKTREE_ROOT` from the Mac, and uses `SUPABASE_SECRET_KEY` as the service key when `.env` has one.
6. **Upload it** (replace `<path>` with the printed path), then delete the local copy:
   ```sh
   ssh root@$VPS_IP 'install -d -m 0700 /etc/peanutgallery'
   scp <path> root@$VPS_IP:/etc/peanutgallery/dispatcher.env
   ssh root@$VPS_IP 'chown root:root /etc/peanutgallery/dispatcher.env && chmod 600 /etc/peanutgallery/dispatcher.env'
   rm -r "$(dirname <path>)"
   ```
7. **The ntfy URL for the alert unit:**
   ```sh
   printf '%s\n' "$NTFY_TOPIC_URL" | ssh root@$VPS_IP 'umask 077 && cat > /etc/peanutgallery/ntfy.url'
   ```
8. **Provision:**
   ```sh
   ssh root@$VPS_IP 'bash -s' < platform/ops/provision.sh
   ```
   It clones the code clone as root with the token from the env file and refuses it if it has uncommitted or untracked files. It validates the env file (root 0600, no quoted value, `AGENT_MODE=unattended`, every required key, `PRICE_TABLE_JSON` parsed by node with a row for `MODEL_BUILDER` and any `MODEL_DIRECTOR` or `MODEL_HOST`, none of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, and none of the `DISPATCHER_*_ROOT` or `DISPATCHER_CODE_READONLY` values the unit sets). It builds the image from the commit, installs `node_modules` into the code clone in a throwaway container with no secret, and makes the code clone root-owned and not writable by others. It clones the work clone inside the image as uid 10001, creates `/srv/peanutgallery-worktrees`, installs both units from the commit, runs `systemd-analyze verify` and enables the dispatcher without starting it. Run it a second time: the last line must read `provision: done: 0 change(s)`.

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
4. **Start the service:** `ssh root@$VPS_IP 'systemctl start dispatcher'`.
5. **The probe.** `ssh root@$VPS_IP 'journalctl -u dispatcher -n 50 --no-pager'` must show `startup probe passed` with `"apiKeySource":"ANTHROPIC_API_KEY"`, after a `probe metered` line naming the ledger row. Quote it in the spec.
6. **Heartbeat.** /board shows the dispatcher seen under 3 minutes ago; the healthchecks.io check is green.
7. **Resume** from /board.
8. **Restart check.** `ssh root@$VPS_IP 'systemctl restart dispatcher'`, then as the service role `select paused, dispatcher_seen_at from studio_state`: `paused` is still false and `dispatcher_seen_at` moves within 2 minutes. Then `ssh root@$VPS_IP reboot` and run the same query.
9. **Liveness alert.** `ssh root@$VPS_IP 'systemctl stop dispatcher'` and wait out the check's grace: healthchecks.io emails the board. Start it again.
10. **Soak for 24 hours** with no restart loop (`systemctl show dispatcher -p NRestarts`) and no unexpected alert. The first funded card built in this window must have `billed_to = 'studio'` ledger rows.

After cutover, running `pnpm --filter @backseat/supabase seed` from the Mac leaves `studio_state` alone and prints a warning when `.env` still says attended.

## Deploy an update

1. Merge to main as usual (the gate green on the head sha).
2. Pause from /board and let any building card finish.
3. `ssh root@$VPS_IP 'bash /srv/peanutgallery-code/platform/ops/deploy.sh'`

It refuses unless `studio_state.paused` is true and no card is building or gated, and while the dispatcher unit is stopped (before the cutover, a start would run a second dispatcher beside the Mac's). It refuses when the code clone has any uncommitted or untracked file: only `deploy.sh` and `provision.sh` change that clone, so a difference means someone else did, and the refusal prints the files and the commands to inspect them. Then, in the code clone only, with `core.fsmonitor` and hooks off on every git call:
- It fetches `main` with a one-off token header, fast-forwards to the fetched `origin/main` (checking out `main` first after a roll back), and checks that `HEAD` is `origin/main`.
- It rebuilds the image from `git archive` of the new commit only when `platform/ops` changed (otherwise it tags `:current` with the new sha too).
- It runs `pnpm install --frozen-lockfile` into the code clone in a throwaway container: root inside, no capability, no env file. It then makes the clone root-owned and not writable by others, and checks it is still clean.
- It installs changed units from `git show <new sha>:platform/ops/<unit>`.

It restarts and waits up to 10 minutes for `startup probe passed`; the journal also shows `code root is read-only` before it. Then resume from /board. If the build or the install fails, the code clone is already at the new commit: fix main and run `deploy.sh` again, or roll back.

`deploy.sh` never touches the work clone: the dispatcher fetches `main` there itself before every card.

## Roll back

When a deploy leaves the dispatcher failing or misbehaving:

1. Pause from /board.
2. Find the previous commit:
   ```sh
   ssh root@$VPS_IP 'git -c safe.directory=/srv/peanutgallery-code -c core.fsmonitor=false -c core.hooksPath=/dev/null -C /srv/peanutgallery-code log --oneline -5 origin/main; docker image ls peanutgallery/dispatcher'
   ```
3. Deploy it by its full sha (replace `<previous-sha>`):
   ```sh
   ssh root@$VPS_IP 'bash /srv/peanutgallery-code/platform/ops/deploy.sh --ref <previous-sha>'
   ```
   `--ref` takes a full 40-character sha that must be on `origin/main`. `deploy.sh` checks it out detached in the code clone, reuses `peanutgallery/dispatcher:<previous-sha>` when that image exists (else builds it from the commit), installs that commit's `node_modules` and units, restarts, and waits for the probe. A failed unit (exit 78) is fine; a stopped one is refused as usual.
4. Resume from /board.
5. Fix forward on main. The next plain `deploy.sh` checks out `main` again and fast-forwards to `origin/main`, so do not run it until the fix is merged.

If `deploy.sh` refuses a dirty code clone, do not clean it by hand and deploy over it. Inspect the files it lists, find out how they changed, and if in doubt move the clone aside (`mv /srv/peanutgallery-code /root/peanutgallery-code.suspect`) and run `provision.sh` again, which clones it fresh.

A card that failed after merge is reverted on main by the dispatcher itself (`docs/specs/launch-hardening.md`); this section is for the dispatcher's own code.

## Rotate a key

Each rotation: pause from /board, change the value in `/etc/peanutgallery/dispatcher.env` on the VPS (for example `ssh -t root@$VPS_IP 'nano /etc/peanutgallery/dispatcher.env'`; the file keeps its owner and mode), run `provision.sh` again to validate it (it reports 0 changes), `systemctl restart dispatcher`, check `startup probe passed` and the heartbeat, resume, and only then revoke the old key.

- **GitHub token.** Create a new fine-grained token with the same repository and permissions (Provision, step 3), set `GITHUB_TOKEN`, restart, and check the next card pushes its branch from the work clone. The next `deploy.sh` fetches the code clone with the same value. Revoke the old token on GitHub. The token lives only in the env file on the VPS; neither clone stores it.
- **Studio Anthropic key.** In the studio's Console organization (never the founder's), create a key, set `STUDIO_ANTHROPIC_API_KEY`, restart: the probe must pass with `apiKeySource` `ANTHROPIC_API_KEY`. Delete the old key in the Console. Update the Mac's `.env` too.
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

- **Exit 78** is a startup failure no restart can fix: a configuration error, a code root the dispatcher can write to (the unit's `:ro` mount or the code clone's owner is wrong; run `deploy.sh` or `provision.sh` again), a probe verdict that will not change (forbidden tools, memory paths, the wrong `apiKeySource`, no tools), a model missing from `PRICE_TABLE_JSON` (the configured models, a writing role's model, or a model the probe reported), the wrong claude CLI, or a clone without an https origin. systemd does not restart it; the unit fails and ntfy gets "Peanut Gallery dispatcher unit failed on <hostname>". Fix the cause, then `systemctl reset-failed dispatcher && systemctl start dispatcher`.
- **Any other exit** restarts after 30 seconds, the delay growing over 6 steps to 30 minutes: a probe with no stream or an error result, a failed install, a mode mismatch with /board. After 8 starts in 6 hours the unit fails and ntfy is posted the same way.

## The money guardrail

The studio's Console organization holds prepaid credit with auto-reload off and a $500 monthly limit. The board tops it up by hand as Stripe payouts arrive, so API spend can never outrun customer money. Inside that, the dispatcher's own caps apply: the pool balance, the daily cap and the per-card ceiling.

## Known risk

Agent-written test code runs as the dispatcher's OS user (uid 10001) and could read the dispatcher's environment, secrets included, from `/proc`.

In place:
- Agent sessions and the smoke test's headless bot start from an allowlisted environment with no secret; `pnpm install` runs only in `deploy.sh`'s throwaway container, which has none.
- Every git command the dispatcher, `deploy.sh` and `provision.sh` run has fsmonitor and hooks off, so a planted hook or fsmonitor never runs with the dispatcher's environment or as root.
- uid 10001 cannot change the code the dispatcher runs or the files root acts on: the dispatcher runs from the root-owned code clone mounted read-only and refuses to start if it can write there, root never runs git or code from the work clone, and `deploy.sh` refuses a dirty code clone and reads the image and units from the commit (`docs/specs/ops-separation.md`).
- The Console limit caps what a leaked studio key can spend.

Follow-up: run agent sessions under a separate uid through a sudo wrapper at `CLAUDE_BIN`. It is specified and built before any card source other than the board opens.
