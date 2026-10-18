import { useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Glyph, type GlyphName } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { PersonLink } from '../components/Person';
import { ShowMore } from '../components/ShowMore';
import { rpc, useSignedIn } from '../lib/account';
import { CommunityError, relativeTime, usePagedCommunity } from '../lib/community';
import type { DeclineReason, SuggestionState, SuggestionSummary } from '../lib/community-types';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';

// /suggest (docs/specs/final-state.md, Suggestions): the crowd's suggestions, sorted by top or new
// and filtered by area, each with its upvotes, its state in words and, when declined, the reason from
// the fixed list. Signed-in players submit one in a fixed shape: an area, a title of at most 80
// characters and a description of at most 500. The page says plainly what happens next: a review
// agent with no tools reads it, and no agent that builds ever sees the player's words.

export const SUGGESTION_AREAS = ['dust', 'new_game', 'site', 'studio'] as const;
export const TITLE_MAX = 80;
export const BODY_MAX = 500;

const STATE_GLYPHS: Record<SuggestionState, GlyphName> = {
  received: 'plane',
  reviewed: 'checklist',
  clustered: 'blocks',
  drafted: 'pencil',
  open: 'coin-outline',
  building: 'gear',
  live: 'stamp',
  declined: 'crossed-card',
};

function StateChip({ suggestion }: { suggestion: SuggestionSummary }) {
  return (
    <span className="tag state-chip" data-state={suggestion.state}>
      <Glyph name={STATE_GLYPHS[suggestion.state]} />
      {copy.suggest.states[suggestion.state]}
    </span>
  );
}

function declineWords(reason: DeclineReason | null): string {
  return reason === null ? copy.suggest.decline.none : copy.suggest.decline[reason];
}

/** The suggestion's true total from vote_suggestion's answer: the one figure its object holds. */
export function totalFrom(answer: unknown): number | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const figure = Object.values(answer).find((value) => typeof value === 'number');
  return typeof figure === 'number' && Number.isFinite(figure) ? Math.max(0, Math.round(figure)) : null;
}

type Pressed = { readonly item: SuggestionSummary; readonly upvoted: boolean; readonly total: number };

