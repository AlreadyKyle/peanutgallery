import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../lib/copy';
import { ShareCard } from './ShareCard';

const URL = 'https://mobmachine.games/card/0b7f2c1e-0000-4000-8000-000000000001';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'share');
});

describe('ShareCard', () => {
  it("opens the browser's share sheet with the card's title and address when there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    render(<ShareCard title="A cheaper Mill" url={URL} />);
    fireEvent.click(screen.getByRole('button', { name: copy.cardPage.share }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'A cheaper Mill', url: URL }));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('copies the address and says so where there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ShareCard title="A cheaper Mill" url={URL} />);
    fireEvent.click(screen.getByRole('button', { name: copy.cardPage.share }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.cardPage.shareCopied));
    expect(writeText).toHaveBeenCalledWith(URL);
  });

  it('shows the address to copy by hand when the clipboard refuses', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    render(<ShareCard title="A cheaper Mill" url={URL} />);
    fireEvent.click(screen.getByRole('button', { name: copy.cardPage.share }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.cardPage.shareFailed.replace('{url}', URL)));
  });

  it('says nothing when the viewer closes the share sheet', async () => {
    Object.defineProperty(navigator, 'share', { value: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')), configurable: true });
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ShareCard title="A cheaper Mill" url={URL} />);
    fireEvent.click(screen.getByRole('button', { name: copy.cardPage.share }));
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
