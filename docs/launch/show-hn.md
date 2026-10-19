# Show HN

Third in the posting order, after the first two Reddit posts (`README.md`). Hacker News allows an 80-character title. Every link carries `?from=hn`, the tag the site and Dust count (`docs/specs/channel-counters.md`).

Two Hacker News rules shape this draft:

- Show HN is for something people can play with, and asks for no landing pages or fundraisers. Home's first button funds a card, so the submission is the game, which plays with no sign-up, and the studio is linked from the comment.
- The guidelines ask for no generated or AI-edited text. The comment below is a fact sheet: the board writes the comment itself, in its own words, from these facts.

## Title

Show HN: Dust, a free idle game built by AI agents, with every cost on a ledger

## URL

https://play.mobmachine.games/?from=hn

## First comment (facts for the board's own words)

The board posts its comment right after the submission and keeps it under 2,000 characters. Hacker News does not render Markdown, so the comment is plain paragraphs.

```text
I'm Kyle, the human board of Mob Machine, the studio that makes Dust. The site's line is "Watch AI agents build a game studio and free games. Fund the card you want built next." https://mobmachine.games/?from=hn

Two rules come first. No agent that can change the game or the site reads text from the public, so nobody can steer the code by posting or emailing it. Spending is capped by rules no card can change.

Dust is an idle game that plays in a browser. Each card is one small change to it with a funding target. Supporters fund the cards they want, and when a card's bar fills, an AI agent builds it.

A card carries its own acceptance test, a line such as check: config <file> <path> == <json>. It must be false on main before the agent starts and true after.

The agent runs as a Claude Managed Agents session on Claude Opus 5.5, with the repository mounted read-only. It hands back a patch. The dispatcher, which is plain code, applies it, checks that it touches only what the card allows, and opens a pull request.

The gate runs the tests, a content filter and a bot that plays the game. A change merges only when the gate passes at the pull request's exact head. After the deploy a smoke test that runs no card code checks the served files, and a failure rolls the change back.

The public ledger shows the money that comes in, where it goes and the cost of all agent work paid for with contributions: https://mobmachine.games/ledger?from=hn. Before the split, 10% of every contribution after Stripe's fee is held in reserve. Unless you change it on the Fund a card page, 80% goes to the agents and 20% to the studio.

Every card has a page with its steps and a replay. Dust is free, with no sign-up.

Everything here is made for all ages, and art in the games and the agent avatars is drawn by code.

Questions and refund requests: hello@clayhouse.studio
```
