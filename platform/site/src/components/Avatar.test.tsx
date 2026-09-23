import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Avatar, avatarFeatures, CREATURE_COLOURS } from './Avatar';

// The roster's species notes, read from the role specs the roles table is seeded from.
const AGENTS = resolve(process.cwd(), '../agents');
const NOTES: Record<string, string> = Object.fromEntries(
  readdirSync(AGENTS)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(resolve(AGENTS, name), 'utf8')) as { title: string; species_note: string })
    .map((spec) => [spec.title, spec.species_note]),
);

afterEach(() => {
  cleanup();
});

describe('avatarFeatures', () => {
  it('reads each launch agent from its species note', () => {
    expect(Object.keys(NOTES).sort()).toEqual(
      [
        'Biz Dev',
        'Builder A',
        'Builder B',
        'Community',
        'Game Designer',
        'Game Director',
        'HR',
        'Head of Finance',
        'Head of Product',
        'Host',
        'Janitor',
        'Platform Builder',
        'Platform Director',
        'QA',
        'Studio Head',
        'Tech Artist',
      ].sort(),
    );
    const f = (title: string) => avatarFeatures(NOTES[title]!);
    expect(f('Builder A')).toMatchObject({ colour: 'blue', build: 'small', antennae: true, legs: 'stubby' });
    expect(f('Builder B')).toMatchObject({ colour: 'orange', build: 'small', tail: true, fingers: true, arms: 2 });
    expect(f('QA')).toMatchObject({ colour: 'yellow', build: 'slim', eyes: { count: 6, shape: 'small', ring: true } });
    expect(f('Studio Head')).toMatchObject({ colour: 'grey', eyes: { count: 1, shape: 'large', ring: false }, wideHead: true });
    expect(f('Game Director')).toMatchObject({ colour: 'green', build: 'short', arms: 4, tuft: true });
    expect(f('Host')).toMatchObject({ colour: 'pink', build: 'round', ears: true, wideMouth: true });
    expect(f('Platform Builder')).toMatchObject({ colour: 'purple', build: 'squat', shell: true, eyes: { count: 2, shape: 'wide', ring: false } });
    expect(f('Biz Dev')).toMatchObject({ colour: 'teal', build: 'slim', legs: 'long', eyes: { count: 2, shape: 'tall', ring: false } });
    expect(f('Community')).toMatchObject({ colour: 'lavender', build: 'soft', horns: true, wideHead: true });
    // The roles added on 23 September 2026.
    expect(f('Game Designer')).toMatchObject({ colour: 'red', build: 'small', arms: 3, tail: true });
    expect(f('Platform Director')).toMatchObject({ colour: 'brown', build: 'slim', ears: true, eyes: { count: 2, shape: 'wide', ring: false } });
    expect(f('Head of Finance')).toMatchObject({ colour: 'grey', build: 'squat', shell: true, eyes: { count: 4, shape: 'small', ring: false } });
    expect(f('Janitor')).toMatchObject({ colour: 'orange', build: 'short', legs: 'long', eyes: { count: 1, shape: 'large', ring: false } });
    expect(f('Tech Artist')).toMatchObject({ colour: 'pink', build: 'soft', horns: true, tuft: true });
    expect(f('HR')).toMatchObject({ colour: 'blue', build: 'round', antennae: true, wideMouth: true });
    expect(f('Head of Product')).toMatchObject({ colour: 'teal', build: 'small', legs: 'stubby', eyes: { count: 3, shape: 'normal', ring: true } });
  });

  it('is deterministic, and fills in what a note does not say from the note itself', () => {
    const note = 'A curious creature with a hat.';
    expect(avatarFeatures(note)).toEqual(avatarFeatures(note));
    expect(CREATURE_COLOURS).toContain(avatarFeatures(note).colour);
    expect(avatarFeatures('A small gray creature.').colour).toBe('grey');
  });
});

describe('Avatar', () => {
  it('draws the same picture for the same note and a different one for a different note', () => {
    const first = render(<Avatar note={NOTES['Builder A']!} />).container.innerHTML;
    cleanup();
    const again = render(<Avatar note={NOTES['Builder A']!} />).container.innerHTML;
    cleanup();
    const other = render(<Avatar note={NOTES.QA!} />).container.innerHTML;
    const strip = (html: string) => html.replace(/id="[^"]*"|aria-labelledby="[^"]*"/g, '');
    expect(strip(again)).toBe(strip(first));
    expect(strip(other)).not.toBe(strip(first));
  });

  it('is an image named by its species note, coloured by a palette token', () => {
    const { container } = render(<Avatar note={NOTES.Host!} />);
    const image = screen.getByRole('img', { name: NOTES.Host });
    expect(image.tagName.toLowerCase()).toBe('svg');
    expect(image.getAttribute('style')).toContain('--avatar-fill: var(--creature-pink)');
    // Colours come from tokens: no literal colour anywhere in the drawing.
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(/i);
  });

  it('has a --creature token in styles.css for every colour it can pick', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles.css'), 'utf8');
    for (const colour of CREATURE_COLOURS) expect(css).toMatch(new RegExp(`--creature-${colour}:\\s*#[0-9a-f]{6};`));
  });
});
