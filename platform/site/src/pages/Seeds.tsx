import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, type EmptyNext } from '../components/EmptyState';
import { Glyph } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { PersonLink } from '../components/Person';
import { ShowMore } from '../components/ShowMore';
import { adoptSessionFromLocation, rpc, sendMagicLink, useSignedIn } from '../lib/account';
import { CommunityError, relativeTime, usePagedCommunity } from '../lib/community';
import type { SeedSummary } from '../lib/community-types';
import { copy } from '../lib/copy';
import { siteEnv } from '../lib/env';
import { legal } from '../lib/legal';
import { clearPendingSeed, parseSeedCode, rememberPendingSeed } from '../lib/seed-link';

// /seeds (docs/specs/final-state.md, Seeds and instances): the gallery of saved runs anyone can open.
// Sorted by Trending (a gravity score the server computes), Top this week, Top all time or New; one
// upvote or downvote per account. Play opens the game at the seed's link.
//
// /seeds?save=<code> saves a seed the game linked here to the player's profile: the code is checked
// against save_seed's rule (lib/seed-link.ts) before anything is sent; a signed-in player's save goes
// through the same-origin save_seed RPC at once, privately, and then offers to publish a copy to the
// gallery with a title; a signed-out player is asked to sign in, the code is kept in this browser,
// and /me sends them back here to finish the save when the link signs them in.

export const PLAY_SEED_URL = 'https://play.mobmachine.games/?seed=';
export type SeedSort = 'trending' | 'top_week' | 'top_all' | 'new';
const SORTS: readonly SeedSort[] = ['trending', 'top_week', 'top_all', 'new'];

export function seedLink(code: string): string {
  return `${PLAY_SEED_URL}${encodeURIComponent(code)}`;
}

/** A seed's true score from vote_seed's answer ({up, down}), or null when the answer holds no figures. */
export function scoreFrom(answer: unknown): number | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { up, down } = answer as { up?: unknown; down?: unknown };
  return typeof up === 'number' && typeof down === 'number' && Number.isFinite(up) && Number.isFinite(down) ? up - down : null;
}

type SeedPressed = { readonly seed: SeedSummary; readonly mine: -1 | 0 | 1; readonly score: number };

export function SeedTile({ seed, signedIn }: { seed: SeedSummary; signedIn: boolean }) {
  // The gallery is a public, cached document, so it cannot say how this player scored a seed, and its
  // figures may already include them. After a press the score is the one the RPC answered with and
  // the buttons show the press just made. Both belong to the seed they were read for: a reload brings
  // a new seed object and the gallery's own figures again.
  const [pressed, setPressed] = useState<SeedPressed | null>(null);
  const [busy, setBusy] = useState(false);
  const current = pressed !== null && pressed.seed === seed ? pressed : null;
  const mine = current?.mine ?? 0;
  const score = current?.score ?? seed.up - seed.down;
  const cast = (value: -1 | 1) => {
    const next = mine === value ? 0 : value;
    setBusy(true);
    rpc<unknown>('vote_seed', { id: seed.id, value: next })
      .then((answer) => setPressed({ seed, mine: next, score: scoreFrom(answer) ?? score }))
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };
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
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'limit'>('idle');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setState('sending');
    // The link lands on /me, the address sign-in is set up for; /me sends the player back here.
    sendMagicLink(email.trim(), `${window.location.origin}/me`)
      .then(() => setState('sent'))
      .catch((error: unknown) => setState(error instanceof CommunityError && error.status === 429 ? 'limit' : 'error'));
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
        {state === 'sent' ? copy.me.sent : state === 'limit' ? copy.me.tooMany : state === 'error' ? copy.me.closed : ''}
      </p>
    </form>
  );
}

export const SEED_TITLE_MAX = 60;

/**
 * After the save: publish the seed to the gallery with a title. save_seed needs a title (at most 60
 * characters) to publish and has no way to publish a seed already saved, so this saves a published
 * copy beside the private save, once.
 */
