# Role specs

Roles are data. Each of the sixteen roles in the roster is one JSON file in this folder plus one prompt file under `prompts/`. The Supabase seed script reads the JSON files into the `roles` table; the dispatcher reads the row when it starts a session and appends the prompt file named by `prompt_path`. Names equal titles until the Studio Head names the roster at launch.

Files: `studio-head.json`, `game-designer.json`, `game-director.json`, `builder-a.json`, `builder-b.json`, `qa.json`, `platform-builder.json`, `platform-director.json`, `head-of-finance.json`, `janitor.json`, `tech-artist.json`, `hr.json`, `head-of-product.json`, `biz-dev.json`, `community.json`, `host.json`, and `prompts/<same name>.md`. The jobs' typed answers are JSON Schemas under `schemas/` (a card draft, a ranking and a draft verdict), which the dispatcher validates each session's final message against, and the Game Director's grading rubric is `rubrics/draft-game.md` (`docs/specs/agent-workflows.md`).

Each role's `status` is its place in the launch roster: `running` for the roles that run at launch (Studio Head, Game Designer, Game Director, Builder A, Builder B, QA, Platform Builder and Platform Director), `starts` for a role that starts on a named trigger, and `planned` for one with no trigger yet. A role that is not `running` carries its `trigger`, one sentence saying when it starts. `running` names the roster, not what runs today: while the studio is paused, or until a role's workflow is built, its description says it is not running yet. The Scout was renamed Biz Dev on 23 September 2026, with the same job and guardrails; migration `20260923000200_rename_biz_dev.sql` renamed its row in place.

## Schema

