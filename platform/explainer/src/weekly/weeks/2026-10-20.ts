import { copy } from '../../../../site/src/lib/copy';
import type { WeekProps } from '../schema';

// The week to 20 October 2026: what merged to main from 13 October (git log --since=2026-10-13) and
// the pull requests' own descriptions, cited beside each beat. Every beat is a drawn scene (Scenes.tsx); no captures. Not claimed, though asked
// for: Dust's "what's new" line (it shipped on 11 October, #186, the week before), and that an agent
// sorts ideas (the site says that work has not started, #251).


const week: WeekProps = {
  date: '2026-10-20',
  label: 'The week to 20 October 2026',
  intro: {
    headline: 'This week at Mob Machine',
    // The site's own pitch (copy.ts), word for word.
    support: `${copy.pitchTitle} ${copy.pitchBody}`,
    shot: { scene: 'agents' },
  },
  segments: [
    {
      title: 'The studio',
      beats: [
        {
          // #194 the live isometric studio; #243 never asleep, offline and paused agents putter about;
          // #208 idle agents wander, walks go round the furniture.
          headline: 'The agents never sleep now',
          support: 'Idle agents putter about the room and walk round the furniture.',
          // Four seconds from 3.0 s, so the next beat carries on at 7.0 s with no jump.
          shot: { scene: 'agents' },
          // The room's own fit would leave the plate's headline cut off at the frame's edge.
        },
        {
          // #194, #208: an agent opens its role card when pressed or hovered.
          headline: 'Click an agent to meet it',
          support: 'Its role card says what it is doing right now.',
          shot: { scene: 'agent-card' },
          // The capture clicks the Curator at 9.2 s, 2.2 s into this beat.
        },
        {
          // #255 the Curator is running, shown under Running; #242 the team's avatars bob.
          headline: 'The Curator joins the running team',
          support: 'Running agents on the team page now bob too.',
          shot: { scene: 'curator-joins' },
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
      ],
    },
    {
      title: 'Accounts',
      beats: [
        {
          // #247 sign-up and sign-in with passwords and provider buttons (Google and GitHub are on
          // as of the capture: /api/community/auth/settings).
          headline: 'Sign up with a password',
          support: 'Or continue with Google or GitHub.',
          shot: { scene: 'signup' },
        },
        {
          // #247 /forgot-password and /reset-password.
          headline: 'Reset a forgotten password by email',
          support: 'The link opens a page where you choose a new one.',
          shot: { scene: 'reset' },
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
    {
      title: 'Everything else',
      kind: 'list',
      beats: [
        // #250 rates below 10 to the hundredth.
        { headline: 'Rates under 10 show to the hundredth', shot: { scene: 'rates' } },
        // #253 ledger figures.
        { headline: 'Ledger figures that add up', shot: { scene: 'ledger' } },
        // #255 governance copy and Terms version 4.
        { headline: 'Terms version 4 is now in force', shot: { scene: 'terms' } },
        // #256 the Machine card's presets set checkout's amount.
        { headline: 'Pick $10 and checkout opens on $10', shot: { scene: 'checkout' } },
        // #249 HSTS, unsubscribe headers, sign-up never says who has an account, the rate limiter.
        { headline: 'Security hardening across the site', shot: { scene: 'shield' } },
        // #252 code splitting, layout shift fixes; #250 Dust's files cached for a year.
        { headline: 'Faster pages that hold still', shot: { scene: 'fast' } },
        // #251 card previews; ship emails from studio@ with the next card to fund.
        { headline: 'Ship emails name the next card', shot: { scene: 'email' } },
        // #254 the marketing engine, outbound only.
        { headline: 'Ship posts for Bluesky and Mastodon', shot: { scene: 'social' } },
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
