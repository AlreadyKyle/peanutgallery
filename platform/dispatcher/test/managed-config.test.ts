import { describe, expect, it } from 'vitest';
import { agentChanges, environmentChanges } from '../src/adapters/managed-setup.js';
import { agentProblems, enabledToolNames, environmentProblems, SUBMIT_PATCH } from '../src/adapters/managed-config.js';
import { checkReadToken, PROBE_REF, ZERO_SHA } from '../src/adapters/read-token.js';
import { FILES, agentFromFile, environmentFromFile } from './helpers/fake-managed.js';
import { mockFetch, type Reply } from './helpers/mock-fetch.js';

describe('platform/agents/managed/agent.yaml', () => {
  it('turns on bash, the five file tools and submit_patch, and nothing else', () => {
    expect(enabledToolNames(FILES.agent.tools).sort()).toEqual(['bash', 'edit', 'glob', 'grep', 'read', SUBMIT_PATCH, 'write'].sort());
  });

  it('keeps every tool off by default and turns the web tools off by name', () => {
    const toolset = (FILES.agent.tools ?? []).find((tool) => tool.type === 'agent_toolset_20260401');
    expect(toolset && 'default_config' in toolset ? toolset.default_config : null).toMatchObject({ enabled: false });
    const configs = toolset && 'configs' in toolset ? (toolset.configs ?? []) : [];
    expect(configs.filter((config) => config.name === 'web_fetch' || config.name === 'web_search').map((config) => [config.name, config.enabled])).toEqual([
      ['web_fetch', false],
      ['web_search', false],
    ]);
  });

  it('declares no MCP server, no skill, no sub-agent roster, no model and no MCP toolset', () => {
    expect(FILES.agent.mcp_servers).toEqual([]);
    expect(FILES.agent.skills).toEqual([]);
    expect((FILES.agent as Record<string, unknown>).multiagent).toBeUndefined();
    expect((FILES.agent as Record<string, unknown>).model).toBeUndefined();
    expect((FILES.agent.tools ?? []).some((tool) => tool.type === 'mcp_toolset')).toBe(false);
  });

  it('declares submit_patch with a summary, a sha256 and a byte count, and no diff', () => {
    const submit = (FILES.agent.tools ?? []).find((tool) => tool.type === 'custom' && tool.name === SUBMIT_PATCH);
    const schema = submit && 'input_schema' in submit ? submit.input_schema : null;
    expect(schema?.required).toEqual(['summary', 'sha256', 'bytes']);
    expect(Object.keys(schema?.properties ?? {}).sort()).toEqual(['bytes', 'sha256', 'summary']);
  });

  it('matches the agent the API returns for it', () => {
    expect(agentProblems(agentFromFile(), FILES.agent)).toEqual([]);
  });
});

describe('platform/agents/managed/environment.yaml', () => {
  it('is a cloud container whose only egress is the package registries', () => {
    expect(FILES.environment.config).toEqual({
      type: 'cloud',
      networking: { type: 'limited', allow_package_managers: true, allow_mcp_servers: false, allowed_hosts: [] },
      packages: { npm: ['pnpm@11.0.9'] },
    });
    expect(environmentProblems(environmentFromFile(), FILES.environment)).toEqual([]);
  });
});

describe('managed:apply', () => {
  it('creates a missing agent and environment, and changes nothing when both match', () => {
    expect(agentChanges(null, FILES.agent, 'builder-class')).toEqual(['missing']);
    expect(agentChanges(agentFromFile(), FILES.agent, 'builder-class')).toEqual([]);
    expect(environmentChanges(null, FILES.environment)).toEqual(['missing']);
    expect(environmentChanges(environmentFromFile(), FILES.environment)).toEqual([]);
  });

  it('updates an agent whose model, tools or submit_patch schema drifted', () => {
    expect(agentChanges(agentFromFile(), FILES.agent, 'other-model')).toEqual(['model']);
    expect(agentChanges(agentFromFile({ ...FILES.agent, tools: [{ type: 'agent_toolset_20260401', default_config: { enabled: true } }] }), FILES.agent, 'builder-class')).toContain('tools');
    const described = (FILES.agent.tools ?? []).map((tool) => (tool.type === 'custom' ? { ...tool, description: 'older text' } : tool));
    expect(agentChanges(agentFromFile({ ...FILES.agent, tools: described }), FILES.agent, 'builder-class')).toEqual(['custom tools']);
  });
});

