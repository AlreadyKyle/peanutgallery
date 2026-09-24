import { describe, expect, it } from 'vitest';
import { eventVerb } from './EventList';

// The public event list (docs/specs/agent-system-core.md): a line the database wrote about a card says
// what it did, with the top-up's amount; a role's line keeps its verb, and nothing wrote a note.
describe('eventVerb', () => {
  it('names the database steps, with the amount the resume rule took from Not on a card yet', () => {
    expect(eventVerb({ type: 'message', step: 'dealt', usd: null })).toBe('Dealt to now');
    expect(eventVerb({ type: 'message', step: 'ceiling_top_up', usd: '1.2500' })).toBe('Topped up with $1.25 from Not on a card yet');
    expect(eventVerb({ type: 'message', step: 'resume_rule', usd: null })).toBe('Resumed by rule after its spending limit');
  });

  it("keeps a role's verb for its event type, and an unknown step falls back to it", () => {
    expect(eventVerb({ type: 'message' })).toBe('wrote a note');
    expect(eventVerb({ type: 'ship', step: null, usd: null })).toBe('shipped');
    expect(eventVerb({ type: 'message', step: 'something_new', usd: null })).toBe('wrote a note');
  });
});
