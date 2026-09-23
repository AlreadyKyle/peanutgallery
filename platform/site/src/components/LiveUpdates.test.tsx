import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { LiveUpdates } from './LiveUpdates';

afterEach(() => {
  cleanup();
});

function Row({ start = 0, clock = () => 0 }: { start?: number; clock?: () => number }) {
  const [count, setCount] = useState(start);
  const [paused, setPaused] = useState(false);
  return (
    <>
      <LiveUpdates count={count} paused={paused} now={clock} onTogglePause={() => setPaused((p) => !p)} onShow={() => setCount(0)} />
      <button type="button" onClick={() => setCount((n) => n + 2)}>
        arrive
      </button>
    </>
  );
}

const updates = () => screen.getAllByRole('button').find((b) => b.classList.contains('updates-button'))!;

describe('the live-updates row', () => {
  it('lays out Pause first and the updates button after it from first paint, reading Up to date', () => {
    render(<Row />);
    const [pause, next] = screen.getAllByRole('button');
    expect(pause!.textContent).toBe(copy.pauseLiveUpdates);
    expect(pause!.getAttribute('aria-pressed')).toBe('false');
    expect(next).toBe(updates());
    expect(updates().getAttribute('aria-disabled')).toBe('true');
    expect(updates().hasAttribute('disabled')).toBe(false);
    // Both labels share one cell: the visible one and the longest one, hidden, which holds the width.
    const stack = updates().querySelector('.label-stack')!;
    expect([...stack.children].map((child) => [child.textContent, child.getAttribute('aria-hidden')])).toEqual([
      [copy.upToDate, null],
      ['Show 99+ updates', 'true'],
    ]);
  });

  it('shows the waiting count, and after a press goes back to Up to date in place with focus kept', () => {
    render(<Row />);
    fireEvent.click(screen.getByRole('button', { name: 'arrive' }));
    const button = updates();
    expect(button.querySelector('.label-stack > span')?.textContent).toBe('Show 2 updates');
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    button.focus();
    fireEvent.click(button);
    expect(updates()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelector('.label-stack > span')?.textContent).toBe(copy.upToDate);
  });

  it('marks Pause pressed with the check glyph and says the updates are paused', () => {
    render(<Row />);
    const pause = screen.getByRole('button', { name: copy.pauseLiveUpdates });
    fireEvent.click(pause);
    expect(pause.getAttribute('aria-pressed')).toBe('true');
    expect(pause.querySelector('svg[data-glyph="check"]')).not.toBeNull();
    expect(screen.getByText(copy.liveUpdatesPaused)).toBeTruthy();
  });

  it('announces the waiting count once when it goes from none to some, through one polite announcer', () => {
    render(<Row />);
    const announcer = document.querySelectorAll('[role="status"][aria-live="polite"]');
    expect(announcer).toHaveLength(1);
    expect(announcer[0]!.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'arrive' }));
    expect(announcer[0]!.textContent).toBe(copy.updatesWaiting);
  });
});
