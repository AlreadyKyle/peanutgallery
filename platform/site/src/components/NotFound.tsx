import { Link } from 'react-router-dom';
import { copy } from '../lib/copy';
import { PageHeader } from './PageHeader';

/**
 * The not found page: its title on the signal plate, then the message and the way home together.
 * Kernel (platform/gate/kernel-paths.txt): App.tsx answers every unknown path with it, and the Terms
 * and Refunds version pages answer a version that is not posted with it.
 */
export function NotFound() {
  return (
    <main>
      <div className="band">
        <PageHeader title={copy.notFound} />
      </div>
      <div className="band">
        <div className="prose">
          <p className="lede">{copy.notFoundBody}</p>
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
