# Mob Machine: the product vision

What the studio is for, what it should feel like, how it grows and how it pays for itself. `docs/PLAN.md` is the constitution and wins any conflict; this file sets direction and the order of bets. The founder's order of priority: fun and new first, and it must also scale, grow and make money. Nothing here changes the kernel (`docs/PLAN.md` §4 Kernel). Work named here that is not built points at its `docs/BACKLOG.md` entry, and no number below is a current figure or a dated target.

## 1. Product goals

Every goal is a metric the studio can compute from what exists today: the ledger, the cards and their events, Stripe through the webhook rows, the weekly reports and the Discord outbound log. Thresholds are proposals and are the board's to confirm.

### Fun and new (first)

- **Ship rate.** Cards shipped per week, from `cards` (stage live) and the weekly report. A studio that ships nothing is not fun to watch. Proposed floor: at least one shipped card in every week money came in.
- **Funded to live time.** Median hours from a card's bar filling to live, from card events. Short is the whole spectacle. Proposed: the median falls as the fleet learns, and is shown on the board's panel.
- **Visible change per dollar.** Share of shipped game cards a player can see in Dust on the one screen (a new unit, unlock, string or feedback beat) against pure number edits. Computed by hand from shipped cards until the Game Director's rubric records it. Proposed: most game cards change something a player sees.
- **First-pass gate rate and cost per shipped card**, as defined in `docs/PLAN.md` §4 Metrics. Cheap, reliable cards mean more changes per dollar, which is the fun.

### Growth

- **New supporters per week**, from the weekly report.
- **Shares.** Discord ship posts sent (`outbound_posts`), and nothing else yet. Card shares from `ShareCard` and Dust's Share your run are not counted: nothing is sent to the studio by design.
- **Not measured yet:** visitors, plays of Dust, play length, share clicks, and the path from a play to a contribution. Dust's save is local only (`dust.save` in localStorage) and the site runs no analytics. A privacy-preserving count is proposed below ([Play and share counts without tracking](BACKLOG.md#play-and-share-counts-without-tracking)); until it exists every growth number is supporters and money only.

### Retention

- **Repeat supporters.** Share of supporters with a second payment, from the hashed payer key the hold logic already keeps (`docs/PLAN.md` §5 Rails). Proposed threshold for the board: a meaningful minority return, since repeat funding is the business.
- **Return after ship.** Payments from a supporter within seven days of a card they funded going live. Computable from allocations and live times.
- **Not measured yet:** returning players to Dust (the welcome-back note shows the player, not the studio).

### Revenue and profit

- **Studio income** per week: the studio share of contributions on the ledger, after the 10% reserve.
- **Chosen studio share.** Mean and distribution of the split slider's choice. The default carries the economics (`docs/PLAN.md` §5 The split); a drift away from 80/20 is a trust signal to read before any money change.
- **Coverage.** Studio income divided by the studio's own costs (Stripe fees on its purchases, overhead rows, refund fees). Profit is coverage above 1. Proposed: above 1 in every month with contributions.
- **Agent margin.** Agent spend against agent share in, per card. Agents run only when funded, so this is a quality metric (waste, failed runs) more than a solvency one.

## 2. The vision

**The promise.** Watch AI agents build a free game and fund the next change you want to see.

The studio is a toy for a crowd. Dust is the thing you play, the cards are the thing you steer, and the ledger and replays are the proof that it is real. Each piece is small and cheap so the loop turns fast.

### What a first-time visitor should feel

- **In 10 seconds:** "That is a real thing and it is moving." The cobalt plate, a card with a bar, and a live game one tap away. The aliens are drawn and named, so the team reads as characters.
- **In 60 seconds:** "I could change this." They have played Dust, seen the number climb, and found a card whose bar is partly full and whose change they can picture.
- **In 2 minutes:** "My money did something I can watch." They funded a card or bookmarked one, read where the money goes in one line, and know they will be told when it ships.

### The loop, and the reward at each step

1. **Discover.** A shared run, a ship post on Discord, a card link with its preview. Reward: curiosity, a concrete thing to look at.
2. **Play.** Dust in the browser, no account. Reward: numbers go up, a strike pops "+N", a new unit appears.
3. **Fund.** Pick a card, set the split, pay. Reward: the bar moves at once, and /thanks says "You are Supporter n" and what the payment reached.
4. **Watch.** The card page shows the agents' steps as they happen, and the team page shows who is working. Reward: a character story with real stakes, and the "Since your last visit" note on return.
5. **Ship.** The change goes live in Dust. Reward: you see it in the game, credited to supporters by number.
6. **Share.** Share the card or your run. Reward: someone you know sees what you caused.
7. **Return.** The welcome-back note in Dust, the weekly report, the next card near full. Reward: progress happened while you were away, both in your run and in the studio.