describe('checkReadToken', () => {
  const REPO = 'https://api.github.com/repos/owner/repo';
  function answers(read: Reply, write: Reply, writeHeaders: Record<string, string> = {}) {
    const mock = mockFetch((method, url) => (method === 'GET' && url === REPO ? read : method === 'POST' && url === `${REPO}/git/refs` ? write : undefined));
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      const response = await mock.fetchFn(input, init);
      return init?.method === 'POST' ? new Response(await response.text(), { status: response.status, headers: writeHeaders }) : response;
    }) as typeof fetch;
    return { fetchFn, calls: mock.calls };
  }
  const check = (fetchFn: typeof fetch) => checkReadToken({ token: 'github_pat_-read', repo: 'owner/repo', fetchFn });
  const denied: Reply = { status: 403, json: { message: 'Resource not accessible by personal access token' } };

  it('passes a token that reads the repository and is refused a ref write for want of permission, changing nothing', async () => {
    const { fetchFn, calls } = answers({ status: 200, json: {} }, denied);
    expect(await check(fetchFn)).toEqual({ ok: true });
    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ['GET', REPO, null],
      ['POST', `${REPO}/git/refs`, { ref: PROBE_REF, sha: ZERO_SHA }],
    ]);
  });

  it('refuses, for good, a token that could write (a 422 from validation) or cannot read', async () => {
    expect(await check(answers({ status: 200, json: {} }, { status: 422, json: { message: 'Object does not exist' } }).fetchFn)).toMatchObject({ ok: false, fatal: true, reason: expect.stringContaining('can write to owner/repo') });
    expect(await check(answers({ status: 404, json: { message: 'Not Found' } }, denied).fetchFn)).toMatchObject({ ok: false, fatal: true, reason: expect.stringContaining('cannot read owner/repo') });
    expect(await check(answers({ status: 200, json: {} }, { status: 404, json: { message: 'Not Found' } }).fetchFn)).toMatchObject({ ok: false, fatal: true });
    expect(await check(answers({ status: 200, json: {} }, { status: 403, json: { message: 'something else' } }).fetchFn)).toMatchObject({ ok: false, fatal: true, reason: expect.stringContaining('not a permission denial') });
  });

  it('proves nothing, and says so without refusing for good, on a rate limit, a 5xx or no answer', async () => {
    expect(await check(answers({ status: 200, json: {} }, { status: 403, json: { message: 'API rate limit exceeded' } }, { 'x-ratelimit-remaining': '0' }).fetchFn)).toMatchObject({ ok: false, fatal: false });
    expect(await check(answers({ status: 200, json: {} }, { status: 429, json: { message: 'API rate limit exceeded' } }).fetchFn)).toMatchObject({ ok: false, fatal: false, reason: expect.stringContaining('rate limited (429)') });
    expect(await check(answers({ status: 200, json: {} }, { status: 403, json: { message: 'You have exceeded a secondary rate limit' } }, { 'retry-after': '60' }).fetchFn)).toMatchObject({ ok: false, fatal: false });
    expect(await check(answers({ status: 502, text: '' }, denied).fetchFn)).toMatchObject({ ok: false, fatal: false });
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await check(failing)).toMatchObject({ ok: false, fatal: false });
  });

  it('accepts a denial GitHub states only in the accepted-permissions header', async () => {
    expect(await check(answers({ status: 200, json: {} }, { status: 403, json: { message: '' } }, { 'x-accepted-github-permissions': 'contents=write' }).fetchFn)).toEqual({ ok: true });
  });
});
