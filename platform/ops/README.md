# Dispatcher on the VPS: runbook

The dispatcher runs unattended on a Hetzner VPS in a Docker container under systemd, on the studio's Anthropic key (`docs/specs/vps.md`). This page is how the board provisions it, cuts over from the Mac, deploys, rotates keys, reads logs, pauses and rolls back.

## What runs where

- **Host.** Ubuntu 24.04 on x86 (Hetzner CX22 or CPX21), with Docker from Docker's apt repository, ufw, unattended upgrades and key-only SSH.
- **Repository.** An https clone at `/srv/peanutgallery`, owned by uid 10001. It is bind-mounted at the same path in the container, so card worktrees (`.worktrees`) and the pnpm store (`.pnpm-store`) live in the clone and survive restarts.
- **Image.** `peanutgallery/dispatcher:current` (also tagged with the commit it was built or deployed at). It holds Node 22, git, tini, pnpm 11.0.9 and the claude CLI 2.1.139, and nothing from the repository. Its entrypoint checks the CLI version and the https origin, runs `pnpm install` with no secret in its environment, and starts `platform/dispatcher/src/main.ts`.
- **Secrets.** `/etc/peanutgallery/dispatcher.env`, root 0600, read only by `docker run --env-file`. Format: `KEY=value`, no quotes, no `export`, JSON on one line.
- **Units.** `dispatcher.service` runs the container. `dispatcher-alert.service` posts to ntfy when the dispatcher unit fails for good; it reads the topic URL from `/etc/peanutgallery/ntfy.url`.

| File | Runs on | Does |
|---|---|---|
| `make-dispatcher-env.sh` | the Mac | writes the env file from `.env` and three exported values |
| `provision.sh` | the VPS, as root | prepares the host, clones, validates the env file, builds, installs and enables the units |
| `deploy.sh` | the VPS, as root | fast-forwards to `origin/main`, rebuilds if `platform/ops` changed, restarts, waits for the probe |
| `Dockerfile.dispatcher`, `dispatcher-entrypoint.sh` | the VPS | the image |
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

1. **Create the instance.** Hetzner Cloud: Ubuntu 24.04, x86, CX22 or CPX21, with the board's SSH key and no root password. Export its address as `VPS_IP`.
2. **Hetzner Cloud firewall.** Inbound: TCP 22 only. Outbound: everything. Attach it to the instance. The dispatcher publishes no port, and Docker's `-p` would bypass ufw, so this firewall matches ufw rather than trusting it.
3. **The GitHub token.** GitHub, Settings, Developer settings, Fine-grained tokens: resource owner AlreadyKyle, only the `peanutgallery` repository. Permissions: Contents read and write, Pull requests read and write, Checks read, Metadata read. No Workflows. Export it as `VPS_GITHUB_TOKEN`.
4. **Alerts.** Create a healthchecks.io check for the VPS with a 1-minute period and a 5-minute grace, email to the board; export its ping URL as `HEALTHCHECK_URL`. Choose an ntfy topic, subscribe to it on the board's phones, and export its URL as `NTFY_TOPIC_URL`.
5. **Write the env file on the Mac,** at the repository root:
   ```sh
   platform/ops/make-dispatcher-env.sh
   ```
   It prints the path it wrote (a new temporary folder) and the key names, never the values. It refuses when an exported value is missing, when `VPS_GITHUB_TOKEN` equals the Mac's token, or when `MODEL_BUILDER` has no row in `PRICE_TABLE_JSON`. It copies no `ANTHROPIC_API_KEY`, `CLAUDE_BIN` or `DISPATCHER_WORKTREE_ROOT` from the Mac, and uses `SUPABASE_SECRET_KEY` as the service key when `.env` has one.
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
   It clones with the token from the env file, validates the env file (root 0600, no quoted value, `AGENT_MODE=unattended`, every required key, `PRICE_TABLE_JSON` parsed by node, none of `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SUPABASE_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`), builds the image, runs `systemd-analyze verify` on both units and enables the dispatcher without starting it. Run it a second time: the last line must read `provision: done: 0 change(s)`.

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
3. **Set agent mode to unattended** from /board. Once `docs/specs/launch-pages.md` ships the second factor, this needs it.
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
3. `ssh root@$VPS_IP 'bash /srv/peanutgallery/platform/ops/deploy.sh'`

