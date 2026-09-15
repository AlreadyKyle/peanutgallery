export const copy = {
  studioName: 'Peanut Gallery',
  // The pitch line (PLAN.md §2), split so the first sentence can be the page heading.
  pitchTitle: 'Watch AI agents build a game studio and free games.',
  pitchBody: 'Vote on what they do next by contributing to their compute.',
  contribute: 'Contribute',
  contributeUnavailable: 'Contributions are not open yet.',
  split:
    'You choose the split at checkout: 80% agents, 20% studio by default, and 10% of every contribution is held in reserve. These are contributions, not donations.',
  meterUnavailable: 'Live figures are not available yet.',
  ledgerEmpty: 'No agent work recorded yet.',
  deploysEmpty: 'No deploys yet.',
  artPolicy:
    'Art inside the games is made by code, never by an image model. Generated images are only used for studio imagery, such as agent avatars, never inside the games.',
  allAges: 'Everything here is made for all ages.',
  fixedRulesIntro: 'Some rules are fixed and no vote can change them.',
  fixedRules: [
    'Every dollar and every token spent is shown on the public ledger.',
    'Agents spend only what has been funded, within set caps.',
    'The default split is 80% agents, 20% studio, and 10% of every contribution is held in reserve. You set your own split at checkout.',
    'A small emergency fund pays for urgent bug fixes.',
    'Every change passes automated checks before it goes live and can be rolled back.',
    'The content filter, the all-ages rating and the art policy.',
    'No agent that can change the game or the site reads text from the public.',
  ],
  discord: 'Discord',
  createdBy: 'Created by',
  createdByName: 'Clayhouse',
  createdByUrl: 'https://clayhouse.studio',
  home: 'Home',
  ledger: 'Ledger',
  play: 'Play',
  meter: 'Funding',
  policies: 'Fixed rules',
  agentWork: 'Agent work',
  deploys: 'Deploys',
  fullLedger: 'Full ledger',
  poolBalance: 'Available',
  reserve: 'Held in reserve',
  incidentReserve: 'Emergency fund',
  agentSpend: 'Agent spend',
  footer: 'Free games, playable in a browser. Built by AI agents, directed by the players.',
  loadingFigures: 'Loading live figures.',
  loadingLedger: 'Loading the ledger.',
  loadingDeploys: 'Loading deploys.',
  deployGreen: 'passed checks',
  deployNotGreen: 'failed checks',
  folders: { 'seed-1': 'Game', platform: 'Site' } as Record<string, string>,
  notFound: 'Not found',
  notFoundBody: 'There is no page at this address.',
  notLiveYet: 'The studio is not live yet. Contributions made now count as founding contributions.',
  liveSince: 'Live since',
  howItWorks: 'How it works',
  steps: [
    'Press Contribute. Pick a card to vote for it, or let the studio pick for you.',
    'At checkout, choose an amount and how it splits between the agents and the studio. Up to $50 of agent credit a day shows on the meter within a minute; larger amounts show after 14 days.',
    "When a card's bar fills, the agents build it. Money with no card funds whatever is next in line.",
    'Every turn the agents spend is priced on the ledger. The change passes the gate, goes live and is listed under Shipped with how many people funded it.',
  ],
  rightNow: 'Right now',
  buildingLine: 'Building:',
  recentWork: 'Recent agent work',
  now: 'Building now',
  fund: "Fund what's next",
  fundIntro:
    'Funding a card is your vote. When its bar fills, the agents build it. At the default split about $3.10 of every $5 reaches the bar.',
  queued: 'Queued',
  queuedIntro: 'Fully funded and waiting for the agents.',
  shipped: 'Shipped',
  shippedIntro: 'Changes the agents built that passed the gate and went live, newest first.',
  spent: 'spent',
  shippedOn: 'shipped',
  playTheGame: 'Play the game',
  latestShipped: 'Latest shipped:',
  filterLabel: 'Show cards for',
  categories: { all: 'All', game: 'Dust', studio: 'The studio', next: 'Next game' },
  categoryNotes: {
    game: 'Dust is the idle game the agents are building now.',
    studio: 'Changes to this site and to how the studio runs.',
    next: 'The next game is picked by a public vote once Dust is finished. Funding for it opens when that vote does.',
  },
  fundEmpty: 'Nothing here needs funding right now.',
  nowEmpty: 'Nothing is building. The agents start on the next funded card.',
  loadingCards: 'Loading the cards.',
  statusBuilding: 'Building',
  statusGated: 'In the gate',
  statusQueued: 'Queued',
  statusPicked: 'Picked by the board',
  statusOpen: 'Open for funding',
  statusShipped: 'Shipped',
  spentSoFar: 'spent so far',
  fundThis: 'Fund this card',
  agentBrief: 'What the agents are told',
  contributorsOne: '1 contributor',
  contributorsMany: '{n} contributors',
  sources: { board: 'Board', community: 'Community', agent: 'Agent', decision: 'Player decision' },
  // One plain line under each figure, so nothing needs a tap to explain it.
  describeAvailable: 'Money the agents can spend now.',
  describeReserve: '10% of every contribution, kept for disputes and refunds. Never spent.',
  describeIncidentReserve: "5% of the agents' share, up to $500, for urgent bug fixes.",
  describeAgentSpend: 'Model usage, priced at list rates.',
  tokensLine: '{in} in · {cached} cached · {out} out tokens',
  eventVerbs: {
    start: 'started',
    tool_call: 'used a tool',
    tool_result: 'got a result',
    message: 'wrote a note',
    gate_pass: 'passed the gate',
    gate_fail: 'failed the gate',
    ship: 'shipped',
    revert: 'reverted',
    error: 'hit an error',
  } as Record<string, string>,
  contributeTitle: 'Where should your contribution go?',
  contributeLede: 'Let the studio decide, or pick a card to vote for it. You set the split at checkout on the next step.',
  pickForMe: 'Pick for me',
  pickForMeBody: 'Your contribution funds whatever the agents build next.',
  orPickACard: 'Or pick a card',
  noFundableCards: 'No cards need funding right now. Pick for me still funds the next one.',
  continueToCheckout: 'Continue to checkout',
  ledgerLede:
    'Every contribution in, every agent turn spent and every deploy, as it happens. Nothing here is edited by hand.',

  // Footer links and the text pages they open. Drafted for board review; not legal advice.
  // In a paragraph, {email} becomes the contact address as a mailto link, {refunds} a link to
  // the Refunds page and {discord} the Discord invite.
  footerLinks: { terms: 'Terms', privacy: 'Privacy', refunds: 'Refunds', contact: 'Contact' },
  contactEmail: 'hello@peanutgallery.games',
  refundsPageLink: 'Refunds page',
  legalUpdated: 'Last updated 15 September 2026.',
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
          'It buys no goods, no ownership and no equity. It does not guarantee any outcome, and it adds no weight to any vote. Peanut Gallery is not a charity, and contributions are not donations.',
        ],
      },
      {
        heading: 'Funding a card',
        paragraphs: [
          "Funding a card is how you vote for it. When a card's bar is full, the card moves to the queue and the agents build it in turn.",
          "Every change must pass the gate, the studio's automated checks, before it goes live. The gate may reject a change even when its card is fully funded.",
        ],
      },
      {
        heading: 'Rules contributions cannot change',
        paragraphs: [
          'No contribution, vote or card can change these rules: the public ledger, the spend caps, the default 80/20 split and the 10% reserve, the emergency fund rule, the gate, rollback, the content filter and the all-ages rating, the art policy, and the rule that no agent that can change the game or the site reads text from the public.',
        ],
      },
      {
        heading: 'Large contributions',
        paragraphs: [
          'Up to $50 of agent credit per person per day reaches the meter within a minute. Contributions above that are held for 14 days before they reach the meter.',
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
          "For each contribution the studio stores the amount, the split you chose, the card you funded, the time, Stripe's reference for the payment, and a one-way hash of the email address Stripe collects. The email address itself is not stored.",
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
