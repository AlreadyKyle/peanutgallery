# Comparables: what earlier crowd-funded and crowd-played games teach Mob Machine

Four projects the board named as references, what each actually did, what worked, what went wrong, and what Mob Machine takes from it. Every figure links the page it came from; each page was opened on 10 October 2026, and a figure no source confirmed was left out. `docs/PLAN.md` §9 lists the AI-stream comparables (Claude Plays Pokémon, Nothing, Forever, Neuro-sama), and §7 Channels uses them; they are not repeated here. Where a lesson becomes work, it names its `docs/BACKLOG.md` entry.

## Kickstarter, and Double Fine Adventure

**What it is.** A project sets a goal. If the campaign ends short of it, no one is charged and the creator gets nothing. Kickstarter says it does this to protect creators and backers and to create urgency that helps campaigns finish ([Kickstarter help](https://help.kickstarter.com/hc/en-us/articles/115005047893-Why-is-funding-all-or-nothing)).

**The case.** Double Fine Adventure asked for $400,000 and closed in March 2012 at $3,335,265. A documentary of the game's making was part of the pitch from the start ([Engadget](https://www.engadget.com/2012-03-13-double-fine-adventure-kickstarter-concludes-with-3-335-265-amas.html)).

**What worked.**
- A visible goal gives early backers a reason to bring in others.
- Filming the making turned the process into something to watch, not just a product to wait for.

**What went wrong.** Raising eight times the ask led the studio to widen the game's scope, which is the common way over-funded projects slip.

**What Mob Machine takes.**
- Each card is a small goal with a visible bar. A bar near full is the strongest prompt to fund it ("Fund the last $0.40").
- The card page and its replay are the documentary, built in.
- A card's ceiling (150% of its estimate, capped by `card_max_usd`) means over-funding never widens a card's scope. Extra money goes to the next card in line instead (§4 Funding a card).

## Star Citizen

**What it is.** Crowdfunding that started on Kickstarter in 2012 (over US$2 million there) and reached US$6.2 million by the end of the first pledge campaign. Wikipedia reports that combined crowdfunding and early-access sales had passed US$1 billion as of May 2026. Pledges are packages that include a spaceship ([Wikipedia](https://en.wikipedia.org/wiki/Star_Citizen)). The official funding page lists stretch goals by dollar threshold, each marked accomplished ([RSI funding goals](https://robertsspaceindustries.com/funding-goals)).

**What worked.**
- A live funding meter.
- Stretch goals that kept giving people the next reason to pledge.
- A public roadmap, introduced in December 2017.
- An annual event (CitizenCon) that kept a community paying for more than a decade.

**What went wrong.**
- The original release target was November 2014, and the single-player campaign's window has moved to the second quarter of 2027.
- It won Wired's 2016 Vaporware Award.
- In 2021 the UK Advertising Standards Authority upheld a complaint about how "concept ships" (ships sold before they existed) were marketed.
- Selling virtual land drew pay-to-win criticism.
- In 2016 the terms dropped an 18-month refund clause (all from [Wikipedia](https://en.wikipedia.org/wiki/Star_Citizen)).

**What Mob Machine takes.**
- The meter and the milestone list work. Selling the future is what failed.
- Mob Machine sells no promise: a card is funded only when it meets the definition of ready (§4 Definition of ready), and it ships or its money moves on.
- A stretch goal here should unlock studio capacity that the money itself pays for, such as a second builder running in parallel once monthly funding covers it. It should never be game content promised for later. See [A card supply that keeps pace with funding](BACKLOG.md#a-card-supply-that-keeps-pace-with-funding).
- No item in a Mob Machine game is sold for money (§4 Rating, §4 Art policy).

## Twitch Plays Pokémon

**What it is.** A stream where chat commands drove one copy of Pokémon Red. It started on 12 February 2014 and beat the game on 1 March 2014 after 16 days, 7 hours, 50 minutes and 19 seconds. Twitch estimated over 1.16 million participants, with a peak of 121,000 at once ([Wikipedia](https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon)).

**What worked.**
- Participation was free and instant.
- Progress was visible every second.
- The rules themselves became the story. After players stalled, Democracy mode, introduced on 18 February, tallied votes over a window. Switching to it took a supermajority; switching back to Anarchy took a simple majority.
- Players invented lore, treating the useless Helix Fossil as a deity, and Reddit live-blogged the run.
- It spread by word of mouth, reaching over 17 million views by 20 February.

**What went wrong.** Chaos is slow, and only the core audience could follow progress without a recap.

**What Mob Machine takes.**
- The process is the show, failures included. Gate failures and reverts are already public on the card pages.
- Free participation is what scales an audience. Money alone does not. See [Free voting on open cards](BACKLOG.md#free-voting-on-open-cards), which waits on [Player accounts](BACKLOG.md#player-accounts).
- Lore comes from the community naming things. See [The name pipeline](BACKLOG.md#the-name-pipeline) and [Personal decisions for contributors](BACKLOG.md#personal-decisions-for-contributors), which keep public text away from writing agents (§4 Kernel).
- A recap helps late arrivals. See [Weekly episodes and clips](BACKLOG.md#weekly-episodes-and-clips).

## Humble Bundle

**What it is.** Pay what you want for a bundle of games, then split the payment with sliders among the developers, charities and Humble's own tip ([Wikipedia](https://en.wikipedia.org/wiki/Humble_Bundle)). The first bundle, in May 2010, passed a million dollars within its week, $321,295 of it to the charities. Several of its games released their source code at that mark ([TechCrunch](https://techcrunch.com/2010/05/11/humble-indie-bundle-breaks-1000000)).

**What worked.**
- Buyers choosing where their money goes built trust, and the choice itself was engaging.
- A public milestone with a reward for everyone (the open-source release) brought in more money.
- Some bundles added a bonus for paying more than the current average.
- Charity giving passed US$200 million by September 2021 ([Wikipedia](https://en.wikipedia.org/wiki/Humble_Bundle)).

**What went wrong.** In April 2021 Humble announced it would remove the charity slider. After developers and buyers objected, it reversed course in May 2021, then in July 2021 set a range of 15 to 30% that stays with the store ([Wikipedia](https://en.wikipedia.org/wiki/Humble_Bundle)). Taking away a control people value costs more than never offering it.

**What Mob Machine takes.**
- The slider is built on /contribute (`docs/specs/split-slider.md`). The 80/20 default and the 10% reserve stay fixed (§4 Kernel), so the slider never takes back a promise.
- A community milestone that benefits everyone fits [Public mirror of the game with a license](BACKLOG.md#public-mirror-of-the-game-with-a-license).
- Mob Machine leaves out beat-the-average. It ranks payers by amount, which the money surfaces avoid.

## Growth: the share loop

The loop is fund, watch, ship, share. Each ship is the moment a supporter has something true to show, so each step below makes that moment visible and easy to pass on. They are listed in build order, and each step is a backlog entry.

1. **Tell the supporter their card shipped.** Built: a supporter who left `/thanks` heard nothing more from the studio, and now a short email to the Stripe checkout address, saying the card is live, what it cost and where to play it, closes the loop. See [Ship notices](../specs/ship-notices.md).
2. **A Share button and a link preview for each card.** Both are built: the Share button, and a code-drawn preview image of the card face with the title, its Supporter numbers, what it cost and how long the agents took, from public records only. See [Card link preview](../specs/card-preview.md).
3. **Play the version you funded.** A permalink to the game as the card shipped it, already listed in [More on a card's own page](BACKLOG.md#more-on-a-cards-own-page).
4. **Studio milestones a supporter can push over the line.** Capacity that money unlocks, shown as a meter (the Star Citizen lesson, without the promises). See [A card supply that keeps pace with funding](BACKLOG.md#a-card-supply-that-keeps-pace-with-funding).
5. **Shareable moments inside Dust.** A code-drawn image of a run that a player can share. See [Shareable runs in Dust](BACKLOG.md#shareable-runs-in-dust).
6. **Free participation.** Accounts, then free votes (the Twitch Plays Pokémon lesson). See [Player accounts](BACKLOG.md#player-accounts).

Channels and their order are §7 Channels: Reddit, then Hacker News, X and the press.

**Design rules for every share surface.**
- It is drawn in code from `platform/site/DESIGN.md` and `tokens.css`, and the card face is the share image.
- Its copy follows `docs/COPY.md`.
- It states only public facts. It shows no countdown, no chance cue near money and no ranking of supporters by amount.
- It offers no referral payouts. A payout is a money flow the kernel does not have, and supporters may be minors.
