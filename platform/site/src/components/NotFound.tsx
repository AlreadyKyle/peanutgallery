import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { copy } from '../lib/copy';
import { PageHeader } from './PageHeader';

/**
 * The not found page: its title on the signal plate, then the message and the way home together.
 * Kernel (platform/gate/kernel-paths.txt): App.tsx answers every unknown path with it, the Terms
 * and Refunds version pages answer a version that is not posted with it, and a card's page answers an
 * id with no public card with it, saying so in `body`.
 */
export function NotFound({ body = copy.notFoundBody }: { body?: string } = {}) {
  // Netlify serves the app with a 200 at any path it does not know, so a search engine would index a
  // not found page as a real one (a soft 404). While it is drawn the page asks not to be indexed.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
  return (
    <main>
      <div className="band">
        <PageHeader title={copy.notFound} />
      </div>
      <div className="band">
        <div className="prose">
          <p className="lede">{body}</p>
          <p>
            <Link className="button" to="/">
              {copy.home}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
