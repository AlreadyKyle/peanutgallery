// The managed agent and environment as the repository declares them (platform/agents/managed/*.yaml),
// and the comparisons unattended startup and every session create make against what the API
// returns. A writing agent may have bash and the five file tools and the submit_patch custom tool,
// and nothing else: no web tool, no MCP server, no skill, no sub-agent roster, no fast mode. The
// environment must be a cloud container whose only egress is the package registries.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { AgentCreateParams } from '@anthropic-ai/sdk/resources/beta/agents/agents';
import type { EnvironmentCreateParams } from '@anthropic-ai/sdk/resources/beta/environments/environments';
import type { ManagedAgent, ManagedEnvironment } from './managed-client.js';

export const MANAGED_DIR = path.join('platform', 'agents', 'managed');
export const AGENT_FILE = 'agent.yaml';
export const ENVIRONMENT_FILE = 'environment.yaml';
export const SUBMIT_PATCH = 'submit_patch';
export const TOOLSET_TYPE = 'agent_toolset_20260401';
// Every tool agent_toolset_20260401 carries (managed-agents-tools.md, Agent Toolset).
export const TOOLSET_TOOLS = ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'web_fetch', 'web_search'] as const;
// The tools a writing agent may never have, whatever the file says.
export const FORBIDDEN_MANAGED_TOOLS = ['web_fetch', 'web_search'] as const;

// The agent file without its model, which the apply step sets from MODEL_BUILDER.
export type AgentFile = Omit<AgentCreateParams, 'model' | 'betas' | 'workspace_id'>;
export type EnvironmentFile = Omit<EnvironmentCreateParams, 'betas' | 'workspace_id'>;

export interface ManagedFiles {
  agent: AgentFile;
  environment: EnvironmentFile;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Reads both files from a checkout (the dispatcher's own code root at runtime). A file that does not
// parse, or lacks a name, is an error that no restart fixes.
export function loadManagedFiles(root: string): ManagedFiles {
  const read = (file: string): Record<string, unknown> => {
    const full = path.join(root, MANAGED_DIR, file);
    const parsed: unknown = parse(readFileSync(full, 'utf8'));
    if (!isRecord(parsed) || typeof parsed.name !== 'string' || parsed.name.length === 0) {
      throw new Error(`${path.join(MANAGED_DIR, file)} is not a mapping with a name`);
    }
    return parsed;
  };
  const agent = read(AGENT_FILE);
  const environment = read(ENVIRONMENT_FILE);
  return { agent: agent as unknown as AgentFile, environment: environment as unknown as EnvironmentFile };
}

interface ToolLike {
  type: string;
  name?: string;
  enabled?: boolean | null;
  default_config?: { enabled?: boolean | null } | null;
  configs?: Array<{ name: string; enabled?: boolean | null }> | null;
  mcp_server_name?: string;
}

// The tool names a tools list turns on: each toolset tool by its config or the toolset default, each
// custom tool by name, and each MCP toolset as mcp__<server> (always refused).
export function enabledToolNames(tools: readonly unknown[] | null | undefined): string[] {
  const names: string[] = [];
  for (const raw of tools ?? []) {
    const tool = raw as ToolLike;
    if (tool.type === TOOLSET_TYPE) {
      const fallback = tool.default_config?.enabled ?? true;
      for (const name of TOOLSET_TOOLS) {
        const config = (tool.configs ?? []).find((entry) => entry.name === name);
        if (config?.enabled ?? fallback) names.push(name);
      }
    } else if (tool.type === 'custom' && typeof tool.name === 'string') {
      names.push(tool.name);
    } else if (tool.type === 'mcp_toolset') {
      names.push(`mcp__${tool.mcp_server_name ?? ''}`);
    } else {
      names.push(`unknown:${String(tool.type)}`);
    }
  }
  return names;
}

// What an agent object (a retrieved version, or the agent a session create returns) does differently
// from the agent file, as one line per problem. Empty means it matches.
export function agentProblems(
  agent: Pick<ManagedAgent, 'tools' | 'mcp_servers' | 'skills' | 'model'> & { multiagent?: unknown },
  expected: AgentFile,
): string[] {
  const problems: string[] = [];
  const want = enabledToolNames(expected.tools ?? []).sort();
  const have = enabledToolNames(agent.tools).sort();
  const forbidden = have.filter((name) => (FORBIDDEN_MANAGED_TOOLS as readonly string[]).includes(name) || name.startsWith('mcp__'));
  if (forbidden.length > 0) problems.push(`enabled tools include ${forbidden.join(', ')}`);
  if (have.join(',') !== want.join(',')) problems.push(`tools are ${have.join(', ') || 'none'}, not ${want.join(', ')}`);
  if ((agent.mcp_servers ?? []).length > 0) problems.push(`MCP servers configured: ${agent.mcp_servers.map((server) => server.name).join(', ')}`);
  if ((agent.skills ?? []).length > 0) problems.push(`skills attached: ${agent.skills.map((skill) => skill.skill_id).join(', ')}`);
  if (agent.multiagent) problems.push('a multiagent roster is configured');
  if (agent.model?.speed === 'fast') problems.push('the model runs at fast speed');
  return problems;
}

// What the environment does differently from the environment file.
export function environmentProblems(environment: Pick<ManagedEnvironment, 'config' | 'archived_at'>, expected: EnvironmentFile): string[] {
  const problems: string[] = [];
  if (environment.archived_at) problems.push('the environment is archived');
  const config = environment.config;
  const want = expected.config;
  if (!want || want.type !== 'cloud' || !want.networking || want.networking.type !== 'limited') {
    return [...problems, 'the environment file does not declare a cloud container with limited networking'];
  }
  if (config.type !== 'cloud') return [...problems, `the environment is ${config.type}, not cloud`];
  const net = config.networking;
  if (net.type !== 'limited') return [...problems, `networking is ${net.type}, not limited`];
  const wantNet = want.networking;
  if (net.allow_mcp_servers !== false) problems.push('MCP server egress is allowed');
  if (net.allow_package_managers !== (wantNet.allow_package_managers ?? false)) problems.push(`allow_package_managers is ${String(net.allow_package_managers)}`);
  const hosts = [...(net.allowed_hosts ?? [])].sort().join(',');
  const wantHosts = [...(wantNet.allowed_hosts ?? [])].sort().join(',');
  if (hosts !== wantHosts) problems.push(`allowed_hosts is [${hosts}], not [${wantHosts}]`);
  const npm = [...(config.packages?.npm ?? [])].sort().join(',');
  const wantNpm = [...(want.packages?.npm ?? [])].sort().join(',');
  if (npm !== wantNpm) problems.push(`npm packages are [${npm}], not [${wantNpm}]`);
  return problems;
}
