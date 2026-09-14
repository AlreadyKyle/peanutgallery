// Attended adapter: the shared Claude Code command line on the founder's subscription. The
// child environment is the allowlist alone, so the session signs in the way the founder's
// machine does and no API key reaches it.
import { ClaudeCliAdapter, childEnv, type ClaudeCliOptions } from './claude-cli.js';

export type AttendedOptions = ClaudeCliOptions;

export class AttendedAdapter extends ClaudeCliAdapter {
  readonly mode = 'attended' as const;

  constructor(options: AttendedOptions) {
    super(options);
  }

  protected sessionEnv(): NodeJS.ProcessEnv {
    return childEnv(process.env);
  }
}

export {
  CHILD_ENV_NAMES,
  CHILD_ENV_PREFIXES,
  CHILD_ENV_SWITCHES,
  DISALLOWED_TOOLS,
  EXCLUDED_TOOLS,
  MCP_PREFIX,
  allowedToolRules,
  baseToolNames,
  childEnv,
  claudeArgs,
  refusedTools,
} from './claude-cli.js';
export type { SpawnFn } from './claude-cli.js';
