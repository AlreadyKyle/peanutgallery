# Board setup: everything that needs Kyle

Every item that blocks the studio, in the order that unblocks the most work soonest. Each one says
why it blocks, exactly what to do, how you know it worked, and what to tell me afterwards.

Sources: `platform/ops/README.md` (Operator inputs, Provision), `docs/specs/vps.md`,
`docs/specs/launch-pages.md`, `.env.example`, `docs/ROADMAP.md`.

**Two rules.**

1. **Never paste a key, token or ping URL into the chat.** They go in `.env`, in `.env.vps`, or in an
   `export` in a terminal. I can read `.env` and run commands; I can never type a secret for you.
2. **If a screen does not match these words,** the provider changed its UI. Tell me what you see
   rather than guessing — I will not be able to tell from the result that you picked the wrong thing.

**How to reply.** Each item ends with a line in quotes. Sending me that line is all I need.

---

## Progress

What is left, in the numbering the sections use. Numbers never change as things finish, so a line
you wrote down stays valid. Finished items move to **Done** at the bottom of this file, with what was
checked and when.

| # | Item | Status |
|---|---|---|
| 4 | hello@peanutgallery.games | waiting on you (GoDaddy; no MX records exist yet) |
| 5 | ntfy topic | **subscribe on your phone** — I made and tested the topic; the webhook secret needs your allow |
| 6 | healthchecks.io check | waiting on you |
| 7 | VPS GitHub token | waiting on you — now one pre-filled link |
| 8 | Studio Anthropic credit | waiting on you |
| 9 | Day-7 kill line | **needs your OK** — I tried to delete it and the edit is held for your approval |
| 10 | Funding target vs agent spend ceiling | **needs your call** |
| 2b | Oracle sign-up and one sign-in command | waiting on you — I launch the instance by script after it |
| Part 3 | Hand me the two values | needs 6 and 7 first |
| Part 4 | Cutover, contribution, clip, Go live | later, with me |

Done so far: **4 of 12** — image provider and key; TOTP on /board; legal text review; SSH key (2a).

---

## Part 1 — Quick ones. Any order, none depends on another.

### 4. hello@peanutgallery.games — live criterion 4

**Why it blocks.** The Contact page already links this address. Right now mail to it goes nowhere.

**Do this.**

I checked on 22 September: the domain's DNS is at **GoDaddy** (`ns45/ns46.domaincontrol.com`) and
it has **no MX records at all**, so every message to any @peanutgallery.games address bounces today.
Any forwarder needs an account in your name, so this one stays yours.

1. Sign in at GoDaddy → the domain → **Email forwarding** (if GoDaddy offers it on this domain), or
   use a free forwarder such as ImprovMX, which gives you two MX records to add in GoDaddy's DNS.
2. Forward `hello@peanutgallery.games` to kyle@clayhouse.studio. An alias is enough.
3. Send it a test message from another address and confirm it arrives.

After you tell me, I check the MX records with `dig` and record them here.

**Tell me:** "hello@ works, test mail arrived."

---

### 5. ntfy topic — one of four VPS inputs

**Why it blocks.** The dispatcher's alert unit posts here when it fails for good, and the Stripe
webhook posts here too. Without it, an unattended failure is silent.

**What I did, 22 September.** Generated an unguessable topic without printing it, saved the URL as
`NTFY_TOPIC_URL` in `.env.vps` at the repository root (gitignored, mode 0600), and posted a test to
it: HTTP 200. The topic name is on your Mac's clipboard. Anyone who knows it can read and post your
alerts, so it stays out of chat.

**Do this.**

1. Install the **ntfy** app on your phone (App Store / Play Store).
2. In the app: **+** → paste the topic name (Universal Clipboard carries it from the Mac; if the
   clipboard has moved on, `cut -d/ -f4 .env.vps | tr -d '\n' | pbcopy` puts it back) → Subscribe. Leave the
   server as ntfy.sh.
3. Tell me, and I post a second test so you see it arrive.

**One allow I need.** The Stripe webhook also posts to this topic, from the Supabase function secret
`NTFY_TOPIC_URL`. Setting that secret on production was held for your approval. Allow it when I ask,
or run this yourself at the repository root:

