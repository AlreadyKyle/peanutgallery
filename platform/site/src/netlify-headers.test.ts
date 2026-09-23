import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { netlifyHeaders } from '../vite.config';
import { KERNEL_SEGMENTS } from './App';

// Security headers: netlify.toml sends them on every path. frame-ancestors and connect-src are
// enforced (docs/specs/launch-site.md); the full policy is report-only until production shows it
// breaks nothing. vite preview sends the same headers, so the e2e run loads every page under them.
// Paths resolve from the package root vitest runs in (see styles.test.ts).
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

  it('enforces frame-ancestors, connect-src to the site and its Supabase project only, and form-action to the site', () => {
    const host = new URL(supabaseUrl).host;
    expect(headers['Content-Security-Policy']).toBe(`frame-ancestors 'none'; connect-src 'self' https://${host} wss://${host}; form-action 'self'`);
    const enforced = directives(headers['Content-Security-Policy'] ?? '');
    expect(Object.keys(enforced)).toEqual(['frame-ancestors', 'connect-src', 'form-action']);
  });

  it('answers /board with the not found page and a 404 status, and serves the app at the kernel pages even over a file, before the SPA rewrite', () => {
    const rules = [
      ...toml.matchAll(/^\[\[redirects\]\]\s*\n\s*from = "([^"]+)"\s*\n\s*to = "([^"]+)"\s*\n\s*status = (\d+)(\s*\n\s*force = true)?/gm),
    ].map((m) => [m[1], m[2], m[3], m[4] === undefined ? 'no force' : 'force']);
    const spa = rules.findIndex(([from]) => from === '/*');
    expect(rules.slice(1, spa)).toEqual([
      ['/board', '/index.html', '404', 'force'],
      ['/board/*', '/index.html', '404', 'force'],
      ...['/contribute', '/ledger', '/terms', '/terms/*', '/privacy', '/refunds', '/refunds/*', '/contact'].map((path) => [path, '/index.html', '200', 'force']),
    ]);
    // The same paths App.tsx keeps from the card lane's routes; /board/*, /terms/* and /refunds/* (the
    // posted Terms versions, docs/specs/legal-copy.md) sit under a segment already listed.
    expect(KERNEL_SEGMENTS.map((segment) => `/${segment}`).sort()).toEqual(
      rules
        .slice(1, spa)
        .map(([from]) => from)
        .filter((from) => !from!.endsWith('/*'))
        .sort(),
    );
    expect(rules[spa]).toEqual(['/*', '/index.html', '200', 'no force']);
    expect(toml).not.toMatch(/board[a-z0-9-]*\.netlify\.app/);
  });

  it('is what vite preview sends, so the e2e run tests the production policy', () => {
    expect(netlifyHeaders(toml)).toEqual(headers);
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
    const joined = (name: string) => {
      const pieces = script.match(new RegExp(`const ${name} =\\s*((?:"[^"]*"\\s*\\+?\\s*)+);`))?.[1] ?? '';
      return [...pieces.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
    };
    expect(joined('REPORT_ONLY_POLICY')).toBe(headers['Content-Security-Policy-Report-Only']);
    expect(joined('ENFORCED_POLICY')).toBe(headers['Content-Security-Policy']);
    for (const name of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy']) {
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

describe('the design guide is not indexed', () => {
  it('sends X-Robots-Tag noindex, nofollow on the guide path from netlify.toml', async () => {
    const { GUIDE_PATH } = await import('./pages/Guide');
    expect(headersFor(GUIDE_PATH)['X-Robots-Tag']).toBe('noindex, nofollow');
  });
});

