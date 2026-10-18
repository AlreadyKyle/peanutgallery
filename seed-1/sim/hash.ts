import type { SimState } from './types';

// A stable fingerprint of a state: canonical JSON (sorted keys) run through
// two FNV-1a passes with different offsets, giving sixteen hex characters.

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(text: string, offset: number): string {
  let hash = offset >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The same two FNV-1a passes over any text: sixteen hex characters. */
export function hashText(text: string): string {
  return fnv1a(text, 0x811c9dc5) + fnv1a(text, 0x050c5d1f);
}

export function hashState(state: SimState): string {
  return hashText(canonical(state));
}
