// Unattended adapter: each card runs as a Claude Managed Agents session on the studio organisation's
// key (docs/specs/launch-managed.md). The agent loop runs on Anthropic's side and the tools run in a
// container Anthropic hosts, with the repository mounted at the card's base commit through a
// read-only token. No agent-written code runs on the VPS, which holds the dispatcher's secrets; the
// VPS keeps each session's event stream, meters it, answers submit_patch and drives the gate, merge
// and deploy as before.
//
// One session, in order:
// 1. Sessions a previous process left for this card are settled and archived first (a patch one of
//    them submitted is applied instead of paying for a new session), the read-only token is proved
//    unable to write, and the base commit is checked for repository skills. A failure here that is
//    not the card's (an API or GitHub that did not answer, a session that could not be settled)
//    throws SessionPaused: the card pauses with no session started, rather than being rejected.
// 2. The session is created idle, spending nothing, with the role's model and a system prompt built
//    from the role prompt and the CLAUDE.md files at the base commit, a dollar budget, and metadata
//    naming the card. Its id goes on the card's start event before any spend.
// 3. The stream is opened, the history listed and deduped by event id (on every connect and
//    reconnect), and the card prompt sent as the first user.message.
// 4. Every span.model_request_end is a ledger row under its event id and a turn_usage event. Every
//    abort the session sees (pause, ceiling, wall clock, turn cap, refusal, dispatcher stop) becomes a
//    user.interrupt, and the stream is drained to idle.
// 5. The agent finishes by writing its diff to /mnt/session/outputs/card.patch and calling
//    submit_patch({summary, sha256, bytes}). The dispatcher fetches the file through the Files API,
//    checks it and applies it to the worktree (src/patch.ts), stores it in card_patches and ends the
//    session without a tool result, which would start a paid turn. A refused patch gets the reason as
//    an error result and one more try.
// 6. Once idle, the session's usage is read, the runtime and settle rows are written so its rows add
//    up to the platform's list cost, the output files are deleted and the session archived. A session
//    whose rows could not all be written is left unarchived for recovery to settle. A stream that
//    could not be held or a ledger that refused rows pauses the card (SessionPaused) once the session
//    is settled.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { Alerter } from '../alert.js';
import type { Db } from '../db.js';
import { StartupError } from '../exit-code.js';
import { haltDispatcher } from '../halt.js';
import { errorMessage, type Logger } from '../log.js';
import { applyStoredPatch, PATCH_FILE, PATCH_MAX_BYTES, patchSha256, patchTextProblem, storedPatch, validateAndApply, type PatchStore } from '../patch.js';
import { fallbackPrice, modelPrice, priceWith, round4, type PriceTable } from '../pricing.js';
import { sleep } from '../time.js';
import { git, headSha, shortId } from '../worktree.js';
import { refusedTools } from './tool-names.js';
import { agentProblems, enabledToolNames, environmentProblems, SUBMIT_PATCH, type ManagedFiles } from './managed-config.js';
import type { EventStream, ManagedClient, ManagedSession, OutputFile, SessionEvent, StreamEvent } from './managed-client.js';
import { ManagedMeter, listCostUsd, turnUsage, type ManagedBilling, type SettleReport } from './managed-meter.js';
import { checkReadToken } from './read-token.js';
import { SessionPaused, type AgentAdapter, type AgentEvent, type ClosedSessions, type EventSink, type ManagedControl, type SessionResult, type SessionSpec } from './types.js';

export const API_KEY_SOURCE = 'ANTHROPIC_API_KEY';
export const REPO_MOUNT = '/workspace/peanutgallery';
export const OUTPUTS_DIR = '/mnt/session/outputs';
export const TOOLCHAIN_FILE = 'toolchain.txt';
// A system prompt may be up to 100,000 characters (managed-agents-core.md, agent configuration).
export const SYSTEM_PROMPT_LIMIT = 100_000;
// One more submission after a refused patch.
export const SUBMIT_RETRIES = 1;
// The budget keeps back one model request, because the platform's cap lets the request that crosses
// it finish: one request reading this many cached tokens and writing this much output, priced at the
// session model's rates.
export const MARGIN_CACHE_READ_TOKENS = 150_000;
export const MARGIN_OUTPUT_TOKENS = 8_192;
export const PROBE_BUDGET_CENTS = 25;
export const TOOLCHAIN_BUDGET_CENTS = 100;
export const PROBE_PROMPT = 'Reply with the single word ready. Run no tool.';

export type SessionPurpose = 'card' | 'probe' | 'toolchain' | 'check';
const PURPOSES: readonly string[] = ['card', 'probe', 'toolchain', 'check'];

export interface ManagedTimings {
  // How long an interrupted session is drained before the dispatcher stops reading it.
  interruptGraceMs: number;
  // How long, and how often, the session is read until it is no longer running.
  statusWaitMs: number;
  statusPollMs: number;
  // Session outputs take a moment to be indexed after the session goes idle.
  outputTries: number;
  outputDelayMs: number;
  reconnectTries: number;
  reconnectDelayMs: number;
  ledgerRetryMs: number;
  archiveTries: number;
  archiveDelayMs: number;
  probeTimeoutMs: number;
}

export const DEFAULT_TIMINGS: ManagedTimings = {
  interruptGraceMs: 15_000,
  statusWaitMs: 10_000,
  statusPollMs: 250,
  outputTries: 6,
  outputDelayMs: 1000,
  reconnectTries: 5,
  reconnectDelayMs: 1000,
  ledgerRetryMs: 500,
  archiveTries: 5,
  archiveDelayMs: 500,
  probeTimeoutMs: 180_000,
};

export interface ManagedAdapterOptions {
  client: ManagedClient;
  files: ManagedFiles;
  agentId: string;
  agentVersion: number;
  environmentId: string;
  githubRepo: string;
  readToken: string;
  priceTable: PriceTable;
  // The model the startup probe runs on (MODEL_BUILDER).
  probeModel: string;
  db: Pick<Db, 'recordUsage'>;
  patches: PatchStore | null;
  alert: Alerter;
  log: Logger;
  fetchFn?: typeof fetch;
  timings?: Partial<ManagedTimings>;
}

type CustomToolUse = Extract<SessionEvent, { type: 'agent.custom_tool_use' }>;
type IdleStop = Extract<SessionEvent, { type: 'session.status_idle' }>['stop_reason'];
type UsageSnapshot = Extract<SessionEvent, { type: 'session.usage' }>['usage'];
type SubmitVerdict = { accepted: true } | { accepted: false; reason: string };