function PublishSeed({ game, code }: { game: string; code: string }) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [state, setState] = useState<'idle' | 'blank' | 'sending' | 'published' | 'error'>('idle');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (title.trim() === '') {
      setState('blank');
      return;
    }
    setState('sending');
    rpc<{ id: string }>('save_seed', { game, code, title: title.trim(), publish: true })
      .then(() => setState('published'))
      .catch(() => setState('error'));
  };
  if (state === 'published') return <p role="status">{copy.seeds.save.published}</p>;
  return (
    <form className="form seed-publish" onSubmit={submit}>
      <label htmlFor={`${id}-title`}>{copy.seeds.save.titleLabel}</label>
      <input
        id={`${id}-title`}
        type="text"
        maxLength={SEED_TITLE_MAX}
        value={title}
        aria-invalid={state === 'blank' ? true : undefined}
        aria-describedby={state === 'blank' || state === 'error' ? `${id}-hint ${id}-status` : `${id}-hint`}
        onChange={(event) => setTitle(event.currentTarget.value)}
      />
      <p className="small muted" id={`${id}-hint`}>
        {copy.seeds.save.titleHint}
      </p>
      <p>
        <button type="submit" className="button button-secondary" disabled={state === 'sending'}>
          <Glyph name="seed" />
          {state === 'sending' ? copy.seeds.save.publishing : copy.seeds.save.publish}
        </button>
      </p>
      {/* Drawn only with something to say, so the save's own line stays the section's one status. */}
      {state === 'blank' || state === 'error' ? (
        <p role="alert" className="small" id={`${id}-status`}>
          {state === 'blank' ? copy.seeds.save.needTitle : copy.seeds.save.publishFailed}
        </p>
      ) : null}
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
              {signedIn ? <PublishSeed game={seed.game} code={seed.code} /> : null}
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

/** An empty gallery's next step: play the game and save a run, or the cards to fund without a play address. */
function playNext(): EmptyNext {
  const play = siteEnv().playUrl;
  return play === '' ? { to: '/', label: copy.roadmapLink } : { to: play, label: copy.emptyState.playDust };
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
  const list = usePagedCommunity<SeedSummary>(`/seeds?sort=${sort}`);
  return (
    <main className="wide sheet">
      <div className="band">
        <PageHeader title={copy.seeds.title} lede={copy.seeds.lede} />
      </div>
      <div className="band">
        {saveCode === null ? null : <SaveFromLink raw={saveCode} />}
        <section className="section" aria-labelledby="seeds-gallery">
          <h2 id="seeds-gallery">{copy.seeds.galleryTitle}</h2>
          {/* The sorts show only while there is a list to sort. */}
          {list.state === 'unavailable' ? null : (
            <div role="group" aria-label={copy.seeds.sortLabel} className="filters">
              {SORTS.map((key) => (
                <button key={key} type="button" className="filter" aria-pressed={sort === key} onClick={() => setSort(key)}>
                  {sort === key ? <Glyph name="check" /> : null}
                  {copy.seeds.sorts[key]}
                </button>
              ))}
            </div>
          )}
          {list.state === 'loading' ? (
            <p className="muted" aria-busy="true">
              {copy.seeds.loading}
            </p>
          ) : list.state === 'unavailable' ? (
            <EmptyState line={legal.partUnavailable} next={playNext()} unavailable onRetry={list.reload} />
          ) : list.items.length === 0 ? (
            <EmptyState line={copy.seeds.empty} next={playNext()} />
          ) : (
            <>
              <ul className="seed-grid">
                {list.items.map((seed) => (
                  <SeedTile key={seed.id} seed={seed} signedIn={signedIn} />
                ))}
              </ul>
              {list.hasMore ? (
                <ShowMore
                  label={copy.seeds.more}
                  loadingLabel={copy.seeds.loadingMore}
                  failedLine={copy.seeds.moreFailed}
                  loading={list.loadingMore}
                  failed={list.moreFailed}
                  onMore={list.loadMore}
                />
              ) : null}
            </>
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
