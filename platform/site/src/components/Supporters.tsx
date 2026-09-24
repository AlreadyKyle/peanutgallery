import type { Supporter } from '../lib/card-source';
import { formatInteger } from '../lib/format';
import { legal } from '../lib/legal';

// Kernel (docs/specs/supporter-pages.md): the supporters a card's money came from, each only as a
// number (and founding when it is), in number order: the first 24 the document carries, then "and n
// more". No amount, time or name, ever.

/** "Supporter 12" or "Founding supporter 12". */
export function supporterName(supporter: Supporter): string {
  return (supporter.founding ? legal.foundingSupporter : legal.supporter).replace('{n}', formatInteger(supporter.number));
}

export function Supporters({ supporters, count }: { supporters: readonly Supporter[]; count: number }) {
  if (supporters.length === 0) return <p className="muted">{legal.supportersNone}</p>;
  const shown = [...supporters].sort((a, b) => a.number - b.number);
  const more = Math.max(0, count - shown.length);
  return (
    <>
      <ul className="supporters">
        {shown.map((supporter) => (
          <li key={supporter.number} data-founding={supporter.founding ? 'true' : undefined}>
            {supporterName(supporter)}
          </li>
        ))}
      </ul>
      {more === 0 ? null : <p className="muted supporters-more">{legal.supportersMore.replace('{n}', formatInteger(more))}</p>}
    </>
  );
}
