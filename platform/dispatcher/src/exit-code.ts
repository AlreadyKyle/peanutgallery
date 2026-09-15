// Exit codes for the dispatcher process. On the VPS systemd restarts the unit after any exit except
// 78 (RestartPreventExitStatus=78; EX_CONFIG in sysexits.h). A startup failure that cannot change
// on retry exits 78, so the unit stops and alerts instead of re-running, and re-metering, the
// probe on every restart. Anything else exits 1 and systemd backs off and tries again.

export const EXIT_FATAL = 78;
export const EXIT_RETRY = 1;

// A startup failure that says whether a retry can help. A ConfigError is always fatal; a mode
// mismatch is not, because the board can fix it from /board and a restart costs nothing.
export class StartupError extends Error {
  readonly fatal: boolean;
  constructor(message: string, fatal: boolean) {
    super(message);
    this.name = 'StartupError';
    this.fatal = fatal;
  }
}

export function isFatal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { fatal?: unknown }).fatal === true;
}

// The exit code for an error that ended the process: 78 when it is marked fatal, else 1.
export function exitCodeFor(error: unknown): number {
  return isFatal(error) ? EXIT_FATAL : EXIT_RETRY;
}
