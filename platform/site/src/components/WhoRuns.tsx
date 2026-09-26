import { legal } from '../lib/legal';
import { LinkedText } from './TextPage';

/**
 * Who runs the studio (docs/specs/copy-pass.md): the board by name, what it can do, what it files and
 * its standing duties, in legal.ts's words. On /how-it-works and at the foot of /team. It names no
 * public list of the board's actions, since none exists.
 */
export function WhoRuns({ id }: { id: string }) {
  const who = legal.whoRuns;
  return (
    <section className="section" aria-labelledby={id} data-who-runs="">
      <h2 id={id}>{who.heading}</h2>
      <div className="prose">
        {who.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        <p>{who.dutiesIntro}</p>
        <ul className="rules">
          {who.duties.map((duty) => (
            <li key={duty}>
              <LinkedText text={duty} />
            </li>
          ))}
        </ul>
        <p>{who.dutiesOutro}</p>
      </div>
    </section>
  );
}