```bash
set -a; . ./.env; . ./.env.vps; set +a; cd platform && npx supabase secrets set --project-ref lyxndueoeisyqzewflpu NTFY_TOPIC_URL="$NTFY_TOPIC_URL"
```

**Tell me:** "subscribed to ntfy."

---

### 6. healthchecks.io check — one of four VPS inputs

**Why it blocks.** It is how you find out the VPS dispatcher stopped pinging. The ops runbook fixes
the timings, so use these exactly.

**Do this.**

1. Sign up at healthchecks.io with **kyle@clayhouse.studio**.
2. Add a check:
   - Name: `peanutgallery dispatcher`
   - **Period: 1 minute**
   - **Grace time: 5 minutes**
3. Under Notification methods, confirm your email is on and gets this check.
4. Copy the ping URL. It looks like `https://hc-ping.com/<uuid>`. Put it in `.env.vps` (Part 3).
   Keep it out of chat.

**Note.** The period is 1 minute, not 5. The dispatcher pings every tick, and an earlier note of
mine said 5 — `platform/ops/README.md` is the version of record.

**Tell me:** "healthchecks check is created."

---

### 7. Fine-grained GitHub token for the VPS — one of four VPS inputs

**Why it blocks.** The VPS clones and pushes with its own token, never your Mac's. The provisioning
script refuses a token equal to the Mac's `GITHUB_TOKEN`, so this must be a new one.

No API creates a fine-grained token, so this stays yours, but GitHub now takes the settings in the
link, which leaves one choice to make by hand.

**Do this.**

1. Open this link. It fills in the name, owner AlreadyKyle, a 366-day expiry, and exactly the
   permissions the VPS needs — Contents read and write, Pull requests read and write, Checks read
   (Metadata read is added by GitHub):

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-vps&description=Peanut+Gallery+VPS+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&checks=read

2. The one thing to choose: Repository access → **Only select repositories** → `peanutgallery`.
3. Check the permissions list shows those four and nothing else — no Workflows. Change the expiry if
   you want; rotation is in `platform/ops/README.md`.
4. Generate, and copy the token. It is shown once. Put it in `.env.vps` (Part 3). Keep it out of chat.

**Tell me:** "VPS GitHub token is created."

---

### 8. Studio Anthropic prepaid credit

**Why it blocks.** Unattended cards bill the studio organisation's key, not your Max subscription.
`STUDIO_ANTHROPIC_API_KEY` is already set in `.env`; the organisation it belongs to just needs money
in it. This is studio money, not pool money.

**Do this.**

1. console.anthropic.com → sign in → switch to the **studio** organisation (the one that key belongs
   to, never your personal one). If you are unsure which it is, open Settings → API keys in each
   organisation and find the key whose prefix matches the one in `.env` — I can print you the first
   few characters safely if you ask.
2. **Billing** → buy prepaid credit.
3. Turn **auto-reload off**.
4. Set a **monthly spend limit of $500**, which is the guardrail the ops runbook assumes.
5. Amount is your call. For scale: the six shipped cards cost $0.82 in total.

**Tell me:** "Studio credit is loaded."

---

### 9. One decision, one reply

The day-7 kill line in the docs reads "under 300 peak concurrent". It was a stream number, and the
stream has left launch scope, so nothing measures it any more.

You said nothing, so on 22 September I went to delete it from `docs/PLAN.md` (the day-7 row keeps
its other three criteria). The edit was held for your approval, because it changes a kill criterion.
The day-30 row has the same problem: "under 150 average concurrent" is also a stream number.

**Tell me:** "delete it" (day 7 only), "delete both", or the site-first numbers you want instead.

---

### 10. Funding target vs agent spend ceiling — your call, 19 September

**What you saw.** "Daily cap $100.00. Card maximum $25.00." on /board.

**What those two numbers actually are.** Agent burn limits, not contribution limits. Nothing stops
anyone giving any amount. Detail and the options are below in this file under **Open decisions**.

**Tell me:** which of the three options, and any numbers you want changed.


---

## Part 2 — The Oracle instance. Your part is a sign-up and one command.

