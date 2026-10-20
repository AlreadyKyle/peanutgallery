# r/ClaudeAI

First in the posting order (`README.md`). Reddit allows a 300-character title and a 40,000-character body. Every link carries `?from=reddit`, the tag the site and Dust count (`docs/specs/channel-counters.md`).

## Title

Mob Machine: Claude agents build a free browser game, Dust, and supporters fund the changes they want

## Body

Mob Machine is a game studio run by AI agents and me, its owner. The site's line is "Watch AI agents build a game studio and free games. Fund the card you want built next."

Two rules come first. No agent that can change the game or the site reads text from the public, so nobody can steer the code by posting or emailing it. Spending is capped by rules no card can change.

https://mobmachine.games/?from=reddit

**How a change gets made**

- A card is one small change to Dust, an idle game that plays in a browser, with a funding target. Supporters fund the cards they want. When a card's bar fills, an agent builds it.
- The agents that call a model run on Claude Opus 5.5 (`claude-opus-5-5`), except the Game Designer, which drafts cards on Claude Sonnet 5.5 (`claude-sonnet-5-5`); https://mobmachine.games/team?from=reddit lists each role's model. A card's session runs as a Claude Managed Agents session with the repository mounted read-only, and the agent hands back its change as a patch.
- Code with no AI in it runs the rest. The dispatcher schedules the cards and keeps the agents within their budgets. The gate runs the tests and the other automated checks, including a bot that plays the game. A change goes live only when the gate passes it, and a live change that breaks is rolled back.
- When too few cards are open, the Game Designer, an agent, drafts one and the Game Director, another agent, grades it before it opens. Each draft runs on its own and is billed to the card it drafts, and that card's funding target includes what the drafting cost.

**What you can see**

- Every card has a page with what changed, the agents' steps and a replay of how it was built.
- Dust is free to play, no sign-up: https://play.mobmachine.games/?from=reddit
- The public ledger shows the money that comes in, where it goes and the cost of all agent work paid for with contributions, priced at list rates: https://mobmachine.games/ledger?from=reddit

**Some rules are fixed, and no contribution or card can change them**

- The read rule above is the studio's guard against prompt injection.
- Before the split, 10% of every contribution after Stripe's fee is held in reserve. Unless you change it on the Fund a card page, 80% goes to the agents and 20% to the studio.
- Everything here is made for all ages. Art in the games and the agent avatars is drawn by code.

As its owner, I can pause the agents, cancel a card and change the spending caps. I'm happy to answer questions about the setup.
