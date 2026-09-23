// Picks the adapter for the configured mode. Attended mode runs Claude Code on the founder's Mac;
// unattended mode runs Managed Agents sessions and refuses to exist without the studio key, the
// managed ids, the read-only token and the ledger it meters to, so a misconfigured process fails
// here, before any session or probe.
import type { Alerter } from '../alert.js';
import type { DispatcherConfig } from '../config.js';
import type { Db } from '../db.js';
import type { Logger } from '../log.js';
import type { PatchStore } from '../patch.js';
import { AttendedAdapter } from './attended.js';
import { ManagedAdapter } from './managed.js';
import { sdkManagedClient, type ManagedClient } from './managed-client.js';
import { loadManagedFiles } from './managed-config.js';
import type { AgentAdapter } from './types.js';
import { STUDIO_KEY_ENV } from './unattended.js';

export interface AdapterDeps {
  db: Pick<Db, 'recordUsage' | 'getCard'>;
  alert: Alerter;
  log: Logger;
  patches: PatchStore | null;
  // Tests pass a fake; production builds the SDK client on the studio key.
  client?: ManagedClient;
  fetchFn?: typeof fetch;
}

export function createAdapter(config: DispatcherConfig, deps?: AdapterDeps): AgentAdapter {
  if (config.agentMode === 'unattended') {
    const key = config.studioAnthropicApiKey?.trim() ?? '';
    if (key.length === 0) throw new Error(`${STUDIO_KEY_ENV} is required in unattended mode`);
    const managed = config.managed;
    if (!managed) throw new Error('GITHUB_READ_TOKEN and the managed agent and environment ids are required in unattended mode');
    if (!deps) throw new Error('unattended mode meters to the ledger, so the adapter needs the database, the alerter and the log');
    return new ManagedAdapter({
      client: deps.client ?? sdkManagedClient(key),
      files: loadManagedFiles(config.codeRoot),
      agentId: managed.agentId,
      agentVersion: managed.agentVersion,
      environmentId: managed.environmentId,
      githubRepo: config.githubRepo,
      readToken: managed.readToken,
      priceTable: config.priceTable,
      probeModel: config.modelBuilder,
      db: deps.db,
      patches: deps.patches,
      alert: deps.alert,
      log: deps.log,
      fetchFn: deps.fetchFn,
    });
  }
  return new AttendedAdapter({ claudeBin: config.claudeBin, repoRoot: config.repoRoot });
}
