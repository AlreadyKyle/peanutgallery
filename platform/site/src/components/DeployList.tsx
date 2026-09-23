import { legal } from '../lib/legal';
import { formatDateTime, shortSha } from '../lib/format';
import type { Snapshot } from '../lib/source';

// A deploy reads "Game 2775bcb passed checks". The smoke bot's raw output stays in the database: it
// is inside text ("bot: 812 simulated seconds, 13 unlocks"), not something a reader can use.
export function DeployList({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.missing.includes('deploys')) {
    return <p className="muted">{legal.partUnavailable}</p>;
  }
  if (snapshot.deploys.length === 0) {
    return <p className="muted">{legal.deploysEmpty}</p>;
  }
  return (
    <ul className="rows">
      {snapshot.deploys.map((deploy) => (
        <li key={deploy.id}>
          <span className="row-time">{formatDateTime(deploy.created_at)}</span>
          <span>
            {legal.folders[deploy.folder] ?? deploy.folder}{' '}
            <code className="muted">{shortSha(deploy.sha)}</code>{' '}
            <span className={deploy.is_green ? undefined : 'failed'}>
              {deploy.is_green ? legal.deployGreen : legal.deployNotGreen}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