export type DriveStop =
  | 'accepted'
  | 'end_turn'
  | 'budget_reached'
  | 'retries_exhausted'
  | 'terminated'
  | 'patch_rejected'
  | 'no_patch'
  | 'interrupted'
  | 'stream_lost'
  | 'ledger_refused'
  | 'violation';

interface DriveOptions {
  sessionId: string;
  model: string;
  meter: ManagedMeter;
  onEvent: EventSink;
  signal: AbortSignal;
  firstMessage: string;
  onSubmit: ((event: CustomToolUse) => Promise<SubmitVerdict>) | null;
  remind: boolean;
}

export interface DriveResult {
  stop: DriveStop;
  turns: number;
  messages: string[];
  errors: string[];
  toolUses: number;
  killReason: string | null;
  lastUsage: UsageSnapshot | null;
}

function textOf(content: ReadonlyArray<{ type: string; text?: string }> | null | undefined): string {
  return (content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function isApiError(error: unknown): error is InstanceType<typeof Anthropic.APIError> {
  return error instanceof Anthropic.APIError;
}

// A request error no retry can change: a malformed or refused request, a bad key, a missing agent,
// environment or session. Rate limits, overload, 5xx and connection errors are transient.
export function fatalApiError(error: unknown): boolean {
  if (!isApiError(error) || error.status === undefined) return false;
  return [400, 401, 403, 404, 422].includes(error.status);
}

// The dollar budget in cents: what the session may still spend, less one request, rounded down.
export function budgetCents(maxBudgetUsd: number, marginUsd: number): number {
  return Math.max(0, Math.floor(round4(maxBudgetUsd - marginUsd) * 100 + 1e-6));
}

export function exportCommand(baseSha: string): string {
  const patch = `${OUTPUTS_DIR}/${PATCH_FILE}`;
  return `cd ${REPO_MOUNT} && mkdir -p ${OUTPUTS_DIR} && git add -A && git diff --cached --no-renames --full-index ${baseSha} > ${patch} && sha256sum ${patch} && wc -c < ${patch}`;
}

// The first user.message's closing section: the one network command and the one git command a managed
// session runs, and how it hands its work back. It follows the card prompt, which forbids both for
// the command-line sessions that commit in place.
export function finishingSection(baseSha: string): string {
  return [
    '',
    'Finishing in this session:',
    `- You work in a container. The repository is checked out at ${REPO_MOUNT}, at the card's base commit ${baseSha}. The dispatcher, not you, commits, pushes and opens the pull request.`,
    '- The rules above against git, gh and network commands still hold, with two exceptions and no others:',
    `  1. Before your verification commands, run \`cd ${REPO_MOUNT} && pnpm install --frozen-lockfile\` once. It installs from the lockfile; the only hosts the container reaches are the package registries.`,
    `  2. When the acceptance check holds and your verification commands pass, run exactly this command with the bash tool: \`${exportCommand(baseSha)}\``,
    `- Then call the submit_patch tool once, with a one-line summary and the sha256 and byte count that command printed. Do not paste the diff.`,
    `- The dispatcher fetches ${OUTPUTS_DIR}/${PATCH_FILE}, checks it and applies it. It refuses a patch that touches a file outside the allowed paths or on a kernel path, renames or copies a file, changes a binary file, uses a file mode other than a regular file, or is over ${PATCH_MAX_BYTES} bytes. The tool result then says why, and you may fix the change, export again and submit once more.`,
    '- Once the dispatcher accepts the patch the session ends.',
  ].join('\n');
}

export const REMINDER = 'You ended without calling submit_patch. If the acceptance check holds and the verification commands pass, run the export command from the card message and call submit_patch now. Otherwise say in one line why the card cannot be done.';

export function toolchainCommand(): string {
  const out = `${OUTPUTS_DIR}/${TOOLCHAIN_FILE}`;
  return [
    `mkdir -p ${OUTPUTS_DIR}`,
    `cd ${REPO_MOUNT}`,
    `{ echo "node=$(node -v 2>&1)"; echo "pnpm=$(pnpm -v 2>&1)"; pnpm install --frozen-lockfile > /tmp/install.log 2>&1; echo "install_exit=$?"; pnpm --filter @backseat/seed-1 bot --config-dir seed-1/config --hours 10 --seed 20260914 > /tmp/bot.log 2>&1; echo "bot_exit=$?"; tail -n 3 /tmp/bot.log | sed 's/^/bot_tail=/'; } > ${out} 2>&1`,
    `cat ${out}`,
  ].join(' && ');
}

// Drives one session's event stream to a stop, with the consolidation pattern on every connect.
class SessionDriver {
  private readonly seen = new Set<string>();
  private readonly pendingSubmits = new Map<string, CustomToolUse>();
  private readonly answered = new Set<string>();
  private readonly messages: string[] = [];
  private readonly errors: string[] = [];
  private messageSent = false;
  private rejections = 0;
  private reminded = false;
  private interruptSent = false;
  private drainExpired = false;
  private drainTimer: NodeJS.Timeout | null = null;
  private stream: EventStream | null = null;
  private stop: DriveStop | null = null;
  private killReason: string | null = null;
  private lastUsage: UsageSnapshot | null = null;
  private turns = 0;
  private toolUses = 0;
  private ledgerFailed = false;
  private violated = false;

  constructor(
    private readonly adapter: ManagedAdapter,
    private readonly opts: DriveOptions,
  ) {}

  private get client(): ManagedClient {
    return this.adapter.client;
  }

  private done(): boolean {
    return this.stop !== null || this.drainExpired;
  }

  async drive(): Promise<DriveResult> {
    const onAbort = () => void this.interrupt(String(this.opts.signal.reason ?? 'aborted'));
    this.opts.signal.addEventListener('abort', onAbort, { once: true });
    if (this.opts.signal.aborted) onAbort();
    let reconnects = 0;
    try {
      while (!this.done()) {
        try {
          await this.connect();
        } catch (error) {
          if (this.done()) break;
          this.adapter.log.warn('managed', 'session stream dropped', { session: this.opts.sessionId, error: errorMessage(error) });
        }
        if (this.done()) break;
        reconnects += 1;
        if (reconnects > this.adapter.timings.reconnectTries) {
          this.stop = 'stream_lost';
          this.errors.push(`the event stream dropped ${reconnects} times`);
          break;
        }
        await sleep(this.adapter.timings.reconnectDelayMs * reconnects);
      }
    } finally {
      this.opts.signal.removeEventListener('abort', onAbort);
      if (this.drainTimer) clearTimeout(this.drainTimer);
      this.stream?.controller.abort();
    }
    return {
      stop: this.violated ? 'violation' : this.ledgerFailed ? 'ledger_refused' : (this.stop ?? 'interrupted'),
      turns: this.turns,
      messages: this.messages,
      errors: this.errors,
      toolUses: this.toolUses,
      killReason: this.killReason,
      lastUsage: this.lastUsage,
    };
  }

  // Stream first, then the history, deduped by event id, then the live tail. The card prompt is sent
  // once, after the first history read, so every event it causes arrives on the open stream.
  private async connect(): Promise<void> {
    const stream = await this.client.sessions.events.stream(this.opts.sessionId);
    this.stream = stream;
    try {
      for await (const event of this.client.sessions.events.list(this.opts.sessionId)) {
        await this.consume(event);
        if (this.done()) return;
      }
      if (!this.messageSent) {
        if (this.opts.signal.aborted) {
          this.stop = 'interrupted';
          return;
        }
        await this.send([{ type: 'user.message', content: [{ type: 'text', text: this.opts.firstMessage }] }]);
        this.messageSent = true;
      }
      for await (const event of stream) {
        await this.consume(event);
        if (this.done()) return;
      }
    } finally {
      stream.controller.abort();
      if (this.stream === stream) this.stream = null;
    }
  }

  private async send(events: Parameters<ManagedClient['sessions']['events']['send']>[1]['events']): Promise<void> {
    await this.client.sessions.events.send(this.opts.sessionId, { events });
  }

  private async consume(event: SessionEvent | StreamEvent): Promise<void> {
    const id = 'id' in event && typeof event.id === 'string' ? event.id : '';
    if (id) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
    }
    // Before the card prompt the session was idle and had done nothing of ours.
    if (!this.messageSent) return;
    await this.handle(event);
  }

  private async interrupt(reason: string): Promise<void> {
    this.killReason ??= reason;
    if (!this.messageSent) {
      this.stop ??= 'interrupted';
      return;
    }
    if (this.interruptSent || this.stop !== null) return;
    this.interruptSent = true;
    this.drainTimer = setTimeout(() => {
      this.drainExpired = true;
      this.stream?.controller.abort();
    }, this.adapter.timings.interruptGraceMs);
    this.drainTimer.unref?.();
    try {
      await this.send([{ type: 'user.interrupt' }]);
    } catch (error) {
      this.adapter.log.warn('managed', 'interrupt not sent', { session: this.opts.sessionId, error: errorMessage(error) });
    }
  }

  // A session that did something no writing agent may do is interrupted and ends as a violation.
  private async violation(message: string): Promise<void> {
    this.violated = true;
    this.errors.push(message);
    await this.opts.onEvent({ type: 'error', message });
    await this.interrupt('refused');
  }

  private async handle(event: SessionEvent | StreamEvent): Promise<void> {
    switch (event.type) {
      case 'span.model_request_end': {
        const usage = event.model_usage;
        this.turns += 1;
        const { written } = await this.opts.meter.request(event.id, usage);
        await this.opts.onEvent({ type: 'turn_usage', turn: this.turns, model: this.opts.model, usage: turnUsage(usage), contentChars: 0, thinking: false, requestId: event.id });
        if (!written && !this.ledgerFailed) {
          this.ledgerFailed = true;
          this.errors.push(`the ledger refused the row for request ${event.id}`);
          await this.interrupt('ledger');
        }
        if (usage.speed === 'fast') await this.violation(`model request ${event.id} ran at fast speed`);
        return;
      }
      case 'agent.message': {
        const text = textOf(event.content);
        if (text) {
          this.messages.push(text);
          await this.opts.onEvent({ type: 'message', text });
        }
        return;
      }
      case 'agent.tool_use':
        this.toolUses += 1;
        await this.opts.onEvent({ type: 'tool_call', toolUseId: event.id, name: event.name, input: event.input });
        if (event.evaluated_permission === 'ask') {
          await this.send([{ type: 'user.tool_confirmation', tool_use_id: event.id, result: 'deny', deny_message: 'No tool call waits for approval in this studio.' }]);
        }
        return;
      case 'agent.tool_result':
        await this.opts.onEvent({ type: 'tool_result', toolUseId: event.tool_use_id, content: textOf(event.content), isError: event.is_error ?? false });
        return;
      case 'agent.mcp_tool_use':
        if (event.evaluated_permission === 'ask') {
          await this.send([{ type: 'user.tool_confirmation', tool_use_id: event.id, result: 'deny', deny_message: 'No MCP tool is allowed.' }]);
        }
        await this.violation(`the session used MCP tool ${event.mcp_server_name}/${event.name}`);
        return;
      case 'agent.custom_tool_use':
        await this.opts.onEvent({ type: 'tool_call', toolUseId: event.id, name: event.name, input: event.input });
        if (event.name === SUBMIT_PATCH && this.opts.onSubmit) {
          this.pendingSubmits.set(event.id, event);
        } else {
          this.answered.add(event.id);
          await this.send([{ type: 'user.custom_tool_result', custom_tool_use_id: event.id, is_error: true, content: [{ type: 'text', text: `${event.name} is not available in this session.` }] }]);
        }
        return;
      case 'user.custom_tool_result':
        this.answered.add(event.custom_tool_use_id);
        return;
      case 'session.error': {
        const message = `session error: ${JSON.stringify(event.error)}`;
        this.errors.push(message);
        await this.opts.onEvent({ type: 'error', message });
        return;
      }
      case 'session.usage':
        this.lastUsage = event.usage;
        return;
      case 'session.status_idle':
        await this.onIdle(event.stop_reason);
        return;
      case 'session.status_terminated':
        this.stop ??= 'terminated';
        return;
      default:
        return;
    }
  }

  private async onIdle(stop: IdleStop): Promise<void> {
    switch (stop.type) {
      case 'requires_action': {
        for (const id of stop.event_ids) {
          const pending = this.pendingSubmits.get(id);
          if (!pending || this.answered.has(id) || !this.opts.onSubmit) continue;
          this.pendingSubmits.delete(id);
          let verdict: SubmitVerdict;
          try {
            verdict = await this.opts.onSubmit(pending);
          } catch (error) {
            verdict = { accepted: false, reason: `the patch could not be checked: ${errorMessage(error)}` };
          }
          if (verdict.accepted) {
            this.stop = 'accepted';
            return;
          }
          this.errors.push(`patch refused: ${verdict.reason}`);
          await this.opts.onEvent({ type: 'error', message: `submit_patch refused: ${verdict.reason}` });
          if (this.interruptSent || this.rejections >= SUBMIT_RETRIES) {
            this.stop = 'patch_rejected';
            return;
          }
          this.rejections += 1;
          this.answered.add(id);
          await this.send([
            {
              type: 'user.custom_tool_result',
              custom_tool_use_id: id,
              is_error: true,
              content: [{ type: 'text', text: `Refused: ${verdict.reason}. Fix the change, run the export command again and call submit_patch once more; this is the last try.` }],
            },
          ]);
        }
        return;
      }
      case 'end_turn':
        if (this.interruptSent) {
          this.stop = 'interrupted';
          return;
        }
        if (this.opts.remind && !this.reminded) {
          this.reminded = true;
          await this.send([{ type: 'user.message', content: [{ type: 'text', text: REMINDER }] }]);
          return;
        }
        this.stop = this.opts.onSubmit ? 'no_patch' : 'end_turn';
        return;
      case 'retries_exhausted':
        this.stop = 'retries_exhausted';
        return;
      case 'budget_reached':
        this.stop = 'budget_reached';
        return;
    }
  }
}

interface SettleOutcome {
  settled: boolean;
  reason: string | null;
  patchStored: boolean;
  report: SettleReport | null;
}

export class ManagedAdapter implements AgentAdapter, ManagedControl {
  readonly mode = 'unattended' as const;
  readonly managed: ManagedControl = this;
  readonly client: ManagedClient;
  readonly log: Logger;
  readonly timings: ManagedTimings;
  private readonly opts: ManagedAdapterOptions;

  constructor(opts: ManagedAdapterOptions) {
    if (!opts.agentId || !opts.environmentId || !Number.isInteger(opts.agentVersion) || opts.agentVersion < 1) {
      throw new Error('the managed agent id, its version and the environment id are required in unattended mode');
    }
    if (!opts.readToken) throw new Error('GITHUB_READ_TOKEN is required in unattended mode');
    this.opts = opts;
    this.client = opts.client;
    this.log = opts.log;
    this.timings = { ...DEFAULT_TIMINGS, ...opts.timings };
  }

  // One request at the session model's rates, kept back from the budget.
  marginUsd(model: string): number {
    const price = modelPrice(this.opts.priceTable, model) ?? fallbackPrice(this.opts.priceTable);
    const usage = { input_tokens: 0, cache_creation_input_tokens: 0, cache_creation_1h_input_tokens: 0, cache_read_input_tokens: MARGIN_CACHE_READ_TOKENS, output_tokens: MARGIN_OUTPUT_TOKENS };
    return round4(priceWith(price, model, usage).usd);
  }

  async preflight(spec: SessionSpec): Promise<void> {
    const refused = refusedTools(spec.roleTools);
    if (refused.length > 0) throw new Error(`role tools include excluded tools: ${refused.join(', ')}`);
    if (spec.maxBudgetUsd <= 0) throw new Error('session budget must be positive');
    if (!spec.allowedPaths || spec.allowedPaths.length === 0) throw new Error('a managed session needs the lane paths its patch must stay inside');
  }

  // --- containment -------------------------------------------------------------------------------

  private async readTokenVerdict(): Promise<void> {
    const verdict = await checkReadToken({ token: this.opts.readToken, repo: this.opts.githubRepo, fetchFn: this.opts.fetchFn });
    if (verdict.ok) return;
    throw new StartupError(verdict.reason, verdict.fatal);
  }

  async checkContainment(): Promise<void> {
    await this.readTokenVerdict();
    const { agentId, agentVersion, environmentId, files } = this.opts;
    try {
      const agent = await this.client.agents.retrieve(agentId, { version: agentVersion });
      const problems = agentProblems(agent, files.agent);
      if (agent.version !== agentVersion) problems.push(`the API returned version ${agent.version}, not the pinned ${agentVersion}`);
      if (agent.archived_at) problems.push('the agent is archived');
      if (problems.length > 0) throw new StartupError(`managed agent ${agentId} version ${agentVersion} differs from ${path.join('platform/agents/managed', 'agent.yaml')}: ${problems.join('; ')}`, true);
      const environment = await this.client.environments.retrieve(environmentId);
      const envProblems = environmentProblems(environment, files.environment);
      if (envProblems.length > 0) throw new StartupError(`managed environment ${environmentId} differs from platform/agents/managed/environment.yaml: ${envProblems.join('; ')}`, true);
    } catch (error) {
      if (error instanceof StartupError) throw error;
      throw new StartupError(`the managed agent or environment could not be read: ${errorMessage(error)}`, fatalApiError(error));
    }
    this.log.info('startup', 'containment verified', { agent: agentId, version: agentVersion, environment: environmentId, repo: this.opts.githubRepo });
  }

  // Before every card session. A token found able to write halts the dispatcher: no card runs again
  // until someone has replaced it and restarted. Either way the card pauses with no session.
  private async assertReadToken(): Promise<void> {
    const verdict = await checkReadToken({ token: this.opts.readToken, repo: this.opts.githubRepo, fetchFn: this.opts.fetchFn });
    if (verdict.ok) return;
    if (verdict.fatal) {
      haltDispatcher(`read_token: ${verdict.reason}`);
      await this.opts.alert.notify(`The dispatcher halted: ${verdict.reason}. No card runs until the token is replaced and the dispatcher restarted.`);
    }
    throw new SessionPaused('read_token', `no session was started: ${verdict.reason}`);
  }

  // --- sessions ----------------------------------------------------------------------------------

  private async waitNotRunning(sessionId: string): Promise<ManagedSession | null> {
    const deadline = Date.now() + this.timings.statusWaitMs;
    let last: ManagedSession | null = null;
    for (;;) {
      try {
        last = await this.client.sessions.retrieve(sessionId);
        if (last.status !== 'running' && last.status !== 'rescheduling') return last;
      } catch (error) {
        this.log.warn('managed', 'session read failed', { session: sessionId, error: errorMessage(error) });
      }
      if (Date.now() >= deadline) return last;
      await sleep(this.timings.statusPollMs);
    }
  }

  private async archive(sessionId: string): Promise<boolean> {
    for (let attempt = 1; attempt <= this.timings.archiveTries; attempt += 1) {
      try {
        await this.client.sessions.archive(sessionId);
        return true;
      } catch (error) {
        this.log.warn('managed', 'session archive failed', { session: sessionId, attempt, error: errorMessage(error) });
        if (attempt < this.timings.archiveTries) await sleep(this.timings.archiveDelayMs * attempt);
      }
    }
    return false;
  }

  private async outputs(sessionId: string, filename: string): Promise<OutputFile[]> {
    for (let attempt = 1; attempt <= this.timings.outputTries; attempt += 1) {
      const found: OutputFile[] = [];
      for await (const file of this.client.files.list({ scope_id: sessionId })) {
        if (file.filename === filename || file.filename.endsWith(`/${filename}`)) found.push(file);
      }
      if (found.length > 0) return found.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
      if (attempt < this.timings.outputTries) await sleep(this.timings.outputDelayMs);
    }
    return [];
  }

  private async deleteOutputs(sessionId: string): Promise<void> {
    try {
      for await (const file of this.client.files.list({ scope_id: sessionId })) {
        await this.client.files.delete(file.id).catch((error: unknown) => this.log.warn('managed', 'output file not deleted', { session: sessionId, file: file.id, error: errorMessage(error) }));
      }
    } catch (error) {
      this.log.warn('managed', 'output files not listed', { session: sessionId, error: errorMessage(error) });
    }
  }

  // The newest card.patch whose bytes hash to wantSha (any when wantSha is absent), no larger than the
  // limit, or why there is none.
  private async fetchPatch(sessionId: string, wantSha: string | null): Promise<{ bytes: Buffer; sha256: string } | { reason: string }> {
    const files = await this.outputs(sessionId, PATCH_FILE);
    if (files.length === 0) return { reason: `no ${OUTPUTS_DIR}/${PATCH_FILE} was found; run the export command, then call submit_patch` };
    let oversize = 0;
    const hashes: string[] = [];
    for (const file of files) {
      if (file.size_bytes > PATCH_MAX_BYTES) {
        oversize += 1;
        continue;
      }
      const response = await this.client.files.download(file.id);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > PATCH_MAX_BYTES) {
        oversize += 1;
        continue;
      }
      const sha256 = patchSha256(bytes);
      if (!wantSha || sha256 === wantSha) return { bytes, sha256 };
      hashes.push(sha256);
    }
    if (oversize > 0 && hashes.length === 0) return { reason: `${OUTPUTS_DIR}/${PATCH_FILE} is over the ${PATCH_MAX_BYTES}-byte limit` };
    return { reason: `no ${PATCH_FILE} in the session outputs has the sha256 ${wantSha}; the files there hash to ${hashes.join(', ') || 'nothing readable'}` };
  }

  private async systemPrompt(spec: SessionSpec, baseSha: string): Promise<string> {
    const show = (file: string) => git(['show', `${baseSha}:${file}`], spec.worktree);
    const optional = async (file: string): Promise<string | null> => {
      try {
        await git(['cat-file', '-e', `${baseSha}:${file}`], spec.worktree);
      } catch {
        return null;
      }
      return show(file);
    };
    const parts: string[] = [];
    if (spec.systemPromptFile) {
      const relative = path.relative(spec.worktree, spec.systemPromptFile);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`role prompt path escapes the worktree: ${spec.systemPromptFile}`);
      parts.push(await show(relative.split(path.sep).join('/')));
    }
    const root = await optional('CLAUDE.md');
    if (root) parts.push(`# Repository instructions: CLAUDE.md at ${baseSha}\n\n${root}`);
    const folder = await optional(`${spec.folder}/CLAUDE.md`);
    if (folder) parts.push(`# Folder instructions: ${spec.folder}/CLAUDE.md at ${baseSha}\n\n${folder}`);
    const system = parts.join('\n\n---\n\n');
    if (system.length > SYSTEM_PROMPT_LIMIT) throw new Error(`the system prompt is ${system.length} characters, over the ${SYSTEM_PROMPT_LIMIT} limit`);
    return system;
  }

  private async assertNoRepoSkills(worktree: string, baseSha: string): Promise<void> {
    const listed = await git(['ls-tree', '--name-only', baseSha, '--', '.claude/skills'], worktree);
    if (listed.length > 0) throw new Error('the base commit has a .claude/skills folder, which Managed Agents would load into the session');
  }

  private billing(purpose: SessionPurpose, metadata: Record<string, string>): ManagedBilling {
    if (purpose === 'card') return { billed_to: 'studio', card_id: metadata.card_id ?? null, role_id: metadata.role_id || null };
    return { billed_to: 'overhead', card_id: null, role_id: null };
  }

  private meter(sessionId: string, model: string, billing: ManagedBilling): ManagedMeter {
    return new ManagedMeter({
      table: this.opts.priceTable,
      model,
      sessionId,
      billing,
      record: (input) => this.opts.db.recordUsage(input),
      log: this.log,
      retryMs: this.timings.ledgerRetryMs,
    });
  }

  // Reads the session once it is no longer running, writes the runtime and settle rows, and archives
  // it when every row is on the ledger.
  private async settle(sessionId: string, meter: ManagedMeter, last: UsageSnapshot | null, label: string): Promise<SettleOutcome> {
    const final = await this.waitNotRunning(sessionId);
    if (!final || final.status === 'running' || final.status === 'rescheduling') {
      const reason = `session ${sessionId} was still ${final?.status ?? 'unreadable'}; it is left for recovery to settle`;
      this.log.warn('managed', reason, { label });
      return { settled: false, reason, patchStored: false, report: null };
    }
    const usage = final.usage ?? last ?? {};
    const report = await meter.finish({ listCost: usage.list_cost ?? last?.list_cost ?? null, activeSeconds: usage.active_seconds ?? last?.active_seconds ?? null });
    this.log.info('managed', 'session metered', {
      session: sessionId,
      label,
      requests: meter.requests,
      recorded_usd: report.recordedUsd,
      runtime_usd: report.runtimeUsd,
      settle_usd: report.settleUsd,
      list_cost_usd: report.listCostUsd,
      settled: report.settled,
    });
    if (report.problems.length > 0) await this.opts.alert.notify(`Managed session ${sessionId} (${label}) metering: ${report.problems.join('; ')}.`);
    if (!report.settled) return { settled: false, reason: report.problems.join('; '), patchStored: false, report };
    await this.deleteOutputs(sessionId);
    const archived = await this.archive(sessionId);
    return { settled: true, reason: archived ? null : 'settled but not archived', patchStored: false, report };
  }

  // --- a card ------------------------------------------------------------------------------------

  private createCardSession(spec: SessionSpec, baseSha: string, system: string, cents: number): Promise<ManagedSession> {
    return this.client.sessions.create({
      agent: {
        type: 'agent_with_overrides',
        id: this.opts.agentId,
        version: this.opts.agentVersion,
        model: { id: spec.model, speed: 'standard' },
        system,
      },
      environment_id: this.opts.environmentId,
      title: `card ${shortId(spec.cardId)}`,
      resources: [
        {
          type: 'github_repository',
          url: `https://github.com/${this.opts.githubRepo}`,
          authorization_token: this.opts.readToken,
          mount_path: REPO_MOUNT,
          checkout: { type: 'commit', sha: baseSha },
        },
      ],
      budget: { type: 'limit', max_list_cost: { amount: String(cents), currency: 'USD' } },
      metadata: { purpose: 'card', card_id: spec.cardId, role_id: spec.roleId ?? '', base_sha: baseSha, run: randomUUID() },
    });
  }

  async run(spec: SessionSpec, onEvent: EventSink, signal: AbortSignal): Promise<SessionResult> {
    const allowed = spec.allowedPaths ?? [];
    if (allowed.length === 0) throw new Error('a managed session needs the lane paths its patch must stay inside');
    const baseSha = await headSha(spec.worktree);
    let leftovers: Map<string, ClosedSessions>;
    try {
      leftovers = await this.closeOrphans((session) => session.metadata?.card_id === spec.cardId);
    } catch (error) {
      throw new SessionPaused('session_unsettled', `the Managed Agents sessions could not be listed, so no new session was started: ${errorMessage(error)}`);
    }
    const unsettled = [...leftovers.values()].flatMap((closed) => closed.unsettled);
    if (unsettled.length > 0) throw new SessionPaused('session_unsettled', `card ${shortId(spec.cardId)} has an earlier session that could not be settled: ${unsettled.join('; ')}`);
    // An earlier session of this card had submitted a patch no one answered; it is used, not paid for
    // again.
    if (leftovers.get(spec.cardId)?.patchStored && this.opts.patches) {
      const reused = await applyStoredPatch(this.opts.patches, spec.cardId, spec.worktree, allowed);
      if (reused.kind === 'applied') {
        await onEvent({ type: 'message', text: `the patch an earlier session submitted (sha256 ${reused.sha256}) was applied; no new session: ${reused.files.join(', ')}` });
        return { exitCode: 0, killed: false, killReason: null, turns: 0, endSubtype: 'success', totalCostUsd: 0, numTurns: 0, isError: false };
      }
      if (reused.kind === 'conflict') {
        throw new SessionPaused('patch_conflict', `the patch an earlier session submitted no longer applies (${reused.detail}); it was discarded, so resuming the card runs a new session`);
      }
    }
    await this.assertReadToken();
    try {
      await this.assertNoRepoSkills(spec.worktree, baseSha);
    } catch (error) {
      throw new SessionPaused('repo_skills', errorMessage(error));
    }
    let system: string;
    try {
      system = await this.systemPrompt(spec, baseSha);
    } catch (error) {
      throw new SessionPaused('system_prompt', `the session's system prompt could not be built: ${errorMessage(error)}`);
    }
    const cents = budgetCents(spec.maxBudgetUsd, this.marginUsd(spec.model));
    if (cents < 1) {
      this.log.warn('managed', `card ${spec.cardId} has less than a cent of budget after the margin; no session`, { max_budget_usd: spec.maxBudgetUsd });
      return { exitCode: 0, killed: false, killReason: null, turns: 0, endSubtype: 'error_max_budget_usd', totalCostUsd: 0, numTurns: 0, isError: false };
    }
    if (signal.aborted) {
      return { exitCode: null, killed: true, killReason: String(signal.reason ?? 'aborted'), turns: 0, endSubtype: null, totalCostUsd: null, numTurns: 0, isError: false };
    }

    let session: ManagedSession;
    try {
      session = await this.createCardSession(spec, baseSha, system, cents);
    } catch (error) {
      // As an event first, so a refusal for want of credit is seen for what it is.
      const message = `the Managed Agents session could not be created: ${errorMessage(error)}`;
      await onEvent({ type: 'error', message });
      throw new SessionPaused('managed_api', message);
    }
    const sessionId = session.id;
    const meter = this.meter(sessionId, spec.model, this.billing('card', { card_id: spec.cardId, role_id: spec.roleId ?? '' }));
    let drive: DriveResult;
    try {
      const problems = agentProblems(session.agent, this.opts.files.agent);
      if (session.agent.model.id !== spec.model) problems.push(`the session model is ${session.agent.model.id}, not ${spec.model}`);
      if (session.agent.version !== this.opts.agentVersion) problems.push(`the session runs agent version ${session.agent.version}, not ${this.opts.agentVersion}`);
      if (problems.length > 0) throw new Error(`managed session ${sessionId} refused before it ran: ${problems.join('; ')}`);
      // The id is on the card's start event before the session can spend anything.
      await onEvent({ type: 'start', sessionId, model: session.agent.model.id, tools: enabledToolNames(session.agent.tools), apiKeySource: API_KEY_SOURCE, ledger: 'adapter' });
      await onEvent({
        type: 'message',
        text: `managed session ${sessionId}: agent ${this.opts.agentId} version ${session.agent.version}, environment ${this.opts.environmentId}, model ${session.agent.model.id}, budget ${cents} cents, base ${baseSha}`,
      });
      const onSubmit = async (event: CustomToolUse): Promise<SubmitVerdict> => {
        const input = event.input as { summary?: unknown; sha256?: unknown; bytes?: unknown };
        const wantSha = typeof input.sha256 === 'string' && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null;
        const fetched = await this.fetchPatch(sessionId, wantSha);
        if ('reason' in fetched) return { accepted: false, reason: fetched.reason };
        if (typeof input.bytes === 'number' && input.bytes !== fetched.bytes.byteLength) {
          return { accepted: false, reason: `the patch is ${fetched.bytes.byteLength} bytes, not the ${input.bytes} you sent` };
        }
        const check = await validateAndApply(spec.worktree, fetched.bytes, allowed);
        if (!check.ok) return { accepted: false, reason: check.reason };
        const summary = typeof input.summary === 'string' ? input.summary.slice(0, 500) : '';
        await this.opts.patches?.save(storedPatch(spec.cardId, baseSha, fetched.bytes, summary || null, sessionId)).catch(async (error: unknown) => {
          this.log.warn('managed', 'accepted patch not stored', { card: spec.cardId, session: sessionId, error: errorMessage(error) });
        });
        await onEvent({ type: 'message', text: `patch accepted: sha256 ${fetched.sha256}, ${check.files.length} file(s): ${check.files.join(', ')}${summary ? `. ${summary}` : ''}` });
        return { accepted: true };
      };
      drive = await new SessionDriver(this, {
        sessionId,
        model: spec.model,
        meter,
        onEvent,
        signal,
        firstMessage: `${spec.prompt}\n${finishingSection(baseSha)}`,
        onSubmit,
        remind: true,
      }).drive();
    } catch (error) {
      const settled = await this.settle(sessionId, meter, null, `card ${shortId(spec.cardId)}`);
      if (!settled.settled) this.log.warn('managed', 'session left unarchived after an error', { session: sessionId });
      throw error;
    }

    const settled = await this.settle(sessionId, meter, drive.lastUsage, `card ${shortId(spec.cardId)}`);
    const listUsd = settled.report?.listCostUsd ?? listCostUsd(drive.lastUsage?.list_cost);
    if (listUsd !== null && listUsd > spec.maxBudgetUsd + 0.005) {
      await this.opts.alert.notify(
        `Card ${shortId(spec.cardId)}: session ${sessionId} spent ${listUsd} USD against a budget of ${spec.maxBudgetUsd} USD, ${round4(listUsd - spec.maxBudgetUsd)} USD over. The ledger records the true amount.`,
      );
    }
    const end = this.endEvent(drive, meter, spec.model, listUsd);
    await onEvent(end);
    // The dispatcher's own side failed, not the card: the card pauses with what was spent recorded.
    if (drive.stop === 'stream_lost') throw new SessionPaused('stream_lost', `session ${sessionId}: ${drive.errors.join('; ')}`);
    if (drive.stop === 'ledger_refused') throw new SessionPaused('ledger', `session ${sessionId} was interrupted: ${drive.errors.join('; ')}`);
    return this.result(drive);
  }

  private endEvent(drive: DriveResult, meter: ManagedMeter, model: string, listUsd: number | null): AgentEvent {
    const usage = meter.usage();
    return {
      type: 'end',
      subtype: drive.stop,
      isError: this.isError(drive.stop),
      totalCostUsd: listUsd,
      numTurns: drive.turns,
      result: drive.messages.at(-1) ?? '',
      usage,
      modelUsage: [
        {
          model,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_input_tokens: usage.cache_read_input_tokens,
          cache_creation_input_tokens: usage.cache_creation_input_tokens,
          cost_usd: null,
        },
      ],
      permissionDenials: [],
    };
  }

  private isError(stop: DriveStop): boolean {
    return !['accepted', 'end_turn', 'budget_reached', 'interrupted'].includes(stop);
  }

  private result(drive: DriveResult): SessionResult {
    const subtype = drive.stop === 'accepted' || drive.stop === 'end_turn' ? 'success' : drive.stop === 'budget_reached' ? 'error_max_budget_usd' : drive.stop;
    const isError = this.isError(drive.stop);
    return {
      exitCode: isError ? 1 : 0,
      killed: drive.killReason !== null,
      killReason: drive.killReason,
      turns: drive.turns,
      endSubtype: subtype,
      totalCostUsd: null,
      numTurns: drive.turns,
      isError,
    };
  }

  // --- recovery ----------------------------------------------------------------------------------

  // Interrupts a session that is still running, meters every model request in its history under its
  // event id (written once however often this runs), stores a card patch the agent submitted that no
  // one answered, and settles and archives it.
  private async settleOrphan(session: ManagedSession): Promise<SettleOutcome> {
    const metadata = session.metadata ?? {};
    const purpose = metadata.purpose as SessionPurpose;
    const label = purpose === 'card' ? `orphan card ${shortId(metadata.card_id ?? '')}` : `orphan ${purpose}`;
    if (session.status === 'running' || session.status === 'rescheduling') {
      await this.client.sessions.events.send(session.id, { events: [{ type: 'user.interrupt' }] }).catch((error: unknown) =>
        this.log.warn('managed', 'orphan interrupt not sent', { session: session.id, error: errorMessage(error) }),
      );
    }
    const meter = this.meter(session.id, session.agent.model.id, this.billing(purpose, metadata));
    let pending: CustomToolUse | null = null;
    const answered = new Set<string>();
    for await (const event of this.client.sessions.events.list(session.id)) {
      if (event.type === 'span.model_request_end') await meter.request(event.id, event.model_usage);
      else if (event.type === 'agent.custom_tool_use' && event.name === SUBMIT_PATCH) pending = event;
      else if (event.type === 'user.custom_tool_result') answered.add(event.custom_tool_use_id);
    }
    let patchStored = false;
    const baseSha = metadata.base_sha ?? '';
    if (purpose === 'card' && pending && !answered.has(pending.id) && this.opts.patches && /^[0-9a-f]{40}$/.test(baseSha)) {
      const input = pending.input as { sha256?: unknown; summary?: unknown };
      const fetched = await this.fetchPatch(session.id, typeof input.sha256 === 'string' ? input.sha256 : null);
      // Checked in full against the lane when the card's next claim re-applies it (patch.ts
      // applyStoredPatch); only a patch card_patches can hold as exact text is kept.
      const problem = 'bytes' in fetched ? patchTextProblem(fetched.bytes) : fetched.reason;
      if ('bytes' in fetched && problem === null) {
        const summary = typeof input.summary === 'string' ? input.summary.slice(0, 500) : null;
        await this.opts.patches.save(storedPatch(metadata.card_id ?? '', baseSha, fetched.bytes, summary, session.id));
        patchStored = true;
        this.log.info('managed', 'orphan patch stored', { session: session.id, card: metadata.card_id, sha256: fetched.sha256 });
      } else {
        this.log.warn('managed', 'orphan patch not stored', { session: session.id, card: metadata.card_id, reason: problem });
      }
    }
    const outcome = await this.settle(session.id, meter, null, label);
    return { ...outcome, patchStored };
  }

  async closeOrphans(filter: (session: ManagedSession) => boolean = () => true): Promise<Map<string, ClosedSessions>> {
    const closed = new Map<string, ClosedSessions>();
    const sessions: ManagedSession[] = [];
    for await (const session of this.client.sessions.list({ agent_id: this.opts.agentId, include_archived: false })) sessions.push(session);
    for (const session of sessions) {
      const metadata = session.metadata ?? {};
      if (!PURPOSES.includes(metadata.purpose ?? '')) {
        this.log.warn('managed', 'unarchived session without dispatcher metadata left alone', { session: session.id });
        continue;
      }
      if (!filter(session)) continue;
      const key = metadata.purpose === 'card' ? (metadata.card_id ?? '') : `${metadata.purpose}`;
      const entry = closed.get(key) ?? { sessionIds: [], patchStored: false, unsettled: [] };
      entry.sessionIds.push(session.id);
      try {
        const outcome = await this.settleOrphan(session);
        if (outcome.patchStored) entry.patchStored = true;
        if (!outcome.settled) entry.unsettled.push(`${session.id}: ${outcome.reason ?? 'not settled'}`);
      } catch (error) {
        entry.unsettled.push(`${session.id}: ${errorMessage(error)}`);
      }
      closed.set(key, entry);
      this.log.warn('managed', 'orphan session closed', { session: session.id, purpose: metadata.purpose, card: metadata.card_id, unsettled: entry.unsettled.length });
    }
    return closed;
  }

  // --- the probe and the toolchain check ---------------------------------------------------------

  // Creates a session that is not a card's, runs it to a stop on one message, settles it as overhead
  // and archives it. Config drift is fatal; an API error is fatal only when no retry can change it.
  private async overheadSession(purpose: 'probe' | 'toolchain', message: string, cents: number, resources: Parameters<ManagedClient['sessions']['create']>[0]['resources']) {
    const model = this.opts.probeModel;
    let session: ManagedSession;
    try {
      session = await this.client.sessions.create({
        agent: { type: 'agent_with_overrides', id: this.opts.agentId, version: this.opts.agentVersion, model: { id: model, speed: 'standard' } },
        environment_id: this.opts.environmentId,
        title: purpose === 'probe' ? 'startup probe' : 'toolchain check',
        ...(resources ? { resources } : {}),
        budget: { type: 'limit', max_list_cost: { amount: String(cents), currency: 'USD' } },
        metadata: { purpose, run: randomUUID() },
      });
    } catch (error) {
      throw new StartupError(`the ${purpose} session could not be created: ${errorMessage(error)}`, fatalApiError(error));
    }
    const meter = this.meter(session.id, model, this.billing(purpose, {}));
    const problems = agentProblems(session.agent, this.opts.files.agent);
    if (problems.length > 0) {
      await this.settle(session.id, meter, null, purpose);
      throw new StartupError(`the ${purpose} session's agent differs from platform/agents/managed/agent.yaml: ${problems.join('; ')}`, true);
    }
    const events: AgentEvent[] = [];
    const drive = await new SessionDriver(this, {
      sessionId: session.id,
      model,
      meter,
      onEvent: (event) => void events.push(event),
      signal: AbortSignal.timeout(this.timings.probeTimeoutMs),
      firstMessage: message,
      onSubmit: null,
      remind: false,
    }).drive();
    return { session, meter, drive };
  }

  async probe(): Promise<void> {
    await this.closeOrphans((session) => session.metadata?.purpose !== 'card');
    const { session, meter, drive } = await this.overheadSession('probe', PROBE_PROMPT, PROBE_BUDGET_CENTS, undefined);
    const settled = await this.settle(session.id, meter, drive.lastUsage, 'startup probe');
    if (settled.report && settled.report.unwritten.length > 0) {
      throw new StartupError(`the ledger refused probe rows: ${settled.report.unwritten.map((row) => `${row.request_id} ${row.usd} USD`).join(', ')}`, true);
    }
    if (meter.pricedAtFallback) throw new StartupError(`no price for model ${this.opts.probeModel}`, true);
    if (drive.stop === 'violation') throw new StartupError(`startup probe failed: ${drive.errors.join('; ')}`, true);
    if (drive.stop !== 'end_turn' || meter.requests === 0 || drive.messages.length === 0) {
      throw new StartupError(`startup probe failed: the session stopped with ${drive.stop} after ${meter.requests} model request(s)${drive.errors.length > 0 ? `: ${drive.errors.join('; ')}` : ''}`, false);
    }
    this.log.info('probe', 'startup probe passed', {
      apiKeySource: API_KEY_SOURCE,
      session: session.id,
      agent: this.opts.agentId,
      version: this.opts.agentVersion,
      environment: this.opts.environmentId,
      model: this.opts.probeModel,
      requests: meter.requests,
      list_cost_usd: settled.report?.listCostUsd ?? null,
      billed_to: 'overhead',
    });
  }

  // The one-time cutover check that the container's toolchain runs the seed's gate commands: the
  // repository mounted at a main commit, the fixed command run once, its output file read back.
  async toolchain(mainSha: string): Promise<{ ok: boolean; lines: Record<string, string>; reason: string | null }> {
    const message = `Run exactly this command with the bash tool, once, and then reply with the single word done:\n${toolchainCommand()}`;
    const resources = [
      {
        type: 'github_repository' as const,
        url: `https://github.com/${this.opts.githubRepo}`,
        authorization_token: this.opts.readToken,
        mount_path: REPO_MOUNT,
        checkout: { type: 'commit' as const, sha: mainSha },
      },
    ];
    const { session, meter, drive } = await this.overheadSession('toolchain', message, TOOLCHAIN_BUDGET_CENTS, resources);
    let lines: Record<string, string> = {};
    let reason: string | null = null;
    const files = await this.outputs(session.id, TOOLCHAIN_FILE);
    const first = files[0];
    if (!first) {
      reason = `no ${TOOLCHAIN_FILE} in the session outputs (the session stopped with ${drive.stop})`;
    } else {
      const text = await (await this.client.files.download(first.id)).text();
      lines = Object.fromEntries(
        text
          .split('\n')
          .map((line) => /^([a-z_]+)=(.*)$/.exec(line))
          .filter((match): match is RegExpExecArray => match !== null)
          .map((match) => [match[1] ?? '', match[2] ?? '']),
      );
      reason = toolchainProblem(lines);
    }
    await this.settle(session.id, meter, drive.lastUsage, 'toolchain check');
    return { ok: reason === null, lines, reason };
  }
}

// Why the toolchain lines fail the check, or null: node 22 or later, the repository's pnpm, and the
// install and the seed bot exiting 0.
export function toolchainProblem(lines: Record<string, string>): string | null {
  const major = /^v(\d+)\./.exec(lines.node ?? '')?.[1];
  if (!major || Number(major) < 22) return `node is ${lines.node ?? 'missing'}; the gate needs 22 or later`;
  if (lines.pnpm !== '11.0.9') return `pnpm is ${lines.pnpm ?? 'missing'}, not 11.0.9`;
  if (lines.install_exit !== '0') return `pnpm install --frozen-lockfile exited ${lines.install_exit ?? 'unknown'}`;
  if (lines.bot_exit !== '0') return `the seed bot exited ${lines.bot_exit ?? 'unknown'}`;
  return null;
}
