import { useState } from 'react';
import { copy } from '../lib/copy';
import { Glyph } from './Glyph';

type ShareState = 'idle' | 'copied' | 'failed';

// Kernel (docs/specs/supporter-loop.md): /thanks, a kernel page, puts this button beside the card a
// payment reached, so it lives in the kernel list; the card's own page uses it too.

/**
 * Share this card (docs/BACKLOG.md, Share button and link preview for each card): the browser's
 * share sheet where there is one, else the card's address copied to the clipboard, with one polite
 * line saying which happened. It shares the page's own address and title only, never a supporter.
 */
export function ShareCard({ title, url }: { title: string; url: string }) {
  const [state, setState] = useState<ShareState>('idle');
  async function share() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // The viewer closed the sheet: nothing to say.
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  }
  return (
    <p className="share-card">
      <button type="button" className="target" onClick={() => void share()}>
        <Glyph name="arrow-up" />
        {copy.cardPage.share}
      </button>
      <span className="share-status" role="status" aria-live="polite">
        {state === 'copied' ? copy.cardPage.shareCopied : state === 'failed' ? copy.cardPage.shareFailed.replace('{url}', url) : ''}
      </span>
    </p>
  );
}
