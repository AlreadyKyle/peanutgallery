import type { SupabaseClient } from '@supabase/supabase-js';
import { Actions } from './Actions';
import { Activity, useActivity } from './Activity';
import { StudioStatus, useStudioState } from './Status';

/**
 * The board's panel at the second factor: Status first, then Activity, then Actions. It sends no
 * heartbeat; the studio runs whether or not this page is open (docs/specs/optional-board.md).
 */
export function Panel({ client }: { client: SupabaseClient }) {
  const studio = useStudioState(client);
  const activity = useActivity(client);
  return (
    <>
      <StudioStatus client={client} studio={studio} />
      <Activity client={client} activity={activity} />
      <Actions client={client} jobs={activity.jobs?.names ?? []} onStudioChanged={studio.refresh} onActivityChanged={activity.refresh} />
    </>
  );
}
