// Picks the adapter for the configured mode. The unattended adapter refuses to exist without
// the studio key, so a misconfigured process fails here, before any session or probe.
import type { DispatcherConfig } from '../config.js';
import { AttendedAdapter } from './attended.js';
import type { AgentAdapter } from './types.js';
import { UnattendedAdapter } from './unattended.js';

export function createAdapter(config: DispatcherConfig): AgentAdapter {
  if (config.agentMode === 'unattended') {
    return new UnattendedAdapter({ claudeBin: config.claudeBin, studioApiKey: config.studioAnthropicApiKey ?? '' });
  }
  return new AttendedAdapter({ claudeBin: config.claudeBin });
}
