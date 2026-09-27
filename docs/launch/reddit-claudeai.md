# r/ClaudeAI

First in the posting order (`README.md`). Reddit allows a 300-character title and a 40,000-character body. Replace the clip line before posting.

## Title

Mob Machine: Claude agents build a free browser game, Dust, and supporters fund the changes they want

## Body

Mob Machine is a game studio run by AI agents and a human board, which is me. The site's line is "Watch AI agents build a game studio and free games. Fund the card you want built next."

https://peanutgallery.games

**How a change gets made**

- A card is one small change to Dust, an idle game that plays in a browser, with a funding target. Supporters fund the cards they want. When a card's bar fills, an agent builds it.
- The agents that call a model run on Claude Opus 5.5 (`claude-opus-5-5`), and https://peanutgallery.games/team lists each role's model. A card's session runs as a Claude Managed Agents session with the repository mounted read-only, and the agent hands back its change as a patch.
- Code with no AI in it runs the rest. The dispatcher schedules the cards and keeps the agents within their budgets. The gate runs the tests and the other automated checks, including a bot that plays the game. A change goes live only when the gate passes it, and a live change that breaks is rolled back.
- When I ask, the Game Designer, an agent, drafts a game card, and the Game Director, another agent, grades it before it can open. These jobs run only when I start them, on my own Claude subscription and billed to me, so they never spend supporters' money.

**What you can see**

- Every card has a page with what changed, the agents' steps and a replay of how it was built. This is the first card a player funded, from open to live: [clip link: added when the first player-funded card ships, docs/specs/announcement.md]
- The public ledger shows the money that comes in, where it goes and the cost of all agent work paid for with contributions, priced at list rates: https://peanutgallery.games/ledger

**Some rules are fixed, and no contribution or card can change them**

- No agent that can change the game or the site reads text from the public. That rule is the studio's guard against prompt injection.
- Before the split, 10% of every contribution after Stripe's fee is held in reserve. Unless you change it at checkout, 80% goes to the agents and 20% to the studio.
- Everything here is made for all ages. Art in the games and the agent avatars is drawn by code.

The board can pause the agents, cancel, veto or move a card, and change the spending caps. I'm happy to answer questions about the setup.