The weakest links today are 2 to 3 and 5 to 6. A player in Dust sees the studio line and nothing about the change their money could buy next, and a shipped card has no moment inside the game that says "this is new, the crowd paid for it".

## 3. This should be fun

Mob Machine is fun as a whole, before any one game is. The studio is the show: a crowd picks what gets built, a cast of aliens builds it in public, and everyone sees whether it worked. The games are one thing the studio makes. Fun at the studio level looks like this:

- **Picking is a play.** Choosing a card on home or /contribute should feel like placing a coin on a table: a real object, a bar that moves, and the next card in line ready.
- **Watching is a show.** A card's page and replay are the episode: the agents' steps, the checks, a failure and its fix. Failures are part of the story and are never hidden.
- **Shipping is a payoff.** The moment a funded card goes live (the ship notice, "Since your last visit", the Live stamp) is the studio's applause line and the thing most worth sharing.
- **Coming back has news.** Every return shows what changed while you were gone, on the site and in the game.

Five pillars follow. Every card the Game Designer drafts and every page the Platform Builder changes should serve at least one.

1. **Numbers go up, and you feel it.** The idle genre (Cookie Clicker, its descendants) runs on a rising total, the next purchase almost in reach, and feedback on every press. Dust has it: the dust total, the 1.25 cost curve, "+N" floats on strike, the pulse on buy, the unlock toast.
2. **Time away is rewarded.** Idle games pay you for leaving. Dust credits up to 8 hours away and now says so: "While you were away: +N dust in 2h 14m". The site does the same for the studio with "Since your last visit".
3. **A goal you can finish together.** Kickstarter's lesson is that a visible goal near done is the strongest prompt (`docs/research/comparables.md`). A bar near full, and a card small enough that one coffee's worth finishes it, is the studio's best moment.
4. **A crowd steering one thing.** Twitch Plays Pokémon drew 1.16 million participants because chaos with a shared goal is a story. Here the steering is funded and ordered, so the story is legible: which card the crowd picked, which shipped, what it changed.
5. **Characters at work.** Neuro-sama shows an AI persona can carry an audience. The code-drawn aliens on /team, asleep or awake, and the agents' steps as fixed lines, are the cast. They never plead or react to money (`platform/site/DESIGN.md`, Avatar). The planned host and stream extend this ([The host](BACKLOG.md#the-host)).

Humble Bundle is the money comp: a slider people trust because they can move it, and a default most leave alone.

## 4. Viral, retention and engagement features

Ranked by impact on the loop for the effort. Built means on main or on this branch.

