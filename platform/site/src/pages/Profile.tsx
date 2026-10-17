import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ProfileView } from '../components/ProfileView';
import { useCommunity } from '../lib/community';
import type { Profile as ProfileDoc } from '../lib/community-types';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';

// /u/:handle (docs/specs/final-state.md, Identity and anonymity): a player's public profile, from
// /api/community/profile/<handle>. A handle with no profile is a plain "no player" page; a profile
// read that fails says so. Profiles are public by the player's own choice, so the page is not indexed
// either way: a player's name is theirs, not search engines'.

export function Profile() {
  const { handle = '' } = useParams();
  const doc = useCommunity<ProfileDoc>(`/profile/${encodeURIComponent(handle)}`);
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  const title = doc.state === 'ready' ? doc.data.displayName : copy.profile.title;
  return (
    <main className="wide">
      <div className="band">
        <PageHeader title={title} lede={doc.state === 'ready' ? `@${doc.data.handle}` : undefined} />
      </div>
      <div className="band">
        {doc.state === 'loading' ? (
          <p className="muted" aria-busy="true">
            {copy.profile.loading}
          </p>
        ) : doc.state === 'unavailable' ? (
          <section className="section">
            <p>{doc.status === 404 ? copy.profile.missing : legal.partUnavailable}</p>
            <p>
              <Link to="/">{copy.home}</Link>
            </p>
          </section>
        ) : (
          <ProfileView profile={doc.data} />
        )}
      </div>
    </main>
  );
}
