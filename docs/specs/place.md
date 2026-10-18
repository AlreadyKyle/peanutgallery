# Mob Machine as a place

Status: agreed. Card: none. Owner: studio.

## Problem

The site reads as a document about the studio rather than a place you visit and come back to. The frame never shows who is here, /me is a settings form, ideas from players sit on a side page instead of at the start of the machine, the room on the home page is a picture you cannot use, and nothing says what a contribution gets you where people decide to pay.

## Scope

In: the top bar's you slot; home as the studio's floor (the room's stations as links, a rail that maps them, the players' ideas as a station); /me as the player's desk; one panel saying what a contribution gets you, on home's Fund station, a card's page, /contribute, signed-out /me and /thanks; sign-in that returns the player to where they were; the card page's credit for a card the community asked for.

Out: prices, perks, XP rates, the split, the reserve, caps and every other money rule (the panel states only perks that exist today); PLAN.md; the kernel's rules; new RPCs, tables or migrations; motion beyond what the room already draws.

## Behaviour

- **The frame knows you.** The top bar carries a you slot after the wordmark: "Sign in" to /me for a visitor; for a signed-in player, their avatar in its frame and their level, linking to their desk. The menu has its own "Your desk" link, so phones reach it where the slot keeps to the avatar. The slot never stands between a visitor and Contribute: paying never needs an account.
- **Home is the floor.** The first screen is a wide ink floor: the room large beside the pitch, or beside "Welcome back" with the player's level and cards once signed in, and the pipe under it. The room's stations carry labelled tags (Ideas at the whiteboard, Fund at the hopper, Building at the desks and checks, Shipped at the dock, Team in the lounge), each a link to its part of the page. The room stands on the plate with no screen around it, part of the scene, and from 64rem it shrinks onto the rail's small map as the page scrolls (the board, 18 October 2026); under reduced motion it stays where it is. Under the plate the stations follow as unnumbered parts in the board's order (decisions 67 and 70): Fund, then the first game's tile, then Ideas, then how the cards move as Next up, Building and Shipped. Next up has no piece in the room, so no tag; the rail lists it. The team is on the map only while it has roles. From 64rem a rail stays in view beside them with the room as a small map and the stations as a list with what waits at each; the part in view lights its station with a still dashed outline. Under 64rem the rail is a strip of station links; under 48rem the room is full width and its tags give way to that strip.
- **Ideas are a station of the machine.** Ideas from players are one source of cards, beside the studio's own plans. The station shows the ideas board's top three ideas with their state and upvotes (their area left out, since home names a game only in its tile, decision 68), Pitch an idea, and the safety line (a review agent with no tools reads every idea; the agents that build never see a player's words). Next up, after it, says what the Game Designer is doing and shows the approved drafts waiting to open (decision 69).
- **Your desk.** Signed in, /me opens on the player: avatar, level, XP and what the next level unlocks; their cards with rarity and where each one is now; the cards they follow; their ideas with state and upvotes; their badges. Editing the profile and claiming past contributions follow.
- **What you get.** One panel lists the guest perks (a Supporter number, the card's own page to watch it built) and the free profile's (XP at the rate the XP rules use, the card in the collection with its rarity, badges, level unlocks), and says paying never needs an account. On /thanks it is Keep this card: sign in with the receipt's email and the payment is claimed as soon as the link lands. Every new sign-in claims the player's guest payments too, so a card paid for on another device joins the collection, also when sign-in returns the player to another page; the desk says so only when one was found.
- **Sign-in closed.** The community function answers `GET /api/community/auth/settings` with one boolean read from Supabase Auth's public settings (email sign-in on and sign-ups allowed). While it is false the site drops every profile prompt (the you slot, Make a free profile, Keep this card, Follow, Pitch an idea) and /me says profiles are not open yet; paying as a guest is unchanged. Turning sign-ups on brings them back with no deploy.
- **Back where you were.** Signing in from Pitch an idea returns the player to the pitch form.

## Acceptance criteria

- [ ] Signed out, the top bar's you slot reads Sign in and links /me; signed in, it shows the player's avatar and names their desk and level.
- [ ] Home's parts run Fund, the first game, Ideas, Next up, Building, Shipped, then Team, and the room's tags and the rail's links go to each.
- [ ] While the settings route says sign-in is closed, home, /me, /suggest and /thanks offer no profile, and the cards to fund still link Stripe.
- [ ] The settings route answers only `{ signIn: boolean }`.
- [ ] The Ideas station shows the top three ideas that are not declined, with upvotes, and Pitch an idea links /suggest#suggest-send.
- [ ] The kernel's own pages draw the top bar with no you slot.
- [ ] Signed in, home's first panel welcomes the player by name with their cards.
- [ ] /me signed in lists the player's cards, ideas and badges before the editor, and names what the next level unlocks.
- [ ] The panel's XP line equals the XP rules' XP_PER_DOLLAR.
- [ ] /thanks for a recorded payment offers Keep this card to /me?keep=1, and the claim runs once the magic link lands.
- [ ] Signing in from Pitch an idea returns to /suggest#suggest-send, and the sign-in claims guest payments on the way.
- [ ] A card page whose card is fundable shows the panel; a shipped card's page does not.
- [ ] No page scrolls sideways at 375, 768 or 1440px.
- [ ] The top bar stays at the top of the window while a page scrolls and after it stops, at 375 and 1440px, and no sticky block sits under it.
- [ ] From 64rem with motion allowed, home's room lands exactly on the rail's map as the page scrolls and comes back on the way up; under reduced motion or below 64rem nothing moves.
- [ ] Perks.tsx and lib/sign-in.ts are kernel; Perks imports only legal.ts (its words), the sign-in probe and the router, so no card can change what the pay pages say paying gets.

## Verification

- `pnpm verify`
- `E2E_PORT=4401 npx playwright test place.spec.ts topbar.spec.ts` in `platform/site`
- The live-check workflow's first line for the merge commit reads `PASS ... failed=0`.

## Evidence

Added when the status moves to built.

## Decisions

- 2026-10-18: home is the floor (map and list) rather than a scroll-driven camera or a room you open panels in. It keeps the cards to fund one scroll from the top and adds no motion; the research and the options weighed are in the project's product-pass notes.
- 2026-10-18: the perks panel is kernel, so /contribute and /thanks may draw it, and states only perks that exist; Early looks at pitches is not built and is not claimed.
- 2026-10-18: home keeps the board's order (PLAN.md §10 decisions 67, 69 and 70): the cards to fund, the first game, then how the cards move. The ideas station is added to home's sections, between the first game and Next up; PLAN.md is not changed here, so the board may record that as a decision. The card page's "started as an idea" credit is left out until a card's data says which idea it came from (BACKLOG, Suggested by credits).
- 2026-10-18: the you slot is the card lane's code, so the kernel's own pages draw the top bar without it; the perks panel no longer claims a name on the card, which card pages never show.
