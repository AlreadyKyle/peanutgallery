# The dispatcher on a VPS, unattended, with alerts

Status: draft. Card: none. Owner: board.

## Problem

The dispatcher runs on the founder's Mac in attended mode. A public studio needs it running around the clock on the studio's API key, spending only funded money, restarting on its own, and telling the board when it stops or a card fails.

## Scope

In:
- A Hetzner VPS with Docker and systemd.
- The dispatcher image with the `claude` CLI pinned.
- A provisioning script.
- The env file.
- The healthchecks.io check and the ntfy topic.
- Cutover from the Mac.
- A 24-hour soak.
- A runbook in `platform/ops/README.md`.

Out: OBS, the stream, the host, Twitch.

## Behaviour

**Image.** `platform/ops/Dockerfile.dispatcher` installs Node 22, pnpm, git and a pinned `@anthropic-ai/claude-code`. It runs as a non-root user with the git identity "Peanut Gallery agents".

**Service.** `dispatcher.service` loads `/etc/peanutgallery/dispatcher.env` (0600) with `Restart=always`. The env carries:
- `AGENT_MODE=unattended` and `STUDIO_ANTHROPIC_API_KEY`
- the GitHub token (repo scope), the Netlify token and site ids
- the Supabase URL and service key
- `PRICE_TABLE_JSON`, `MODEL_BUILDER`
- `HEALTHCHECK_URL`, `NTFY_TOPIC_URL`

**Provisioning.** `platform/ops/provision.sh` is idempotent, run over SSH. It installs Docker, sets ufw to allow SSH only and enables unattended-upgrades. It clones the repository with a read/write deploy key into `/srv/peanutgallery`, builds the image, and installs and enables the unit.

**Cutover.**
1. Stop the Mac dispatcher.
2. Set agent mode to unattended from /board.
3. Start the service.
4. The startup probe must pass with `apiKeySource ANTHROPIC_API_KEY` and bill the studio.

**Money guardrail.** The studio Console organization holds prepaid credit with auto-reload off and a $500 monthly limit. The board tops it up by hand as Stripe payouts arrive, so API spend can never outrun customer money.

## Acceptance criteria

- [ ] The /board heartbeat shows under 3 minutes after cutover, and the healthchecks.io check is green.
- [ ] `systemctl restart dispatcher` leaves `studio_state.paused` false and the heartbeat resumes within 2 minutes; a reboot does the same.
- [ ] Stopping the container triggers the healthchecks.io alert email within its grace period.
- [ ] A card funded by a real contribution builds with no board session and its ledger rows are `billed_to = 'studio'`.
- [ ] A rejected card posts one ntfy message.
- [ ] `platform/ops/README.md` covers provision, deploy an update, rotate a key, read logs, and pause from /board.

## Verification

- `journalctl -u dispatcher -n 50`, quoted, showing `startup probe passed` with `apiKeySource` `ANTHROPIC_API_KEY`.
- The restart and reboot checks, with `select paused, dispatcher_seen_at from studio_state` quoted.
- The healthchecks.io alert email and the ntfy message, screenshotted.
- The first unattended card's ledger rows quoted.

## Decisions

- 2026-09-14: a small Hetzner VPS rather than the Mac (board). The agents stop when a Mac sleeps.
- 2026-09-14: healthchecks.io for liveness, ntfy for events (`launch-hardening.md`).

## Needs the board

The Hetzner instance and its IP, the healthchecks.io check URL, the ntfy topic, a GitHub deploy key or fine-grained token for the VPS, and prepaid credit on the studio Console organization.
