# Carry-over fixes before the launch work

Status: built. Card: none. Owner: board.

## Problem

Five things left from the launch batch block the launch plan's next work. On Claude Code 2.1.280 the attended sandbox check fails: seed-1's `build-sha.mjs` cannot run `git rev-parse` under the sandbox, so no attended session can be shown safe. The production live check fails, because `/team` now shows `claude-opus-5-5` for running roles. The Managed Agents adapter leaves a session running, unwatched and spending, when its event stream is lost (the ROADMAP's "Fix before the cutover"). The board renamed the Scout to Biz Dev. And `/team` cannot show the launch roster, because seven of its roles have no role spec and no role carries its place in the roster.

## Scope

In:
- The attended sandbox settings (`platform/dispatcher/src/adapters/attended.ts`) and the check (`sandbox-check.ts`).
- The `/team` assertion in `platform/site/scripts/live-check.mjs`, its check in `platform/site/scripts/team-models.mjs`, and the e2e team tests that run the same check.
- The stream-loss stop in `platform/dispatcher/src/adapters/managed.ts`.
- The Scout to Biz Dev rename, and migration `20260923000200_rename_biz_dev.sql`.
- Role specs and prompts for the Game Designer, Platform Director, Head of Finance, Janitor, Tech Artist, HR and Head of Product; `status` and `trigger` on every role, through the seed into `roles` and `public_roles`.
- The Opus 5.5 docs have their own spec, `docs/specs/opus-55.md`, in the same pull request.

Out:
- Rendering the statuses on `/team`, which the site work in the launch plan does. `/team` keeps working as before and lists the new roles as not running yet.
- The operations budget, which redefines `budget_share` (the agent-system work). The new roles carry 0 until then.
- The dated specs that name the Scout (`launch-db.md`, `launch-docs.md`, `launch-site.md`, `live-cut.md`), which record what was decided on their dates.
- Pinning the Claude Code version, the board's step once this merges.

## Behaviour

- An attended session's sandbox paths are resolved through symlinks, as Claude Code resolves them, and no re-allowed read path holds a denied folder. Claude Code 2.1.280 writes a second deny, after the re-allowed paths, for every denied folder inside a re-allowed one ("J3" in its bundled profile code, `(deny file-read* (subpath <denied folder>))` with no exceptions); 2.1.139 wrote none. The check's scratch clone sat in the temp folder, which was re-allowed, so the clone was denied again and with it the `.git` re-allowed inside it. The temp folder is no longer re-allowed when it holds the repository; outside a denied folder reading is allowed anyway.
- `sandbox:check` can put its scratch folder under the home folder (`SANDBOX_CHECK_SCRATCH=$HOME`), and its positive check uses the dispatcher's layout: the clone, and the card worktree in `<clone>-worktrees` beside it.
- The live check passes when `/team` shows at least one running role, each running role shows `claude-opus-5-5` (decision 36) and no role that does not run shows a model. A missing Running section, or a running role on any other model, such as a re-seed from a stale `.env` with `MODEL_BUILDER=claude-sonnet-5`, fails and names what it found.
- A managed session the dispatcher stops reading after the card prompt without the session ending (its stream lost, the drain after an interrupt run out, or the driver throwing) is sent `user.interrupt`, read with `sessions.retrieve` for up to a minute until it is not running, then settled and archived. A session still running after that is left for recovery, and the card pauses as before. The reconnect count starts again after a connect that delivered a new event. Before it sets the budget in cents, the adapter reads the card's spend again after settling the card's earlier sessions, and lowers the budget by what they added.
- The Scout is Biz Dev everywhere outside the dated specs, with the same job and guardrails: no write tools, and it never contacts anyone. The migration renames the Scout's `roles` row in place, retires it instead when a Biz Dev row already exists, and retitles its planned roadmap card so `file-backlog`, which matches by title, updates it.
- Sixteen role specs. Each carries `status` (`running`, `starts` or `planned`) and, when it is not running, a one-sentence `trigger`. Running at launch: Studio Head, Game Designer, Game Director, Builder A, Builder B, QA, Platform Builder, Platform Director. Starting on a trigger: Head of Finance (the cutover), Janitor, Tech Artist, HR, Head of Product, Biz Dev, Community. Planned: Host. The seven new roles have no tools, no write access and a `budget_share` of 0, and their descriptions say they are not running yet.
- `specs.test.mjs` now requires the `budget_share` values that are not 0 to sum to 1, rather than every value; the nine launch shares are unchanged.

## Acceptance criteria

- [x] `attendedSettings` resolves every path through symlinks, never lists an `allowRead` path that holds a `denyRead` folder, and names the repository in its permission rules both as given and as resolved.
- [x] `sandbox:check --positive` passes on Claude Code 2.1.280 with the check's clone in the temp folder, and again with it under `$HOME`; every negative attempt is blocked in both.
- [x] With the settings on `main` before this change, the same check fails in the temp layout and passes under `$HOME`, which places the fault in the check's layout.
- [x] The live check's `/team` lines require at least one running role, `claude-opus-5-5` on every running role and no model on the rest; the e2e team tests run the same check on the same locators, and it fails a roster with no running role and one left on an older model.
- [x] A session whose stream drops after the prompt is sent `user.interrupt`, read until it is not running, settled, archived, and the card paused as `stream_lost`.
- [x] A session whose drain runs out is interrupted again and archived; one that will not stop is left unarchived for recovery.
- [x] The reconnect count starts again after a connect that delivered events.
- [x] The new session's budget is lowered by what the card's settled orphan added, and a card whose spend cannot be read gets no session (`card_spend`).
- [x] `git grep -i scout` finds only the dated specs and the files that name the old name to rename it or to test that it is gone.
- [x] Migration `20260923000200` renames the Scout's row in place, retires it beside an existing Biz Dev row, retitles its planned card, adds checked `status` and `trigger` columns and shows them in `public_roles`, and runs twice.
- [x] The seven new role specs and prompts pass `specs.test.mjs`, every role carries its status and trigger, and the seed writes both.
- [ ] Production: the migration applied, the roles re-seeded, and the live check PASS (waits on: the production steps below, after merge).

## Verification

- `pnpm verify`
- `SANDBOX_CHECK_REPO_ROOT=/Users/kylesmith/GitHub/peanutgallery pnpm --filter @backseat/dispatcher sandbox:check --positive` on Claude Code 2.1.280.
- The same with `SANDBOX_CHECK_SCRATCH=$HOME`.
- The same two runs with `attended.ts` as it is on `main` before this change (a copy of `main`'s dispatcher source with this change's `sandbox-check.ts`).
- From `platform/site`: `E2E_PORT=4391 npx playwright test` (the whole e2e suite, the team page among it).
- (waits on: production) `node platform/site/scripts/live-check.mjs` against https://peanutgallery.games after the re-seed.

## Evidence

- `pnpm verify`, exit 0: `platform/supabase` `Tests  233 passed (233)`; `seed-1` `Tests  77 passed (77)`; `platform/site` `Tests  231 passed (231)`; `platform/dispatcher` `Tests  567 passed (567)`; `platform/gate` `PASS: gate tests passed=348`; `specs.test.mjs` `pass 117, fail 0`; ops `pass 44, fail 0`; functions `ok | 80 passed (66 steps) | 0 failed`; `GATE PASS folder=seed-1 lane=code`; `GATE PASS folder=platform lane=code`; `PASS: secret-scan files=421`; `docs.test.mjs` `pass 15, fail 0`.
- Site e2e, from `platform/site`: `E2E_PORT=4395 npx playwright test`: `27 passed (9.9s)`.
- Claude Code: `~/.local/bin/claude --version` prints `2.1.280 (Claude Code)`.
- The check, temp layout, this change:
  ```
  PASS: attended sandbox
  claude: /Users/kylesmith/.local/bin/claude; model claude-haiku-4-5; repository /Users/kylesmith/GitHub/peanutgallery; scratch /private/var/folders/yv/6n3ds9hj6_75dzqx_9gvz7d00000gn/T/sandbox-check-z8OXeL
  targets present outside the sandbox: id_ed25519=true, .env=true, .env.vps=true
  bash sandbox: attempt=ssh-key outcome=blocked detail=EPERM
  bash sandbox: attempt=repo-env outcome=blocked detail=EPERM
  bash sandbox: attempt=repo-env-vps outcome=blocked detail=EPERM
  bash sandbox: attempt=keychain-gh-token outcome=blocked detail=exit-44
  bash sandbox: attempt=external-fetch outcome=blocked detail=ENOTFOUND
  (the same five lines again for the run that asked to leave the sandbox)
  bash calls the session made: 2
  read tool: 1 call(s), blocked; permission denials reported: 1; result: <tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>
  positive: clone /private/var/folders/yv/6n3ds9hj6_75dzqx_9gvz7d00000gn/T/sandbox-check-z8OXeL/peanutgallery; worktree /private/var/folders/yv/6n3ds9hj6_75dzqx_9gvz7d00000gn/T/sandbox-check-z8OXeL/peanutgallery-worktrees/card-sandbox
  positive: seed-1 tests passed:  Test Files  9 passed (9) |       Tests  77 passed (77)
  positive: seed-1 typecheck exited 0
  positive: seed-1 bot passed: PASS: 4 of 4 invariants hold over 36000 simulated seconds
  positive: node_modules installed before the session: true
  ```
- The check, clone and worktree under `$HOME`, this change:
  ```
  PASS: attended sandbox
  claude: /Users/kylesmith/.local/bin/claude; model claude-haiku-4-5; repository /Users/kylesmith/GitHub/peanutgallery; scratch /Users/kylesmith/sandbox-check-Ve7Kci
  (the ten attempt lines as above, each outcome=blocked)
  read tool: 1 call(s), blocked; permission denials reported: 1; result: <tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>
  positive: clone /Users/kylesmith/sandbox-check-Ve7Kci/peanutgallery; worktree /Users/kylesmith/sandbox-check-Ve7Kci/peanutgallery-worktrees/card-sandbox
  positive: seed-1 tests passed:  Test Files  9 passed (9) |       Tests  77 passed (77)
  positive: seed-1 typecheck exited 0
  positive: seed-1 bot passed: PASS: 4 of 4 invariants hold over 36000 simulated seconds
  ```
- The control, `main`'s `attended.ts`, temp layout: `FAIL: attended sandbox: the seed-1 tests did not pass under the sandbox`, `positive: seed-1 tests did not pass: ... Test Files  1 failed | 8 passed (9) |       Tests  1 failed | 76 passed (77)`, every attempt still `outcome=blocked`. Under `$HOME`: `PASS: attended sandbox`, `Tests  77 passed (77)`. So real attended card sessions, whose clone and worktrees sit under the home folder, were not blocked on 2.1.280; the check's own layout was, and the check now runs both layouts.
- Sandbox settings: `attended.test.ts` "never re-allows a path that holds a denied folder, so the git data inside it stays readable", "resolves a path through its symlinks, keeping a tail that does not exist yet", "names every sandbox path resolved, and the repository rules both as given and as resolved".
- Stream loss: `managed.test.ts` "a session the dispatcher stops reading": "interrupts a session whose stream drops after the prompt, reads it until it is not running, then settles and archives it and pauses the card", "interrupts again, and settles, a session still running when the drain after an interrupt runs out", "leaves a session that will not stop unarchived for recovery, and still pauses the card", "starts the reconnect count again after a connect that brought new events, so a stream that drops now and then is not lost". With the fix taken out, those four fail (`Tests  4 failed | 41 passed (45)`); with it, `Tests  45 passed (45)`.
- Spend re-read: `managed.test.ts` "lowers the new session's budget by what the settled orphan added to the card's spend" and "starts no session when the card cannot be read after its orphans are settled"; `unattended.test.ts` refuses a card spec without `spentUsd` at preflight.
- Live check: `live-check.mjs` runs `runningModelsCheck` from `scripts/team-models.mjs` on `running.locator('li.role .card-meta').allTextContents()`. `src/team-models.test.ts` "passes when every running role shows that model", "fails when no role runs, since the Running section is then missing", "fails a stale re-seed that left a running role on another claude model", "fails a running role that shows no model, or a longer id that starts the same way" and "is what live-check.mjs runs on the Running section": `Tests  6 passed (6)`. With the check put back to the first version's rule (any `claude-*` model, no running role allowed), three fail: `Tests  3 failed | 3 passed (6)`. The e2e team test asserts the check's result on the fixture, `/team 3 running roles, each on claude-opus-5-5: claude-opus-5-5, claude-opus-5-5, claude-opus-5-5`, and "the production /team model check" renders `/team` with the builders on `claude-sonnet-5` (`/team 3 running roles, each on claude-opus-5-5: claude-sonnet-5, claude-sonnet-5, claude-sonnet-5`, not ok) and with no running role (`/team 0 running roles, each on claude-opus-5-5: none`, not ok): `E2E_PORT=4393 npx playwright test e2e/pages.spec.ts` `8 passed (3.3s)`. Against a local `vite preview` of a build without database values, `node scripts/live-check.mjs http://localhost:4394 --allow-no-data`: `PASS live-check http://localhost:4394 passed=131 failed=0 skipped=8`, exit 0.
- Rename: `git grep -i -l scout` after this change lists `docs/PLAN.md` (the note that Biz Dev was the Scout), `docs/docs.test.mjs` (a comment), the four dated specs, `platform/agents/README.md` (the rename note), and the migration and its three tests.
- Migration: the Deno test "the Biz Dev rename keeps the Scout's row and adds status and trigger" (three steps: the rename in place run twice, the planned card retitled and a funded one left alone, the Scout row retired beside an existing Biz Dev row) and the static tests in `migration.test.ts` "rename-biz-dev migration".
- Roles: `specs.test.mjs` `117 pass, 0 fail`; `role-files.test.ts` "carries each role's place in the launch roster, with a trigger for every role that is not running"; `roles.test.ts` "requires a status from the roster, and a one-line trigger exactly when the role is not running".

## Production steps (need the board's allow)

In order, with the studio paused and no Mac dispatcher running:

1. Apply `platform/supabase/migrations/20260923000200_rename_biz_dev.sql` through the Management API query endpoint, then `anon-negative-test.ts`: it renames the Scout's row, retitles its planned roadmap card and adds `status` and `trigger`.
2. `pnpm --filter @backseat/supabase seed` with `.env`'s model values, `MODEL_BUILDER` and `MODEL_DIRECTOR` set to `claude-opus-5-5` (decision 36): it updates the renamed Biz Dev row, adds the seven new roles and writes every role's status and trigger.
3. `pnpm --filter @backseat/supabase file-backlog` as a dry run: the Biz Dev entry shows as an update of the retitled card, never an insert.
4. `node platform/site/scripts/live-check.mjs` against production, quoting its `/team` lines. The model line must read `/team 3 running roles, each on claude-opus-5-5: claude-opus-5-5, claude-opus-5-5, claude-opus-5-5`; any other model means step 2 ran with a stale `.env`.

## Decisions

- 23 September 2026: the sandbox fix leaves out any re-allowed path that holds a denied folder rather than expressing the carve-out another way (globs, a denied folder per top-level entry, a clone per card). Leaving a path out only ever allows less, and 2.1.280's rule is then never met, whatever the layout.
- 23 September 2026: the check keeps the temp layout as its default and gains `SANDBOX_CHECK_SCRATCH`, so both layouts are proven; before any Claude Code version change, run both.
- 23 September 2026: the stop after a lost stream waits up to a minute (`stopWaitMs`) rather than the ten seconds a normal settle waits, since an interrupted session finishes its current model request first.
- 23 September 2026: the managed adapter refuses a card session without the card's spend its budget was worked out from (`spentUsd`), rather than guessing it; `session.ts` always passes it.
- 23 September 2026: Biz Dev's title equals its name, as every role's does until the roster is named.
- 23 September 2026: the migration also retitles the Scout's planned roadmap card, because `file-backlog` matches cards by title and would otherwise file a second card beside it.
- 23 September 2026: `status` names the launch roster, not what runs today. A running role whose workflow is not built yet, such as the Game Designer, says "not running yet" in its description until it runs.
- 23 September 2026: the live check pins `claude-opus-5-5` in `team-models.mjs` rather than taking the expected model as an argument, as it pins the security headers: a production run checks what is served against what the board decided, and a change of model is a decision that changes the constant with it.
