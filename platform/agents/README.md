# Role specs

Roles are data. Each of the nine launch roles is one JSON file in this folder plus one prompt file under `prompts/`. The Supabase seed script reads the JSON files into the `roles` table; the dispatcher reads the row when it starts a session and appends the prompt file named by `prompt_path`. Names equal titles until the Studio Head names the roster at launch.

Files: `studio-head.json`, `game-director.json`, `builder-a.json`, `builder-b.json`, `platform-builder.json`, `qa.json`, `host.json`, `scout.json`, `community.json`, and `prompts/<same name>.md`.

## Schema

Every file carries all eleven keys. The schema allows no extra keys.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Role spec",
  "type": "object",
  "additionalProperties": false,
  "required": ["name", "title", "description", "species_note", "model", "budget_share", "voice", "prompt_path", "tools", "metrics", "write_access"],
  "properties": {
    "name": { "type": "string", "minLength": 1, "description": "Unique across roles; the roles.name column. Equals title until the roster is named at launch." },
    "title": { "type": "string", "minLength": 1, "description": "The role as it appears on the site and the stream." },
    "description": { "type": "string", "minLength": 1, "maxLength": 200, "pattern": "^[^\\s][^\\n\u2014]*[.]$", "description": "One plain sentence saying what the role does, shown on the Meet the Team page: at most 200 characters, no em dash, ending in a full stop. A role that is not running says so." },
    "species_note": { "type": "string", "minLength": 1, "pattern": "^[^\\n]+$", "description": "One plain line describing the alien: a small, strange, friendly creature. No backstory, no claimed experience." },
    "model": { "type": "string", "enum": ["MODEL_DIRECTOR", "MODEL_BUILDER", "MODEL_HOST"], "description": "The environment variable whose value is the model id. Resolved at seed time." },
    "budget_share": { "type": "number", "exclusiveMinimum": 0, "maximum": 1, "description": "Share of the week's pool. The nine shares sum to 1." },
    "voice": { "type": "string", "pattern": "^[a-z]+$", "description": "One word." },
    "prompt_path": { "type": "string", "pattern": "^platform/agents/prompts/[a-z-]+\\.md$", "description": "Path from the repo root to the role prompt." },
    "tools": { "type": "array", "items": { "type": "string", "enum": ["Read", "Edit", "Write", "Glob", "Grep", "Bash"] }, "uniqueItems": true, "description": "Tool allowlist passed to the session. Empty for roles without write access." },
    "metrics": { "type": "array", "minItems": 2, "maxItems": 3, "uniqueItems": true, "items": { "type": "string", "enum": ["first_pass_rate", "cost_per_ship", "estimate_accuracy", "reopen_rate"] }, "description": "The two or three scored metrics from PLAN.md §4." },
    "write_access": { "type": "boolean", "description": "False for host, scout and community. A role with write access never reads free text from the public." }
  }
}
```

Two rules hold across files and are not expressible in the schema: `write_access` is false exactly when `tools` is empty, and the `budget_share` values across all nine files sum to 1.

## Launch values

| File | model | budget_share | voice | tools | metrics | write_access |
|---|---|---|---|---|---|---|
| studio-head | MODEL_DIRECTOR | 0.10 | terse | write set | estimate_accuracy, cost_per_ship | true |
| game-director | MODEL_DIRECTOR | 0.10 | firm | write set | estimate_accuracy, cost_per_ship | true |
| builder-a | MODEL_BUILDER | 0.20 | plain | write set | first_pass_rate, cost_per_ship, estimate_accuracy | true |
| builder-b | MODEL_BUILDER | 0.20 | brisk | write set | first_pass_rate, cost_per_ship, estimate_accuracy | true |
| platform-builder | MODEL_BUILDER | 0.15 | cautious | write set | first_pass_rate, cost_per_ship | true |
| qa | MODEL_BUILDER | 0.15 | exact | write set | first_pass_rate, reopen_rate | true |
| host | MODEL_HOST | 0.05 | cheerful | none | first_pass_rate, cost_per_ship | false |
| scout | MODEL_BUILDER | 0.025 | curious | none | first_pass_rate, cost_per_ship | false |
| community | MODEL_BUILDER | 0.025 | warm | none | first_pass_rate, cost_per_ship | false |

The write set is `["Read", "Edit", "Write", "Glob", "Grep", "Bash"]`.

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
| write_access | write_access | as is |

Columns the spec does not carry: `avatar_url` stays null until the image adapter lands (after launch), `state` is `active`, `hired_at` takes the column default on insert, `retired_at` is null.

The dispatcher reads the row: `tools_json` becomes the `--allowedTools` list, and the attended adapter passes the row's `model` to the session and falls back to `MODEL_BUILDER` when it is empty. `prompt_path` is stored on the row; the dispatcher resolves it inside the card's worktree and appends the file's contents to the session's system prompt, so a session runs with the card, the CLAUDE.md files and this prompt only. The attended adapter refuses any role whose `tools_json` names WebFetch, WebSearch, Agent, Task or an MCP tool.

## Prompts

Each prompt states the role's purpose from PLAN.md §3, the kernel, the read/write rule, what the role may edit, and how the gate works. Builder prompts add the two lanes, the `check:` line convention, the rule to stop when the acceptance check holds and all invariants pass, and the kernel paths no agent may edit (`platform/gate/kernel-paths.txt`). The Platform Builder's lane is `platform/site/` only. The Builder A, Builder B, QA and Platform Builder prompts carry a `## Working method` section with five steps, each named at the start of its sentence: Understand (restate the acceptance test, quoting each `check:` line), Plan (one short message naming files and verification commands), Implement (the smallest change), Verify (run the named commands; red means fix or stop and report) and Report (pass or fail against the acceptance test verbatim, files changed). The block lives in each file rather than a shared one because the adapter appends exactly one file per role. The Game Director prompt carries the seven Seed 1 pillars verbatim. The Host, Scout and Community prompts state that the role has no write tools. Prompts contain no backstories, no claimed experience and no jokes.

## Validation

`specs.test.mjs` in this folder checks every spec. It reads the schema out of the fenced block above, so the documented schema is the enforced one, and asserts: each file carries exactly the eleven keys with the schema's types, lengths, enums and patterns; `prompt_path` is `platform/agents/prompts/<file name>.md` and the file exists; `name` equals `title`; `name` is unique across files; `write_access` is true exactly when `tools` is non-empty; the description of every role with an empty `tools` list says it is `not running yet`; the folder holds exactly the nine launch files; each file carries the launch values in the table above; and the nine `budget_share` values sum to 1. It then reads each prompt file and asserts: every prompt contains the kernel line `No agent with write access`, a `## How the gate works` heading and the sentence that a failed deploy or smoke puts a revert commit on `main`; the prompt of every role with an empty `tools` list contains `You have no write tools`; the Builder A, Builder B and QA prompts contain the literal `check: config <file> <path> == <json>` and `Stop when the acceptance check holds`; the Builder A, Builder B, QA and Platform Builder prompts contain `## Working method`, each of `Understand:`, `Plan:`, `Implement:`, `Verify:` and `Report:`, and `platform/gate/kernel-paths.txt`; and `game-director.md` contains the pillars sentence from the `Seed 1 pillars` line of `docs/PLAN.md` verbatim.

It uses only the Node test runner and has no dependencies. From the repo root:

```sh
node --test platform/agents/specs.test.mjs
```

Expected: 67 tests pass, 0 fail.
