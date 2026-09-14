import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, errorMessage, logLine } from '../src/log.js';

const TS = '2026-09-14T15:00:00.000Z';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { log: createLogger(stream, () => new Date(TS)), lines };
}

describe('createLogger', () => {
  it('writes one JSON object per line at each level', () => {
    const { log, lines } = capture();
    log.info('tick', 'started');
    log.warn('session', 'aborting card 4c2f5a1e');
    log.error('pipeline', 'card 4c2f5a1e failed');
    expect(lines.every((line) => line.endsWith('\n') && line.indexOf('\n') === line.length - 1)).toBe(true);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { ts: TS, level: 'info', scope: 'tick', msg: 'started' },
      { ts: TS, level: 'warn', scope: 'session', msg: 'aborting card 4c2f5a1e' },
      { ts: TS, level: 'error', scope: 'pipeline', msg: 'card 4c2f5a1e failed' },
    ]);
  });

  it('spreads fields after the envelope', () => {
    const { log, lines } = capture();
    log.info('session', 'turn 2 metered', { card: '4c2f5a1e', usd: 0.0045, tools: ['Read', 'Edit'], branch: null });
    const parsed = JSON.parse(lines[0] ?? '');
    expect(parsed).toEqual({ ts: TS, level: 'info', scope: 'session', msg: 'turn 2 metered', card: '4c2f5a1e', usd: 0.0045, tools: ['Read', 'Edit'], branch: null });
    expect(Object.keys(parsed).slice(0, 4)).toEqual(['ts', 'level', 'scope', 'msg']);
  });

  it('never lets a field overwrite ts, level, scope or msg', () => {
    const { log, lines } = capture();
    log.warn('tick', 'mode mismatch', { level: 'debug', msg: 'not this one', scope: 'other', ts: 'never', studio: 'unattended' });
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      ts: TS,
      level: 'warn',
      scope: 'tick',
      msg: 'mode mismatch',
      studio: 'unattended',
      fields: { level: 'debug', msg: 'not this one', scope: 'other', ts: 'never' },
    });
  });

  it('keeps a caller-supplied fields object and adds the clashing keys to it', () => {
    expect(JSON.parse(logLine(TS, 'info', 'main', 'started', { fields: { repo: 'owner/repo' }, level: 'x' }))).toEqual({
      ts: TS,
      level: 'info',
      scope: 'main',
      msg: 'started',
      fields: { repo: 'owner/repo', level: 'x' },
    });
  });

  it('serialises errors and bigints, and survives a circular structure', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const error = new Error('db studio_state: no row');
    expect(JSON.parse(logLine(TS, 'error', 'tick', 'tick failed', { error, count: 5n }))).toEqual({
      ts: TS,
      level: 'error',
      scope: 'tick',
      msg: 'tick failed',
      error: { name: 'Error', message: 'db studio_state: no row' },
      count: '5',
    });
    const parsed = JSON.parse(logLine(TS, 'error', 'tick', 'tick failed', { circular }));
    expect(parsed).toMatchObject({ ts: TS, level: 'error', scope: 'tick', msg: 'tick failed' });
    expect(typeof parsed.fields_error).toBe('string');
  });

  it('parses every line it writes', () => {
    const { log, lines } = capture();
    log.info('main', 'dispatcher started', { mode: 'attended', tickMs: 60_000 });
    log.info('tick', 'sleep', { action: 'sleep', reason: 'no_funded_cards', running: 0 });
    log.warn('main', 'SIGTERM received; stopping');
    log.error('pipeline', 'card failed', { detail: 'quote " and newline \n and backslash \\' });
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
      expect(JSON.parse(line)).toMatchObject({ ts: TS });
    }
  });
});

describe('errorMessage', () => {
  it('reads the message of an Error and stringifies anything else', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
  });
});
