# The replay eval set

Frozen inputs with expected outcomes, replayed through the real role sessions, so a change to a role prompt, a rubric, an agent definition or a schema is checked against what the roles did before it (`docs/specs/agent-upkeep.md`). No job runs it and no gate step calls a model: a person runs it at the Mac, on the founder's Max plan. Its result is advisory, not a merge gate (`docs/PLAN.md` §10 decision 66, amending decision 52; `docs/specs/unattended-roles.md`): it can run only on the founder's login, and the studio does not wait on it.

## The cases

`cases/<set>/<id>.json`, one case a file, named for its id. There is one set, `draft`:

- **A Director case** (`"kind": "director"`) is a frozen card draft, as the Game Designer answers it (`schemas/card-draft.schema.json`), that has passed the dispatcher's checks. One Game Director session grades it with `rubrics/draft-game.md`, as `draft_card` runs it. `expect.result` lists the verdicts that pass; `expect.reason_code`, when set, must be among the verdict's reason codes. Half the drafts are good and expect `approved`; the other half break a pillar (expecting `revise` or `flagged` with `off_pillar`, since the rubric sends a pillar break back to revise) or the all-ages rating (expecting `flagged` with `not_all_ages`), in words the deny-list does not hold, as a draft that reached the Director would be.
- **A Designer case** (`"kind": "designer"`) is a `draft_card` input, `{}`. The draft handler's own steps run: the Game Designer drafts, the dispatcher's checks run, the Game Director grades. It passes when the run ends approved within `expect.approved_within_rounds` rounds.

There is no visual set yet: the visual review keeps no rubric example images, so a visual set waits for frozen frame pairs from real reviews (`docs/BACKLOG.md`, "Visual replay set").

## k and pass^k

`pnpm eval:replay -- --set draft --k 3` runs each case k times. A case passes when all k of its runs meet its expectation; pass^k for a set is the share of its cases that pass, so it asks for a role that is right every time, not once. A run that fails to start or answers no valid object is a failed run.

## The attended rule

The runner deletes `STUDIO_ANTHROPIC_API_KEY` and `ANTHROPIC_API_KEY` from its own environment after loading `.env`, so its sessions sign in only with the founder's Claude login. It refuses when `CI` or `GITHUB_ACTIONS` is set or `AGENT_MODE` is unattended, as a dispatcher host's env file sets it. Its sessions run through the attended adapter with the Claude Code pin, each in a scratch checkout of main, and its store is in memory: it writes no database row and reads no board session. The dispatcher itself has no attended mode, so this is the attended adapter's one remaining use besides `sandbox:check` and the probe's `--attended` run. The draft set is 9 cases; at k = 3 that is 24 Director sessions and 3 draft runs of up to three rounds each.

## The result and the baseline

A run writes `results/<UTC stamp>.json`: `{commit, cli_version, model_ids, sets: {<name>: {cases, k, pass_k, passes}}}`, where `model_ids` are the `MODEL_*` values it ran with. It exits 1 when a set is below `baseline.json`, `{"sets": {"draft": <pass^k>}, "reason": "..."}`. The daily `janitor` check compares the `MODEL_*` values in `.env` with the newest result's `model_ids`.

## The diff rule

`platform/agents/evals.test.mjs`, in `pnpm test:agents`, reads the change against the gate's base. A change to `platform/agents/{prompts,rubrics,schemas,managed}/**` should add a `results/*.json` whose every set is at or above `baseline.json`, like a changeset; nothing is hashed. One that adds none, adds one below the baseline, or comes before any baseline exists still passes the gate, and the gate log reports what is missing as an advisory line (`replay eval, advisory and not a merge gate ...`), printed as the test's diagnostic.

## How a baseline moves

Only in a board pull request that changes `baseline.json` and gives the reason in its `reason` field; the test refuses a changed baseline with none. The first baseline is set the same way, from the first attended run; until it exists, the gate log reports that it is missing.
