// The legal pages, the fixed rules and the statements of money: every money rule (the reserve, the
// split, the emergency fund, the daily limit, holds, refunds and where the money goes), the label and
// description of every money and ledger figure, the words of the ledger's rows, the Payment Link's
// choices and the funding caption on a card (docs/specs/board-site.md). This file is kernel
// (platform/gate/kernel-paths.txt): no card may change it, and a change is a board pull request.
// copy.ts holds the rest of the site's words and does not repeat these; every page, kernel or not,
// reads these from here.
//
// The text pages are drafted for board review; not legal advice. In a paragraph, {email} becomes the
// contact address as a mailto link, {refunds} a link to the Refunds page, {terms} a link to the Terms
// and {discord} the Discord invite. The words of the Terms and the Refunds page are not here: every
// posted version of them is in terms-versions.ts (docs/specs/legal-copy.md).
// Resume by rule (docs/specs/agent-system-core.md): the one case where money in Not on a card yet goes
// to a card that is not the next to open. Said under /ledger's Not on a card yet and on /how-it-works.
const CEILING_TOP_UP =
  'A card paused at its spending limit for the first time can take enough from Not on a card yet, once, to spend up to 1.5 times what it has cost so far; its bar can then read above its target.';

export const legal = {
  contributeUnavailable: 'Contributions are not open yet.',
  split:
    'At checkout you choose how your contribution splits between the agents and the studio. These are contributions, not donations.',
  // Home's Where the money goes: the fixed rule's split, filled in from the constants in payment.ts
  // (Funding.tsx splitSentence), then the contributions line on its own.
  splitLine:
    "Before the split, {reserve}% of every contribution after Stripe's fee is held in reserve. Unless you change it at checkout, {agents}% goes to the agents and {studio}% to the studio.",
  notDonations: 'These are contributions, not donations.',
  // Said once on /contribute and /ledger. Stripe takes US dollars only (the webhook refuses any other currency).
  usdNote: 'All amounts are in US dollars (USD).',
  fixedRulesIntro: 'Some rules are fixed, and no contribution or card can change them.',
  fixedRules: [
    'The public ledger shows the money that comes in, where it goes and the cost of all agent work paid for with contributions.',
    'Agents spend contributions only on funded cards, within set caps.',
    "Before the split, 10% of every contribution after Stripe's fee is held in reserve. Unless you change it at checkout, 80% goes to the agents and 20% to the studio.",
    "5% of the agents' share is set aside in an emergency fund, up to $500.",
    'Every change passes automated checks before it goes live and can be rolled back.',
    'The content filter, the all-ages rating and the art policy always apply.',
    'No agent that can change the game or the site reads text from the public.',
  ],
  ledger: 'Ledger',
  meter: 'Funding',
  agentWork: 'Agent work',
  deploys: 'Deploys',
  poolBalance: 'In the pool',
  // The pool figure on home, after the coin and the amount: "$0.50 in the pool".
  poolInline: 'in the pool',
  // Home's last band: the pool, the split and the latest agent actions.
  moneyHeading: 'Where the money goes',
  // Home's five latest agent actions, above the rows.
  latestActions: 'Latest agent actions',
  reserve: 'Held in reserve',
  incidentReserve: 'Emergency fund',
  held: 'Held for 14 days',
  agentSpend: 'Agent spend',
  loadingFigures: 'Loading live figures.',
  loadingLedger: 'Loading the ledger.',
  loadingDeploys: 'Loading deploys.',
  contributorsOne: '1 contributor',
  contributorsMany: '{n} contributors',
  // One plain line under each figure, so nothing needs a tap to explain it.
  describeAvailable: 'Agent money from contributions that is not spent yet, including the money on card bars.',
  // Added to the In the pool description when agent work has cost more than came in; the figure shows $0.00.
  shortfall: 'Agent work has cost {amount} more than contributions have paid in.',
  describeReserve: "10% of every contribution after Stripe's fee. It covers disputes first. Agents never spend it.",
  describeIncidentReserve: "5% of the agents' share, up to $500, kept for urgent bug fixes. Nothing spends it yet.",
  describeHeld:
    "Agent credit above $50 from one person in one day, or above the studio's daily limit across everyone. It moves to In the pool after 14 days.",
  describeAgentSpend: 'Model usage paid for with contributions, priced at list rates.',
  tokensLine: '{in} in · {cached} cached · {out} out tokens',
  meterUnavailable: 'Live figures are not available yet.',
  staleFigures: 'Could not refresh. These figures may be out of date.',
  partUnavailable: 'Not available right now.',
  ledgerEmpty: 'No agent work recorded yet.',
  deploysEmpty: 'No deploys yet.',
  artPolicy: 'Art in the games and the agent avatars is drawn by code.',
  allAges: 'Everything here is made for all ages.',
  deployGreen: 'passed checks',
  deployNotGreen: 'failed checks',
  spent: 'spent',
  shippedOn: 'shipped',
  spentSoFar: 'spent so far',
  fundThis: 'Fund this card',
  // A card's spec rows: "Funded $1.50 of $3.00" and "Contributors 2".
  fundedLabel: 'Funded',
  contributorsLabel: 'Contributors',
  // A card that was not built, on the design guide's sample face; /ledger's Stopped rows say where the
  // money went card by card (movedTo).
  notBuiltMoney: 'Its unspent money went to the next cards in line.',
  folders: { 'seed-1': 'Game', platform: 'Site' } as Record<string, string>,
  // Shown while the agents are paused and public_studio names no reason. It follows the board's Pause
  // and Resume on its own. With a reason, the notice and home's status line say pauseReasons' sentence
  // instead (PausedNotice.tsx pausedSentence); each names the category only, never who paused or when.
  pausedNotice: 'The agents are paused. Funded cards keep their money and wait in the queue until the board resumes them.',
  pauseReasons: {
    awaiting_credit:
      "The agents are paused while the studio waits for Stripe to pay out contributions, which buy the agents' model credit. Cards funded now keep their money and wait in the queue.",
    spend_limit:
      'The agents are paused because the studio reached its monthly limit on model usage. Funded cards keep their money and wait in the queue until the board resumes them.',
    incident:
      'The agents are paused while the board checks a problem. Funded cards keep their money and wait in the queue until the board resumes them.',
    board: 'The board has paused the agents. Funded cards keep their money and wait in the queue until the board resumes them.',
  } as Record<string, string>,
  eventVerbs: {
    start: 'started',
    tool_call: 'used a tool',
    tool_result: 'got a result',
    message: 'wrote a note',
    gate_pass: 'passed checks',
    gate_fail: 'failed checks',
    ship: 'shipped',
    revert: 'reverted',
    error: 'hit an error',
  } as Record<string, string>,
  // What the database itself did to a card, on a line no role wrote (public_agent_events' step and
  // usd, docs/specs/agent-system-core.md): dealt to now after the cooling window, and the resume rule
  // with the amount it took from Not on a card yet. One step has a role: the Studio Head's Rank now
  // (docs/specs/agent-workflows.md), which reads after the role's name.
  eventSteps: {
    dealt: 'Dealt to now',
    ceiling_top_up: 'Topped up with {usd} from Not on a card yet',
    resume_rule: 'Resumed by rule after its spending limit',
    ranked: 'ranked the cards open for funding',
  } as Record<string, string>,
  // The worked path of a contribution on /how-it-works: its steps, the split example's rows and
  // where the money goes. The page's title, lede and example labels are in copy.ts.
  howMoneyMoves: {
    blocks: [
      {
        heading: 'Pick a card',
        body: [
          'Each card is one change to the game or to this site, with a funding target. Pick one to fund, or let the studio pick for you.',
        ],
      },
      {
        heading: 'Contribute and choose the split',
        body: [
          "At checkout you choose an amount and how it splits between the agents and the studio. Before the split, 10% of what is left after Stripe's fee goes to a reserve that covers disputes.",
          "Unless you change it, 80% of the rest goes to the agents and 20% to the studio. 5% of the agents' share goes to an emergency fund until it holds $500.",
        ],
      },
      {
        heading: 'The bar fills',
        body: [
          "Up to $50 of agent credit from one person a day reaches the card's bar within a minute, while the studio's total for the day is under its daily limit. Credit above either limit is held for 14 days first.",
          'When the bar is full, the card joins the queue. If a card costs less than its bar holds, the rest pays for later cards.',
        ],
      },
      {
        heading: 'The agents build it',
        body: [
          'An AI agent takes the card and makes the change. Its actions appear on the ledger, and the cost of work paid for with contributions is added to the public total.',
        ],
      },
      {
        heading: 'Checks, then live',
        body: [
          'Before a change goes live it must pass automated checks, including a bot that plays the game. A change that fails is not shipped, and a live change that breaks is rolled back.',
        ],
      },
      {
        heading: 'It shows under Shipped',
        body: ['Once it is live, the card is listed under Shipped with what it cost and how many people funded it.'],
      },
    ],
    splitCaption: "A $10.00 contribution after Stripe's fee, with the default split.",
    splitRows: {
      reserve: 'Held in reserve',
      reserveNote: '10% of the $10.00.',
      studio: "Studio's share",
      studioNote: '20% of the $9.00 left.',
      incident: 'Emergency fund',
      incidentNote: "5% of the agents' $7.20, until the fund holds $500.",
      credit: 'Agent credit',
      creditNote: "What reaches the card's bar and the meter.",
    },
    sections: [
      {
        heading: 'Where the money goes',
        paragraphs: [
          "Stripe takes its fee first. 10% of the rest is held in reserve; it covers disputes first, and agents never spend it.",
          "The split you choose at checkout divides what is left between the agents and the studio. Unless you change it, 80% goes to the agents and 20% to the studio.",
          "5% of the agents' share goes to an emergency fund for urgent bug fixes, until the fund holds $500. The rest is agent credit.",
          'Agent credit pays for model usage on funded cards, within daily and per-card caps. Money a card does not use stays with the agents and pays for later cards.',
          `Money given with no card, or beyond a card's target, waits in Not on a card yet for the next card to open. ${CEILING_TOP_UP}`,
          "The studio pays for the agents' model usage with contributions once Stripe has paid them out to the studio.",
        ],
      },
      {
        heading: 'Holds and refunds',
        paragraphs: [
          "Up to $50 of agent credit from one person a day is added within a minute, while the studio's total for the day is under its daily limit. Credit above either limit is held for 14 days before it counts.",
          "A refund or a dispute takes that contribution's credit off the meter and off any card bar it funded. Work that has already shipped stays shipped. The {refunds} says how to ask for one.",
        ],
      },
    ],
  },
  contributeTitle: 'Where should your contribution go?',
  contributeLede: 'Let the studio decide, or pick the card you want built. You set the split at checkout on the next step.',
  // The first choice on /contribute: money given with no card funds the next cards in line (PLAN.md
  // §4). It names the first card in the waterfall's order (public_money.funding_order), says the
  // money waits when no card takes money, and names no card when the order did not load
  // (docs/specs/money-surfaces.md).
  pickForMe: 'Fund the next card in line',
  pickForMeBody: 'Your contribution funds whatever the agents build next.',
  nextInLine: 'Next in line: {title}',
  nextInLineNone: 'No card is open for funding right now. Your contribution waits in Not on a card yet and funds the next card that opens.',
  orPickACard: 'Or pick a card',
  noFundableCards: 'No cards need funding right now. Funding the next card in line still pays for whatever the agents build next.',
  // Under /contribute's card choices.
  waterfallLine: "Anything beyond a card's target funds the next cards in line.",
  // /ledger's Funding band: money on no card yet, the shortfall and the board's test payment.
  notOnCard: 'Not on a card yet',
  describeNotOnCard: "Money given with no card, or beyond a card's target, waiting for the next card to open.",
  notOnCardTopUp: CEILING_TOP_UP,
  shortBy: 'Waiting cards are short by {usd} until new money arrives.',
  // {usd} is public_money.board_test_usd: the part of the board's test payment that sits in the pool
  // (its agent credit), not the payment itself; its reserve and emergency fund shares sit in those
  // figures and its Stripe fee in none (docs/specs/money-logic.md).
  boardTestLine: "The pool includes {usd} of the board's own test payment; it funds no card.",
  // /ledger's Money in band: what supporters paid and where it went. The figures add up: received -
  // Stripe fees - refunded - disputed + corrections = reserve + studio + emergency fund + held + agent
  // credit (docs/specs/money-logic.md). The board's own test payment is in none of them.
  moneyIn: 'Money in',
  moneyInLede: 'What supporters have paid, and where it went.',
  moneyInEmpty: 'No contributions yet.',
  moneyFromOne: 'from 1 contribution',
  moneyFromMany: 'from {n} contributions',
  received: 'Received',
  describeReceived: 'What supporters paid at checkout, before any fee.',
  stripeFees: 'Stripe fees',
  describeStripeFees: 'What Stripe kept to process payments, refunds and disputes.',
  refunded: 'Refunded',
  describeRefunded: 'Contributions paid back to supporters.',
  disputed: 'Disputed',
  describeDisputed: "Contributions taken back through a bank dispute, less any the studio got back when the bank ruled for it.",
  corrections: 'Corrections',
  describeCorrections: 'Changes the board recorded by hand to correct the books.',
  toReserve: 'To the reserve',
  describeToReserve: "10% of every contribution after Stripe's fee. It covers disputes first.",
  toStudio: 'To the studio',
  describeStudio: 'What supporters chose to send to the studio, less any correction charged to it.',
  studioPctAvg: 'At checkout they chose {pct}% on average, weighted by amount, and the default is {default}%.',
  toIncident: 'To the emergency fund',
  describeToIncident: "5% of the agents' share while the fund holds under $500.",
  heldMoneyIn: 'Held for 14 days',
  describeHeldMoneyIn: 'Agent credit still in its 14-day hold.',
  agentCredit: 'Agent credit',
  describeAgentCredit: 'What reached the agents to spend on cards.',
  reconciledOn: 'Reconciled with Stripe on {date}.',
  notReconciled: 'Not yet reconciled with Stripe.',
  // /ledger's Stopped band: the rejected and paused cards, each with why and where its money is. The
  // one public list of them (docs/specs/money-surfaces.md); they appear on no other page.
  stoppedHeading: 'Stopped cards',
  stoppedLede: 'Cards that stopped before they shipped, why, and where their money is.',
  pausedHeading: 'Paused',
  didntShipHeading: "Didn't ship",
  pausedMoneyStays: 'Its money stays on it until it resumes or the board cancels it.',
  fundedByOne: 'funded by {usd} from 1 supporter',
  fundedByMany: 'funded by {usd} from {n} supporters',
  fundedByAmount: 'funded by {usd}',
  movedTo: 'Its unspent money went to {places}.',
  movedPlace: '{place} ({usd})',
  anotherCard: 'another card',
  // A stopped card's reason in plain words, by the failing_check code the dispatcher or the board
  // wrote. A code with no entry shows its stage's fallback; the raw code never shows.
  failingCheckWords: {
    cancelled_by_board: 'The board cancelled it.',
    acceptance: "The change did not pass the card's own check.",
    acceptance_grammar: "The card's check could not be read.",
    acceptance_already_true: 'What the card asked for was already true.',
    lane_unsupported: 'The agents cannot change that part of the studio yet.',
    lane_violation: 'The change touched files the card does not allow.',
    file_mode: 'The change added a kind of file the studio does not accept.',
    history: 'The change did not arrive in the shape the checks expect.',
    no_changes: 'The agent made no change.',
    tool_allowlist: 'The agent tried to use a tool it is not allowed.',
    session: "The agent's work session failed.",
    gate: 'The change failed the automated checks.',
    merge: 'The change could not be merged.',
    deploy: 'The change failed to deploy.',
    smoke: 'The bot that plays the game found a problem with the change.',
    git_tamper: "The change touched the studio's own tools.",
    dispatcher_error: "An error in the studio's own tools stopped it.",
    ceiling: 'It reached its spending limit.',
    budget: 'It used up its budget.',
    turn_cap: 'The agent reached its limit on steps.',
    wall_clock: 'The agent ran out of time.',
    console_credit: "The agents' model credit ran out.",
    usage_tier_cap: 'The studio reached its monthly limit on model usage.',
    paused_by_board: 'The board paused the studio while it was being built.',
    board_session: 'The board session it was running in ended.',
    horizon: 'The board moved it to a later part of the roadmap.',
    vetoed: 'The board set it aside.',
    patch_conflict: 'Its change no longer fits the latest version, so it waits to be redone.',
    unknown_model: "The agent's model was not recognised.",
    dispatcher_stopped: "The studio's tools stopped while it was being built.",
    dispatcher_restart: "The studio's tools restarted while it was being built.",
    adapter: 'The service the agents run on had a problem.',
    managed_api: 'The service the agents run on had a problem.',
    stream_lost: 'The connection to the agent was lost.',
    session_unsettled: "The agent's last session could not be closed out.",
    outage: 'A service the studio relies on was down.',
    post_merge_outage: 'A service the studio relies on was down after the change went in.',
    deploy_timeout: 'The deploy took too long to confirm.',
    gate_missing: 'The automated checks did not start.',
    gate_pending: 'The automated checks did not finish in time.',
    gate_infrastructure: 'The automated checks could not run.',
    main_red: 'The automated checks were already failing before this change.',
    pr_head: 'The change did not reach GitHub in time.',
    card_spend: 'The studio could not read what the card had already spent, so the agent was not started.',
    read_token: "The studio's access to its own code failed a safety check, so the agent was not started.",
    repo_skills: 'The code held files the agents may not load, so the agent was not started.',
    system_prompt: "The agent's instructions could not be put together, so it was not started.",
    ledger: 'The studio could not record what the agent spent, so the work stopped.',
  } as Record<string, string>,
  pausedFallback: 'It stopped on a check the board is looking into.',
  rejectedFallback: "It did not pass one of the studio's checks.",
  continueToCheckout: 'Continue to checkout',
  ledgerLede:
    'The money available to the agents, what agent work paid for by contributions has cost, and the latest agent actions and deploys.',
  // The footer links and the text pages they open.
  footerLinks: { terms: 'Terms', privacy: 'Privacy', refunds: 'Refunds', contact: 'Contact' },
  contactEmail: 'hello@clayhouse.studio',
  refundsPageLink: 'Refunds page',
  // The Terms and Refunds pages name the version they show and when it took effect
  // (docs/specs/legal-copy.md). {n} is the version, {time}, {from} and {until} a posted time
  // (format.ts formatPostedAt) and {title} the page's own title.
  termsVersionLine: 'Version {n}, in force since {time}.',
  termsPastLine: 'Version {n}, in force from {from} until {until}. It applies to contributions whose checkout started in that time.',
  termsCurrentLink: 'Read the version in force now',
  termsEarlier: 'Earlier versions',
  termsEarlierItem: 'Version {n}, in force from {from} until {until}',
  termsVersionTitle: '{title}, version {n}',
  termsLoading: 'Loading the terms.',
  termsUnconfirmed:
    'This page cannot confirm which version is in force right now. Email {email} to ask which version applies to your contribution.',
  // Before every path to checkout: directly under the first choice on /contribute, and under every
  // live Fund this card link (Contribute.tsx, Funding.tsx).
  contributeAgreement:
    'Contributing means you accept the {terms} in force when your checkout starts, including the {refunds}. To contribute you must be an adult where you live, or have the permission of a parent or guardian.',
  fundAgreement: "By funding you accept the {terms} and the {refunds}, and confirm you are an adult or have a guardian's permission.",
  // Privacy is a notice with its own date, not part of a Terms version.
  privacyUpdated: 'Last updated 23 September 2026.',
  privacy: {
    title: 'Privacy',
    lede: 'What the studio stores when you contribute, and what it does not.',
    sections: [
      {
        heading: 'Payments',
        paragraphs: ['Stripe processes every payment. The studio never sees or stores your card number.'],
      },
      {
        heading: 'What the studio stores',
        paragraphs: [
          "For each contribution the studio stores the amount, the split you chose, the card you funded, the time, Stripe's reference for the payment, a one-way hash of the email address Stripe collects and, when Stripe provides one, a one-way hash of the identifier Stripe gives your payment card. The email address and the card number are not stored.",
          'The card hash is used only to apply the $50 daily limit, so one person paying with several email addresses shares one limit.',
          "The studio's database does not store your name. Stripe keeps the name on your card with its record of the payment.",
        ],
      },
      {
        heading: 'What the site does not do',
        paragraphs: ['The site has no ads, no analytics and no tracking cookies.'],
      },
      {
        heading: 'Board sign-in',
        paragraphs: ['Only board members can sign in. Sign-in uses Supabase Auth.'],
      },
      {
        heading: 'Hosting',
        paragraphs: ['The site is hosted on Netlify and the database on Supabase. Their logs may record IP addresses for security.'],
      },
      {
        heading: 'What is public',
        paragraphs: [
          "The public pages show totals, such as the money available and each card's number of contributors. They never show names or email addresses.",
        ],
      },
      {
        heading: 'Your data',
        paragraphs: [
          'To ask for a copy of your data or for its deletion, email {email} and include the email address you paid with, so the matching record can be found.',
          'Payment records the law requires the studio to keep are kept for as long as the law requires.',
        ],
      },
    ],
  },
  contact: {
    title: 'Contact',
    lede: 'How to reach the studio.',
    sections: [
      {
        heading: 'Email',
        paragraphs: [
          '{email}',
          'Write about refunds, a copy or deletion of your data, or anything else about the studio.',
        ],
      },
    ],
    discordSection: {
      heading: 'Discord',
      paragraphs: ['The studio also has a {discord} server.'],
    },
  },
} as const;
