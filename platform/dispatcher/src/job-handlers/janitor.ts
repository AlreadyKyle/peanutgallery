// janitor, the Janitor's daily drift check (docs/specs/agent-upkeep.md). Code only: no model reads or
// writes any of it, and it runs while the studio is paused, because it only reads and records
// findings. Five checks, each a list of findings keyed by check and subject:
// - schema: production's schema_fingerprint() against PGlite's after every migration in this
//   checkout; each object that differs, or that only one side has, is one finding;
// - model: each MODEL_* value needs a row in PRICE_TABLE_JSON, must be listed by the Anthropic API's
//   /v1/models when the studio key is set (a free read), and must equal the model ids of the newest
//   eval result, when there is one;
// - cli: claude --version must equal the pin (every attended session, role jobs included, runs on
//   this host's Claude Code);
// - scan: each failed job of the newest completed janitor.yml run on main, linking the run;
// - producer: each producer_signals() row.
// A finding new or reopened (record_finding true) sends one ntfy message; one seen again sends
// nothing. A check that ran closes each open finding of its kind it did not see. A check that could
// not run records nothing and closes nothing, and the run's output names why. It writes nothing but
// findings and its job run: no finding changes code or files a card, and no agent reads them.
import type { Finding, FindingKind, ProducerSignal } from '../db.js';
import { latestCompletedRun, runJobs, requestSignal, type GitHubOptions } from '../github.js';
import type { JobHandler } from '../jobs.js';
import { errorMessage } from '../log.js';
import { requireUpkeep, type UpkeepDeps } from './upkeep.js';

export const SCAN_WORKFLOW = 'janitor.yml';
export const MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1000';
const PASSING_CONCLUSIONS = new Set(['success', 'skipped', 'neutral']);

function short(id: string | null): string {
  return id === null ? 'none' : id.slice(0, 8);
}

// Production's objects against the migrations'.
export function schemaFindings(production: Record<string, string>, migrations: Record<string, string>): Finding[] {
  const keys = [...new Set([...Object.keys(production), ...Object.keys(migrations)])].sort();
  const findings: Finding[] = [];
  for (const key of keys) {
    const inProduction = production[key];
    const inMigrations = migrations[key];
    if (inProduction === inMigrations) continue;
    const subject =
      inProduction === undefined
        ? `${key} is in the migrations but not in production`
        : inMigrations === undefined
          ? `${key} is in production but no migration makes it`
          : `${key} differs between production and the migrations`;
    findings.push({ fingerprint: `schema:${key}`, kind: 'schema', subject, detail: { object: key, production: inProduction ?? null, migrations: inMigrations ?? null } });
  }
  return findings;
}

// The MODEL_* values the dispatcher is configured with.
export function configuredModels(config: UpkeepDeps['config']): Array<[string, string]> {
  const models: Array<[string, string | null]> = [
    ['MODEL_BUILDER', config.modelBuilder],
    ['MODEL_DIRECTOR', config.modelDirector],
    ['MODEL_HOST', config.modelHost],
  ];
  return models.filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '');
}

async function listedModels(key: string, fetchFn: typeof fetch): Promise<Set<string>> {
  const response = await fetchFn(MODELS_URL, {
    method: 'GET',
    signal: requestSignal(undefined, undefined),
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'backseat-dispatcher' },
  });
  const body = await response.text();
  if (response.status !== 200) throw new Error(`anthropic /v1/models: http ${response.status}`);
  const json: unknown = JSON.parse(body);
  const data = typeof json === 'object' && json !== null && Array.isArray((json as { data?: unknown }).data) ? (json as { data: unknown[] }).data : [];
  return new Set(data.map((model) => (typeof model === 'object' && model !== null ? String((model as { id?: unknown }).id ?? '') : '')).filter((id) => id !== ''));
}

export async function modelFindings(deps: UpkeepDeps): Promise<Finding[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  const models = configuredModels(deps.config);
  const findings: Finding[] = [];
  for (const [name, id] of models) {
    if (!(id in deps.config.priceTable)) {
      findings.push({ fingerprint: `model:${name}:price`, kind: 'model', subject: `${name} ${id} has no row in PRICE_TABLE_JSON`, detail: { env: name, model: id } });
    }
  }
  const key = deps.config.studioAnthropicApiKey?.trim() ?? '';
  if (key !== '') {
    const listed = await listedModels(key, fetchFn);
    for (const [name, id] of models) {
      if (!listed.has(id)) findings.push({ fingerprint: `model:${name}:listed`, kind: 'model', subject: `${name} ${id} is not listed by the Anthropic API`, detail: { env: name, model: id } });
    }
  }
  const result = await deps.newestEvalResult();
  if (result !== null) {
    for (const [name, id] of models) {
      const ran = result.model_ids[name];
      if (ran === undefined || ran === id) continue;
      findings.push({
        fingerprint: `model:${name}:eval`,
        kind: 'model',
        subject: `${name} is ${id} but the newest eval result ran ${ran}`,
        detail: { env: name, model: id, eval_model: ran, result: result.file },
      });
    }
  }
  return findings;
}

