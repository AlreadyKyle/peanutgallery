// studio_ranking, the board's Rank now (docs/specs/agent-workflows.md): one attended Studio Head
// session orders the cards on now that are open for funding and hold no money, and
// apply_card_ranking writes rank only, at most ten changes, with one public event of ids and
// positions. The Studio Head sees typed card fields only; a card a supporter or the community
// proposed carries no text. A failed session, or an answer that names a card it may not rank, fails
// the run and writes nothing.
import type { JobHandler } from '../jobs.js';
import { runRoleSession } from '../role-session.js';
import { schemaRepoPath, type TypedOutput } from '../typed-output.js';
import { requireWorkflow, sessionDeps, typedCard, type TypedCard } from './workflow.js';

export interface Ranking {
  order: Array<{ card_id: string; reason_code: string }>;
}

const OPEN_STAGES = ['proposed', 'designing', 'voted'];

export function rankingPrompt(runId: string, cards: readonly TypedCard[], rankable: readonly string[], typed: TypedOutput): string {
  return [
    `Rank now (job run ${runId}).`,
    '',
    'The cards on now, as typed fields. A card whose source is community carries no text: rank it by its fields alone.',
    JSON.stringify(cards, null, 2),
    '',
    `Rankable: the cards on now at proposed, designing or voted with no money on their bar: ${rankable.join(', ')}.`,
    'Answer with the rankable cards in the order they should be funded, first first, each with one reason code. Name only rankable cards, each at most once; a card you leave out keeps its rank.',
    'The card at position n gets rank n. At most ten changes are applied, in your order. A card with money on its bar or on hold keeps its place, and the board can set any rank afterwards.',
    '',
    `Answer with one JSON object valid against ${schemaRepoPath('ranking')} and nothing else:`,
    typed.schemaText('ranking'),
  ].join('\n');
}

export const studioRanking: JobHandler = async (context) => {
  const workflow = requireWorkflow(context);
  const role = context.role!;
  const [studio, open] = await Promise.all([context.db.getStudioState(), context.db.openCards()]);
  const onNow = open.filter((card) => card.horizon === 'now');
  const rankable = onNow.filter((card) => OPEN_STAGES.includes(card.stage) && card.funded_usd === 0).map((card) => card.id);
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
