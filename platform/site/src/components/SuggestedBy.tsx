import { PersonLink } from './Person';
import type { SuggestionSummary } from '../lib/community-types';
import { useCommunity } from '../lib/community';
import { copy } from '../lib/copy';
import { formatInteger } from '../lib/format';

const words = copy.cardPage;

// Suggested by (docs/specs/place.md; docs/specs/final-state.md, step 5 of the ideas loop): the players
// whose ideas a card came from, read from /api/community/card/<id>/ideas, which lists the ideas in the
// clusters the board linked to the card, most backed first. A card with none, or a read that fails,
// draws nothing: the page never shows made-up credits.
export function SuggestedBy({ cardId }: { cardId: string }) {
  const doc = useCommunity<{ items: SuggestionSummary[] }>(`/card/${cardId}/ideas`);
  if (doc.state !== 'ready' || doc.data.items.length === 0) return null;
  return (
    <section className="section" aria-labelledby="card-ideas">
      <h2 id="card-ideas">{words.ideasHeading}</h2>
      <p className="muted">{words.ideasLede}</p>
      <ul className="idea-credits">
        {doc.data.items.map((item) => (
          <li key={item.id}>
            <PersonLink person={item.author} />
            <span className="idea-credit-title">{item.title}</span>
            <span className="small muted">
              {(item.upvotes === 1 ? words.ideasUpvoteOne : words.ideasUpvoteMany).replace('{n}', formatInteger(item.upvotes))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
