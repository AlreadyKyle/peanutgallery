// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ROUTES } from '../e2e/routes';
import { pageRoutes } from './routes';

// Every page the site routes is in the kernel route list the design suite and the frames job read
// (e2e/routes.ts, docs/specs/design-review.md), so no page escapes the checks. A path with a
// parameter (/card/:id) is in the list when a listed route fills it.
function pattern(path: string): RegExp {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/?]+');
  return new RegExp(`^${escaped}(\\?.*)?$`);
}

describe('the kernel route list', () => {
  it('holds every page in routes.tsx', () => {
    const listed = ROUTES.map(([, path]) => path);
    const missing = pageRoutes.map((route) => route.path).filter((path) => !listed.some((listedPath) => pattern(path).test(listedPath)));
    expect(missing).toEqual([]);
  });

  it('gives every route its own name', () => {
    const names = ROUTES.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('matches a parameter only within one path segment', () => {
    expect(pattern('/card/:id').test('/card/20000000-0000-4000-8000-000000000001')).toBe(true);
    expect(pattern('/card/:id').test('/card')).toBe(false);
    expect(pattern('/card/:id').test('/card/a/b')).toBe(false);
    expect(pattern('/team').test('/teams')).toBe(false);
  });
});
