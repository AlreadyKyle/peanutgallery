import type { ReactNode } from 'react';
import { copy } from '../lib/copy';

/**
 * A visual on /how-it-works: the real component in example mode, under a visible label that says
 * whether it shows a real public record or made-up figures. The components inside render no link or
 * button, so nothing here can start a payment.
 */
export function Example({ real, caption, children }: { real: boolean; caption?: string; children: ReactNode }) {
  return (
    <figure className="example">
      <figcaption className="example-label">
        {real ? copy.howItWorksPage.exampleReal : copy.howItWorksPage.exampleMadeUp}
        {caption === undefined ? null : <span className="example-caption">{caption}</span>}
      </figcaption>
      {children}
    </figure>
  );
}
