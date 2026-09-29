import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boardHostFrom, netlifyHosts, playHostFrom, strayNetlifyHosts } from '../scripts/board-address.mjs';

// The check live-check.mjs, App.test.tsx and e2e/csp.spec.ts run on /board (docs/specs/board-site.md).
// Paths resolve from the package root vitest runs in.
const toml = readFileSync(resolve(process.cwd(), 'netlify.toml'), 'utf8');

describe('the board address check', () => {
  it("reads the game's host from netlify.toml: a netlify.app address every page links to", () => {
    expect(playHostFrom(toml)).toBe('play.mobmachine.games');
    expect(playHostFrom('VITE_PLAY_URL = ""\n')).toBeNull();
    expect(playHostFrom('[build]\n')).toBeNull();
  });

  it("allows the game's host and finds any other netlify.app host, in any case", () => {
    const page = '<a href="https://peanutgallery-seed-1.netlify.app">Play</a> <a href="https://Board-x7Q2.Netlify.app/">x</a> board-x7q2.netlify.app';
    expect(netlifyHosts(page)).toEqual(['peanutgallery-seed-1.netlify.app', 'board-x7q2.netlify.app']);
    expect(strayNetlifyHosts(page, ['peanutgallery-seed-1.netlify.app'])).toEqual(['board-x7q2.netlify.app']);
    expect(strayNetlifyHosts('<a href="https://peanutgallery-seed-1.netlify.app">Play</a>', ['peanutgallery-seed-1.netlify.app'])).toEqual([]);
    expect(netlifyHosts('https://notnetlify.app/x https://x.netlify.apps/y')).toEqual([]);
  });

  it('reads the board host from BOARD_SITE_URL only when it is set and a URL', () => {
    expect(boardHostFrom('https://board-x7q2.netlify.app/')).toBe('board-x7q2.netlify.app');
    expect(boardHostFrom(undefined)).toBeNull();
    expect(boardHostFrom('  ')).toBeNull();
    expect(boardHostFrom('not a url')).toBeNull();
  });

  it("is what live-check.mjs runs on /board, with the game's host from netlify.toml allowed", () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/live-check.mjs'), 'utf8');
    expect(script).toContain("playHostFrom(readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8'))");
    expect(script).toContain('strayNetlifyHosts(content, PLAY_HOST === null ? [] : [PLAY_HOST])');
    expect(script).toContain('boardHostFrom(process.env.BOARD_SITE_URL)');
    expect(script).not.toMatch(/!\/netlify\\\.app\/\.test/);
  });
});
