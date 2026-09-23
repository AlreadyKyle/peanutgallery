// Applies platform/agents/managed/agent.yaml and environment.yaml to the studio organisation, once per
// change, and prints the ids the dispatcher runs with (docs/specs/launch-managed.md):
//   pnpm --filter @backseat/dispatcher managed:apply            create or update both, print the ids
//   pnpm --filter @backseat/dispatcher managed:apply -- --check  then create one session with the
//     repository mounted at main's head, a one-cent budget and no events, print it, and archive it
// It reads .env at the repository root: STUDIO_ANTHROPIC_API_KEY (never the founder's key, which it
// refuses), MODEL_BUILDER for the agent's default model, and for --check GITHUB_REPO and
// GITHUB_READ_TOKEN. Agents and environments are found by name and updated only when they differ, so a
// second run with no change prints the same version and creates nothing.
//
// The --check session proves the ids, that the read token reaches the repository and that the model
// has a list price (a budgeted create on an unpriced model is refused), before any credit is spent: a
// session created without events starts no work. It proves neither the checkout nor the toolchain,
// since no container starts; `probe --toolchain` does that at the cutover.
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config as loadDotenv } from 'dotenv';
import { errorMessage } from '../log.js';
import { agentProblems, enabledToolNames, environmentProblems, loadManagedFiles, type AgentFile, type EnvironmentFile } from './managed-config.js';
import type { ManagedAgent, ManagedEnvironment } from './managed-client.js';

const CODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

function customTools(tools: readonly unknown[] | null | undefined): string {
  return JSON.stringify(
    (tools ?? [])
      .filter((tool) => (tool as { type?: string }).type === 'custom')
      .map((tool) => {
        const custom = tool as { name: string; description?: string; input_schema?: { properties?: unknown; required?: unknown } };
        return { name: custom.name, description: (custom.description ?? '').trim(), properties: custom.input_schema?.properties ?? null, required: custom.input_schema?.required ?? null };
      }),
  );
}

// What an existing agent needs changed to match the file with this default model; empty when nothing,
// ['missing'] when there is no agent by that name.
export function agentChanges(existing: ManagedAgent | null, file: AgentFile, model: string): string[] {
  if (!existing) return ['missing'];
  const changes: string[] = [];
  if ((existing.description ?? '') !== (file.description ?? '')) changes.push('description');
  if ((existing.system ?? '') !== (file.system ?? '')) changes.push('system');
  if (existing.model.id !== model) changes.push('model');
  if (enabledToolNames(existing.tools).sort().join(',') !== enabledToolNames(file.tools ?? []).sort().join(',')) changes.push('tools');
  if (customTools(existing.tools) !== customTools(file.tools ?? [])) changes.push('custom tools');
  if (agentProblems(existing, file).length > 0 && !changes.includes('tools')) changes.push('tools');
  return changes;
}

export function environmentChanges(existing: ManagedEnvironment | null, file: EnvironmentFile): string[] {
  if (!existing) return ['missing'];
  const changes = environmentProblems(existing, file);
  if ((existing.description ?? '') !== (file.description ?? '')) changes.push('description');
  return changes;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set in .env`);
  return value;
}

async function mainSha(repo: string, token: string): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'backseat-dispatcher' },
  });
  const json = (await response.json()) as { sha?: unknown; message?: unknown };
  if (response.status !== 200 || typeof json.sha !== 'string') throw new Error(`GITHUB_READ_TOKEN could not read main: http ${response.status} ${String(json.message ?? '')}`.trim());
  return json.sha;
}

async function apply(): Promise<void> {
  loadDotenv({ path: path.join(CODE_ROOT, '.env'), quiet: true });
  const key = required('STUDIO_ANTHROPIC_API_KEY');
  if (key === process.env.ANTHROPIC_API_KEY?.trim()) throw new Error("STUDIO_ANTHROPIC_API_KEY equals ANTHROPIC_API_KEY; the managed agent lives in the studio's organisation, never the founder's");
  const model = required('MODEL_BUILDER');
  const files = loadManagedFiles(CODE_ROOT);
  const client = new Anthropic({ apiKey: key });

  let agent: ManagedAgent | null = null;
  for await (const candidate of client.beta.agents.list()) {
    if (candidate.name === files.agent.name && !candidate.archived_at) agent = candidate;
  }
  const agentDiff = agentChanges(agent, files.agent, model);
  const agentBody = { ...files.agent, model: { id: model, speed: 'standard' as const } };
  if (!agent) agent = await client.beta.agents.create(agentBody);
  else if (agentDiff.length > 0) agent = await client.beta.agents.update(agent.id, agentBody);
  process.stdout.write(`agent ${files.agent.name}: ${agentDiff.length === 0 ? 'unchanged' : agentDiff.includes('missing') ? 'created' : `updated (${agentDiff.join(', ')})`}\n`);

  let environment: ManagedEnvironment | null = null;
  for await (const candidate of client.beta.environments.list()) {
    if (candidate.name === files.environment.name && !candidate.archived_at) environment = candidate;
  }
  const envDiff = environmentChanges(environment, files.environment);
  if (!environment) environment = await client.beta.environments.create(files.environment);
  else if (envDiff.length > 0) environment = await client.beta.environments.update(environment.id, files.environment);
  process.stdout.write(`environment ${files.environment.name}: ${envDiff.length === 0 ? 'unchanged' : envDiff.includes('missing') ? 'created' : `updated (${envDiff.join('; ')})`}\n`);

  process.stdout.write(`MANAGED_AGENT_ID=${agent.id}\nMANAGED_AGENT_VERSION=${agent.version}\nMANAGED_ENVIRONMENT_ID=${environment.id}\n`);

  if (!process.argv.includes('--check')) return;
  const repo = required('GITHUB_REPO');
  const readToken = required('GITHUB_READ_TOKEN');
  const sha = await mainSha(repo, readToken);
  const session = await client.beta.sessions.create({
    agent: { type: 'agent', id: agent.id, version: agent.version },
    environment_id: environment.id,
    title: 'pre-credit check',
    resources: [{ type: 'github_repository', url: `https://github.com/${repo}`, authorization_token: readToken, mount_path: '/workspace/peanutgallery', checkout: { type: 'commit', sha } }],
    budget: { type: 'limit', max_list_cost: { amount: '1', currency: 'USD' } },
    metadata: { purpose: 'check' },
  });
  const problems = agentProblems(session.agent, files.agent);
  process.stdout.write(
    `check session ${session.id}: status ${session.status}, agent version ${session.agent.version}, model ${session.agent.model.id}, main ${sha.slice(0, 12)}, resources ${session.resources.map((resource) => resource.type).join(', ')}${problems.length > 0 ? `; agent differs: ${problems.join('; ')}` : ''}\n`,
  );
  await client.beta.sessions.archive(session.id);
  process.stdout.write(`check session ${session.id} archived\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  apply().catch((error: unknown) => {
    process.stderr.write(`managed:apply failed: ${errorMessage(error)}\n`);
    process.exit(1);
  });
}
