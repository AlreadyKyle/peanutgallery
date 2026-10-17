import type { SupabaseClient } from '@supabase/supabase-js';
import { Actions } from './Actions';
import { Activity, useActivity } from './Activity';
import { Community } from './Community';
import { PlayCounts } from './PlayCounts';
import { StudioStatus, useStudioState } from './Status';

/**
 * The board's panel at the second factor: Status first, then Activity, the play and share counts
 * (docs/specs/play-counts.md), then Actions, then Community admin (docs/specs/community-core.md). It sends no
 * heartbeat; the studio runs whether or not this page is open (docs/specs/optional-board.md).
 */
export function Panel({ client }: { client: SupabaseClient }) {
  const studio = useStudioState(client);
  const activity = useActivity(client);
  return (
    <>
      <StudioStatus client={client} studio={studio} />
      <Activity client={client} activity={activity} />
      <PlayCounts client={client} />
      <Actions
        client={client}
        jobs={activity.jobs?.names ?? []}
        cards={activity.actionable}
        cardsError={activity.errors.actionable}
        onStudioChanged={studio.refresh}
        onActivityChanged={activity.refresh}
      />
      <Community client={client} />
    </>
  );
}
