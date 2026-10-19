# Lessons: routes, limits and board asks

What sessions have learned about working in this project: which routes work from a cloud session,
which are refused, which steps need the board's own hands, and how to put a step to the board so one
step reads as one ask. What a session may do without asking is `docs/PLAN.md` §10 decision 74 and the
project's own instructions; this file does not change it. Add a line when you learn one, as the fact
and its reason.

## Putting a step to the board

- **Check the routes first.** Before calling a step manual, check the table below. A route marked
  refused is a limit of the environment: don't retry it, and don't offer it to the board as something
  to approve.
- **One owner per board step.** A step that needs the board's hands has one owning session and one
  entry in the board list (in a Claude project, `/mnt/project-files/unblock/README.md`). Other sessions
  link to that entry rather than listing the step again.
- **Keep the rest moving.** A missing board step holds only the line that needs it. Work that doesn't
  need it carries on, and anything that needs a key stays inert or behind its flag until the key exists.
- **One list, said once.** An ask is one numbered list of exact clicks. If the board declines (for
  example, no device access right now), the step stays in the board list for later.
- **Use what exists.** Steps use the accounts, organisations and logins the board already has. If a doc
  reads as needing a new one, raise that as an optional note, not a step.
- **Optional is labelled optional.** A decision the work doesn't need (a `docs/PLAN.md` record, a copy
  choice, a money idea) is marked optional and isn't counted as waiting on the board.
- **Device steps in one batch.** Steps that need the board's own logins (`gh secret set`,
  `gh variable set`, the Supabase CLI, `.env`) go in one Remote Control session in the Mac checkout,
  started by the owning thread.

## Routes from a cloud session

| Route | Result |
|---|---|
| GitHub MCP: branches, pull requests, comments, squash merge pinned to the head sha | works |
| GitHub MCP: Actions runs and job logs (`get_job_logs`), for the dispatcher's `stop reason:` line | works |
| Supabase connector: read-only SQL on production | works |
| Supabase connector: write SQL on production | works after the board approves in the same thread; an approval relayed from the project chat unlocked reads only |
| Supabase connector: `apply_migration` | works since 19 October 2026, when the board set the connector's permissions to Always allow; before that its confirmation dialog did not show in the Projects app and timed out |
| The dispatcher | runs on its own schedule; read its newest run's log rather than starting it |
| Starting a workflow (the GitHub app, or a workflow on a side branch that starts another) | refused (HTTP 403, and the safety check) |
| Actions variables and secrets (`STUDIO_REF`, `DISPATCHER_ENV`) | refused from the cloud; set from the Mac with the board's `gh` login |
| Moving `STUDIO_REF` into a committed file | refused (it weakens the ops repository's pin) |
| A standing permissions allowlist | refused |
| Driving the board's browser | refused |
| Deleting a branch | refused (HTTP 403); GitHub's auto-delete or a local session does it |
| Re-running a failed job (`rerun-failed-jobs`) | refused (HTTP 403); a push with a real change starts a new gate run |
| Reading the container's environment notes or a local tool's configuration for keys | refused (the safety check's credential rule); a key's state comes from the run log that used it |
| Supabase Auth settings (sign-ups, redirect URLs) | no connector tool; set from the Mac or the dashboard |
| Stripe connector: writes (a new price or Payment Link) | refused (`Forbidden`): the connector's key is read-only, so a Stripe Dashboard change is the board's |
| GitHub account billing (Actions minutes and budgets) | refused from the cloud (sessions are bound to their repositories); the private ops repository stops when the account's free minutes run out and its Actions budget is $0 |
| Anthropic Console receipts through the Gmail connector | refused (the safety check's personal-data rule); the board reads the amounts in the Console |
| The live site and Supabase's public Auth settings | the container cannot reach them; WebFetch can (for example `/api/community/auth/settings`) |

## Steps only the board's hands can do

- Creating an API key in the Anthropic Console, in the organisation the board already uses (the board
  said on 18 October 2026 that it has one organisation with credit). The key reaches `.env` on the Mac,
  never through chat.
- Allowing a Remote Control session on the Mac.
- The human and legal duties in `BOARD-SETUP.md`.
- Keys for outside services the studio has no account with yet (the marketing channels list their own);
  each channel stays off until its key is added.

## What happened

- 17 October 2026: the go-live SQL was handed to the board to paste into the SQL editor while the
  Supabase connector was available; its confirmation dialog then timed out unseen. The in-thread
  approval is what worked.
- 18 October 2026: several threads each listed the same board steps (the studio key, `STUDIO_REF`,
  Supabase sign-ups), so one step read as five asks.
- 18 October 2026: the board was asked to type a four-part approval phrase; three of the four routes
  were refused by the environment anyway.
- 18 October 2026: a step asked the board to switch to a separate studio organisation for a new key,
  when the board has one organisation with credit.
- 18 October 2026: four of five threads shown as blocked were waiting only on optional or moved asks.
- 15 to 18 October 2026: the dispatcher exited at startup on every run with `stop reason: anthropic key
  refused` (a 401 on the studio key) while sessions guessed at Console credit. The run's log names the
  cause.
- 19 October 2026: the board set the Supabase connector's permissions to Always allow, and
  `apply_migration` then ran on production without a dialog. The same day the ops repository's jobs
  stopped because the account's free Actions minutes ran out; a session first read it as a failed
  payment, and GitHub's usage email named the cause.
- 19 October 2026: during GitHub's own Actions incident (githubstatus.com, from 15:49Z) a docs-only
  gate run failed: its gate job read detect as cancelled while detect was still running. Check the
  status page before diagnosing a failure the diff can't explain.