export async function cliFindings(deps: UpkeepDeps): Promise<Finding[]> {
  const pin = await deps.cliPin();
  if (pin.ok) return [];
  return [
    {
      fingerprint: 'cli:version',
      kind: 'cli',
      subject: `Claude Code ${pin.installed ?? '(unread)'} is installed but the pin is ${pin.pinned ?? '(unread)'}`,
      detail: { installed: pin.installed, pinned: pin.pinned, detail: pin.detail },
    },
  ];
}

export async function scanFindings(github: GitHubOptions): Promise<Finding[]> {
  const run = await latestCompletedRun(github, SCAN_WORKFLOW, 'main');
  if (run === null) return [];
  const jobs = await runJobs(github, run.id);
  const failed = jobs.filter((job) => job.conclusion === null || !PASSING_CONCLUSIONS.has(job.conclusion));
  const findings: Finding[] = failed.map((job) => ({
    fingerprint: `scan:${job.name}`,
    kind: 'scan',
    subject: `The weekly scan's ${job.name} job failed (${job.conclusion ?? 'no conclusion'})`,
    detail: { run: run.htmlUrl, job: job.htmlUrl, conclusion: job.conclusion, sha: run.headSha },
  }));
  // A run that failed before any job ran (no Actions minutes, a workflow GitHub refused) is one finding.
  if (jobs.length === 0 && run.conclusion !== null && !PASSING_CONCLUSIONS.has(run.conclusion)) {
    findings.push({ fingerprint: 'scan:run', kind: 'scan', subject: `The weekly scan did not run its jobs (${run.conclusion})`, detail: { run: run.htmlUrl, conclusion: run.conclusion } });
  }
  return findings;
}

export function producerFinding(signal: ProducerSignal): Finding {
  const f = signal.figures;
  if (signal.kind === 'unclaimed') {
    return {
      fingerprint: `producer:unclaimed:${signal.card_id}`,
      kind: 'producer',
      subject: `Card ${short(signal.card_id)} is funded and has not been claimed for ${String(f.hours)} hours`,
      detail: { card_id: signal.card_id, executor: signal.executor, ...f },
    };
  }
  if (signal.kind === 'overrun') {
    return {
      fingerprint: `producer:overrun:${signal.card_id}`,
      kind: 'producer',
      subject: `Card ${short(signal.card_id)} paused at its ceiling${signal.executor ? ` (${signal.executor})` : ''}`,
      detail: { card_id: signal.card_id, executor: signal.executor, ...f },
    };
  }
  return {
    fingerprint: `producer:throughput:${String(f.week)}`,
    kind: 'producer',
    subject: `${String(f.last_7_days)} cards shipped in the last seven days, fewer than half the ${String(f.previous_7_days)} the week before, with ${String(f.funded_waiting)} funded cards waiting`,
    detail: { ...f },
  };
}

type Check = { kind: FindingKind; run: () => Promise<Finding[]> };

export const janitor: JobHandler = async (context) => {
  const deps = requireUpkeep(context);
  const github: GitHubOptions = { token: deps.config.githubToken, repo: deps.config.githubRepo, fetchFn: deps.fetchFn };
  const checks: Check[] = [
    {
      kind: 'schema',
      run: async () => {
        const [production, migrations] = await Promise.all([context.db.schemaFingerprint(), deps.migrationsFingerprint()]);
        return schemaFindings(production, migrations);
      },
    },
    { kind: 'model', run: () => modelFindings(deps) },
    { kind: 'cli', run: () => cliFindings(deps) },
    { kind: 'scan', run: () => scanFindings(github) },
    { kind: 'producer', run: async () => (await context.db.producerSignals()).map(producerFinding) },
  ];

  const seen = new Set<string>();
  const checked: FindingKind[] = [];
  const errors: Array<{ check: FindingKind; error: string }> = [];
  const opened: string[] = [];
  let recorded = 0;
  for (const check of checks) {
    if (context.stopSignal.aborted) break;
    let findings: Finding[];
    try {
      findings = await check.run();
    } catch (error) {
      errors.push({ check: check.kind, error: errorMessage(error).slice(0, 500) });
      context.log.warn('janitor', `the ${check.kind} check could not run`, { error: errorMessage(error) });
      continue;
    }
    checked.push(check.kind);
    for (const finding of findings) {
      seen.add(finding.fingerprint);
      recorded += 1;
      if (await context.db.recordFinding(finding)) {
        opened.push(finding.fingerprint);
        await context.alert.notify(`Janitor: ${finding.subject}. It is listed under Findings in the board panel's Activity.`);
      }
    }
  }
  const closed: string[] = [];
  for (const open of await context.db.openFindings()) {
    if (!checked.includes(open.kind) || seen.has(open.fingerprint)) continue;
    if (await context.db.closeFinding(open.fingerprint)) closed.push(open.fingerprint);
  }
  context.log.info('janitor', 'drift check done', { checked, recorded, opened: opened.length, closed: closed.length, errors: errors.length });
  return { checked, recorded, opened, closed, errors };
};
