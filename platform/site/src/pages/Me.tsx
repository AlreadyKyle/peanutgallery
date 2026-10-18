import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CREATURE_COLOURS } from '../components/Avatar';
import { Glyph } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { noteFromSpec, PersonAvatar } from '../components/Person';
import { ProfileHead } from '../components/ProfileView';
import { adoptLinkErrorFromLocation, adoptSessionFromLocation, rpc, sendMagicLink, signOut, useMyProfile, type LinkError } from '../lib/account';
import { CommunityError } from '../lib/community';
import type { AvatarSpec, Profile } from '../lib/community-types';
import { copy } from '../lib/copy';
import { pendingFollowPath, unfollowCard, useFollows } from '../lib/follows';
import { legal } from '../lib/legal';
import { pendingSeedPath } from '../lib/seed-link';
import { TIERS } from '../lib/xp';

// /me (docs/specs/final-state.md, Identity and anonymity): sign in by a magic link, then the
// player's own profile: the name shown on the site, the avatar from the parts their level has
// unlocked, the frame, the flair, whether contributions show their name by default, and claiming
// past contributions by the email on the Stripe receipt (matched on the server, which never shows
// another payer). An account is optional: contributing never needs one.

/** Avatar parts and the level each option unlocks at: the first is open to everyone. */
export const AVATAR_PARTS = {
  body: ['round', 'small', 'soft', 'slim', 'squat', 'short'],
  eyes: ['two', 'one large', 'three', 'two wide', 'four', 'six small'],
  antennae: ['none', 'two'],
  fill: [...CREATURE_COLOURS],
} as const;
export type AvatarPart = keyof typeof AVATAR_PARTS;

/** The level an option of a part unlocks at: every second level opens the next. */
export function unlockLevel(index: number): number {
  return index === 0 ? 1 : 1 + index * 2;
}

/** The frames a profile may wear: its tier's and every earlier tier's, and each rarity it collected. */
export function framesFor(profile: Profile): string[] {
  const tierIndex = Math.max(0, TIERS.indexOf(profile.tier as (typeof TIERS)[number]));
  const tiers = TIERS.slice(0, tierIndex + 1).map((tier) => tier.toLowerCase());
  const rarities = Array.from(new Set(profile.collection.map((card) => card.rarity))).filter((rarity) => rarity !== 'common');
  return [...tiers, ...rarities];
}

function SignIn({ linkError }: { linkError: LinkError | null }) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'limit'>('idle');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setState('sending');
    sendMagicLink(email.trim(), `${window.location.origin}/me`)
      .then(() => setState('sent'))
      .catch((error: unknown) => setState(error instanceof CommunityError && error.status === 429 ? 'limit' : 'error'));
  };
  return (
    <section className="section" aria-labelledby="me-sign-in">
      <h2 id="me-sign-in">{copy.me.signInTitle}</h2>
      {/* A link that expired or was used already lands here with the error in the fragment. */}
      {linkError === null || state !== 'idle' ? null : (
        <p className="notice-plain" role="alert">
          <Glyph name="clock" />
          <span>{linkError === 'expired' ? copy.me.linkExpired : copy.me.linkFailed}</span>
        </p>
      )}
      <p>{copy.me.signInBody}</p>
      <form className="form" onSubmit={submit}>
        <label htmlFor={`${id}-email`}>{copy.me.emailLabel}</label>
        <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
        <p>
          <button type="submit" className="button" disabled={state === 'sending'}>
            {state === 'sending' ? copy.me.sending : copy.me.send}
          </button>
        </p>
        <p role="status" className="small">
          {state === 'sent' ? copy.me.sent : state === 'limit' ? copy.me.tooMany : state === 'error' ? copy.me.closed : ''}
        </p>
      </form>
      <p className="small muted">{copy.me.optional}</p>
    </section>
  );
}

type EditorFields = { name: string; avatar: AvatarSpec; frame: string; flair: string; publicDefault: boolean };

/**
 * update_profile's arguments from the editor. public_by_default is sent only when the player changed
 * the box from what it started as, so saving a name never turns showing their name on contributions
 * back on.
 */
