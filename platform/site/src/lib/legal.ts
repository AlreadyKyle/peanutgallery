// The legal pages, the fixed rules and the statements of money: every money rule (the reserve, the
// split, the emergency fund, the daily limit, holds, refunds and where the money goes), the label and
// description of every money and ledger figure, the words of the ledger's rows, the Payment Link's
// choices and the funding caption on a card (docs/specs/board-site.md). This file is kernel
// (platform/gate/kernel-paths.txt): no card may change it, and a change is a board pull request.
// copy.ts holds the rest of the site's words and does not repeat these; every page, kernel or not,
// reads these from here.
//
// The text pages are drafted for board review; not legal advice. In a paragraph, {email} becomes the
// contact address as a mailto link, {refunds} a link to the Refunds page and {discord} the Discord
// invite.
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
    'The public ledger shows the cost of all agent work paid for with contributions.',
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
  // A card that was not built (the design guide's sample face until a public read lists them).
  notBuiltMoney: 'Its unspent money went to the next cards in line.',
  folders: { 'seed-1': 'Game', platform: 'Site' } as Record<string, string>,
  // Shown while the board has paused the agents, for any reason: before the first payout, at the
  // cutover, after a failed revert or in an incident. It follows the board's Pause and Resume on its own.
  pausedNotice: 'The agents are paused. Funded cards keep their money and wait in the queue until the board resumes them.',
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
  pickForMe: 'Pick for me',
  pickForMeBody: 'Your contribution funds whatever the agents build next.',
  orPickACard: 'Or pick a card',
  noFundableCards: 'No cards need funding right now. Pick for me still funds the next one.',
  continueToCheckout: 'Continue to checkout',
  ledgerLede:
    'The money available to the agents, what agent work paid for by contributions has cost, and the latest agent actions and deploys.',
  // The footer links and the text pages they open.
  footerLinks: { terms: 'Terms', privacy: 'Privacy', refunds: 'Refunds', contact: 'Contact' },
  contactEmail: 'hello@clayhouse.studio',
  refundsPageLink: 'Refunds page',
  legalUpdated: 'Last updated 22 September 2026.',
  terms: {
    title: 'Terms',
    lede: 'What a contribution pays for, what it does not buy, and the rules that apply.',
    sections: [
      {
        heading: 'Who runs the studio',
        paragraphs: ['Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada.'],
      },
      {
        heading: 'What a contribution pays for',
        paragraphs: [
          "A contribution pays for the agents' compute and for the studio, in the split you choose at checkout.",
          'It buys no goods, no ownership and no equity. It does not guarantee any outcome. Peanut Gallery is not a charity, and contributions are not donations.',
        ],
      },
      {
        heading: 'Funding a card',
        paragraphs: [
          "You fund a card to have it built. When a card's bar is full, the card moves to the queue and the agents build it in turn.",
          "Every change must pass the gate, the studio's automated checks, before it goes live. The gate may reject a change even when its card is fully funded.",
        ],
      },
      {
        heading: 'Rules contributions cannot change',
        paragraphs: [
          'No contribution or card can change these rules: the public ledger, the spend caps, the default 80/20 split and the 10% reserve, the emergency fund rule, the gate, rollback, the content filter and the all-ages rating, the art policy, and the rule that no agent that can change the game or the site reads text from the public.',
        ],
      },
      {
        heading: 'Large contributions',
        paragraphs: [
          "Up to $50 of agent credit per person per day reaches the meter within a minute, while the studio's total for the day is under its daily limit. Credit above either limit is held for 14 days before it reaches the meter.",
        ],
      },
      {
        heading: 'Refunds',
        paragraphs: ['Refunds and disputes are handled as the {refunds} describes.'],
      },
      {
        heading: 'The games',
        paragraphs: ['The games are free to play.'],
      },
      {
        heading: 'Law',
        paragraphs: ['These terms are governed by the laws of Ontario and the laws of Canada that apply there.'],
      },
      {
        heading: 'Changes to these terms',
        paragraphs: ['When these terms change, the new version is posted on this page with its date.'],
      },
      {
        heading: 'Contact',
        paragraphs: ['Questions about these terms go to {email}.'],
      },
    ],
  },
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
          'If you give a display name at checkout, it is stored and kept private until names are reviewed.',
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
  refunds: {
    title: 'Refunds',
    lede: 'How to ask for a refund, and what a refund changes.',
    sections: [
      {
        heading: 'Asking for a refund',
        paragraphs: ['Email {email} within 14 days of your contribution, with your Stripe receipt.'],
      },
      {
        heading: 'How refunds are paid',
        paragraphs: ['Refunds go back through Stripe to the card or account you paid with.'],
      },
      {
        heading: 'What a refund changes',
        paragraphs: [
          "A refund or a dispute takes that contribution's credit off the meter and off any card bar it funded. Work that has already shipped stays shipped.",
        ],
      },
      {
        heading: 'Disputes',
        paragraphs: ['Disputes go through Stripe. The 10% reserve covers disputes first.'],
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
