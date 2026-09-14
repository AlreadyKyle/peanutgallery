// Unattended mode (Claude Agent SDK on the separate API organization) is launch-onward work.
// Selecting it in this build fails before any session starts.
import type { AgentAdapter, EventSink, SessionResult, SessionSpec } from './types.js';

export const UNATTENDED_MESSAGE = 'unattended mode is not enabled this session';

export class UnattendedAdapter implements AgentAdapter {
  readonly mode = 'unattended' as const;

  async preflight(_spec: SessionSpec): Promise<void> {
    throw new Error(UNATTENDED_MESSAGE);
  }

  async run(_spec: SessionSpec, _onEvent: EventSink, _signal: AbortSignal): Promise<SessionResult> {
    throw new Error(UNATTENDED_MESSAGE);
  }
}
