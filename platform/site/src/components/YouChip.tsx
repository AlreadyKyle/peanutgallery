import { Link } from 'react-router-dom';
import { useMyProfile } from '../lib/account';
import { copy } from '../lib/copy';
import { PersonAvatar } from './Person';

// The top bar's you slot (docs/specs/place.md): the frame knows who is here. Signed out, a quiet
// Sign in link to /me; signed in, the player's avatar in its frame and their level, a link to their
// desk. It never asks for anything and never stands between a visitor and Contribute: paying needs
// no account. While the profile loads, or when it cannot be read, the slot keeps its place with the
// plain link, so the bar never jumps.

export function YouChip() {
  const me = useMyProfile();
  if (me.state !== 'ready') {
    return (
      <Link className="you-chip" to="/me" data-you={me.state === 'signed-out' ? 'out' : 'loading'}>
        {me.state === 'signed-out' ? copy.you.signIn : copy.nav.me}
      </Link>
    );
  }
  const { profile } = me;
  return (
    <Link
      className="you-chip"
      to="/me"
      data-you="in"
      aria-label={copy.you.deskNamed.replace('{name}', profile.displayName).replace('{n}', String(profile.level))}
    >
      <PersonAvatar person={profile} size={24} />
      <span className="you-level" aria-hidden="true">
        {copy.you.level.replace('{n}', String(profile.level))}
      </span>
    </Link>
  );
}