**Why it blocks.** Live criterion 2 is the dispatcher running unattended on a server. Today it runs
on your Mac, billed to you. Any Ubuntu 24.04 host works; Oracle's free tier is what the runbook was
written against.

**What changed, 22 September.** The console walk-through is gone. `platform/ops/oracle-launch.sh`
(spec `docs/specs/oracle-launch.md`) builds the network, launches the instance, and keeps retrying
every availability domain while Oracle says "Out of capacity" — the free Ampere tier's usual answer,
which by hand meant clicking Create again for hours. It checks the firewall is TCP 22 only, proves
ssh, and can rebuild the box the same way later. The SSH key (2a) is made, so all that is left is
the account, which only you can create.

### 2b. Sign up, then sign in once from the terminal

1. cloud.oracle.com → **Start for free**. **Home region: Canada Southeast (Toronto),
   `ca-toronto-1`.** Montreal (`ca-montreal-1`) is the accepted alternative. The home region cannot
   be changed later. Stop once you reach the console home page; create nothing there.
2. In the **Terminal tab inside Claude**, run:

   ```bash
   oci session authenticate --region ca-toronto-1 --profile-name peanutgallery
   ```

   A browser window opens; sign in with the Oracle account. The CLI is already installed. No API key
   is created, and the sign-in lasts 24 hours with refresh, which covers a long capacity wait.

**Tell me:** "Oracle is signed in."

Then I run the script, with your allow, and quote the `RUNNING` state, the address and both
`ssh … ok` lines. If capacity never frees up, any Ubuntu 24.04 host works unchanged, including a
cheap paid instance elsewhere — that would be your call, because it costs money.

---

## Part 3 — Hand me the two values. Two minutes, and it never touches the chat.

The address comes from my script and the ntfy URL is already in `.env.vps`. What is left are the
healthchecks ping URL (item 6) and the VPS GitHub token (item 7). Open `.env.vps` at the repository
root in any editor and add two lines under the one that is there:

```bash
VPS_GITHUB_TOKEN=github_pat_...
HEALTHCHECK_URL=https://hc-ping.com/...
```

Substitute your real values, no quotes. The file is gitignored and readable only by you.

**Tell me:** "VPS inputs are set."

Then I take over: I load `.env.vps` into the shell and write the env file with
`platform/ops/make-dispatcher-env.sh` (it prints key names, never values), upload it to the server as
root-only 0600, install the ntfy URL for the alert unit, and run `provision.sh` twice — the second run
must print `provision: done: 0 change(s)`. I quote every check as I go.

---

## Open decisions

### Caps: what they are, and the one that is worth changing

**Nothing caps what a supporter can give.** The two numbers on /board are limits on what the *agents*
may spend, and they appear on /board only. The public site says one sentence about them: "Agents
spend contributions only on funded cards, within set caps."

| Number | What it limits | Where |
|---|---|---|
| Daily cap $100 | API money the agents may burn in a day, as `min(pool balance, $100)` | `throttle.ts`, `tick.ts` |
| Card maximum $25 | agent spend on one card, as `min(1.5 × estimate, $25)` | `session.ts:59` |
| Card maximum $25, again | **the funding target a card may ask for** | `Board.tsx:594` and `file_card` in `20260915000000_live_cut.sql:226` |

The daily cap is not binding today: the pool holds $0.50, and the cap is the lower of the balance and
$100, so the balance is what stops the agents. For scale, the six shipped cards cost $0.82 in total.

**Where you are right.** The third row. `card_max_usd` does double duty: it caps agent spend *and*
caps what a card may ask the community for. `file_card` refuses a target above it server-side with
"The funding target must not exceed the per-card maximum". So no card can ask for more than $25 —
that is a real ceiling on community money per card, and it is the thing worth fixing.

**Where the framing is off.** A supporter can already give any amount. Above $50 per contributor per
day the excess is *held* for 14 days and then credited, per `docs/specs/refunds-and-holds.md` — a
$120 contribution credits $50 now and $70 on release. That is chargeback protection, not a refusal.

