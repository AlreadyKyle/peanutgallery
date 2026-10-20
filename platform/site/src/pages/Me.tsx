import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CREATURE_COLOURS } from '../components/Avatar';
import { stageWords } from '../components/Floor';
import { Glyph, RarityTag } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { Perks } from '../components/Perks';
import { noteFromSpec, PersonAvatar } from '../components/Person';
import { ProfileHead } from '../components/ProfileView';
import { AuthForm, NewPasswordForm } from '../components/AuthForm';
import {
  adoptLinkErrorFromLocation,
  adoptSessionFromLocation,
  rememberClaim,
  rpc,
  signOut,
  takeArrival,
  takeClaim,
  useMyProfile,
  type LinkError,
} from '../lib/account';
import { arrival, claimInBackground } from '../lib/arrive';
import { CommunityError, relativeTime } from '../lib/community';
import type { AvatarSpec, Profile } from '../lib/community-types';
import { copy } from '../lib/copy';
import { unfollowCard, useFollows } from '../lib/follows';
import { legal } from '../lib/legal';
import { useSignInAnswer } from '../lib/sign-in';
import { useStudio } from '../lib/studio';
import { TIERS } from '../lib/xp';

// /me (docs/specs/final-state.md, Identity and anonymity; docs/specs/place.md, Your desk;
// docs/specs/accounts.md): signed out, the sign-in form, and where every emailed link and provider
// sign-in lands; then the player's desk: who they are here (avatar, level, XP and what the next level
// unlocks), their cards and where each one is now, the cards they follow, the ideas they pitched and
// how far each got, and their badges. Under that, editing the profile (the name shown on the site, the
// avatar from the parts their level has unlocked, the frame, the flair, whether contributions show
// their name by default) and claiming past contributions by the email on the Stripe receipt (matched
// on the server, which never shows another payer). An account is optional: contributing never needs one.

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

/** The next level that opens an avatar option, and the options it opens, or null when every one is open. */
export function nextUnlock(level: number): { level: number; options: string[] } | null {
  const ahead = (Object.keys(AVATAR_PARTS) as AvatarPart[]).flatMap((part) =>
    AVATAR_PARTS[part].map((option, i) => ({ part, option, at: unlockLevel(i) })).filter((entry) => entry.at > level),
  );
  if (ahead.length === 0) return null;
  const at = Math.min(...ahead.map((entry) => entry.at));
  return {
    level: at,
    options: ahead
      .filter((entry) => entry.at === at)
      .map((entry) => `${entry.option} ${entry.part === 'eyes' && entry.option.startsWith('one') ? 'eye' : copy.me.parts[entry.part].toLowerCase()}`),
  };
}

/** The frames a profile may wear: its tier's and every earlier tier's, and each rarity it collected. */
export function framesFor(profile: Profile): string[] {
  const tierIndex = Math.max(0, TIERS.indexOf(profile.tier as (typeof TIERS)[number]));
  const tiers = TIERS.slice(0, tierIndex + 1).map((tier) => tier.toLowerCase());
  const rarities = Array.from(new Set(profile.collection.map((card) => card.rarity))).filter((rarity) => rarity !== 'common');
  return [...tiers, ...rarities];
}

function SignIn({ linkError, onSignedIn }: { linkError: LinkError | null; onSignedIn: () => void }) {
  return (
    <section className="section" aria-label={copy.auth.signIn}>
      {/* A link that expired or was used already lands here with the error in the fragment. */}
      {linkError === null ? null : (
        <p className="notice-plain" role="alert">
          <Glyph name="clock" />
          <span>{linkError === 'expired' ? copy.me.linkExpired : copy.me.linkFailed}</span>
        </p>
      )}
      <div className="auth-panel">
        <AuthForm title="h2" onSignedIn={onSignedIn} />
      </div>
    </section>
  );
}

