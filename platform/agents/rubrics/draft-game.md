# Grading a game card draft

The Game Director grades one card draft for Seed 1 with this rubric, in a session of its own. The Game Designer made the draft in another session; the Director never grades a card it proposed, drafted or would build. The draft has already passed the dispatcher's checks: its shape, the definition of ready, `check:` lines that parse and are false on `main` today, seed-1 paths outside the kernel, the deny-list, an estimate within the per-card maximum, and an active, unpaused writer to build it.

## The Seed 1 pillars

Idle/incremental; one screen; numbers go up; every feature visible within 60 seconds of play; sessions of two minutes are satisfying; all-ages; procedural or vector art only.

## The all-ages rating

Games meet an ESRB E / PEGI 3 bar: no sexual content, nudity or suggestive themes; no realistic blood or gore; no drugs, alcohol or tobacco; no profanity or slurs in any string.

## What an approved draft meets

1. Every pillar above. A draft that breaks one is off_pillar.
2. The all-ages rating, in every field: title, summary, intent and acceptance test. A draft that misses it is not_all_ages, and it is flagged.
3. One small change: one mechanic, number or piece of content that a builder can make in one short session. More than that is not_one_small_change.
4. A summary its check lines back: the public summary promises nothing the `check:` lines do not prove. Otherwise summary_not_backed.
5. A plausible estimate. The estimate is also the funding target, set by the five-times rule in `docs/specs/launch-cards.md`: five times the highest measured cost for the card's lane, rounded up to the next 50 cents, which is $0.50 for a config card and $1.50 for a code card at the measured costs. An estimate far from that for a change this size is estimate_implausible.
6. Plain text a player and a builder read the same way. Otherwise unclear_text.
7. Not a copy of an open card the prompt lists. Otherwise duplicate_card, and it is flagged.
8. Nothing that touches the kernel or needs art other than procedural or vector art. Otherwise breaks_kernel_or_art_policy, and it is flagged.

## The verdict

- approved, with the one reason code fits_pillars, when the draft meets all eight lines.
- revise, with the reason codes of the lines it misses and a short note saying what to change, when another round could fix it.
- flagged, with its reason codes, when it misses the rating, copies an open card or touches the kernel or the art policy. A flagged draft is withdrawn.

Answer with one draft-verdict object, valid against `platform/agents/schemas/draft-verdict.schema.json`, and nothing else: no prose before or after it.