**What the kernel actually fixes.** `docs/PLAN.md:139` puts "spend caps" among the rules no card,
vote, regime or org change may edit. It fixes that caps *exist*, not what they are set to:
`PLAN.md:237` says "Caps live in `studio_state` and are edited from the board; the environment values
are the initial seeds", and `PLAN.md:151` lists spend caps as a board control needing the second
factor. So the numbers are yours to change; removing the caps outright is a kernel change and I would
argue against it — they are what stops a looping agent draining the pool, and the pool is customer
money.

**Three options.**

1. **Raise the numbers.** A minute's work at /board, needs your TOTP, no code. Fixes the $25 ask
   ceiling by moving it. Both meanings move together, so the agents' per-card burn ceiling rises with
   it.
2. **Split the two meanings** *(what I would do)*. A card's funding target stops being bounded by the
   agents' spend ceiling. The community can fund a card at any size; the agents still cannot burn
   more than a bounded amount building it. Needs a spec, a migration to `file_card`, and a /board
   change. It also needs one decision from you: what happens to money raised above what a card costs
   to build — it goes to the pool and funds later cards, but the site has to say so plainly.
3. **Both.** Split them, and set the new ceiling where you want it.

My recommendation is 2, with the agent ceilings left where they are: at $0.14 a card so far, $25 is
about 180 times what a card costs, so it constrains nothing except the ask.

---

## Part 4 — Later, with me. Nothing to do yet.

These come after Part 3 and after I finish two pieces of my own work: agent sessions under a
separate user, and the API-key proxy that keeps the studio key out of agent sessions. The roadmap
requires both before any unattended card runs.

### A. Cutover

I prompt you at each point; the whole thing is about fifteen minutes.

1. You: **Pause** at /board.
2. Me: stop the Mac dispatcher, confirm no dispatcher process is left.
3. You: set the agent mode to **unattended** at /board. This needs your second factor, which is why
   item 2 comes first.
4. Me: start the service, then read the journal for `startup probe passed` with
   `"apiKeySource":"ANTHROPIC_API_KEY"`, and quote it.
5. You: confirm /board shows the dispatcher seen under 3 minutes ago, and healthchecks.io is green.
6. You: **Resume**.
7. Me: restart test, reboot test, then stop the service and wait out the grace so healthchecks emails
   you — that proves the alert path. Start it again.
8. Then a 24-hour soak with no restart loop and no unexpected alert. I quote the results.

### B. One real contribution — closes live criteria 1 and 2 together

After the cutover, so the same payment proves both the money path and an unattended build.

1. Open https://peanutgallery.games/contribute and pick a card.
2. Pay a small amount with your own card. I cannot make payments.
3. I confirm the webhook answered 200, the meter moved, and the card then builds with nobody at the
   keyboard, with `billed_to = 'studio'` ledger rows.

### C. Launch clip and posts

I draft the posts in `docs/launch/`. You record the screen clip and edit the drafts so they sound
like you. The posting is yours.

### D. Go live

At /board, press **Go live**. It works once and cannot be undone. Then post.

---

## Reply crib sheet

Copy any of these back to me as you finish:

- "hello@ works, test mail arrived."
- "subscribed to ntfy."
- "healthchecks check is created."
- "VPS GitHub token is created."
- "Studio credit is loaded."
- "Oracle is signed in."
- "VPS inputs are set."
- "delete it" / "delete both" (the kill lines, item 9)
- "raise the numbers" / "split them" / "both" (the funding ceiling, item 10)

## What I build while you do all this

None of it is blocked by the list above:

1. Strip the stream and every date or deadline you did not set from PLAN, ROADMAP and the agent
   prompts.
2. Backlog core: Now/Next/Later on cards, board reorder/park/cancel/resume, the public `/roadmap`
   page, and the after-live items filed as real Later cards.
3. `docs/PIPELINE.md` and the unwired links: a board alert when a card ships, a way to resume
   orphaned cards, refunds on shipped cards.
4. Docs readability and a decisions index.
5. The image adapter, then `/how-it-works` and `/team`. Unblocked as of 19 September: both keys
   are in `.env` and tested.
6. ~~Write the production results into the merged specs and bring `docs/ROADMAP.md` up to date.~~
   Done 20 September: every check re-run against production and quoted, ten spec statuses corrected,
   the roadmap rewritten.

