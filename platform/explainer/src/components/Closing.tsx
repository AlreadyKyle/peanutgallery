import type { GlyphName } from '../../../site/src/components/Glyph';
import { at, pop, progress } from '../anim';
import { script, SITE_ADDRESS } from '../data';
import type { Format } from '../format';
import { C, FONT } from '../theme';
import { CHOREO } from '../timeline';
import { Glyph } from './Glyph';
import { closingLines, closingTop, plateLockup } from './TopBar';

// The closing plate's line, the board's own (PLAN.md §10 decision 57): its three sentences one to a
// beat and a half, each with the site glyph for what it says (open for funding, building, the game
// suit's cartridge), paper on the plate. The social cuts add the site's address under it.

const GLYPHS: readonly GlyphName[] = ['coin-outline', 'gear', 'cartridge'];

export function Closing({ frame, format, social }: { frame: number; format: Format; social: boolean }) {
  const lines = closingLines(format, social);
  const top = closingTop(format, social) + plateLockup(format).height + lines.gap;
  const sentences = script.beats[script.beats.length - 1]!.line.split(/(?<=\.)\s+/);
  return (
    <div style={{ position: 'absolute', left: 0, top, width: format.width, fontFamily: FONT, color: C.paper, textAlign: 'center' }}>
      {sentences.map((sentence, i) => {
        const k = pop(frame, at(CHOREO.outro.lines[i]!), 'bouncy');
        const glyph = GLYPHS[i]!;
        return (
          <div
            key={sentence}
            style={{
              height: lines.line,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: Math.round(lines.size * 0.34),
              fontSize: lines.size,
              fontWeight: 700,
              letterSpacing: '-0.01em',
              opacity: Math.min(1, k * 1.4),
              transform: `translateY(${(1 - k) * 36}px) scale(${0.82 + 0.18 * k})`,
            }}
          >
            <Glyph name={glyph} size={Math.round(lines.size * 0.92)} />
            {sentence}
          </div>
        );
      })}
      {social ? (
        <div
          style={{
            marginTop: 28,
            fontSize: Math.round(lines.size * 0.6),
            fontWeight: 600,
            color: C.mutedOnInk,
            opacity: progress(frame, at(CHOREO.outro.url), 20),
            transform: `translateY(${(1 - progress(frame, at(CHOREO.outro.url), 20)) * 14}px)`,
          }}
        >
          {SITE_ADDRESS}
        </div>
      ) : null}
    </div>
  );
}
