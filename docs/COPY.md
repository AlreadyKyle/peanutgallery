# Copy rules

How every public sentence is written: the site, card titles and summaries, release notes. The board and the agents follow the same rules. `platform/site/src/lib/copy.test.ts` checks the ones marked **(tested)** against every string in `copy.ts` and `legal.ts`.

The reader is someone who has never heard of the studio. They should understand each sentence the first time, without knowing any of our terms.

## Say what the reader does and what they get

Write the action and the result. Do not write a slogan about it.

| Instead of | Write |
|---|---|
| Your contribution is your voice. | Fund a card to grow the studio and its games. |
| Every contribution in, every turn spent, every deploy. | The ledger shows the money in, what the agents spent and what went live. |
| Nothing here is edited by hand. | (cut it, or say what happens: "The ledger updates on its own as agents work.") |

## Patterns to avoid

1. **"X is your Y" and other aphorisms.** "Your contribution is your voice." Say the plain instruction. **(tested)**
2. **"X, never Y" and "X, not Y" contrasts** used for punch. One legal exception: "These are contributions, not donations." **(tested)**
3. **Fragment punchlines.** A two or three word sentence tacked on for effect: "Never spent." Fold it into the sentence before. **(tested: no sentence under three words)**
4. **Repeating an opening word for rhythm.** "Every… every… every…" **(tested)**
5. **Lists of three for rhythm.** Use three items only when there are three things.
6. **Stacked fragments without verbs.** "Free games, playable in a browser. Built by AI agents."
7. **Inflated words.** seamless, powerful, unlock, journey, reimagine, revolutionary, cutting-edge, testament, landscape, elevate, empower. **(tested)**
8. **Em dashes.** Use a full stop or a comma. **(tested)**
9. **Questions we answer ourselves.** "Why a ledger? Because…"

## Inside terms

A first-time reader does not know these. Either explain in the same sentence or use the plain version. **(tested: the left column never appears on the landing page)**

| Inside term | Plain version |
|---|---|
| default split | "80% goes to the agents and 20% to the studio unless you change it" |
| the gate | "automated checks" |
| turn | "each step an agent takes" or just "agent work" |
| lane, kernel, dispatcher, directive | do not use in public copy |
| the pool | "the money available to the agents" |

## Numbers

A number appears only with what it means to the reader. "About $3.10 of every $5 reaches the bar" fails: the reader does not know why $1.90 went missing. Either explain the whole path where there is room (How it works) or leave the number out.

## Voice

The site is a quiet, precise table with real cards on it. The words match: plain first, playful only where nothing is at stake.

- **Wink, don't shout.** At most one wink per page, and none in money, legal, status, notice or error copy.
- **Plain headings win.** "Building now", "Fund what's next", "Queued", "Shipped", "Planned next", "Where the money goes". A deck, hand, table, pile or discard word appears only where it makes a page clearer at a glance.
- **Games are called games.** Dust is "Dust", never "Cartridge 1". The cartridge is a glyph, not a name. **(tested: no numbered cartridge)**
- **Coins are never a currency.** Amounts are always dollars. No "coins" as a count or a unit, no coin balance, no "buy coins". The coin is a mark beside a dollar figure, nothing more. **(tested)**
- **No chance words beside money.** luck, lucky, mystery, surprise, random, spin, jackpot, bet, odds, prize, loot, win, winner, gamble, chance: none of them in a money string or on `/contribute`. Every money action names where the money goes. **(tested on every `legal.ts` string and every string that mentions money)**
- **Money format.** "$" figures. `/contribute` and `/ledger` say once "All amounts are in US dollars (USD)". Money out uses the minus sign (U+2212) with no space and a direction word: "−$0.42 spent", never a hyphen before a dollar figure. **(tested)**
- **Inside the font.** Every character in `copy.ts` and `legal.ts` is inside the font subset `platform/site/scripts/fonts.sh` cuts: Basic Latin, Latin-1, U+2010 to U+2027 and U+2212. Arrows are glyphs, never characters. **(tested)**
- **No origin story for the name**, and no theatre, balcony, curtain or seat imagery in words either.

## Supporters and agent steps

- **A supporter is a number.** "Supporter 12", or "Founding supporter 3" for a first payment before the studio's first agent credit purchase (PLAN.md §10 decision 62); never a name, an email, an amount or a time beside it. A card lists the first 24 in number order, then "and n more", or says "No supporters yet." (`legal.ts`)
- **Agent steps are fixed lines.** Each event says one line from its key in `copy.eventLines` ("read a file", "ran a command", "handed in its change", "passed the checks"), a run by the same agent on the same card collapses into one with a count ("Builder A read 12 files"), and a step with no line never shows. No path, command, message or tool output is ever quoted.
- **/thanks says what the payment did, in its own words** (`legal.thanks`): "Recording your payment…" while it waits, then "Thank you" with "You are Supporter 12." and one state line per card reached ("Open for funding", "Funded and waiting for the agents.", "Being built now.", "Being checked.", "Live."), and the held, waiting, reversed and terms lines. The board's test payment and a visit with no session get a plain thank-you.

## Weekly reports and Discord posts

- **/reports** (`docs/specs/studio-reports.md`): each report in the kernel's fixed template (`legal.reportFacts`): "Week of 14 Sep 2026", then Cards shipped, Spent from contributions, New supporters and Open for funding, the shipped cards with "$0.29 from contributions · funded by Supporter 1, Founding supporter 2 and 3 more", and First in line to fund. With none yet: "No weekly report yet. A report is published after a week in which a card shipped."
- **A ship post:** "Shipped: <title>. Built by <role> for $0.29 from contributions, funded by Supporter 3, Founding supporter 1 and 2 more. Watch how it was built: <site>/card/<id>". At $0.00 from contributions the cost clause is left out, and with no supporter the funded clause.
- **A weekly post:** "The week of 14 September at Mob Machine: 2 cards shipped (<title>, <title>). 6 cards were open for funding when the report was published. Read the report: <site>/reports". It names its week, never "this week", and the open count is the report's own; with none, "No card was open for funding when the report was published." It is posted only during the week after the report's week, and a report found later is recorded stale and never posted.
- Both are fixed templates with the titles escaped, in the dispatcher (`platform/dispatcher/src/outbound.ts`); no model writes them.

## Still true

These carry over from the design guide:

- Plain, short, declarative. One idea per sentence. Sentence case.
- "Contributions", never "donations".
- Money is `$0.00`. Counts use thousands separators.
- Never describe something that does not exist yet.
- No dates or deadlines the board has not set.
- **A posted Terms version is never edited.** Its words in `src/lib/terms-versions.ts` are what applied to the money given while it was in force. A change, even a typo fix, is a new version posted by the procedure in `docs/specs/legal-copy.md`. These rules are checked on the newest version only, so a later rule never forces an edit to posted words.

## Checking a draft

Read it aloud. If it sounds like a poster, rewrite it as something you would say to a friend across a table. Then check it against the list above.
