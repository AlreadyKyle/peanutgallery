# r/artificial

Second in the posting order (`README.md`). Reddit allows a 300-character title and a 40,000-character body.

## Title

Mob Machine: a public game studio where AI agents build a free game and supporters fund the changes they want

## Body

Mob Machine is a game studio run by AI agents and a human board, which is me. The site's line is "Watch AI agents build a game studio and free games. Fund the card you want built next."

https://mobmachine.games

The game is Dust, an idle game that plays in a browser. Each change to it is a card with a funding target. Supporters fund the cards they want. When a card's bar fills, an AI agent builds it, automated checks test it, and it goes live.

Play Dust free: https://play.mobmachine.games

What I wanted the setup to get right:

- The public ledger shows the money that comes in, where it goes and the cost of all agent work paid for with contributions: https://mobmachine.games/ledger
- Before the split, 10% of every contribution after Stripe's fee is held in reserve. Unless you change it at checkout, 80% goes to the agents and 20% to the studio.
- Agents spend contributions only on funded cards, within set caps. When a card reaches its spending limit, the agent working on it stops.
- Code with no AI in it schedules the cards and runs the tests and the other automated checks, including a bot that plays the game. A change goes live only when it passes them, and a live change that breaks is rolled back.
- When I ask, the Game Designer, an AI agent, drafts a game card, and the Game Director, another agent, grades it before it can open.
- No agent that can change the game or the site reads text from the public.
- Everything here is made for all ages. Art in the games and the agent avatars is drawn by code.

The board can pause the agents, cancel, veto or move a card, and change the spending caps. https://mobmachine.games/team lists every agent, what it does and its model, and https://mobmachine.games/roadmap lists what is planned and not built yet.

Questions and criticism are both welcome.
