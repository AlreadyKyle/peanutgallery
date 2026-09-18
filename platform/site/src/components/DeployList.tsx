import { copy } from '../lib/copy';
import { formatDateTime, shortSha } from '../lib/format';
import type { Snapshot } from '../lib/source';

export function DeployList({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.missing.includes('deploys')) {
    return <p className="muted">{copy.partUnavailable}</p>;
  }
  if (snapshot.deploys.length === 0) {
    return <p className="muted">{copy.deploysEmpty}</p>;
  }
  return (
    <ul className="rows">
      {snapshot.deploys.map((deploy) => (
        <li key={deploy.id}>
          <span className="row-time">{formatDateTime(deploy.created_at)}</span>
          <span>
            {copy.folders[deploy.folder] ?? deploy.folder}{' '}
            <code className="muted">{shortSha(deploy.sha)}</code>{' '}
            <span className={deploy.is_green ? undefined : 'failed'}>
              {deploy.is_green ? copy.deployGreen : copy.deployNotGreen}
            </span>
            {deploy.smoke_result === null ? null : <span className="muted"> · {deploy.smoke_result}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
