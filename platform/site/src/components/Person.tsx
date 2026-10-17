import { Link } from 'react-router-dom';
import type { AvatarSpec, PublicPerson } from '../lib/community-types';
import { copy } from '../lib/copy';
import { Avatar } from './Avatar';

// A player as the site draws them (docs/specs/final-state.md, XP, levels, badges, avatars, frames):
// the same code-drawn alien system as the team, from the parts they unlocked, in the frame of their
// tier or of a rarity they collected. The frame is a ring pattern with its name written beside the
// avatar wherever it matters, never colour alone.

/** A species note for the avatar parts, so Avatar.tsx draws a player the way it draws an agent. */
export function noteFromSpec(spec: AvatarSpec): string {
  const parts = [spec.eyes === '' ? 'two eyes' : `${spec.eyes} eyes`];
  if (spec.antennae !== '' && spec.antennae !== 'none') parts.push(`${spec.antennae} antennae`);
  if (spec.pattern !== '' && spec.pattern !== 'none') parts.push(`a ${spec.pattern} pattern`);
  return `A ${spec.body} ${spec.fill} creature with ${parts.join(' and ')}.`;
}

export function PersonAvatar({ person, size = 48 }: { person: Pick<PublicPerson, 'avatar' | 'frame'>; size?: number }) {
  return (
    <span className="person-frame" data-frame={person.frame ?? 'none'} style={{ width: size + 12, height: size + 12 }}>
      <Avatar note={noteFromSpec(person.avatar)} size={size} />
    </span>
  );
}

export function PersonLink({ person }: { person: PublicPerson | null }) {
  if (person === null) return <span className="person-name">{copy.pipe.anonymous}</span>;
  return (
    <Link className="person-link" to={`/u/${encodeURIComponent(person.handle)}`}>
      <PersonAvatar person={person} size={24} />
      <span>{person.displayName}</span>
    </Link>
  );
}