/** The desk's password: set one (a player who signed in by link or a provider) or change it. */
function PasswordSection() {
  const [saved, setSaved] = useState(0);
  return (
    <section className="section" aria-labelledby="me-password">
      <h2 id="me-password">{copy.auth.passwordTitle}</h2>
      <p>{copy.auth.passwordBody}</p>
      <div className="auth-panel auth-panel-plain">
        <NewPasswordForm key={saved} onDone={() => setSaved((n) => n + 1)} />
      </div>
      {saved > 0 ? (
        <p className="notice-plain" role="status">
          <Glyph name="check" />
          <span>{copy.auth.passwordSaved}</span>
        </p>
      ) : null}
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

/** The head of the desk: the player, their level and XP, what the next level opens, and the way out. */
function DeskHead({ profile }: { profile: Profile }) {
  const next = nextUnlock(profile.level);
  return (
    <section className="section desk-head" aria-labelledby="me-you">
      <h2 id="me-you">{profile.displayName}</h2>
      <ProfileHead profile={profile} />
      <p className="desk-next">
        <span className="desk-next-label">{copy.desk.nextTitle}</span>
        <span>
          {next === null
            ? copy.desk.nextNothing.replace('{n}', String(profile.level + 1))
            : copy.desk.nextUnlocks.replace('{n}', String(next.level)).replace('{parts}', next.options.join(', '))}
        </span>
      </p>
      <p className="me-links">
        <Link className="button" to="/#fund">
          {copy.here.fund}
        </Link>
        <Link to={`/u/${encodeURIComponent(profile.handle)}`}>
          {copy.me.seePublic}
          <Glyph name="arrow-right" />
        </Link>
        <button type="button" className="button button-secondary" onClick={signOut}>
          {copy.me.signOut}
        </button>
      </p>
    </section>
  );
}

/** The cards the player helped fund, each with its rarity and where it is in the studio now. */
function DeskCards({ profile }: { profile: Profile }) {
  const studio = useStudio();
  const byId = new Map((studio.state === 'ready' ? studio.snapshot.cards : []).map((card) => [card.id, card]));
  return (
    <section className="section" aria-labelledby="me-cards">
      <h2 id="me-cards">{copy.desk.cardsTitle}</h2>
      <p>{copy.desk.cardsLede}</p>
      {profile.collection.length === 0 ? (
        <>
          <p className="muted">{copy.desk.noCards}</p>
          <p>
            <Link className="button" to="/#fund">
              {copy.desk.fundOne}
            </Link>
          </p>
        </>
      ) : (
        <ul className="collection-grid desk-cards">
          {profile.collection.map((card) => (
            <li key={card.cardId} className="collected" data-rarity={card.rarity}>
              <span className="rarity-edge" aria-hidden="true" />
              <RarityTag rarity={card.rarity} />
              <Link to={`/card/${card.cardId}`} className="collected-title">
                {card.title}
              </Link>
              <span className="small muted">{studio.state === 'ready' ? stageWords(byId.get(card.cardId)) : null}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The ideas the player pitched and how far each got: received, drafted into a card, live. */
function DeskIdeas({ profile }: { profile: Profile }) {
  return (
    <section className="section" aria-labelledby="me-ideas">
      <h2 id="me-ideas">{copy.desk.ideasTitle}</h2>
      <p>{copy.desk.ideasLede}</p>
      {profile.suggestions.length === 0 ? (
        <>
          <p className="muted">{copy.desk.noIdeas}</p>
          <p>
            <Link className="button button-secondary" to="/suggest#suggest-send">
              {copy.here.pitch}
            </Link>
          </p>
        </>
      ) : (
        <ul className="rows desk-ideas">
          {profile.suggestions.map((item) => (
            <li key={item.id} data-state={item.state}>
              <p className="row-title">{item.title}</p>
              <p className="row-meta small muted">
                <span className="state-chip" data-state={item.state}>
                  {copy.suggest.states[item.state]}
                </span>{' '}
                · <span>{(item.upvotes === 1 ? copy.ideas.upvoteOne : copy.ideas.upvoteMany).replace('{n}', String(item.upvotes))}</span> ·{' '}
                <span>{relativeTime(item.createdAt)}</span>
                {item.cardId === null ? null : (
                  <>
                    {' '}
                    · <Link to={`/card/${item.cardId}`}>{copy.suggest.seeCard}</Link>
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeskBadges({ profile }: { profile: Profile }) {
  return (
    <section className="section" aria-labelledby="me-badges">
      <h2 id="me-badges">{copy.desk.badgesTitle}</h2>
      {profile.badges.length === 0 ? (
        <p className="muted">{copy.profile.noBadges}</p>
      ) : (
        <ul className="badge-grid">
          {profile.badges.map((badge) => (
            <li key={badge.id} className="badge-tile">
              <span className="badge-medal" aria-hidden="true">
                <Glyph name="badge" />
              </span>
              <span className="badge-name">{badge.name}</span>
              <span className="small muted">{badge.rule}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** /thanks's Keep this card lands here signed out: the reason to sign in, said first. */
function KeepNote() {
  return (
    <section className="section" aria-labelledby="me-keep">
      <h2 id="me-keep">{legal.perks.keepTitle}</h2>
      <p>{legal.perks.keepBody}</p>
    </section>
  );
}

export function Me() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const keep = params.get('keep') === '1';
  const [linkError, setLinkError] = useState<LinkError | null>(null);
  const [claim, setClaim] = useState<'none' | 'wanted' | 'running' | 'done'>('none');
  const [claimed, setClaimed] = useState(0);
  // Signed out, the sign-in form is drawn until the studio says sign-in is closed (no answer counts
  // as open), so a first visit lays the page out once.
  const open = useSignInAnswer() !== false;
  const me = useMyProfile();
  const { reload } = me;
  // /thanks's Keep this card (docs/specs/place.md): signed out, the claim waits for the magic link;
  // signed in, or once the link signs the player in, it runs at once and the desk reloads with the card.
  // Every new sign-in claims too, so a card paid for on another device joins the collection.
  useEffect(() => {
    if (!keep) return;
    if (me.state === 'signed-out') rememberClaim();
    else setClaim((was) => (was === 'none' ? 'wanted' : was));
  }, [keep, me.state]);
  useEffect(() => {
    if (claim !== 'wanted' || me.state !== 'ready') return;
    setClaim('running');
    takeClaim();
    rpc<{ claimed: number }>('claim_contributions')
      .then((result) => {
        const n = typeof result?.claimed === 'number' ? result.claimed : 0;
        setClaimed(n);
        setClaim('done');
        if (n > 0) reload();
        // A refresh of /me?keep=1 should not claim again.
        if (keep) navigate('/me', { replace: true });
      })
      .catch(() => setClaim('none'));
  }, [claim, me.state, reload, keep, navigate]);
  // A player who signed in to save a seed (/seeds?save=) goes back to finish the save; one who signed
  // in to follow a card goes back to the card (docs/specs/card-follows.md); one who signed in from
  // another page (Pitch an idea) goes back to it. Otherwise they stay on the desk, which claims.
  const arrive = useCallback(() => {
    const next = arrival();
    if (next.to === 'desk') {
      setClaim('wanted');
      return;
    }
    claimInBackground();
    navigate(next.path, { replace: true });
  }, [navigate]);
  useEffect(() => {
    // A link that expired or was used already says so, and the error leaves the address.
    const failed = adoptLinkErrorFromLocation();
    if (failed !== null) setLinkError(failed);
    if (adoptSessionFromLocation()) {
      // A password reset link signs the player in to choose a new password.
      if (takeArrival() === 'recovery') {
        navigate('/reset-password', { replace: true });
        return;
      }
      arrive();
      return;
    }
    // A password sign-in on /sign-in that had nowhere else to go.
    if ((location.state as { arrived?: unknown } | null)?.arrived === true) {
      navigate('/me', { replace: true, state: null });
      setClaim('wanted');
    }
    // Once, on landing: the address is read as it arrived.
  }, []);
  return (
    // A signed-in player's desk loads after first paint: the lede is the desk's from the start, and the
    // loading band holds the window's height (main.me-page), so the footer waits below the fold.
    <main className="wide me-page">
      <div className="band">
        <PageHeader title={copy.me.title} lede={me.state === 'ready' || me.state === 'loading' ? copy.desk.lede : open ? copy.me.lede : copy.me.ledeClosed} />
      </div>
      <div className="band">
        {me.state === 'signed-out' ? (
          <>
            {open ? (
              <>
                {keep ? <KeepNote /> : null}
                {/* The form, and beside it what a profile adds over paying as a guest. */}
                <div className="auth-layout" data-aside="">
                  <SignIn linkError={linkError} onSignedIn={arrive} />
                  <div className="section">
                    <Perks />
                  </div>
                </div>
              </>
            ) : (
              <>
                <section className="section" aria-labelledby="me-closed">
                  <h2 id="me-closed">{copy.me.closedTitle}</h2>
                  <p>{copy.me.closedBody}</p>
                  <p>
                    <Link className="button" to="/#fund">
                      {copy.desk.fundOne}
                    </Link>
                  </p>
                </section>
                <div className="section">
                  <Perks />
                </div>
              </>
            )}
          </>
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
            {claim === 'done' && claimed > 0 ? (
              <p className="notice-plain" role="status">
                <Glyph name="check" />
                <span>{copy.desk.claimed}</span>
              </p>
            ) : null}
            <DeskHead profile={me.profile} />
            <DeskCards profile={me.profile} />
            <Follows />
            <DeskIdeas profile={me.profile} />
            <DeskBadges profile={me.profile} />
            <section className="section" aria-labelledby="me-edit">
              <h2 id="me-edit">{copy.me.editTitle}</h2>
              <Editor profile={me.profile} onSaved={me.reload} />
            </section>
            <Claim onClaimed={me.reload} />
            <PasswordSection />
          </>
        )}
      </div>
    </main>
  );
}
