// An in-memory Managed Agents API for the managed adapter's tests: agents, environments, sessions with
// an event history and live streams, session outputs and archiving. Nothing reaches the network. A test
// scripts what the "platform" does after each event the dispatcher sends; the event shapes follow
// managed-agents-events.md (test/fixtures/managed-session.json), and are doc-derived, not recorded.
import path from 'node:path';
import type { EventSendParams } from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { EventStream, ManagedAgent, ManagedClient, ManagedEnvironment, ManagedSession, OutputFile, SessionCreateParams, SessionEvent, StreamEvent } from '../../src/adapters/managed-client.js';
import { loadManagedFiles, type AgentFile } from '../../src/adapters/managed-config.js';

export const CODE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
export const FILES = loadManagedFiles(CODE_ROOT);
export const AGENT_ID = 'agent_fixture';
export const ENVIRONMENT_ID = 'env_fixture';

type SentEvent = EventSendParams['events'][number];

// The agent object the API returns for the agent file: every toolset tool listed with its effective
// switch, as responses do.
export function agentFromFile(file: AgentFile = FILES.agent, overrides: Partial<ManagedAgent> = {}): ManagedAgent {
  const tools = (file.tools ?? []).map((tool) => {
    if (tool.type !== 'agent_toolset_20260401') return { ...tool };
    const fallback = tool.default_config?.enabled ?? true;
    const names = ['bash', 'read', 'write', 'edit', 'glob', 'grep', 'web_fetch', 'web_search'] as const;
    return {
      type: 'agent_toolset_20260401' as const,
      default_config: { enabled: fallback, permission_policy: { type: 'always_allow' as const } },
      configs: names.map((name) => ({ name, type: name, enabled: (tool.configs ?? []).find((config) => config.name === name)?.enabled ?? fallback, permission_policy: { type: 'always_allow' as const } })),
    };
  });
  return {
    id: AGENT_ID,
    archived_at: null,
    created_at: 'created',
    description: file.description ?? null,
    mcp_servers: [],
    metadata: {},
    model: { id: 'builder-class', speed: 'standard' },
    multiagent: null,
    name: file.name,
    skills: [],
    system: file.system ?? null,
    tools: tools as ManagedAgent['tools'],
    type: 'agent',
    updated_at: 'updated',
    version: 3,
    ...overrides,
  };
}

export function environmentFromFile(overrides: Partial<ManagedEnvironment['config']> = {}): ManagedEnvironment {
  return {
    id: ENVIRONMENT_ID,
    archived_at: null,
    config: {
      type: 'cloud',
      networking: { type: 'limited', allow_mcp_servers: false, allow_package_managers: true, allowed_hosts: [] },
      packages: { apt: [], cargo: [], gem: [], go: [], npm: ['pnpm@11.0.9'], pip: [] },
      ...overrides,
    } as ManagedEnvironment['config'],
    created_at: 'created',
    description: FILES.environment.description ?? null,
    metadata: {},
    name: FILES.environment.name,
    type: 'environment',
    updated_at: 'updated',
  };
}

export interface ListCost {
  cents: number;
  activeSeconds: number;
}

export class FakeSession {
  readonly id: string;
  status: ManagedSession['status'] = 'idle';
  archived = false;
  readonly history: SessionEvent[] = [];
  readonly params: SessionCreateParams;
  readonly agent: ManagedSession['agent'];
  cost: ListCost = { cents: 0, activeSeconds: 0 };
  private readonly queues = new Set<{ push: (event: StreamEvent | null) => void }>();
  private counter = 0;

  constructor(id: string, params: SessionCreateParams, agent: ManagedSession['agent']) {
    this.id = id;
    this.params = params;
    this.agent = agent;
  }

  // Adds events to the history and every open stream, as the platform does.
  emit(...events: Array<Record<string, unknown>>): void {
    for (const raw of events) {
      const event = { id: `sevt_${this.id}_${(this.counter += 1)}`, ...raw } as unknown as SessionEvent;
      if (event.type === 'session.status_idle') this.status = 'idle';
      if (event.type === 'session.status_running') this.status = 'running';
      if (event.type === 'session.status_terminated') this.status = 'terminated';
      this.history.push(event);
      for (const queue of this.queues) queue.push(event as StreamEvent);
    }
  }

  // Ends every open stream, as a dropped connection does.
  drop(): void {
    for (const queue of this.queues) queue.push(null);
  }

  openStream(dropAfter: number | null): EventStream {
    const buffer: Array<StreamEvent | null> = [];
    let wake: (() => void) | null = null;
    const controller = new AbortController();
    const queue = {
      push: (event: StreamEvent | null) => {
        buffer.push(event);
        wake?.();
      },
    };
    this.queues.add(queue);
    controller.signal.addEventListener('abort', () => queue.push(null));
    const queues = this.queues;
    let delivered = 0;
    return {
      controller,
      async *[Symbol.asyncIterator]() {
        try {
          for (;;) {
            if (buffer.length === 0) await new Promise<void>((resolve) => (wake = resolve));
            wake = null;
            const next = buffer.shift();
            if (next === null || next === undefined) return;
            yield next;
            delivered += 1;
            if (dropAfter !== null && delivered >= dropAfter) return;
          }
        } finally {
          queues.delete(queue);
        }
      },
    };
  }

