import { copy } from '../../../../site/src/lib/copy';
import type { WeekProps } from '../schema';

// The week to 20 October 2026: what merged to main from 13 October (git log --since=2026-10-13) and
// the pull requests' own descriptions, cited beside each beat. Captures: weekly-captures/2026-10-20,
// made by scripts/weekly-capture.mjs from the live site on 20 Oct 2026. Not claimed, though asked
// for: Dust's "what's new" line (it shipped on 11 October, #186, the week before), and that an agent
// sorts ideas (the site says that work has not started, #251).

const AS_OF = 'As of 20 Oct 2026';

const week: WeekProps = {
  date: '2026-10-20',
  label: 'The week to 20 October 2026',
  intro: {
    headline: 'This week at Mob Machine',
    // The site's own pitch (copy.ts), word for word.
    support: `${copy.pitchTitle} ${copy.pitchBody}`,
    shot: { src: 'studio.mp4', url: 'mobmachine.games', from: 0 },
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
          shot: { src: 'studio.mp4', url: 'mobmachine.games', from: 3.0 },
          focus: 'studio.room',
          // The room's own fit would leave the plate's headline cut off at the frame's edge.
          zoom: 1.72,
          bars: 2,
        },
        {
          // #194, #208: an agent opens its role card when pressed or hovered.
          headline: 'Click an agent to meet it',
          support: 'Its role card says what it is doing right now.',
          shot: { src: 'studio.mp4', url: 'mobmachine.games', from: 7.0 },
          focus: 'studio.room',
          zoom: 1.72,
          ring: 'studio.roleCard',
          // The capture clicks the Curator at 9.2 s, 2.2 s into this beat.
          ringAt: 2.5,
          bars: 2,
        },
        {
          // #255 the Curator is running, shown under Running; #242 the team's avatars bob.
          headline: 'The Curator joins the running team',
          support: 'Running agents on the team page now bob too.',
          shot: { src: 'team.mp4', url: 'mobmachine.games/team', from: 1.0 },
          ring: 'team.curator',
          ringAt: 2.8,
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
          shot: { src: 'suggest-top.png', url: 'mobmachine.games/suggest' },
          focus: 'suggest-top.pitch',
          ring: 'suggest-top.pitch',
        },
        {
          // #227 "Suggested by" credits on the card page; copy.suggest.how.
          headline: 'Players upvote the ideas they back',
          support: 'A card made from an idea credits who pitched it.',
          shot: { src: 'suggest-list.png', url: 'mobmachine.games/suggest' },
          focus: 'suggest-list.how',
          zoom: 1.3,
          ring: 'suggest-list.how',
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
          shot: { src: 'sign-up.png', url: 'mobmachine.games/sign-up' },
          ring: 'sign-up.form',
        },
        {
          // #247 /forgot-password and /reset-password.
          headline: 'Reset a forgotten password by email',
          support: 'The link opens a page where you choose a new one.',
          shot: { src: 'forgot.png', url: 'mobmachine.games/forgot-password' },
          focus: 'forgot.form',
          ring: 'forgot.form',
        },
        {
          // #212 card follows; the list on /me.
          headline: 'Follow a card to hear when it ships',
          support: 'Your desk at /me lists the cards you follow.',
          shot: { src: 'card-follow.png', url: 'mobmachine.games/card/e1ee4792' },
          focus: 'card-follow.button',
          ring: 'card-follow.button',
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
          shot: { src: 'dust.mp4', url: 'play.mobmachine.games', from: 0.5 },
        },
        {
          // #213 Daily Dust: the same 4-minute run for everyone each day, with a result card.
          headline: 'Daily Dust: one run for everyone',
          support: 'The same four-minute run each day, with a result card.',
          shot: { src: 'daily-start.png', url: 'play.mobmachine.games/?daily=2026-10-20' },
          focus: 'daily-start.line',
          zoom: 1.6,
          ring: 'daily-start.line',
        },
        {
          // #194 seeds; #211 publish to the gallery; #207 safer seeds.
          headline: 'Save a run as a seed',
          support: 'Anyone can open it and play on from the same moment.',
          shot: { src: 'dust-after.png', url: 'play.mobmachine.games' },
          focus: 'dust-after.seed',
          zoom: 1.6,
          ring: 'dust-after.seed',
        },
      ],
    },
    {
      title: 'Everything else',
      kind: 'list',
      beats: [
        // #250 rates below 10 to the hundredth.
        { headline: 'Rates under 10 show to the hundredth', shot: { src: 'dust-after.png', url: 'play.mobmachine.games' }, focus: 'dust-after.gatherer', ring: 'dust-after.gatherer' },
        // #253 ledger figures.
        { headline: 'Ledger figures that add up', shot: { src: 'ledger.png', url: 'mobmachine.games/ledger', asOf: AS_OF } },
        // #255 governance copy and Terms version 4.
        { headline: 'Terms version 4 is now in force', shot: { src: 'terms.png', url: 'mobmachine.games/terms' }, focus: 'terms.version', zoom: 1.6, ring: 'terms.version' },
        // #256 the Machine card's presets set checkout's amount.
        { headline: 'Pick $10 and checkout opens on $10', shot: { src: 'machine.png', url: 'mobmachine.games/contribute' }, ring: 'machine.presets' },
        // #249 HSTS, unsubscribe headers, sign-up never says who has an account, the rate limiter.
        { headline: 'Security hardening across the site', shot: { glyph: 'check', url: 'mobmachine.games', line: 'The site always asks for a secure connection, and sign-up never says who has an account.' } },
        // #252 code splitting, layout shift fixes; #250 Dust's files cached for a year.
        { headline: 'Faster pages that hold still', shot: { glyph: 'clock', url: 'mobmachine.games', line: 'Pages load in pieces, and browsers keep Dust\'s files for a year.' } },
        // #251 card previews; ship emails from studio@ with the next card to fund.
        { headline: 'Ship emails name the next card', shot: { glyph: 'flag', line: 'Each one comes from studio@mobmachine.games.' } },
        // #254 the marketing engine, outbound only.
        { headline: 'Ship posts for Bluesky and Mastodon', shot: { glyph: 'plane', line: 'New cards go to Discord as well. It posts and reads nothing.' } },
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
