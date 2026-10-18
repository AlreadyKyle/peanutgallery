# Dust for Claude Code

A small Claude Code mod that lets you play Dust, Mob Machine's idle game, while Claude works.

## What it does

- `/dust` opens https://play.mobmachine.games/?from=claude-code in your browser and prints the link. It runs at once, even while Claude is in the middle of a turn. Where no browser can be opened (a remote or cloud session), it prints the link for you to open.
- An optional hint, off unless you turn it on: once a session, when a turn has run for two minutes, a short notice says "Claude is still working. Type /dust to play Dust in your browser while you wait." It shows at most once a session, not at all after you have run `/dust`, and never opens anything by itself.

The link carries `?from=claude-code` and nothing else. The mod sends nothing anywhere, keeps no counts and stores nothing.

## Install

At a Claude Code prompt:

```
/plugin install dust --marketplace AlreadyKyle/peanutgallery
```

Answer `y` to add the marketplace, then pick a scope (user is the usual one). From a shell, the same thing is:

```
claude plugin install dust --marketplace AlreadyKyle/peanutgallery
```

To turn the long-turn hint on, install with `--config longTurnHint=true`, or later run `/plugin configure dust@mobmachine`, or change "Suggest Dust on long turns" in `/config`.

To try it from a checkout of this repository without installing it:

```
claude --plugin-dir platform/claude-mod
```

## Remove

```
claude plugin uninstall dust@mobmachine
claude plugin marketplace remove mobmachine
```

The first line removes the mod; the second removes the `mobmachine` marketplace it came from.

## Files

- `.claude-plugin/plugin.json`: the manifest, with the one option, `longTurnHint`.
- `hooks/hooks.json` and `hooks/register.ts`: the hooks module. It registers `/dust`, opens the link with the system's own opener (`open` on macOS, `xdg-open` on Linux, `rundll32` on Windows), and runs the hint's timer.
- `tests/dust.test.ts`: the behaviour tests, run with `claude plugin test platform/claude-mod`.
- `tests/mod.test.mjs`: the static checks `pnpm verify` runs: the manifests, the link and the copy.
- `../../.claude-plugin/marketplace.json`: the marketplace file at the repository root that makes the install line work.

## Checking a change

```
claude plugin validate platform/claude-mod
claude plugin test platform/claude-mod
node --test platform/claude-mod/tests/mod.test.mjs
```
