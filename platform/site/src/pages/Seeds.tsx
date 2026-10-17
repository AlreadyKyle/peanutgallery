import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Glyph } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { PersonLink } from '../components/Person';
import { adoptSessionFromLocation, rpc, sendMagicLink, useSignedIn } from '../lib/account';
import { CommunityError, relativeTime, useCommunity } from '../lib/community';
import type { PageDoc, SeedSummary } from '../lib/community-types';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';
import { clearPendingSeed, parseSeedCode, rememberPendingSeed } from '../lib/seed-link';

// /seeds (docs/specs/final-state.md, Seeds and instances): the gallery of saved runs anyone can open.
// Sorted by Trending (a gravity score the server computes), Top this week, Top all time or New; one
// upvote or downvote per account. Play opens the game at the seed's link.
//
// /seeds?save=<code> saves a seed the game linked here to the player's profile: the code is checked
// against save_seed's rule (lib/seed-link.ts) before anything is sent; a signed-in player's save goes
// through the same-origin save_seed RPC at once; a signed-out player is asked to sign in, the code is
// kept in this browser, and /me sends them back here to finish the save when the link signs them in.

export const PLAY_SEED_URL = 'https://play.mobmachine.games/?seed=';
export type SeedSort = 'trending' | 'top_week' | 'top_all' | 'new';
const SORTS: readonly SeedSort[] = ['trending', 'top_week', 'top_all', 'new'];

export function seedLink(code: string): string {
  return `${PLAY_SEED_URL}${encodeURIComponent(code)}`;
}

export function SeedTile({ seed, signedIn }: { seed: SeedSummary; signedIn: boolean }) {
  const [mine, setMine] = useState<-1 | 0 | 1>(0);
  const [busy, setBusy] = useState(false);
  const cast = (value: -1 | 1) => {
    const next = mine === value ? 0 : value;
    setBusy(true);
    rpc('vote_seed', { id: seed.id, value: next })
      .then(() => setMine(next))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
  const score = seed.up - seed.down + mine;
  return (
    <li className="seed" data-featured={seed.featured ? 'true' : undefined}>
      <p className="seed-index">
        <span className="tag">
          <Glyph name="seed" />
          {seed.game}
        </span>
        {seed.featured ? (
          <span className="tag">
            <Glyph name="badge" />
            {copy.seeds.featured}
          </span>
        ) : null}
      </p>
      <h3>{seed.title}</h3>
      <p className="seed-meta small muted">
        <PersonLink person={seed.author} />
        <span>{relativeTime(seed.createdAt)}</span>
      </p>
      <p className="seed-code">
        <code>{seed.code.length > 28 ? `${seed.code.slice(0, 28)}...` : seed.code}</code>
      </p>
      <div className="seed-foot">
        <div className="seed-score" role="group" aria-label={copy.seeds.scoreLabel.replace('{title}', seed.title)}>
          {signedIn ? (
            <>
              <button type="button" className="upvote-button" aria-pressed={mine === 1} disabled={busy} onClick={() => cast(1)} aria-label={copy.seeds.up}>
                <Glyph name="thumb-up" />
              </button>
              <span className="upvote-count">{score}</span>
              <button type="button" className="upvote-button" aria-pressed={mine === -1} disabled={busy} onClick={() => cast(-1)} aria-label={copy.seeds.down}>
                <Glyph name="thumb-down" />
              </button>
            </>
          ) : (
            <span className="small">
              <span className="upvote-count">{score}</span> {copy.seeds.score}
            </span>
          )}
        </div>
        <a className="button" href={seedLink(seed.code)} aria-label={copy.seeds.playNamed.replace('{title}', seed.title)}>
          <Glyph name="play" />
          {copy.seeds.play}
        </a>
      </div>
    </li>
  );
}

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved'; id: string } | { kind: 'failed' };

function SaveSignIn() {
  const id = useId();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setState('sending');
    // The link lands on /me, the address sign-in is set up for; /me sends the player back here.
    sendMagicLink(email.trim(), `${window.location.origin}/me`)
      .then(() => setState('sent'))
      .catch(() => setState('error'));
  };
  return (
    <form className="form" onSubmit={submit}>
      <label htmlFor={`${id}-email`}>{copy.me.emailLabel}</label>
      <input id={`${id}-email`} type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.currentTarget.value)} />
      <p>
        <button type="submit" className="button" disabled={state === 'sending'}>
          {state === 'sending' ? copy.me.sending : copy.me.send}
        </button>
      </p>
      <p role="status" className="small">
        {state === 'sent' ? copy.me.sent : state === 'error' ? copy.me.closed : ''}
      </p>
    </form>
  );
}

