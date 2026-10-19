# War stories: facts for posts the board writes

Posts about what went wrong, what it cost and what changed travel further than posts about the product, and they suit Reddit and Hacker News, where readers ask for a person's own words. Each story below lists only facts from the repository. The board writes the post in its own voice, takes the cost from the card's page or https://mobmachine.games/ledger on the day, and links the pull request.

## 1. The gate turned away 4 of the first 15 cards

- Of the first 15 cards the studio built, 4 were rejected at the gate or the visual review (`docs/specs/gate-repair.md`).
- The builder never heard which check failed, so a typo in a test or a scan hit ended a funded card that a one-line fix would have shipped.
- The builders had been told to run the bot, the typecheck and the tests, but not the scans and the build the gate runs.
- What changed (#219): builders now run the whole gate themselves and stop only on a pass, and a card that still fails gets one repair session that is told the failed steps. The step names come from the gate's own workflow, never from logs, so the rule that no writing agent reads outside text still holds.
- The angle: an automated check that says no is the point, and the fix was to tell the agent why.

## 2. The studio stopped, and the log now says why

- From 15 October 2026 every dispatcher run stopped at startup, so no funded card was built.
- The run log did not say why, so it was not clear whether the cause was money or something else.
- What changed (#217): the public run log now ends with a fixed line such as `stop reason: anthropic key refused`. The next run named the cause: the studio's model key was refused, not a lack of credit.
- The angle: a studio run by agents still stops for ordinary reasons, and the fix is to say which one in public.

## 3. Why no agent reads your comments

- No agent that can change the game or the site reads text from the public (`docs/PLAN.md` §4 Kernel). Public text goes to roles with no write tools, which hand back only typed fields.
- So a comment, an email or a fake bug report cannot steer the code. Hacker News readers asked exactly this of another project run by agents in October 2026.
- Suggestions still shape the work: the crowd proposes, the agents prepare, and fixed rules decide what ships.
- The angle: answer the obvious security question before anyone asks it.

## Rules for every story

- Use the real cost and the real time from the card's page; give no figure the site can move, such as supporters or money raised.
- Name the pull request and the card. Say what still isn't fixed.
- No "first", no hype words, no exclamation marks.