  snapshot(): ManagedSession {
    return {
      id: this.id,
      agent: this.agent,
      archived_at: this.archived ? 'archived' : null,
      budget: this.params.budget ?? null,
      created_at: 'created',
      environment_id: this.params.environment_id,
      metadata: { ...(this.params.metadata ?? {}) },
      outcome_evaluations: [],
      resources: [],
      stats: {},
      status: this.status,
      title: this.params.title ?? null,
      type: 'session',
      updated_at: 'updated',
      usage: { list_cost: { amount: String(this.cost.cents), currency: 'USD' }, active_seconds: this.cost.activeSeconds },
      vault_ids: [],
    };
  }
}

export type Reaction = (session: FakeSession, event: SentEvent, client: FakeManagedClient) => void | Promise<void>;

export class FakeManagedClient implements ManagedClient {
  agent: ManagedAgent = agentFromFile();
  environment: ManagedEnvironment = environmentFromFile();
  readonly sessions_: FakeSession[] = [];
  readonly sent: Array<{ sessionId: string; event: SentEvent }> = [];
  readonly outputs = new Map<string, Array<{ meta: OutputFile; bytes: Buffer }>>();
  readonly deletedFiles: string[] = [];
  readonly retrievedAgents: Array<{ id: string; version?: number }> = [];
  // What the platform does after each event the dispatcher sends.
  react: Reaction = () => undefined;
  // Each stream ends after this many events, once; null never.
  dropAfter: number | null = null;
  streamsOpened = 0;
  failCreate: Error | null = null;
  private fileCounter = 0;

  session(id: string): FakeSession {
    const found = this.sessions_.find((session) => session.id === id);
    if (!found) throw new Error(`no fake session ${id}`);
    return found;
  }

  get last(): FakeSession {
    const found = this.sessions_.at(-1);
    if (!found) throw new Error('no fake session yet');
    return found;
  }

  // A file the agent wrote to /mnt/session/outputs.
  addOutput(sessionId: string, filename: string, bytes: Buffer): OutputFile {
    this.fileCounter += 1;
    const meta: OutputFile = {
      id: `file_${this.fileCounter}`,
      created_at: `t${String(this.fileCounter).padStart(4, '0')}`,
      filename,
      mime_type: 'text/plain',
      size_bytes: bytes.byteLength,
      type: 'file',
      downloadable: true,
      scope: { id: sessionId, type: 'session' },
    };
    const list = this.outputs.get(sessionId) ?? [];
    list.push({ meta, bytes });
    this.outputs.set(sessionId, list);
    return meta;
  }

  agents = {
    retrieve: async (agentId: string, params?: { version?: number }) => {
      this.retrievedAgents.push({ id: agentId, version: params?.version });
      return this.agent;
    },
  };

  environments = {
    retrieve: async (_environmentId: string) => this.environment,
  };

  sessions = {
    create: async (params: SessionCreateParams) => {
      if (this.failCreate) throw this.failCreate;
      const ref = typeof params.agent === 'string' ? { id: params.agent } : params.agent;
      const overrides = 'type' in ref && ref.type === 'agent_with_overrides' ? ref : null;
      const model = overrides?.model ? (typeof overrides.model === 'string' ? { id: overrides.model } : { id: overrides.model.id, speed: overrides.model.speed ?? 'standard' }) : this.agent.model;
      const agent: ManagedSession['agent'] = {
        id: this.agent.id,
        description: this.agent.description,
        mcp_servers: this.agent.mcp_servers,
        model: model as ManagedAgent['model'],
        multiagent: null,
        name: this.agent.name,
        skills: this.agent.skills,
        system: overrides && overrides.system !== undefined ? overrides.system : this.agent.system,
        tools: this.agent.tools,
        type: 'agent',
        version: this.agent.version,
      };
      const session = new FakeSession(`sesn_${this.sessions_.length + 1}`, params, agent);
      this.sessions_.push(session);
      return session.snapshot();
    },
    retrieve: async (sessionId: string) => this.session(sessionId).snapshot(),
    archive: async (sessionId: string) => {
      const session = this.session(sessionId);
      session.archived = true;
      return session.snapshot();
    },
    list: (params?: { include_archived?: boolean; agent_id?: string }) => {
      const all = this.sessions_;
      return (async function* () {
        for (const session of [...all]) {
          if (!params?.include_archived && session.archived) continue;
          yield session.snapshot();
        }
      })();
    },
    events: {
      list: (sessionId: string) => {
        const history = [...this.session(sessionId).history];
        return (async function* () {
          yield* history;
        })();
      },
      send: async (sessionId: string, params: EventSendParams) => {
        const session = this.session(sessionId);
        for (const event of params.events) {
          this.sent.push({ sessionId, event });
          if (event.type !== 'user.interrupt') session.emit({ ...event });
          await this.react(session, event, this);
        }
        return {};
      },
      stream: async (sessionId: string) => {
        this.streamsOpened += 1;
        const dropAfter = this.dropAfter;
        this.dropAfter = null;
        return this.session(sessionId).openStream(dropAfter);
      },
    },
  };

  files = {
    list: (params: { scope_id?: string }) => {
      const entries = this.outputs.get(params.scope_id ?? '') ?? [];
      const deleted = this.deletedFiles;
      return (async function* () {
        for (const entry of entries) if (!deleted.includes(entry.meta.id)) yield entry.meta;
      })();
    },
    download: async (fileId: string) => {
      for (const entries of this.outputs.values()) {
        const found = entries.find((entry) => entry.meta.id === fileId);
        if (found) return new Response(new Uint8Array(found.bytes));
      }
      throw new Error(`no fake file ${fileId}`);
    },
    delete: async (fileId: string) => {
      this.deletedFiles.push(fileId);
      return {};
    },
  };
}
