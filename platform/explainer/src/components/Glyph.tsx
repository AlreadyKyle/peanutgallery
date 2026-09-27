import type { CSSProperties } from 'react';
import { Glyph as SiteGlyph, type GlyphName } from '../../../site/src/components/Glyph';

// The site's glyphs, drawn by the site's own component and sized here: styles.css draws the strokes
// the way the site does, and --g sets the size.
export function Glyph({ name, size, colour }: { name: GlyphName; size: number; colour?: string }) {
  const style = { '--g': `${size}px`, color: colour, display: 'inline-flex' } as CSSProperties;
  return (
    <span style={style}>
      <SiteGlyph name={name} />
    </span>
  );
}