Every file carries the thirteen required keys, and `trigger` exactly when `status` is not `running`. The schema allows no other keys.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Role spec",
  "type": "object",
  "additionalProperties": false,
  "required": ["name", "title", "description", "species_note", "model", "budget_share", "voice", "prompt_path", "tools", "metrics", "class", "write_access", "status"],
  "properties": {
    "name": { "type": "string", "minLength": 1, "description": "Unique across roles; the roles.name column. Equals title until the roster is named at launch." },
    "title": { "type": "string", "minLength": 1, "description": "The role as it appears on the site and the stream." },
    "description": { "type": "string", "minLength": 1, "maxLength": 200, "pattern": "^[^\\s][^\\n\u2014]*[.]$", "description": "One plain sentence saying what the role does, shown on the Meet the Team page: at most 200 characters, no em dash, ending in a full stop. A role that is not running says so." },
    "species_note": { "type": "string", "minLength": 1, "pattern": "^[^\\n]+$", "description": "One plain line describing the alien: a small, strange, friendly creature. No backstory, no claimed experience." },
    "model": { "type": "string", "enum": ["MODEL_DIRECTOR", "MODEL_BUILDER", "MODEL_HOST"], "description": "The environment variable whose value is the model id. Resolved at seed time." },
    "budget_share": { "type": "number", "minimum": 0, "maximum": 1, "description": "Share of the agents' budget. The shares that are not 0 sum to 1. The roles added on 23 September 2026 carry 0." },
    "voice": { "type": "string", "pattern": "^[a-z]+$", "description": "One word." },
    "prompt_path": { "type": "string", "pattern": "^platform/agents/prompts/[a-z-]+\\.md$", "description": "Path from the repo root to the role prompt." },
    "tools": { "type": "array", "items": { "type": "string", "enum": ["Read", "Edit", "Write", "Glob", "Grep", "Bash"] }, "uniqueItems": true, "description": "Tool allowlist passed to the session. The write set for the builders; Read, Glob and Grep for the Studio Head and the two Directors, and Bash besides for the Game Designer; empty for the roles that do not run yet." },
    "metrics": { "type": "array", "minItems": 2, "maxItems": 3, "uniqueItems": true, "items": { "type": "string", "enum": ["first_pass_rate", "cost_per_ship", "estimate_accuracy", "reopen_rate"] }, "description": "The two or three scored metrics from PLAN.md §4." },
    "class": { "type": "string", "enum": ["writer", "planner", "reviewer", "read_only", "web_only"], "description": "The role's trust class (docs/SYSTEM.md): writer changes the repository through card sessions; planner drafts and ranks cards as structured output; reviewer grades and approves; read_only reads the repository and the books; web_only reads outside text and writes nothing." },
    "write_access": { "type": "boolean", "description": "True exactly when the class is writer or planner and tools is not empty. A role with write access never reads free text from the public." },
    "status": { "type": "string", "enum": ["running", "starts", "planned"], "description": "The role's place in the launch roster: running at launch, starting on a named trigger, or planned with no trigger yet." },
    "trigger": { "type": "string", "minLength": 1, "maxLength": 200, "pattern": "^[^\\s][^\\n\u2014]*[.]$", "description": "One plain sentence saying when the role starts. Present exactly when status is not running." }
  }
}
```

Three rules hold across files and are not expressible in the schema: `write_access` is true exactly when `class` is `writer` or `planner` and `tools` is not empty; `trigger` is present exactly when `status` is not `running`; and the `budget_share` values of the roles with a share that is not 0 sum to 1. `budget_share` is left as it is: no role job spends studio money until an operations budget exists (`docs/specs/agent-system-core.md`), so the seven roles added on 23 September 2026 carry 0 and the nine earlier shares stand.

## Launch values

| File | model | budget_share | voice | tools | metrics | class | write_access | status |
|---|---|---|---|---|---|---|---|---|
| studio-head | MODEL_DIRECTOR | 0.10 | terse | read set | estimate_accuracy, cost_per_ship | planner | true | running |
| game-designer | MODEL_DIRECTOR | 0 | precise | read set and Bash | estimate_accuracy, first_pass_rate | planner | true | running |
| game-director | MODEL_DIRECTOR | 0.10 | firm | read set | estimate_accuracy, cost_per_ship | reviewer | false | running |
| builder-a | MODEL_BUILDER | 0.20 | plain | write set | first_pass_rate, cost_per_ship, estimate_accuracy | writer | true | running |
| builder-b | MODEL_BUILDER | 0.20 | brisk | write set | first_pass_rate, cost_per_ship, estimate_accuracy | writer | true | running |
| qa | MODEL_BUILDER | 0.15 | exact | write set | first_pass_rate, reopen_rate | writer | true | running |
| platform-builder | MODEL_BUILDER | 0.15 | cautious | write set | first_pass_rate, cost_per_ship | writer | true | running |
| platform-director | MODEL_DIRECTOR | 0 | exacting | read set | first_pass_rate, reopen_rate | reviewer | false | running |
| head-of-finance | MODEL_DIRECTOR | 0 | careful | none | estimate_accuracy, cost_per_ship | read_only | false | starts |
| janitor | MODEL_BUILDER | 0 | tidy | none | first_pass_rate, cost_per_ship | read_only | false | starts |
| tech-artist | MODEL_BUILDER | 0 | vivid | none | first_pass_rate, cost_per_ship | writer | false | starts |
| hr | MODEL_DIRECTOR | 0 | fair | none | estimate_accuracy, cost_per_ship | planner | false | starts |
| head-of-product | MODEL_DIRECTOR | 0 | candid | none | first_pass_rate, cost_per_ship | web_only | false | starts |
| biz-dev | MODEL_BUILDER | 0.025 | curious | none | first_pass_rate, cost_per_ship | web_only | false | starts |
| community | MODEL_BUILDER | 0.025 | warm | none | first_pass_rate, cost_per_ship | web_only | false | starts |
| host | MODEL_HOST | 0.05 | cheerful | none | first_pass_rate, cost_per_ship | web_only | false | planned |

The write set is `["Read", "Edit", "Write", "Glob", "Grep", "Bash"]` and the read set is `["Read", "Glob", "Grep"]`: the Studio Head and the two Directors read the repository and write nothing in it. The Game Designer holds the read set and Bash, `["Read", "Glob", "Grep", "Bash"]`: in a scratch checkout of `main` the dispatcher throws away, Bash runs only seed-1's package scripts, and the Designer writes card drafts, never files (`docs/specs/agent-workflows.md`). The roles added on 23 September 2026 start with no tools and no write access; only the board grants tools. `docs/SYSTEM.md` lists what each class may and may not do. `MODEL_DIRECTOR` and `MODEL_BUILDER` both hold `claude-opus-5-5` and `MODEL_HOST` holds `claude-haiku-4-5` (`docs/PLAN.md` §10 decision 36).

## How the seed script consumes a spec

`platform/supabase/seed.ts` (run as `pnpm --filter @backseat/supabase seed`, service role, `.env` at the repo root) reads every `*.json` in this folder and upserts one `roles` row per file, keyed on the unique `name` column, so re-running the script updates rows in place and never duplicates a role. Column mapping:

| JSON key | roles column | Transform |
|---|---|---|
| name | name | as is |
| title | title | as is |
| description | description | as is |
| species_note | species_note | as is |
| model | model | the value of the named environment variable (`MODEL_DIRECTOR`, `MODEL_BUILDER` or `MODEL_HOST`) |
| budget_share | budget_share | numeric(6,4) |
| voice | voice | as is |
| prompt_path | prompt_path | as is |
| tools | tools_json | the array, stored as jsonb |
| metrics | metrics_json | the array, stored as jsonb |
| class | agent_class | as is |
| write_access | write_access | as is |
| status | status | as is |
| trigger | trigger | as is; null when the file has none |

Columns the spec does not carry: `avatar_url` stays null until the image adapter lands (after launch), `state` is `active`, `hired_at` takes the column default on insert, `retired_at` is null.

The dispatcher reads the row: `tools_json` becomes the `--allowedTools` list, and the attended adapter passes the row's `model` to the session and falls back to `MODEL_BUILDER` when it is empty. `prompt_path` is stored on the row; the dispatcher resolves it inside the card's worktree and appends the file's contents to the session's system prompt, so a session runs with the card, the CLAUDE.md files and this prompt only. The attended adapter refuses any role whose `tools_json` names WebFetch, WebSearch, Agent, Task or an MCP tool.

## Prompts

Each prompt states the role's purpose from PLAN.md §3, the kernel, the read/write rule, what the role may edit, and how the gate works. Builder prompts add the two lanes, the `check:` line convention, the rule to stop when the acceptance check holds and all invariants pass, and the kernel paths no agent may edit (`platform/gate/kernel-paths.txt`). The Platform Builder's lane is `platform/site/` only. The Builder A, Builder B, QA and Platform Builder prompts carry a `## Working method` section with five steps, each named at the start of its sentence: Understand (restate the acceptance test, quoting each `check:` line), Plan (one short message naming files and verification commands), Implement (the smallest change), Verify (run the named commands; red means fix or stop and report) and Report (pass or fail against the acceptance test verbatim, files changed). The block lives in each file rather than a shared one because the adapter appends exactly one file per role. The Game Director prompt carries the seven Seed 1 pillars verbatim. The three roles that run jobs (`docs/specs/agent-workflows.md`) each name the schema their answer must be valid against: the Studio Head `schemas/ranking.schema.json`, the Game Designer `schemas/card-draft.schema.json` and the Game Director `schemas/draft-verdict.schema.json`; the Director grades with `rubrics/draft-game.md`, which carries the pillars and the all-ages rating verbatim from `docs/PLAN.md`. The Biz Dev and Community prompts propose nothing that passes a board review, name no Reddit or X source, put nothing on the ledger page and say they are not running yet. The prompt of every role without a write tool (Edit, Write or Bash) states that the role has no write tools. Prompts contain no backstories, no claimed experience and no jokes.

