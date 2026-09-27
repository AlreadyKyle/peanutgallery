import builderA from '../../agents/builder-a.json';
import builderB from '../../agents/builder-b.json';
import gameDesigner from '../../agents/game-designer.json';
import gameDirector from '../../agents/game-director.json';
import janitor from '../../agents/janitor.json';
import platformBuilder from '../../agents/platform-builder.json';
import platformDirector from '../../agents/platform-director.json';
import qa from '../../agents/qa.json';
import studioHead from '../../agents/studio-head.json';
import { copy } from '../../site/src/lib/copy';
import { legal } from '../../site/src/lib/legal';
import { formatUsd } from '../../site/src/lib/format';
import { exampleFromPaid } from '../../site/src/lib/payment';

// Everything the video shows comes from the studio's own sources: the words from the site's copy and
// legal files, the agents from their role specs, the card titles from the live deck, the money from
// the site's worked example. Nothing is made up for the picture (docs/specs/explainer-video.md).

export const script = legal.explainer;

/** The site's address, shown on the social cuts' closing plate only (docs/ROADMAP.md, Standing facts:
 *  the domain stays peanutgallery.games until the board registers a new one). The site's own cuts
 *  name no address, so a new domain never leaves them wrong. */
export const SITE_ADDRESS = 'peanutgallery.games';
export const stepHeadings = legal.howMoneyMoves.blocks.map((block) => block.heading);

/** The agents drawn in the team scene: every role whose spec says it is running (data.test.ts). */
export const roster = [builderA, builderB, qa, gameDesigner, gameDirector, studioHead, platformBuilder, platformDirector, janitor].map((role) => ({
  title: role.title,
  note: role.species_note,
}));

/** The builder the card is dealt to. */
export const builder = { title: builderA.title, note: builderA.species_note };

// Real cards from the live deck (https://peanutgallery.games/api/cards, read 27 Sep 2026): open game
// cards for the hand, and shipped ones for the pile. The video names no game (PLAN.md §10 decision
// 57), so only cards whose titles do not say "dust" are dealt. The third card is the one followed.
export const hand = [
  'Add Quiet rooms, a fourteenth unlock after Polished rails',
  'Rename the Gatherer to Sweeper',
  'Show how long until the next unlock',
  'Stop the unlock count from showing more unlocks than exist',
] as const;
export const HERO = 2;
export const shipped = [
  "The game's tab shows its name and icon, and the page links to the studio",
  'The unlock list fits any number of unlocks',
  'The game keeps your progress when you reload the page',
] as const;

/** An agent step's fixed public line (copy.eventLines), in its one-event form. */
function eventLine(key: string): string {
  const line = copy.eventLines[key]?.one;
  if (line === undefined) throw new Error(`copy.eventLines has no ${key}`);
  return line;
}

/** The site's words the picture labels things with. */
export const labels = {
  open: copy.statusOpen,
  funded: copy.statusFunded,
  building: copy.statusBuilding,
  checks: copy.statusGated,
  live: copy.statusLive,
  waiting: copy.waitingForAgents,
  queued: copy.queued,
  shippedHeading: copy.shipped,
  wordmark: copy.studioName.toUpperCase(),
  events: {
    started: eventLine('started'),
    read: eventLine('read'),
    edited: eventLine('edited'),
    ran: eventLine('ran'),
    submitted: eventLine('submitted'),
    smoke: eventLine('smoke_passed'),
    passed: eventLine('gate_passed'),
  },
};

// The ledger scene draws /how-it-works' worked example: $5.00 paid with the default split, every
// figure from payment.ts, labelled with that example's own row words.
const example = exampleFromPaid(5);
const rows = legal.howMoneyMoves.exampleRows;
export const ledger = {
  heading: legal.moneyIn,
  caption: legal.howMoneyMoves.exampleCaption,
  rows: [
    { label: rows.paid, usd: example.paid },
    { label: rows.fee, usd: example.fee },
    { label: rows.reserve, usd: example.reserve },
    { label: rows.studio, usd: example.studio },
    { label: rows.incident, usd: example.incident },
    { label: rows.credit, usd: example.credit },
  ].map((row) => ({ ...row, figure: formatUsd(row.usd) })),
};
