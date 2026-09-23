# Oracle launch: create the VPS from a script

Status: built. Card: none. Owner: board.

## Problem

`docs/BOARD-SETUP.md` Part 2 had the board create the Oracle instance by hand in the console: about a dozen screens, one easy-to-miss "assign a public IPv4" switch, and the free Ampere tier's common "Out of capacity" answer, which by hand means retrying until it works. None of it was recorded, so rebuilding the box would mean doing it again from memory. The runbook's later steps also `ssh root@`, which Oracle's Ubuntu image refuses by default.

## Scope

In: `platform/ops/oracle-launch.sh`, run from the Mac after one browser sign-in (`oci session authenticate`). It builds the network, launches the instance, retries capacity, checks the firewall and proves ssh.
Out: the Oracle account itself (the board signs up; an agent may not create accounts), provisioning the host (`provision.sh`, unchanged), and the cutover.

## Behaviour

- The board signs in once with `oci session authenticate --region ca-toronto-1 --profile-name peanutgallery`. No API signing key is created or uploaded.
- The script finds or creates a VCN `peanutgallery-vcn`, an internet gateway, a `0.0.0.0/0` route and one public subnet, then finds or launches `peanutgallery-dispatcher`: Canonical Ubuntu 24.04 (not Minimal), `VM.Standard.A1.Flex`, 2 OCPUs and 12 GB, the Always Free limit (corrected by `money-safety.md`; the shape this spec first named was larger than the limit), public IPv4, the Mac's `~/.ssh/id_ed25519.pub`.
- On "Out of host capacity" it tries every availability domain in turn, waits `ROUND_SECONDS` (60) and goes again, up to `ROUNDS` (240), refreshing the session each round. Any other launch error stops it with Oracle's message.
- It refuses to continue if the subnet's security list admits any TCP or UDP ingress other than TCP 22.
- cloud-init sets `disable_root: false`, so root accepts the same key as `ubuntu` (key only; Ubuntu's `PermitRootLogin prohibit-password` default is untouched) and the ops runbook's `ssh root@` steps work as written.
- It waits for `ssh ubuntu@IP echo ok` and `ssh root@IP echo ok`, and its last line is `VPS_IP=<address>`.
- A rerun creates nothing new and prints the same address. A rerun that finds the instance stopped starts it, retrying "Out of host capacity" the same way (added by `money-safety.md`).

## Acceptance criteria

- [x] `oracle-launch.sh` passes `bash -n` and `shellcheck` in `pnpm test:ops`, and is executable in git.
- [ ] A live run prints `RUNNING`, `ssh ubuntu@… ok`, `ssh root@… ok` and `VPS_IP=…`.
- [ ] A second live run creates nothing and prints the same `VPS_IP`.

## Verification

- `pnpm verify`
- After the board's sign-in: `platform/ops/oracle-launch.sh`, run twice, both outputs quoted here.

## Evidence

- `pnpm test:ops`: 41 tests pass, shellcheck 0.11.0 installed on the Mac so the shellcheck test ran rather than skipped.

## Decisions

- 2026-09-22: session-token auth rather than an API signing key. It needs only a browser sign-in, leaves no long-lived Oracle credential on the Mac, and lasts 24 hours with refresh, which covers a long capacity wait.
- 2026-09-22: root takes the board's key through cloud-init rather than rewriting the runbook to `ssh ubuntu@ sudo`. Every later step in `platform/ops/README.md` is already written as root.
