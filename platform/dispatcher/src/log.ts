// One JSON object per line for the dispatcher process: {"ts","level","scope","msg",...fields}.
// The four envelope keys are written first and cannot be overwritten by a field of the same
// name; such a field is nested under "fields" instead.
import type { Writable } from 'node:stream';

export type LogFields = Record<string, unknown>;
export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(scope: string, message: string, fields?: LogFields): void;
  warn(scope: string, message: string, fields?: LogFields): void;
  error(scope: string, message: string, fields?: LogFields): void;
}

const ENVELOPE_KEYS: ReadonlySet<string> = new Set(['ts', 'level', 'scope', 'msg']);

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Errors and bigints have no JSON form of their own; everything else serialises as JSON does.
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function logLine(ts: string, level: LogLevel, scope: string, msg: string, fields?: LogFields): string {
  const record: Record<string, unknown> = { ts, level, scope, msg };
  const nested: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (ENVELOPE_KEYS.has(key)) nested[key] = value;
    else record[key] = value;
  }
  if (Object.keys(nested).length > 0) {
    const own = record.fields;
    record.fields = typeof own === 'object' && own !== null && !Array.isArray(own) ? { ...own, ...nested } : nested;
  }
  try {
    return JSON.stringify(record, replacer);
  } catch (error) {
    // A circular structure among the fields: keep the envelope and say why the fields are gone.
    return JSON.stringify({ ts, level, scope, msg, fields_error: errorMessage(error) });
  }
}

export function createLogger(stream: Writable = process.stdout, now: () => Date = () => new Date()): Logger {
  const write = (level: LogLevel, scope: string, message: string, fields?: LogFields) => {
    stream.write(`${logLine(now().toISOString(), level, scope, message, fields)}\n`);
  };
  return {
    info: (scope, message, fields) => write('info', scope, message, fields),
    warn: (scope, message, fields) => write('warn', scope, message, fields),
    error: (scope, message, fields) => write('error', scope, message, fields),
  };
}
