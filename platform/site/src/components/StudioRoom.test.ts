import { describe, expect, it } from 'vitest';
import type { AgentPlace } from '../lib/studio-scene';
import { doingLine } from './StudioRoom';

// An agent in the room is a button named by its role and what it is doing: the role once, so a
// screen reader hears "QA. Chatting with Janitor until the next card.", never "QA, QA".

function place(name: string, title: string, doing: string): AgentPlace {
  return { role: { name, title }, doing } as AgentPlace;
}

describe('doingLine', () => {
  it('names a role whose name is its title once, then the activity', () => {
    expect(doingLine(place('QA', 'QA', 'Chatting with Janitor until the next card.'))).toBe('QA. Chatting with Janitor until the next card.');
  });

  it('names both when the name and the title differ', () => {
    expect(doingLine(place('Wren', 'Game Designer', 'Drafting a card.'))).toBe('Wren, Game Designer. Drafting a card.');
  });
});