---

## Done

Newest last. Each entry says what was checked, not just that it happened.

### 1. Image provider and key — DONE 19 September 2026

Nothing left for you here.

You put both keys in `KEYS.md`. I copied them into `.env` (`OPENAI_API_KEY` and
`GOOGLE_AI_API_KEY`), which is gitignored, and tested both against the live APIs before writing
them:

- **OpenAI** — `GET /v1/models` returned HTTP 200, 124 models visible, including `gpt-image-1`,
  `gpt-image-2` and `gpt-image-2.5`.
- **Gemini** — `GET /v1beta/models` returned HTTP 200, 58 models visible, including
  `gemini-2.5-flash-image`, `gemini-3-pro-image` and `gemini-3.1-flash-image`. The key's `AQ.`
  prefix is not the `AIza` form AI Studio usually hands out, but it authenticates on both the
  `key=` query parameter and the `x-goog-api-key` header, so it is fine.

**How I'll use them, unless you say otherwise.** The adapter takes OpenAI as its default with Gemini
behind the same interface, so either can be swapped without touching callers. When I generate the
nine team avatars I'll run a first pass through both providers and put them side by side at /board,
so you approve on what they actually look like rather than on a provider name.

### 2. TOTP on /board — DONE 20 September 2026

Nothing left for you here.

- **Enrolment.** One verified TOTP factor in `auth.mfa_factors`, enrolled 2026-09-20 00:18:56 UTC,
  with no abandoned unverified factor left behind.
- **The second factor proved against a state-changing RPC.** You filed a directive rather than a
  note: card `8bd842eb-8cf7-4f24-a17d-031bd2f97e4b`, "second factor test", at 00:25:54 UTC. That is
  stronger evidence than the note the spec names — `file_directive` is the top-tier board RPC, and
  like `file_note` it refuses a session without `aal2`. I will record it that way in the Evidence
  section of `docs/specs/launch-pages.md` in the docs pull request, rather than asking you to repeat
  it as a note.
- **Open loose end from it:** that directive is a real card, `funded` at priority 0, first in the
  dispatcher's queue. See **Open decisions** below.

### 3. Legal text review — DONE 20 September 2026

You said the text is fine and only needed to be Ontario/Canada. I checked all four pages in
`platform/site/src/lib/copy.ts` and it already was, in both places it matters:

- Terms, "Who runs the studio": "Peanut Gallery is operated by Kyle Smith, an individual in Ontario,
  Canada."
- Terms, "Law": "These terms are governed by the laws of Ontario and the laws of Canada that apply
  there."

No other jurisdiction appears anywhere in Terms, Privacy, Refunds or Contact — no US state, no EU,
no named regulator. Nothing to change, so nothing was changed.

### The "second factor test" directive — RESOLVED 20 September 2026

Deleted. It was card `8bd842eb-8cf7-4f24-a17d-031bd2f97e4b`, left `funded` at priority 0 by the
second-factor test, and it would have been first in the queue once the dispatcher ran and money
covered it.

- Checked first that nothing referenced it: 0 rows in `ledger`, `contributions`, `agent_events`,
  `votes`, `images` and `board_notes`.
- Deleted with the id, title, stage and `actual_usd = 0` all in the filter, so it could match nothing
  else. 1 row deleted, HTTP 200.
- After: the card is gone, 9 cards remain, queue depth 0, 6 live. `ledger` still 65 rows and the pool
  still $0.5019 — the delete touched no money.

### 2a. SSH key for the VPS — DONE 22 September 2026

Nothing left for you here. `~/.ssh` had no key pair, so I made one with no passphrase, the default
this file already named: `ssh-keygen -t ed25519 -C peanutgallery-vps -f ~/.ssh/id_ed25519`.
`ssh-keygen -lf ~/.ssh/id_ed25519.pub` prints
`256 SHA256:1fLWiB1WvhlXXkzbw7/xkUXmRGPsp5NDtozEVZ3ofdk peanutgallery-vps (ED25519)`.
`oracle-launch.sh` gives the public half to the instance; the private half never leaves the Mac.
