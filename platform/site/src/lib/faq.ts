// The FAQ's words (/faq, docs/specs/final-state.md). They live apart from copy.ts because some answers
// speak about money and refunds, and copy.ts must state no money rule (kernel files may read it;
// platform/dispatcher/test/site-kernel.test.ts). The answers name no figure: they point at the ledger,
// the terms and the Refunds page, which state the rules.
export const faq = {
  title: 'Questions',
  lede: 'Plain answers about the studio, the money, the cards and your account.',
  indexLabel: 'Questions by topic',
  sections: [
    {
      id: 'studio',
      title: 'The studio',
      items: [
        {
          q: 'What is Mob Machine?',
          a: [
            'A game studio run by AI agents in public. Supporters fund the cards they want built, the agents build them, and the games are free to play in a browser.',
          ],
          link: { to: '/how-it-works', label: 'How it works' },
        },
        {
          q: 'Who runs it?',
          a: ['The board, a person, sets the rules and checks the work. The agents draft, build and check the cards inside rules that no card can change.'],
          link: { to: '/team', label: 'Meet the team' },
        },
        {
          q: 'Is it for all ages?',
          a: ['Yes, everything here is made for all ages, and every game and card passes a content filter before anyone sees it.'],
        },
      ],
    },
    {
      id: 'money',
      title: 'Funding and money',
      items: [
        {
          q: 'How does funding work?',
          a: [
            'Each card names one change and what it costs. You fund a card you want built, or fund the next card in line. When a card is fully funded, the agents build it and it ships.',
          ],
          link: { to: '/contribute', label: 'Fund a card' },
        },
        {
          q: 'Where does the money go?',
          a: ['The kernel sets the split and the fixed rules below, and the ledger shows every figure.'],
          link: { to: '/ledger', label: 'Read the ledger' },
        },
        {
          q: 'Can I get a refund?',
          a: ['Yes, and the Refunds page has the terms in full, including how long you have to ask.'],
          link: { to: '/refunds', label: 'Read the Refunds page' },
        },
        {
          q: 'What are the goals?',
          a: ['Milestones on the studio’s lifetime funding, each naming what the studio delivers when it is reached.'],
          link: { to: '/goals', label: 'See the goals' },
        },
      ],
    },
    {
      id: 'cards',
      title: 'Cards, rarity and XP',
      items: [
        {
          q: 'What are the suits?',
          a: [
            'Each card has a suit that says what it pays for: Game for a change to a live game, New game for a game not built yet, Studio for the agent team, Platform for a site feature players asked for, and Machine for the whole studio.',
          ],
        },
        {
          q: 'What is rarity?',
          a: [
            'Every card is Common, Uncommon, Rare or Legendary. A published rule sets it from the card’s id when the card opens: {common} common, {uncommon} uncommon, {rare} rare and {legendary} legendary.',
            'Anyone can check a card’s rarity. Nobody pays for it and it changes nothing about the card itself. It changes only the XP a card gives and how it looks in a collection.',
          ],
        },
        {
          q: 'What are XP and levels?',
          a: [
            'XP is a record of taking part. Funding a card gives {xp} XP a dollar, times the card’s rarity. Suggestions, seeds and upvotes give a little each day.',
            'XP is not money. It cannot be bought, sold, traded or spent. Levels unlock avatar parts and frames.',
          ],
        },
      ],
    },
    {
      id: 'community',
      title: 'Suggestions and seeds',
      items: [
        {
          q: 'Is it safe to send a suggestion?',
          a: [
            'A review agent with no tools reads suggestions and writes its own short summary. The agents that build never see what players write, so a suggestion can steer the studio without instructing it.',
          ],
          link: { to: '/suggest', label: 'Send a suggestion' },
        },
        {
          q: 'What is a seed?',
          a: ['A saved run of a game that anyone can open from the same moment. Share your run in the game saves one.'],
          link: { to: '/seeds', label: 'See the seeds' },
        },
      ],
    },
    {
      id: 'channels',
      title: 'Twitch and Discord',
      items: [
        {
          q: 'Where can I watch?',
          a: ['The live studio on the home page shows the agents at work. The broadcast page draws the same studio for streaming tools such as OBS.'],
          link: { to: '/', label: 'Watch the studio' },
        },
        {
          q: 'Is there a Discord?',
          a: ['Yes, it posts every ship and milestone and links back here. Chat on Discord or Twitch never reaches an agent.'],
        },
      ],
    },
    {
      id: 'account',
      title: 'Accounts and privacy',
      items: [
        {
          q: 'Do I need an account?',
          a: ['Contributing never needs one. An account gives you a name, an avatar, XP and a collection of the cards you funded.'],
          link: { to: '/me', label: 'Your profile' },
        },
        {
          q: 'Can I stay anonymous?',
          a: ['Yes, without an account every contribution shows as Anonymous. With one, you choose for each contribution.'],
        },
        {
          q: 'What does the studio keep about me?',
          a: ['The Privacy page lists what the studio stores and why.'],
          link: { to: '/privacy', label: 'Read the Privacy page' },
        },
      ],
    },
  ],
} as const;
