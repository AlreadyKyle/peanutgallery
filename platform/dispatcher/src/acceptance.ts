// Pure acceptance grammar. A card's acceptance_test is prose for the agent and may end with
// machine lines of the form:
//   check: config <file> <path> == <json>
// The path grammar is dotted keys, [n] array indexes and [key=value] array selectors,
// for example rows[id=gatherer].baseCost.

export type PathSegment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'match'; key: string; value: unknown };

export interface ConfigCheck {
  kind: 'config';
  file: string;
  pathText: string;
  path: PathSegment[];
  expected: unknown;
  line: string;
}

export class AcceptanceGrammarError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AcceptanceGrammarError';
  }
}

const CHECK_LINE = /^check:\s+(\S+)\s+(.*)$/;
const CONFIG_ARGS = /^(\S+)\s+(\S+)\s+==\s+(.+)$/;
const IDENT = /^[A-Za-z0-9_$-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return keysA.length === keysB.length && keysA.every((key) => key in b && deepEqual(a[key], b[key]));
  }
  return false;
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function parsePath(text: string): PathSegment[] {
  if (text.length === 0) throw new AcceptanceGrammarError('path is empty');
  const segments: PathSegment[] = [];
  let i = 0;
  let previous: 'start' | 'dot' | 'key' | 'bracket' = 'start';
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '.') {
      if (previous === 'start' || previous === 'dot') {
        throw new AcceptanceGrammarError(`unexpected "." at position ${i} in ${text}`);
      }
      previous = 'dot';
      i += 1;
      continue;
    }
    if (ch === '[') {
      if (previous === 'dot') {
        throw new AcceptanceGrammarError(`unexpected "[" after "." in ${text}`);
      }
      const close = text.indexOf(']', i);
      if (close < 0) throw new AcceptanceGrammarError(`unclosed "[" in ${text}`);
      const inner = text.slice(i + 1, close);
      if (inner.length === 0) throw new AcceptanceGrammarError(`empty selector in ${text}`);
      if (/^\d+$/.test(inner)) {
        segments.push({ kind: 'index', index: Number(inner) });
      } else {
        const eq = inner.indexOf('=');
        if (eq <= 0 || eq === inner.length - 1) {
          throw new AcceptanceGrammarError(`selector must be [n] or [key=value] in ${text}`);
        }
        const key = inner.slice(0, eq);
        if (!IDENT.test(key)) throw new AcceptanceGrammarError(`bad selector key "${key}" in ${text}`);
        segments.push({ kind: 'match', key, value: parseValue(inner.slice(eq + 1)) });
      }
      previous = 'bracket';
      i = close + 1;
      continue;
    }
    if (previous === 'key' || previous === 'bracket') {
      throw new AcceptanceGrammarError(`expected "." or "[" at position ${i} in ${text}`);
    }
    let j = i;
    while (j < text.length && IDENT.test(text.charAt(j))) j += 1;
    if (j === i) throw new AcceptanceGrammarError(`unexpected "${ch}" at position ${i} in ${text}`);
    segments.push({ kind: 'key', key: text.slice(i, j) });
    previous = 'key';
    i = j;
  }
  if (previous === 'dot') throw new AcceptanceGrammarError(`path ends with "." in ${text}`);
  return segments;
}

function validFile(file: string): boolean {
  if (file.startsWith('/') || file.includes('\\')) return false;
  return file.split('/').every((part) => part.length > 0 && part !== '.' && part !== '..');
}

export function parseCheckLine(line: string): ConfigCheck {
  const head = CHECK_LINE.exec(line.trim());
  if (!head) throw new AcceptanceGrammarError(`not a check line: ${line}`);
  const kind = head[1];
  const rest = head[2] ?? '';
  if (kind !== 'config') throw new AcceptanceGrammarError(`unknown check kind "${kind}"`);
  const args = CONFIG_ARGS.exec(rest);
  if (!args) throw new AcceptanceGrammarError(`config check must read "check: config <file> <path> == <json>": ${line}`);
  const file = args[1] ?? '';
  const pathText = args[2] ?? '';
  const expectedText = (args[3] ?? '').trim();
  if (!validFile(file)) throw new AcceptanceGrammarError(`bad file path "${file}"`);
  let expected: unknown;
  try {
    expected = JSON.parse(expectedText);
  } catch {
    throw new AcceptanceGrammarError(`expected value is not JSON: ${expectedText}`);
  }
  return { kind: 'config', file, pathText, path: parsePath(pathText), expected, line: line.trim() };
}

// Every line beginning with "check:" is parsed; a malformed one throws so the card is rejected
// with a grammar failure instead of shipping unchecked.
export function parseChecks(acceptanceTest: string | null | undefined): ConfigCheck[] {
  if (!acceptanceTest) return [];
  return acceptanceTest
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('check:'))
    .map(parseCheckLine);
}

export function resolvePath(doc: unknown, path: readonly PathSegment[]): { found: true; value: unknown } | { found: false } {
  let current: unknown = doc;
  for (const segment of path) {
    if (segment.kind === 'key') {
      if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment.key)) return { found: false };
      current = current[segment.key];
    } else if (segment.kind === 'index') {
      if (!Array.isArray(current) || segment.index >= current.length) return { found: false };
      current = current[segment.index];
    } else {
      if (!Array.isArray(current)) return { found: false };
      const hit = current.find((item) => isRecord(item) && deepEqual(item[segment.key], segment.value));
      if (hit === undefined) return { found: false };
      current = hit;
    }
  }
  return { found: true, value: current };
}

export function evaluateCheck(check: ConfigCheck, doc: unknown): boolean {
  const resolved = resolvePath(doc, check.path);
  return resolved.found && deepEqual(resolved.value, check.expected);
}
