import { copy } from '../lib/copy';
import { formatDateTime, shortSha } from '../lib/format';
import type { Snapshot } from '../lib/source';

export function DeployList({ snapshot }: { snapshot: Snapshot }) {
  if (snapshot.deploys.length === 0) {
    return <p>{copy.deploysEmpty}</p>;
  }
  return (
    <ul className="deploys">
      {snapshot.deploys.map((deploy) => (
        <li key={deploy.id}>
          <span className="event-time">{formatDateTime(deploy.created_at)}</span>
          <span>{deploy.folder}</span>
          <code>{shortSha(deploy.sha)}</code>
          <span className={deploy.is_green ? 'green' : 'red'}>
            {deploy.is_green ? copy.deployGreen : copy.deployNotGreen}
          </span>
          {deploy.smoke_result === null ? null : <span>{deploy.smoke_result}</span>}
        </li>
      ))}
    </ul>
  );
}