export function Suggestion({ item, signedIn }: { item: SuggestionSummary; signedIn: boolean }) {
  // The list is a public, cached document, so it cannot say whether this player upvoted, and its count
  // may already include them. After a press the count is the total the RPC answered with and the
  // button shows the press just made. Both belong to the item they were read for: a reload brings a
  // new item and the list's own count again.
  const [pressed, setPressed] = useState<Pressed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mine = pressed !== null && pressed.item === item ? pressed : null;
  const upvoted = mine?.upvoted ?? false;
  const upvotes = mine?.total ?? item.upvotes;
  const upvote = () => {
    const value = upvoted ? 0 : 1;
    setBusy(true);
    setError('');
    rpc<unknown>('vote_suggestion', { id: item.id, value })
      .then((answer) => setPressed({ item, upvoted: value === 1, total: totalFrom(answer) ?? upvotes }))
      .catch(() => setError(copy.suggest.upvoteFailed))
      .finally(() => setBusy(false));
  };
  return (
    <li className="suggestion" data-state={item.state}>
      <div className="suggestion-upvotes">
        {signedIn && item.state !== 'declined' ? (
          <button type="button" className="upvote-button" aria-pressed={upvoted} onClick={upvote} disabled={busy} aria-label={copy.suggest.backIdea.replace('{title}', item.title)}>
            <Glyph name={upvoted ? 'check' : 'thumb-up'} />
            <span className="upvote-count">{upvotes}</span>
          </button>
        ) : (
          <p className="upvote-static">
            <span className="upvote-count">{upvotes}</span> <span className="small muted">{upvotes === 1 ? copy.suggest.upvoteOne : copy.suggest.upvoteMany}</span>
          </p>
        )}
      </div>
      <div className="suggestion-text">
        <p className="suggestion-index">
          <StateChip suggestion={item} />
          <span className="muted small">{copy.suggest.areas[item.area as (typeof SUGGESTION_AREAS)[number]] ?? item.area}</span>
        </p>
        <h3>{item.title}</h3>
        {item.summary === null ? null : (
          <p>
            <span className="muted small">{copy.suggest.summaryLabel}</span> {item.summary}
          </p>
        )}
        {item.state === 'declined' ? <p className="small">{copy.suggest.declinedBecause.replace('{reason}', declineWords(item.declineReason))}</p> : null}
        <p className="suggestion-meta small muted">
          <PersonLink person={item.author} />
          <span>{relativeTime(item.createdAt)}</span>
          {item.cardId === null ? null : <Link to={`/card/${item.cardId}`}>{copy.suggest.seeCard}</Link>}
        </p>
        {error === '' ? null : (
          <p className="small" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}

function SubmitForm({ onSent }: { onSent: () => void }) {
  const id = useId();
  const [area, setArea] = useState<string>(SUGGESTION_AREAS[0]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [state, setState] = useState<'idle' | 'blank' | 'sending' | 'sent' | 'error' | 'limit'>('idle');
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleBlank = state === 'blank' && title.trim() === '';
  const bodyBlank = state === 'blank' && body.trim() === '';
  const submit = (event: FormEvent) => {
    event.preventDefault();
    // `required` lets a field of only spaces through; the RPC would refuse it, so say so here.
    if (title.trim() === '' || body.trim() === '') {
      setState('blank');
      (title.trim() === '' ? titleRef.current : bodyRef.current)?.focus();
      return;
    }
    setState('sending');
    rpc('submit_suggestion', { area, title: title.trim(), body: body.trim() })
      .then(() => {
        setState('sent');
        setTitle('');
        setBody('');
        onSent();
      })
      .catch((error: unknown) => setState(error instanceof CommunityError && error.status === 429 ? 'limit' : 'error'));
  };
  return (
    <form className="form suggest-form" onSubmit={submit} aria-describedby={`${id}-notice`}>
      <p className="notice-plain" id={`${id}-notice`}>
        <Glyph name="checklist" />
        <span>{copy.suggest.safety}</span>
      </p>
      <label htmlFor={`${id}-area`}>{copy.suggest.areaLabel}</label>
      <select id={`${id}-area`} value={area} onChange={(event) => setArea(event.currentTarget.value)}>
        {SUGGESTION_AREAS.map((key) => (
          <option key={key} value={key}>
            {copy.suggest.areas[key]}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-title`}>{copy.suggest.titleLabel}</label>
      <input
        id={`${id}-title`}
        ref={titleRef}
        type="text"
        value={title}
        maxLength={TITLE_MAX}
        required
        aria-invalid={titleBlank ? true : undefined}
        onChange={(event) => setTitle(event.currentTarget.value)}
        aria-describedby={`${id}-title-count${titleBlank ? ` ${id}-status` : ''}`}
      />
      <p className="small muted field-count" id={`${id}-title-count`}>
        {copy.suggest.left.replace('{n}', String(TITLE_MAX - title.length))}
      </p>
      <label htmlFor={`${id}-body`}>{copy.suggest.bodyLabel}</label>
      <textarea
        id={`${id}-body`}
        ref={bodyRef}
        value={body}
        maxLength={BODY_MAX}
        rows={5}
        required
        aria-invalid={bodyBlank ? true : undefined}
        onChange={(event) => setBody(event.currentTarget.value)}
        aria-describedby={`${id}-body-count ${id}-body-hint${bodyBlank ? ` ${id}-status` : ''}`}
      />
      <p className="small muted field-count" id={`${id}-body-count`}>
        {copy.suggest.left.replace('{n}', String(BODY_MAX - body.length))}
      </p>
      <p className="small muted" id={`${id}-body-hint`}>
        {copy.suggest.bodyHint}
      </p>
      <p>
        <button type="submit" className="button" disabled={state === 'sending'}>
          <Glyph name="plane" />
          {state === 'sending' ? copy.suggest.sending : copy.suggest.send}
        </button>
      </p>
      <p role="status" className="small" id={`${id}-status`}>
        {state === 'sent'
          ? copy.suggest.sent
          : state === 'limit'
            ? copy.suggest.limit
            : state === 'error'
              ? copy.suggest.failed
              : state === 'blank'
                ? copy.suggest.blank
                : ''}
      </p>
    </form>
  );
}

export function Suggest() {
  const signedIn = useSignedIn();
  const [sort, setSort] = useState<'top' | 'new'>('top');
  const [area, setArea] = useState<string>('all');
  const query = `/suggestions?sort=${sort}${area === 'all' ? '' : `&area=${encodeURIComponent(area)}`}`;
  const list = usePagedCommunity<SuggestionSummary>(query);
  const filterId = useId();
  return (
    <main className="wide sheet">
      <div className="band">
        <PageHeader title={copy.suggest.title} lede={copy.suggest.lede} />
      </div>
      <div className="band">
        <section className="section" aria-labelledby="suggest-send">
          <h2 id="suggest-send">{copy.suggest.sendTitle}</h2>
          {signedIn ? (
            <SubmitForm onSent={list.reload} />
          ) : (
            <>
              <p>{copy.suggest.signInFirst}</p>
              <p className="notice-plain">
                <Glyph name="checklist" />
                <span>{copy.suggest.safety}</span>
              </p>
              <p>
                <Link className="button" to="/me">
                  {copy.suggest.signIn}
                </Link>
              </p>
            </>
          )}
        </section>
        <section className="section" aria-labelledby="suggest-list">
          <h2 id="suggest-list">{copy.suggest.listTitle}</h2>
          {/* The sort and the area filter show only while there is a list to sort. */}
          {list.state === 'unavailable' ? null : (
            <div className="list-controls">
              <div role="group" aria-label={copy.suggest.sortLabel} className="filters">
                {(['top', 'new'] as const).map((key) => (
                  <button key={key} type="button" className="filter" aria-pressed={sort === key} onClick={() => setSort(key)}>
                    {sort === key ? <Glyph name="check" /> : null}
                    {copy.suggest.sorts[key]}
                  </button>
                ))}
              </div>
              <label className="inline-select" htmlFor={filterId}>
                <span>{copy.suggest.areaFilter}</span>
                <select id={filterId} value={area} onChange={(event) => setArea(event.currentTarget.value)}>
                  <option value="all">{copy.suggest.allAreas}</option>
                  {SUGGESTION_AREAS.map((key) => (
                    <option key={key} value={key}>
                      {copy.suggest.areas[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {list.state === 'loading' ? (
            <p className="muted" aria-busy="true">
              {copy.suggest.loading}
            </p>
          ) : list.state === 'unavailable' ? (
            <EmptyState line={legal.partUnavailable} next={{ to: '/', label: copy.roadmapLink }} unavailable onRetry={list.reload} />
          ) : list.items.length === 0 ? (
            <EmptyState line={copy.suggest.empty} next={{ to: '#suggest-send', label: copy.emptyState.sendFirst }} />
          ) : (
            <>
              <ol className="suggestions">
                {list.items.map((item) => (
                  <Suggestion key={item.id} item={item} signedIn={signedIn} />
                ))}
              </ol>
              {list.hasMore ? (
                <ShowMore
                  label={copy.suggest.more}
                  loadingLabel={copy.suggest.loadingMore}
                  failedLine={copy.suggest.moreFailed}
                  loading={list.loadingMore}
                  failed={list.moreFailed}
                  onMore={list.loadMore}
                />
              ) : null}
            </>
          )}
        </section>
        <section className="section" aria-labelledby="suggest-how">
          <h2 id="suggest-how">{copy.suggest.howTitle}</h2>
          <ol className="steps-list">
            {copy.suggest.how.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <h3>{copy.suggest.declineTitle}</h3>
          <ul className="plain-list">
            {(Object.keys(copy.suggest.decline) as (keyof typeof copy.suggest.decline)[])
              .filter((key) => key !== 'none')
              .map((key) => (
                <li key={key}>{copy.suggest.decline[key]}</li>
              ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
