import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { netlifyHeaders } from '../vite.config';

// The board site's own settings (docs/specs/board-site.md). Paths resolve from the package root
// vitest runs in: jsdom gives import.meta.url an http scheme.
const root = process.cwd();
const toml = readFileSync(resolve(root, 'netlify.toml'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const headers = netlifyHeaders(toml);
const supabaseUrl = toml.match(/^\s*VITE_SUPABASE_URL\s*=\s*"([^"]+)"/m)?.[1] ?? '';

function directives(policy: string): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const part of policy.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name !== undefined && name !== '') map[name] = sources;
  }
  return map;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('netlify.toml', () => {
  it('builds this folder alone with the public Supabase values and no secret', () => {
    expect(toml).toMatch(/^\s*command = "pnpm --filter @backseat\/board build"$/m);
    expect(toml).toMatch(/^\s*publish = "dist"$/m);
    expect(supabaseUrl).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    expect(toml).toMatch(/^\s*VITE_SUPABASE_ANON_KEY = "sb_publishable_[A-Za-z0-9_-]+"$/m);
    expect(toml).not.toMatch(/service_role|sb_secret_|STRIPE|VITE_STRIPE/);
    // The same project the public site reads.
    const site = readFileSync(resolve(root, '../site/netlify.toml'), 'utf8');
    expect(site.match(/^\s*VITE_SUPABASE_URL\s*=\s*"([^"]+)"/m)?.[1]).toBe(supabaseUrl);
  });

  it('skips card and dependabot branches and builds only when this folder or the workspace files changed', () => {
    const ignore = toml.match(/^\s*ignore = '(.*)'$/m)?.[1] ?? '';
    expect(ignore).toContain('card/*|dependabot/*) exit 0');
    expect(ignore).toContain('-- . ../../pnpm-lock.yaml ../../package.json ../../pnpm-workspace.yaml ../../tsconfig.base.json');
  });

  it('enforces the whole Content Security Policy, with connections to the Supabase project only', () => {
    const host = new URL(supabaseUrl).host;
    const policy = directives(headers['Content-Security-Policy'] ?? '');
    expect(policy).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'"],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:'],
      'font-src': ["'self'"],
      'connect-src': [`https://${host}`],
      'object-src': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
    });
    expect(headers['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(JSON.stringify(policy)).not.toMatch(/unsafe-inline|unsafe-eval|\*/);
  });

  it('asks search engines not to index it, refuses framing and sends no referrer', () => {
    expect(headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    expect(readFileSync(resolve(root, 'public/robots.txt'), 'utf8')).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('index.html', () => {
  it('carries noindex and runs no inline script', () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.map((match) => [match[1]!.trim(), match[2]!.trim()])).toEqual([['type="module" src="/src/main.tsx"', '']]);
    expect(html).not.toMatch(/og:|twitter:|style=/);
  });
});

describe('.gitignore', () => {
  it('keeps the end-to-end build out of the repository, as the public site does', () => {
    const ignored = readFileSync(resolve(root, '.gitignore'), 'utf8').split('\n');
    expect(ignored).toContain('dist-e2e/');
    expect(readFileSync(resolve(root, 'playwright.config.ts'), 'utf8')).toContain('--outDir dist-e2e');
  });
});

describe('the board app is self-contained', () => {
  it('imports nothing from the public site or any other folder a card can change', () => {
    for (const file of sourceFiles(resolve(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/from '([^']+)'/g)) {
        const target = match[1]!;
        expect(target.startsWith('../') && !target.startsWith('../vite.config'), `${file} imports ${target}`).toBe(false);
      }
      expect(text, file).not.toMatch(/platform\/site|peanutgallery\.games\/board/);
    }
  });
});
