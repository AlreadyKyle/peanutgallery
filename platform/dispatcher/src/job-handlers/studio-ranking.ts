// studio_ranking, the board's Rank now (docs/specs/agent-workflows.md): one attended Studio Head
// session orders the cards on now that are open for funding and hold no money on their bar or on
// hold, and apply_card_ranking has the named cards trade the ranks they hold, at most ten changes,
// with one event (step ranked; its ids and ranks stay private). Which cards are rankable comes from rankable_cards, the
// same test the ranking refuses on, so a card whose only money is a payment on hold is never
// offered. The Studio Head sees typed card fields only; a card a supporter or the community
// proposed carries no text. A failed session, or an answer that names a card it may not rank, fails
// the run and writes nothing.
import type { JobHandler } from '../jobs.js';
import { runRoleSession } from '../role-session.js';
import { schemaRepoPath, type TypedOutput } from '../typed-output.js';
import { requireWorkflow, sessionDeps, typedCard, type TypedCard } from './workflow.js';

export interface Ranking {
  order: Array<{ card_id: string; reason_code: string }>;
}

export function rankingPrompt(runId: string, cards: readonly TypedCard[], rankable: readonly string[], typed: TypedOutput): string {
  return [
    `Rank now (job run ${runId}).`,
    '',
    'The cards on now, as typed fields. A card whose source is community carries no text: rank it by its fields alone.',
    JSON.stringify(cards, null, 2),
    '',
    `Rankable: the cards on now at proposed, designing or voted with no money on their bar or on hold: ${rankable.join(', ')}.`,
    'Answer with the rankable cards in the order they should be funded, first first, each with one reason code. Name only rankable cards, each at most once; a card you leave out keeps its rank.',
    'The cards you name trade the ranks they already hold, in your order, so every other card keeps its place in line, a card with money on its bar or on hold included. A card keeps its rank when another card shares it, or when it has none and an older card without one is left out. At most ten ranks change a run: if your order needs more, the longest start of it that fits is applied. The board can set any rank afterwards.',
    '',
    `Answer with one JSON object valid against ${schemaRepoPath('ranking')} and nothing else:`,
    typed.schemaText('ranking'),
  ].join('\n');
}

export const studioRanking: JobHandler = async (context) => {
  const workflow = requireWorkflow(context);
  const role = context.role!;
  const [studio, open, rankableIds] = await Promise.all([context.db.getStudioState(), context.db.openCards(), context.db.rankableCards()]);
  const onNow = open.filter((card) => card.horizon === 'now');
  // In the order the prompt shows the cards, and only cards it shows.
  const rankable = onNow.filter((card) => rankableIds.includes(card.id)).map((card) => card.id);
  if (rankable.length === 0) {
    const applied = await context.db.applyCardRanking(context.run.id, []);
    return { rankable: 0, moves: applied.moves, unapplied: applied.unapplied };
  }
  const workspace = await workflow.openWorkspace(context.run.id);
  try {
    const session = await runRoleSession<Ranking>(
      {
        role,
        runId: context.run.id,
        label: 'head-1',
        worktree: workspace.path,
        prompt: rankingPrompt(context.run.id, onNow.map(typedCard), rankable, workflow.typed),
        schema: 'ranking',
        budgetUsd: studio.card_max_usd,
      },
      sessionDeps(context, workflow),
    );
    if (!session.ok) throw new Error(`the Studio Head's session failed: ${session.reason}`);
    const order = session.value.order.map((entry) => entry.card_id);
    const refused = order.filter((id) => !rankable.includes(id));
    if (refused.length > 0) throw new Error(`the ranking names cards that are not rankable: ${refused.join(', ')}`);
    if (new Set(order).size !== order.length) throw new Error('the ranking names a card twice');
    const applied = await context.db.applyCardRanking(context.run.id, order);
    return { session: session.ref, usd: session.usd, base_sha: workspace.baseSha, order: session.value.order, moves: applied.moves, unapplied: applied.unapplied };
  } finally {
    await workspace.close();
  }
};
