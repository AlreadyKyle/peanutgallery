// One-line structured log output for the dispatcher process.
import type { Writable } from 'node:stream';

export type LogFields = Record<string, unknown>;

export interface Logger {
  info(scope: string, message: string, fields?: LogFields): void;
  warn(scope: string, message: string, fields?: LogFields): void;
  error(scope: string, message: string, fields?: LogFields): void;
}

function formatFields(fields: LogFields | undefined): string {
  if (!fields) return '';
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value) ?? 'null'}`)
    .join(' ');
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createLogger(stream: Writable = process.stdout, now: () => Date = () => new Date()): Logger {
  const write = (level: string, scope: string, message: string, fields?: LogFields) => {
    const tail = formatFields(fields);
    stream.write(`${now().toISOString()} ${level} ${scope}: ${message}${tail ? ` ${tail}` : ''}\n`);
  };
  return {
    info: (scope, message, fields) => write('INFO', scope, message, fields),
    warn: (scope, message, fields) => write('WARN', scope, message, fields),
    error: (scope, message, fields) => write('ERROR', scope, message, fields),
  };
}