It refuses unless `studio_state.paused` is true and no card is building or gated, unless the clone is on `main`, and while the dispatcher unit is stopped (before the cutover, a start would run a second dispatcher beside the Mac's). It fetches with a one-off token header and fast-forwards inside the image as uid 10001. It rebuilds the image only when `platform/ops` changed (otherwise it tags `:current` with the new sha too), reinstalls changed units, restarts, and waits up to 10 minutes for `startup probe passed`. Then resume from /board. If the build fails, the clone is already at the new commit and the running dispatcher is unchanged: fix main and run `deploy.sh` again (it builds again), or roll back.

## Roll back

When a deploy leaves the dispatcher failing or misbehaving:

1. Pause from /board.
2. Find the previous commit and its image:
   ```sh
   ssh root@$VPS_IP 'git -c safe.directory=/srv/peanutgallery -C /srv/peanutgallery log --oneline -5; docker image ls peanutgallery/dispatcher'
   ```
3. Point `:current` at the previous image and check out the previous commit, detached, as uid 10001 (replace `<previous-sha>`):
   ```sh
   ssh root@$VPS_IP 'docker tag peanutgallery/dispatcher:<previous-sha> peanutgallery/dispatcher:current &&
     docker run --rm --pull never --user 10001:10001 --volume /srv/peanutgallery:/srv/peanutgallery \
       --workdir /srv/peanutgallery --entrypoint git peanutgallery/dispatcher:current \
       -c core.hooksPath=/dev/null checkout --detach <previous-sha>'
   ```
4. If the bad commit changed a unit: `ssh root@$VPS_IP 'install -m 0644 /srv/peanutgallery/platform/ops/dispatcher*.service /etc/systemd/system/ && systemctl daemon-reload'`.
5. `ssh root@$VPS_IP 'systemctl reset-failed dispatcher; systemctl restart dispatcher'`, check for `startup probe passed`, resume.
6. Fix forward on main. Before the next deploy, put the clone back on main (the same `docker run ... git` command with `checkout main`); `deploy.sh` refuses a detached clone.

A card that failed after merge is reverted on main by the dispatcher itself (`docs/specs/launch-hardening.md`); this section is for the dispatcher's own code.

## Rotate a key

Each rotation: pause from /board, change the value in `/etc/peanutgallery/dispatcher.env` on the VPS (for example `ssh -t root@$VPS_IP 'nano /etc/peanutgallery/dispatcher.env'`; the file keeps its owner and mode), run `provision.sh` again to validate it (it reports 0 changes), `systemctl restart dispatcher`, check `startup probe passed` and the heartbeat, resume, and only then revoke the old key.

- **GitHub token.** Create a new fine-grained token with the same repository and permissions (Provision, step 3), set `GITHUB_TOKEN`, restart, and check the next card pushes its branch. Revoke the old token on GitHub. The token lives only on the VPS.
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

Dispatcher lines are JSON with `ts`, `level`, `scope` and `msg`; the entrypoint and `pnpm install` print plain text before them. `agent_events` and `ledger` remain the record of what each card did.

## Pause from /board

/board's Pause stops new cards at the next tick, and a running session ends at its next check with the card paused. The dispatcher keeps running, pinging healthchecks.io and writing its heartbeat. Stopping the service does not pause the studio: `studio_state.paused` stays as it was, so a restart resumes work unless the board paused first.

## Exit codes and restarts

- **Exit 78** is a startup failure no restart can fix: a configuration error, a probe verdict that will not change (forbidden tools, memory paths, the wrong `apiKeySource`, no tools), a model missing from `PRICE_TABLE_JSON`, the wrong claude CLI, or a clone without an https origin. systemd does not restart it; the unit fails and ntfy gets "Peanut Gallery dispatcher unit failed on <hostname>". Fix the cause, then `systemctl reset-failed dispatcher && systemctl start dispatcher`.
- **Any other exit** restarts after 30 seconds, the delay growing over 6 steps to 30 minutes: a probe with no stream or an error result, a failed install, a mode mismatch with /board. After 8 starts in 6 hours the unit fails and ntfy is posted the same way.

## The money guardrail

The studio's Console organization holds prepaid credit with auto-reload off and a $500 monthly limit. The board tops it up by hand as Stripe payouts arrive, so API spend can never outrun customer money. Inside that, the dispatcher's own caps apply: the pool balance, the daily cap and the per-card ceiling.

## Known risk

Agent-written test code runs as the dispatcher's OS user (uid 10001) and could read the dispatcher's environment, secrets included, from `/proc`.

In place:
- Agent sessions, the smoke test's headless bot and the entrypoint's `pnpm install` start from an allowlisted environment with no secret.
- Every git command the dispatcher runs has hooks off, so a planted hook never runs with its environment.
- The Console limit caps what a leaked studio key can spend.

Follow-up: run agent sessions under a separate uid through a sudo wrapper at `CLAUDE_BIN`. It is specified and built before any card source other than the board opens.
