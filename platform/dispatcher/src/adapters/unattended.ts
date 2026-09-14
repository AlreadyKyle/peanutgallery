// Unattended adapter: the shared Claude Code command line on the studio organisation's
// pay-as-you-go key. The key lives under its own name in the dispatcher environment and is
// mapped to ANTHROPIC_API_KEY inside the child and nowhere else; everything else in the child
// environment is the attended allowlist.
import { ClaudeCliAdapter, childEnv, type ClaudeCliOptions } from './claude-cli.js';

export const STUDIO_KEY_ENV = 'STUDIO_ANTHROPIC_API_KEY';

export interface UnattendedOptions extends ClaudeCliOptions {
  studioApiKey: string;
}

export function unattendedEnv(env: NodeJS.ProcessEnv, studioApiKey: string): NodeJS.ProcessEnv {
  return { ...childEnv(env), ANTHROPIC_API_KEY: studioApiKey };
}

export class UnattendedAdapter extends ClaudeCliAdapter {
  readonly mode = 'unattended' as const;
  private readonly studioApiKey: string;

  constructor(options: UnattendedOptions) {
    super(options);
    const key = options.studioApiKey.trim();
    if (key.length === 0) throw new Error(`${STUDIO_KEY_ENV} is required in unattended mode`);
    this.studioApiKey = key;
  }

  protected sessionEnv(): NodeJS.ProcessEnv {
    return unattendedEnv(process.env, this.studioApiKey);
  }
}
