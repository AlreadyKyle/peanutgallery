import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { copy } from '../lib/copy';
import { Info } from './Info';

const term = 'Available';
const text = 'Money the agents can spend now.';

function setup() {
  render(<Info term={term} text={text} />);
  const button = screen.getByRole('button', { name: `${copy.about} ${term}` });
  const wrapper = button.parentElement as HTMLElement;
  const tooltip = screen.getByRole('tooltip', { hidden: true });
  return { button, wrapper, tooltip };
}

afterEach(() => {
  cleanup();
});

describe('Info', () => {
  it('names the button and hides the tooltip until it opens', () => {
    const { button, tooltip } = setup();
    expect(button.getAttribute('aria-label')).toBe(`${copy.about} ${term}`);
    expect(tooltip.hidden).toBe(true);
    expect(tooltip.textContent).toBe(text);
  });

  it('describes the button with the tooltip id', () => {
    const { button, tooltip } = setup();
    expect(tooltip.id).not.toBe('');
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('opens on mouse enter and closes on mouse leave while not pinned', () => {
    const { wrapper, tooltip } = setup();
    fireEvent.mouseEnter(wrapper);
    expect(tooltip.hidden).toBe(false);
    fireEvent.mouseLeave(wrapper);
    expect(tooltip.hidden).toBe(true);
  });

  it('opens on focus and closes on blur', () => {
    const { button, tooltip } = setup();
    fireEvent.focus(button);
    expect(tooltip.hidden).toBe(false);
    fireEvent.blur(button);
    expect(tooltip.hidden).toBe(true);
  });

  it('pins open on click so a mouse leave does not close it, and a second click closes it', () => {
    const { button, wrapper, tooltip } = setup();
    fireEvent.click(button);
    expect(tooltip.hidden).toBe(false);
    fireEvent.mouseLeave(wrapper);
    expect(tooltip.hidden).toBe(false);
    fireEvent.click(button);
    expect(tooltip.hidden).toBe(true);
  });

  it('closes on Escape', () => {
    const { button, tooltip } = setup();
    fireEvent.click(button);
    expect(tooltip.hidden).toBe(false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tooltip.hidden).toBe(true);
  });

  it('closes on a pointer press outside but not on one inside', () => {
    const { button, wrapper, tooltip } = setup();
    fireEvent.click(button);
    expect(tooltip.hidden).toBe(false);
    fireEvent.pointerDown(wrapper);
    expect(tooltip.hidden).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(tooltip.hidden).toBe(true);
  });
});
