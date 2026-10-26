import type { WeekProps } from '../schema';

// The week to 20 October 2026: what merged to main from 13 October (git log --since=2026-10-13) and
// the pull requests' own descriptions, cited beside each beat. Every beat is a drawn scene (Scenes.tsx); no captures. Not claimed, though asked
// for: Dust's "what's new" line (it shipped on 11 October, #186, the week before). The Curator's role
// card, which says it sorts ideas, is true: #255 turned it on (curator_triage, every 15 minutes), and
// #264 brings the site's copy level. Cut to fit 45 s, as not worth a
// player's time: passwords and resets (#247), the Curator joining (#255), and the fixes list (#249 to #256).

const week: WeekProps = {
  date: '2026-10-20',
  segments: [
    {
      title: 'The studio',
      beats: [
        {
          // #194 the live isometric studio; #243 never asleep, offline and paused agents putter about;
          // #208 idle agents wander, walks go round the furniture.
          headline: 'The agents never sleep now',
          support: 'Idle agents putter about the room and walk round the furniture.',
          shot: { scene: 'agents' },
        },
        {
          // #194, #208: an agent opens its role card when pressed or hovered.
          headline: 'Click an agent to meet it',
          support: 'Its role card says what it is doing right now.',
          shot: { scene: 'agent-card' },
        },
      ],
    },
    {
      title: 'Ideas',
      beats: [
        {
          // #194 suggest; #241 Ideas stays on home and in the top bar; #251 the safety line.
          headline: 'Pitch the changes you want',
          support: 'Each idea passes a content filter and joins a public list.',
          shot: { scene: 'ideas-pitch' },
        },
        {
          // #227 "Suggested by" credits on the card page; copy.suggest.how.
          headline: 'Players upvote the ideas they back',
          support: 'A card made from an idea credits who pitched it.',
          shot: { scene: 'ideas-vote' },
        },
        {
          // #212 card follows; the list on /me.
          headline: 'Follow a card to hear when it ships',
          support: 'Your desk at /me lists the cards you follow.',
          shot: { scene: 'follow' },
        },
      ],
    },
    {
      title: 'Dust',
      beats: [
        {
          // #194 Dust rebuilt in Three.js; #201 forks, orders and dust devils.
          headline: 'Dust is rebuilt in 3D',
          support: 'Forks, orders and dust devils give you more to decide.',
          shot: { scene: 'dust' },
        },
        {
          // #213 Daily Dust: the same 4-minute run for everyone each day, with a result card.
          headline: 'Daily Dust: one run for everyone',
          support: 'The same four-minute run each day, with a result card.',
          shot: { scene: 'daily' },
        },
        {
          // #194 seeds; #211 publish to the gallery; #207 safer seeds.
          headline: 'Save a run as a seed',
          support: 'Anyone can open it and play on from the same moment.',
          shot: { scene: 'seed' },
        },
      ],
    },
  ],
  outro: {
    lines: [
      { glyph: 'cartridge', text: 'Play Dust free.' },
      { glyph: 'coin-outline', text: 'Fund the next card.' },
    ],
    address: 'mobmachine.games',
  },
};

export default week;