export function profileUpdate(profile: Profile, fields: EditorFields): Record<string, unknown> {
  const args: Record<string, unknown> = {
    display_name: fields.name.trim(),
    avatar: fields.avatar,
    frame: fields.frame === '' ? null : fields.frame,
    flair: fields.flair.trim() === '' ? null : fields.flair.trim(),
  };
  if (fields.publicDefault !== startingPublic(profile)) args.public_by_default = fields.publicDefault;
  return args;
}

/** What the box starts as: the player's own setting from my_profile, else the database's default (on). */
function startingPublic(profile: Profile): boolean {
  return profile.publicByDefault ?? true;
}

function Editor({ profile, onSaved }: { profile: Profile; onSaved: () => void }) {
  const id = useId();
  const [name, setName] = useState(profile.displayName);
  const [avatar, setAvatar] = useState<AvatarSpec>(profile.avatar);
  const [frame, setFrame] = useState(profile.frame ?? '');
  const [flair, setFlair] = useState(profile.flair ?? '');
  const [publicDefault, setPublicDefault] = useState(() => startingPublic(profile));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const frames = framesFor(profile);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setState('saving');
    rpc('update_profile', profileUpdate(profile, { name, avatar, frame, flair, publicDefault }))
      .then(() => {
        setState('saved');
        onSaved();
      })
      .catch(() => setState('error'));
  };
  const preview = { avatar, frame: frame === '' ? null : frame };
  return (
    <form className="form me-editor" onSubmit={submit}>
      <div className="me-preview">
        <PersonAvatar person={preview} size={112} />
        <p className="small muted">{noteFromSpec(avatar)}</p>
      </div>
      <div className="me-fields">
        <label htmlFor={`${id}-name`}>{copy.me.nameLabel}</label>
        <input id={`${id}-name`} type="text" maxLength={32} required value={name} onChange={(event) => setName(event.currentTarget.value)} aria-describedby={`${id}-name-hint`} />
        <p className="small muted" id={`${id}-name-hint`}>
          {copy.me.nameHint}
        </p>
        {(Object.keys(AVATAR_PARTS) as AvatarPart[]).map((part) => (
          <div key={part} className="me-part">
            <label htmlFor={`${id}-${part}`}>{copy.me.parts[part]}</label>
            <select id={`${id}-${part}`} value={avatar[part]} onChange={(event) => setAvatar({ ...avatar, [part]: event.currentTarget.value })}>
              {AVATAR_PARTS[part].map((option, i) => {
                const locked = unlockLevel(i) > profile.level;
                return (
                  <option key={option} value={option} disabled={locked}>
                    {locked ? copy.me.locked.replace('{option}', option).replace('{n}', String(unlockLevel(i))) : option}
                  </option>
                );
              })}
            </select>
          </div>
        ))}
        <label htmlFor={`${id}-frame`}>{copy.me.frameLabel}</label>
        <select id={`${id}-frame`} value={frame} onChange={(event) => setFrame(event.currentTarget.value)}>
          <option value="">{copy.profile.noFrame}</option>
          {frames.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-flair`}>{copy.me.flairLabel}</label>
        <input id={`${id}-flair`} type="text" maxLength={24} value={flair} onChange={(event) => setFlair(event.currentTarget.value)} />
        <label className="check-row" htmlFor={`${id}-public`}>
          <input id={`${id}-public`} type="checkbox" checked={publicDefault} onChange={(event) => setPublicDefault(event.currentTarget.checked)} />
          <span>{copy.me.publicLabel}</span>
        </label>
        <p className="small muted">{copy.me.publicHint}</p>
        <p>
          <button type="submit" className="button" disabled={state === 'saving'}>
            {state === 'saving' ? copy.me.saving : copy.me.save}
          </button>
        </p>
        <p role="status" className="small">
          {state === 'saved' ? copy.me.saved : state === 'error' ? copy.me.saveFailed : ''}
        </p>
      </div>
    </form>
  );
}

function Claim({ onClaimed }: { onClaimed: () => void }) {
  const [state, setState] = useState<{ kind: 'idle' | 'busy' | 'error' } | { kind: 'done'; n: number }>({ kind: 'idle' });
  return (
    <section className="section" aria-labelledby="me-claim">
      <h2 id="me-claim">{copy.me.claimTitle}</h2>
      <p>{copy.me.claimBody}</p>
      <p>
        <button
          type="button"
          className="button button-secondary"
          disabled={state.kind === 'busy'}
          onClick={() => {
            setState({ kind: 'busy' });
            rpc<{ claimed: number }>('claim_contributions')
              .then((result) => {
                setState({ kind: 'done', n: result.claimed });
                onClaimed();
              })
              .catch(() => setState({ kind: 'error' }));
          }}
        >
          {copy.me.claim}
        </button>
      </p>
      <p role="status" className="small">
        {state.kind === 'done'
          ? (state.n === 1 ? copy.me.claimedOne : copy.me.claimedMany).replace('{n}', String(state.n))
          : state.kind === 'error'
            ? copy.me.claimFailed
            : ''}
      </p>
    </section>
  );
}

/** The cards the player follows (docs/specs/card-follows.md), each with its state and Unfollow. */
function Follows() {
  const follows = useFollows();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const words = copy.follow;
  const unfollow = (cardId: string) => {
    setBusy(cardId);
    setFailed(false);
    unfollowCard(cardId)
      .then(() => follows.reload())
      .catch(() => setFailed(true))
      .finally(() => setBusy(null));
  };
  return (
    <section className="section" aria-labelledby="me-follows">
      <h2 id="me-follows">{words.listTitle}</h2>
      <p>{words.listLede}</p>
      {follows.state === 'loading' ? (
        <p className="muted" aria-busy="true">
          {copy.me.loading}
        </p>
      ) : follows.state !== 'ready' ? (
        <p className="muted">{words.listUnavailable}</p>
      ) : follows.follows.length === 0 ? (
        <p className="muted">{words.listEmpty}</p>
      ) : (
        <ul className="rows me-follows">
          {follows.follows.map((follow) => (
            <li key={follow.cardId} data-follow={follow.cardId}>
              <p>
                <Link to={`/card/${follow.cardId}`}>{follow.title}</Link>
              </p>
              <p className="small muted">{words.states[follow.state] ?? words.states.open}</p>
              <p>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={busy === follow.cardId}
                  onClick={() => unfollow(follow.cardId)}
                  aria-label={words.unfollowNamed.replace('{title}', follow.title)}
                >
                  {words.unfollow}
                </button>
              </p>
            </li>
          ))}
        </ul>
      )}
      <p role="status" className="small">
        {failed ? words.failed : ''}
      </p>
    </section>
  );
}

export function Me() {
  const navigate = useNavigate();
  const [linkError, setLinkError] = useState<LinkError | null>(null);
  useEffect(() => {
    // A link that expired or was used already says so, and the error leaves the address.
    const failed = adoptLinkErrorFromLocation();
    if (failed !== null) setLinkError(failed);
    // A player who signed in to save a seed (/seeds?save=) goes back to finish the save; one who
    // signed in to follow a card goes back to the card (docs/specs/card-follows.md).
    if (!adoptSessionFromLocation()) return;
    const back = pendingSeedPath() ?? pendingFollowPath();
    if (back !== null) navigate(back, { replace: true });
  }, [navigate]);
  const me = useMyProfile();
  return (
    <main className="wide">
      <div className="band">
        <PageHeader title={copy.me.title} lede={copy.me.lede} />
      </div>
      <div className="band">
        {me.state === 'signed-out' ? (
          <SignIn linkError={linkError} />
        ) : me.state === 'loading' ? (
          <p className="muted" aria-busy="true">
            {copy.me.loading}
          </p>
        ) : me.state === 'unavailable' ? (
          <section className="section">
            <p>{legal.partUnavailable}</p>
            <p>
              <button type="button" className="button button-secondary" onClick={signOut}>
                {copy.me.signOut}
              </button>
            </p>
          </section>
        ) : (
          <>
            <section className="section" aria-labelledby="me-you">
              <h2 id="me-you">{me.profile.displayName}</h2>
              <ProfileHead profile={me.profile} />
              <p className="me-links">
                <Link to={`/u/${encodeURIComponent(me.profile.handle)}`}>
                  {copy.me.seePublic}
                  <Glyph name="arrow-right" />
                </Link>
                <button type="button" className="button button-secondary" onClick={signOut}>
                  {copy.me.signOut}
                </button>
              </p>
            </section>
            <section className="section" aria-labelledby="me-edit">
              <h2 id="me-edit">{copy.me.editTitle}</h2>
              <Editor profile={me.profile} onSaved={me.reload} />
            </section>
            <Claim onClaimed={me.reload} />
            <Follows />
          </>
        )}
      </div>
    </main>
  );
}
