import { legal } from '../lib/legal';
import { copy } from '../lib/copy';
import { MoreLink } from './MoreLink';

/**
 * Who runs the studio (docs/specs/copy-pass.md, docs/specs/governance-copy.md): the owner by name,
 * what he can do and what he files, in legal.ts's words (his standing duties stay in PLAN.md). On
 * /how-it-works and at the foot of /team. It names no public list of the owner's actions, since none
 * exists.
 */
export function WhoRuns({ id, brief = false }: { id: string; brief?: boolean }) {
  const who = legal.whoRuns;
  const [lede, owner, agents] = who.paragraphs;
  // /team says it once and links the whole block on /how-it-works, so the page does not repeat it.
  if (brief)
    return (
      <section className="section who-runs" aria-labelledby={id} data-who-runs="brief">
        <h2 id={id}>{who.heading}</h2>
        <p className="who-lede">{lede}</p>
        <MoreLink to="/how-it-works#how-who">{copy.team.whoRunsLink}</MoreLink>
      </section>
    );
  // The lede, then two tiles side by side: who acts on their own, and when the owner steps in.
  return (
    <section className="section who-runs" aria-labelledby={id} data-who-runs="">
      <h2 id={id}>{who.heading}</h2>
      <p className="who-lede">{lede}</p>
      <div className="who-tiles">
        <div className="who-tile">
          <p className="who-label">{who.agentsLabel}</p>
          <p>{agents}</p>
        </div>
        <div className="who-tile">
          <p className="who-label">{who.ownerLabel}</p>
          <p>{owner}</p>
        </div>
      </div>
    </section>
  );
}
