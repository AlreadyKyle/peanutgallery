import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Glyph } from '../components/Glyph';
import { PageHeader } from '../components/PageHeader';
import { PersonLink } from '../components/Person';
import { rpc, useSignedIn } from '../lib/account';
import { relativeTime, useCommunity } from '../lib/community';
import type { PageDoc, SeedSummary } from '../lib/community-types';
import { copy } from '../lib/copy';
import { legal } from '../lib/legal';

// /seeds (docs/specs/final-state.md, Seeds and instances): the gallery of saved runs anyone can open.
// Sorted by Trending (a gravity score the server computes), Top this week, Top all time or New; one
// upvote or downvote per account. Play opens the game at the seed's link.

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

export function Seeds() {
  const signedIn = useSignedIn();
  const [sort, setSort] = useState<SeedSort>('trending');
  const list = useCommunity<PageDoc<SeedSummary>>(`/seeds?sort=${sort}`);
  return (
    <main className="wide">
      <div className="band">
        <PageHeader title={copy.seeds.title} lede={copy.seeds.lede} />
      </div>
      <div className="band">
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
