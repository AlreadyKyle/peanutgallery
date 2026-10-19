import { legal } from '../lib/legal';
import { formatDateTime, shortSha } from '../lib/format';
import type { Snapshot } from '../lib/source';

// A deploy reads "Dust update passed checks", with the commit in the row's tooltip, since a commit
// code means nothing to most readers. The smoke bot's raw output stays in the database: it
// is inside text ("bot: 812 simulated seconds, 13 unlocks"), not something a reader can use. Rail
// rows, the same shape as the agent actions, so the two lists on /ledger line up.
export function DeployList({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.missing.includes('deploys')) {
    return <p className="muted">{legal.partUnavailable}</p>;
  }
  if (snapshot.deploys.length === 0) {
    return <p className="muted">{legal.deploysEmpty}</p>;
  }
  return (
    <ul className="rows rail">
      {snapshot.deploys.map((deploy) => (
        <li key={deploy.id}>
          <span className="row-time">{formatDateTime(deploy.created_at)}</span>
          <span className="row-body" title={legal.deployCommit.replace('{sha}', shortSha(deploy.sha))}>
            {legal.folders[deploy.folder] ?? deploy.folder}{' '}
            <span className={deploy.is_green ? undefined : 'failed'}>
              {deploy.is_green ? legal.deployGreen : legal.deployNotGreen}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
