// The legal pages, the fixed rules and every string that states money: the Payment Link's choices,
// the ledger's figures and their descriptions, and the funding caption on a card (docs/specs/board-site.md).
// This file is kernel (platform/gate/kernel-paths.txt): no card may change it, and a change is a board
// pull request. copy.ts spreads it first, so the rest of the site reads the same strings as copy.<key>;
// the kernel pages and components read them from here.
//
// The text pages are drafted for board review; not legal advice. In a paragraph, {email} becomes the
// contact address as a mailto link, {refunds} a link to the Refunds page and {discord} the Discord
// invite.
export const legal = {
  contributeUnavailable: 'Contributions are not open yet.',
  split:
    'At checkout you choose how your contribution splits between the agents and the studio. These are contributions, not donations.',
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
  contactEmail: 'hello@peanutgallery.games',
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
