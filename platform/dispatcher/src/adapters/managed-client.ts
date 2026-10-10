// The slice of the Anthropic SDK the managed adapter uses (client.beta.agents, environments, sessions
// and files), typed with the SDK's own types so the adapter's requests are checked against the real
// API shapes. Tests pass a fake with the same surface; production passes sdkManagedClient().
import Anthropic, { toFile } from '@anthropic-ai/sdk';
import type { BetaManagedAgentsAgent, AgentRetrieveParams } from '@anthropic-ai/sdk/resources/beta/agents/agents';
import type { BetaEnvironment } from '@anthropic-ai/sdk/resources/beta/environments/environments';
import type { BetaFileMetadata, FileListParams } from '@anthropic-ai/sdk/resources/beta/files';
import type {
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
  EventListParams,
  EventSendParams,
} from '@anthropic-ai/sdk/resources/beta/sessions/events';
import type { BetaManagedAgentsSession, SessionCreateParams, SessionListParams } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';

export type ManagedAgent = BetaManagedAgentsAgent;
export type ManagedEnvironment = BetaEnvironment;
export type ManagedSession = BetaManagedAgentsSession;
export type SessionEvent = BetaManagedAgentsSessionEvent;
export type StreamEvent = BetaManagedAgentsStreamSessionEvents;
export type OutputFile = BetaFileMetadata;
export type { SessionCreateParams };

// A live event stream. Iterating ends when the server closes it; abort() closes it from our side.
export interface EventStream extends AsyncIterable<StreamEvent> {
  controller: AbortController;
}

// The beta header the session-scoped file listing needs next to the Files header the SDK adds
// (managed-agents-environments.md, Session outputs).
export const MANAGED_AGENTS_BETA = 'managed-agents-2026-04-01';

// A file to upload through the Files API, to mount in a session (a role session's frames).
export interface UploadFile {
  filename: string;
  bytes: Buffer;
  mimeType: string;
}

// Uploads expire on their own after this long, so one a stopped process could not delete does not
// stay: the session that mounts it copies it in when it starts.
export const UPLOAD_EXPIRES_SECONDS = 24 * 60 * 60;

export interface ManagedClient {
  agents: {
    retrieve(agentId: string, params?: AgentRetrieveParams): Promise<ManagedAgent>;
  };
  environments: {
    retrieve(environmentId: string): Promise<ManagedEnvironment>;
  };
  sessions: {
    create(params: SessionCreateParams): Promise<ManagedSession>;
    retrieve(sessionId: string): Promise<ManagedSession>;
    archive(sessionId: string): Promise<ManagedSession>;
    list(params?: SessionListParams): AsyncIterable<ManagedSession>;
    events: {
      list(sessionId: string, params?: EventListParams): AsyncIterable<SessionEvent>;
      send(sessionId: string, params: EventSendParams): Promise<unknown>;
      stream(sessionId: string): Promise<EventStream>;
    };
  };
  files: {
    list(params: FileListParams): AsyncIterable<OutputFile>;
    download(fileId: string): Promise<Response>;
    delete(fileId: string): Promise<unknown>;
    upload(file: UploadFile): Promise<OutputFile>;
  };
}

// The real client on the studio organisation's key. The SDK retries connection errors, 408, 409,
// 429 and 5xx answers on its own, twice by default, with a backoff.
export function sdkManagedClient(apiKey: string): ManagedClient {
  const client = new Anthropic({ apiKey });
  const beta = client.beta;
  return {
    agents: { retrieve: (agentId, params) => beta.agents.retrieve(agentId, params) },
    environments: { retrieve: (environmentId) => beta.environments.retrieve(environmentId) },
    sessions: {
      create: (params) => beta.sessions.create(params),
      retrieve: (sessionId) => beta.sessions.retrieve(sessionId),
      archive: (sessionId) => beta.sessions.archive(sessionId),
      list: (params) => beta.sessions.list(params),
      events: {
        list: (sessionId, params) => beta.sessions.events.list(sessionId, params),
        send: (sessionId, params) => beta.sessions.events.send(sessionId, params),
        stream: (sessionId) => beta.sessions.events.stream(sessionId),
      },
    },
    files: {
      list: (params) => beta.files.list({ ...params, betas: [...(params.betas ?? []), MANAGED_AGENTS_BETA] }),
      download: (fileId) => beta.files.download(fileId),
      delete: (fileId) => beta.files.delete(fileId),
      upload: async (file) =>
        beta.files.upload({ file: await toFile(file.bytes, file.filename, { type: file.mimeType }), expires_in_seconds: UPLOAD_EXPIRES_SECONDS }),
    },
  };
}