/** The seed a link asked to save: checked, then saved once for a signed-in player, or kept until they sign in. */
export function SaveFromLink({ raw }: { raw: string }) {
  const signedIn = useSignedIn();
  const seed = parseSeedCode(raw);
  const code = seed?.code ?? null;
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const started = useRef(false);
  useEffect(() => {
    const parsed = parseSeedCode(code);
    if (parsed === null) return;
    if (!signedIn) {
      rememberPendingSeed(parsed.code);
      return;
    }
    if (started.current) return;
    started.current = true;
    setState({ kind: 'saving' });
    rpc<{ id: string }>('save_seed', { game: parsed.game, code: parsed.code, title: null, publish: false })
      .then((answer) => {
        clearPendingSeed();
        setState({ kind: 'saved', id: String(answer.id) });
      })
      .catch((error: unknown) => {
        // A session that ran out reads as signed out, and the save waits for sign-in again.
        if (error instanceof CommunityError && error.status === 401) {
          started.current = false;
          setState({ kind: 'idle' });
          return;
        }
        clearPendingSeed();
        setState({ kind: 'failed' });
      });
  }, [code, signedIn]);

  return (
    <section className="section seed-save" aria-labelledby="seeds-save">
      <h2 id="seeds-save">{copy.seeds.save.title}</h2>
      {seed === null ? (
        <p>{copy.seeds.save.bad}</p>
      ) : (
        <>
          <p className="small muted">{copy.seeds.save.game.replace('{game}', seed.game).replace('{n}', String(seed.version))}</p>
          <p className="seed-code">
            <code>{seed.code.length > 40 ? `${seed.code.slice(0, 40)}...` : seed.code}</code>
          </p>
          {!signedIn && state.kind !== 'saved' ? (
            <>
              <p>{copy.seeds.save.signedOut}</p>
              <SaveSignIn />
            </>
          ) : state.kind === 'saved' ? (
            <>
              <p role="status">{copy.seeds.save.saved}</p>
              <p className="me-links">
                <a className="button" href={seedLink(seed.code)}>
                  <Glyph name="play" />
                  {copy.seeds.save.play}
                </a>
                <Link to="/me">
                  {copy.seeds.save.seeProfile}
                  <Glyph name="arrow-right" />
                </Link>
              </p>
            </>
          ) : state.kind === 'failed' ? (
            <p role="status">{copy.seeds.save.failed}</p>
          ) : (
            <p role="status" className="muted" aria-busy="true">
              {copy.seeds.save.saving}
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function Seeds() {
  const signedIn = useSignedIn();
  const [params, setParams] = useSearchParams();
  // Read once: after a save the address drops ?save=, so a reload does not save the seed again.
  const [saveCode] = useState(() => params.get('save'));
  useEffect(() => {
    adoptSessionFromLocation();
  }, []);
  useEffect(() => {
    if (saveCode !== null && signedIn && params.has('save')) {
      const next = new URLSearchParams(params);
      next.delete('save');
      setParams(next, { replace: true });
    }
  }, [saveCode, signedIn, params, setParams]);
  const [sort, setSort] = useState<SeedSort>('trending');
  const list = useCommunity<PageDoc<SeedSummary>>(`/seeds?sort=${sort}`);
  return (
    <main className="wide sheet">
      <div className="band">
        <PageHeader title={copy.seeds.title} lede={copy.seeds.lede} />
      </div>
      <div className="band">
        {saveCode === null ? null : <SaveFromLink raw={saveCode} />}
        <section className="section" aria-labelledby="seeds-gallery">
          <h2 id="seeds-gallery">{copy.seeds.galleryTitle}</h2>
          <div role="group" aria-label={copy.seeds.sortLabel} className="filters">
            {SORTS.map((key) => (
              <button key={key} type="button" className="filter" aria-pressed={sort === key} onClick={() => setSort(key)}>
                {sort === key ? <Glyph name="check" /> : null}
                {copy.seeds.sorts[key]}
              </button>
            ))}
          </div>
          {list.state === 'loading' ? (
            <p className="muted" aria-busy="true">
              {copy.seeds.loading}
            </p>
          ) : list.state === 'unavailable' ? (
            <p className="muted">{legal.partUnavailable}</p>
          ) : list.data.items.length === 0 ? (
            <p className="muted">{copy.seeds.empty}</p>
          ) : (
            <ul className="seed-grid">
              {list.data.items.map((seed) => (
                <SeedTile key={seed.id} seed={seed} signedIn={signedIn} />
              ))}
            </ul>
          )}
        </section>
        <section className="section" aria-labelledby="seeds-how">
          <h2 id="seeds-how">{copy.seeds.howTitle}</h2>
          <p>{copy.seeds.how}</p>
          {signedIn ? null : (
            <p>
              <Link to="/me">{copy.seeds.signIn}</Link>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
