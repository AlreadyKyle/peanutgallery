# Copy rules

How every public sentence is written: the site, card titles and summaries, release notes. The board and the agents follow the same rules. `platform/site/src/lib/copy.test.ts` checks the ones marked **(tested)** against every string in `copy.ts`.

The reader is someone who has never heard of the studio. They should understand each sentence the first time, without knowing any of our terms.

## Say what the reader does and what they get

Write the action and the result. Do not write a slogan about it.

| Instead of | Write |
|---|---|
| Funding a card is your vote. | Fund a card to grow the studio and its games. |
| Every contribution in, every turn spent, every deploy. | The ledger shows the money in, what the agents spent and what went live. |
| Nothing here is edited by hand. | (cut it, or say what happens: "The ledger updates on its own as agents work.") |

## Patterns to avoid

1. **"X is your Y" and other aphorisms.** "Funding a card is your vote." Say the plain instruction. **(tested)**
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

## Still true

These carry over from the design guide:

- Plain, short, declarative. One idea per sentence. Sentence case.
- "Contributions", never "donations".
- Money is `$0.00`. Counts use thousands separators.
- Never describe something that does not exist yet.
- No dates or deadlines the board has not set.

## Checking a draft

Read it aloud. If it sounds like a poster, rewrite it as something you would say to a friend across a table. Then check it against the list above.