## Validation

`specs.test.mjs` in this folder checks every spec. It reads the schema out of the fenced block above, so the documented schema is the enforced one, and asserts: each file carries the thirteen required keys, `trigger` exactly when `status` is not `running`, and no other key, each with the schema's types, lengths, enums and patterns; `prompt_path` is `platform/agents/prompts/<file name>.md` and the file exists; `name` equals `title`; `name` is unique across files; `write_access` is true exactly when `class` is `writer` or `planner` and `tools` is non-empty; the Studio Head, the Game Director and the Platform Director hold exactly Read, Glob and Grep; the description of every role with an empty `tools` list says it is `not running yet`; the folder holds exactly the sixteen roster files; each file carries the values in the table above; and the `budget_share` values that are not 0 sum to 1. It then reads each prompt file and asserts: every prompt contains the kernel line `No agent with write access`, a `## How the gate works` heading and the sentence that a failed deploy or smoke puts a revert commit on `main`; the prompt of every role without a write tool contains `You have no write tools`; the Builder A, Builder B and QA prompts contain the literal `check: config <file> <path> == <json>` and `Stop when the acceptance check holds`; the Builder A, Builder B, QA and Platform Builder prompts contain `## Working method`, each of `Understand:`, `Plan:`, `Implement:`, `Verify:` and `Report:`, and `platform/gate/kernel-paths.txt`; and `game-director.md` contains the pillars sentence from the `Seed 1 pillars` line of `docs/PLAN.md` verbatim. For the jobs (`docs/specs/agent-workflows.md`) it asserts: the Studio Head, Game Designer and Game Director prompts each name their schema, and each schema is a draft 2020-12 object that allows no other keys; the Game Designer holds exactly Read, Glob, Grep and Bash and none of the three holds Write or Edit; the card draft carries one `estimate_usd` and no target, and the verdict's result is approved, revise or flagged with reason codes from a closed list; `rubrics/draft-game.md` carries the pillars and the rating sentence from `docs/PLAN.md` verbatim and the answer line; and the Biz Dev and Community prompts contain no Reddit, no ` X `, no board's review and no ledger page, and say they are not running yet.

It uses only the Node test runner and has no dependencies. From the repo root:

```sh
node --test platform/agents/specs.test.mjs
```

Expected: 125 tests pass, 0 fail.