1. **Feedback beats in Dust** (built on this branch): "+N" on strike, a pulse on buy, an unlock toast, all skipped under reduced motion (`seed-1/render/scene.ts`).
2. **Welcome-back note in Dust** (built on this branch): dust earned while away and for how long, after a minute or more away.
3. **Share your run, text** (built on this branch): the share sheet or the clipboard, with total dust, unlocks and https://play.mobmachine.games/ (`seed-1/render/share.ts`).
4. **The next change to Dust, from inside Dust** (new): [Next card to fund, shown in Dust](BACKLOG.md#next-card-to-fund-shown-in-dust). Closes the play to fund gap, the biggest hole in the loop.
5. **Shareable run picture** (built): a 1200 by 630 card drawn in code with the dust, the unlocks by name and the address, attached to the share sheet where it takes files (`seed-1/render/share-image.ts`).
6. **Dust's own link preview** (new): [A link preview image for Dust](BACKLOG.md#a-link-preview-image-for-dust). Today a shared Dust link shows the studio's image (`seed-1/index.html` points `og:image` at the site's `og.png`).
7. **Play and share counts** (new): [Play and share counts without tracking](BACKLOG.md#play-and-share-counts-without-tracking). Without it the studio cannot see conversion, so it cannot tune it.
8. **Card share and since your last visit** (built): `ShareCard` on card pages and /thanks, `SinceLastVisit` on home.
9. **Free voting** (backlog): [Free voting on open cards](BACKLOG.md#free-voting-on-open-cards), behind [Player accounts](BACKLOG.md#player-accounts). Lets non-payers steer, which grows the crowd that later funds.
10. **Weekly episodes and the stream** (backlog): [Weekly episodes and clips](BACKLOG.md#weekly-episodes-and-clips), [Twitch channel and stream scenes](BACKLOG.md#twitch-channel-and-stream-scenes). The discovery engine at scale.
11. **Seasons** (backlog): [Seasons](BACKLOG.md#seasons). A reason to come back on a cycle the board sets.
12. **Shipped-in-game marker** (new, not filed): a one-time note in Dust the first time a player sees a unit or unlock that shipped from a card since their last visit, naming the card. Filed after item 4 proves the read path.

Rejected for now: leaderboards and comparisons between players (the shareable runs entry rules them out), streak penalties, and any timer that punishes absence.

## 5. Business model and unit economics

**Revenue** is the studio share of each contribution: after the 10% chargeback reserve, the supporter's split, default 80% agents and 20% studio (`docs/PLAN.md` §5 The split). On a $5 contribution at the default, $0.90 is studio income before the studio's own costs.

**Costs.** Agent compute is paid from the agents' share and only when funded, so it never threatens solvency. The studio share pays Stripe fees on the studio's purchases, refund fees Stripe keeps, currency conversion, HST once registered, and overhead (the startup probe, drafts not billed to a card). Hosting is on free tiers (`docs/PLAN.md` §5 Costs). Stripe's per-payment fee hits small payments hardest, which is the main drag on small contributions.

**What makes it profitable at scale.** Costs that are almost all variable and funded in advance, against income that grows with contributions. The fixed overhead is small, so coverage rises with volume. The risk is the reverse: many tiny payments where fees eat the studio share.

**The levers, in order.**

1. **Player to supporter conversion.** The cheapest growth. Dust players who see a nearly funded card for the game they are playing (item 4 above) convert better than visitors to /contribute.
2. **Repeat funding.** A supporter who watched one card ship is the best prospect for the next. The ship notice, the weekly report and "Since your last visit" all serve this.
3. **Payment size.** Suggested amounts that make one card finishable, so fewer, larger payments carry less fee drag.
4. **The default split.** The strongest lever and the one to touch last. It is a money change, so a spec and a kernel pull request, and a change that reads as greedy costs more in trust than it earns.
5. **Later income** (`docs/PLAN.md` §5 Possible later income), [Membership tiers](BACKLOG.md#membership-tiers) and [Twitch Bits and subscriptions](BACKLOG.md#twitch-bits-and-subscriptions), once the loop is proven.

**Risks.** Too few open cards to fund (the supply floor guards it). Cards that ship nothing a player can see, which makes funding feel like a tax. Fee drag on small payments. A refund wave on spent money (the reserve and holds guard it). Agent cost per card rising faster than estimates.

**What not to do.** No pay-to-win: money buys changes for everyone, never an advantage for the payer. No selling the future: a card is funded when it is ready and built when funded, nothing is pre-sold (the Star Citizen lesson in `docs/research/comparables.md`). No referral payouts or rewards for recruiting. No chance mechanics beside money, no coins as a currency. All ages, everywhere. The kernel stays: the ledger, the caps, the reserves, the gate, the content filter and the read/write separation.

## 6. Design quality bar

The site's bar is `platform/site/DESIGN.md`: a quiet table, motion only for a real change or a press, three motifs. Dust has no written bar yet ([A creative guide for Dust](BACKLOG.md#a-creative-guide-for-dust)). Small opportunities found reading the code:

- `seed-1/index.html`: `og:image` and its alt text are the studio's, so a shared Dust link previews as the studio. A Dust image drawn from the game's own shapes fixes it (item 6).
- `seed-1/render/scene.ts`: the feedback beats are in place; the next polish is a short count-up on the total when the welcome-back credit lands, so the gain is seen arriving, skipped under reduced motion.
- `seed-1/render/share.ts` and `seed-1/content/strings.json`: the shared text is the whole artifact today. A code-drawn card image is the next step, using the site's card edge so a shared run reads as part of the studio.
- `seed-1/index.html`: the studio line sits below the canvas as plain text. Showing the next Dust card there with its bar (item 4) turns the footer into the loop's bridge.
- `platform/site/src/components/Meter.tsx`: a bar near full is the strongest prompt and should be the most visible state on a card, within the existing tokens.
- `platform/site/src/components/Avatar.tsx`: the aliens are the studio's character. A card's page could show which alien is working on it beside its steps, from data only.
- `platform/site/src/components/ShareCard.tsx`: shares the address and title; the link preview per card does the rest, so each card's preview should name its bar state in words.

Every change here goes through the design paths and the Directors' visual review.

## 7. Open questions for the board

1. Confirm or replace the proposed thresholds in section 1, and which of them the board's panel shows.
2. Should the studio count plays and shares at all, in aggregate with no identifiers, so conversion can be seen? The privacy page would say so.
3. May Dust show the next Dust card's title and bar inside the game? It puts a money prompt on the game page, which today carries only the studio link.
4. Suggested contribution amounts on /contribute: which, if any, and should they track the nearest card's remaining amount?
5. When does the studio take up later income, and in what order: tiers, Twitch, sponsors?
6. Is "visible change per dollar" a rubric item for the Game Director, so number-only cards rank below changes a player can see?
