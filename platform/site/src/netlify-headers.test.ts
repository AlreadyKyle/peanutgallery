import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Security headers: netlify.toml sends them on every path. Only frame-ancestors is enforced; the
// full policy is report-only until production shows it breaks nothing. Paths resolve from the
// package root vitest runs in (see styles.test.ts).
const toml = readFileSync(resolve(process.cwd(), 'netlify.toml'), 'utf8');

/** The [headers.values] of the [[headers]] block for this path, as a map. */
function headersFor(path: string): Record<string, string> {
  const blocks = toml.split(/^\[\[headers\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const body = block.split(/^\[\[/m)[0]!;
    if (body.match(/^\s*for\s*=\s*"([^"]*)"/m)?.[1] !== path) continue;
    const values: Record<string, string> = {};
    for (const match of body.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"([^"]*)"\s*$/gm)) {
      if (match[1] !== 'for') values[match[1]!] = match[2]!;
    }
    return values;
  }
  return {};
}

function directives(policy: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '') map[name] = sources;
  }
  return map;
}

const headers = headersFor('/*');
const supabaseUrl = toml.match(/^\s*VITE_SUPABASE_URL\s*=\s*"([^"]+)"/m)?.[1] ?? '';

describe('netlify.toml security headers', () => {
  it('sends the fixed headers on every path', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  });

  it('enforces only frame-ancestors', () => {
    expect(headers['Content-Security-Policy']).toBe("frame-ancestors 'none'");
  });

  it('reports the full policy without enforcing it', () => {
    const policy = directives(headers['Content-Security-Policy-Report-Only'] ?? '');
    expect(policy['default-src']).toEqual(["'self'"]);
    expect(policy['script-src']).toEqual(["'self'"]);
    expect(policy['style-src']).toEqual(["'self'"]);
    expect(policy['img-src']).toEqual(["'self'", 'data:']);
    expect(policy['font-src']).toEqual(["'self'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
  });

  it('matches the values live-check.mjs expects from production', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/live-check.mjs'), 'utf8');
    const pieces = script.match(/const REPORT_ONLY_POLICY =\s*((?:"[^"]*"\s*\+?\s*)+);/)?.[1] ?? '';
    const expected = [...pieces.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
    expect(expected).toBe(headers['Content-Security-Policy-Report-Only']);
    for (const name of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'Content-Security-Policy']) {
      expect(script).toContain(`'${name.toLowerCase()}'`);
      expect(script).toContain(headers[name]);
    }
  });

  it('lets the site reach its Supabase project over https and wss', () => {
    expect(supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    const host = new URL(supabaseUrl).host;
    const policy = directives(headers['Content-Security-Policy-Report-Only'] ?? '');
    expect(policy['connect-src']).toEqual(["'self'", `https://${host}`, `wss://${host}`]);
  });
});
