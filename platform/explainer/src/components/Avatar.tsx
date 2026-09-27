import type { CSSProperties } from 'react';
import { avatarFeatures, avatarParts } from '../../../site/src/components/Avatar';
import { CREATURE } from '../theme';

// An agent, drawn by the site's own avatar code from its species note (the art policy: avatars are
// drawn by code). `blink` closes its eyes for a frame or two; agents never speak or react to money.
export function Avatar({ note, size, blink = false }: { note: string; size: number; blink?: boolean }) {
  const features = avatarFeatures(note);
  const style = { '--avatar-fill': CREATURE[features.colour], display: 'block', overflow: 'visible' } as CSSProperties;
  return (
    <svg viewBox="8 16 104 104" width={size} height={size} style={style} aria-hidden="true">
      {avatarParts(features, blink)}
    </svg>
  );
}
