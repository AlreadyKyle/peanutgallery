# Load test

Status: agreed. Card: none. Owner: studio (the Janitor's scalability area, `docs/strategy/operating-system.md`).

## Problem

The site has never been load tested. `docs/specs/final-state.md` (Scale) says public reads are documents cached at the edge so a crowd costs the database almost nothing, and `docs/strategy/operating-system.md` (Load tests) asks for a load test before each growth beat, but nothing measures either claim. The quick closed-loop script in `platform/site/scripts/load-test.mjs` keeps a fixed number of requests in flight, reads no cache header and has never run against production.

## Scope

In: a dependency-free load test of the public read paths a launch spike would hit (`platform/ops/load/load-test.mjs`); its unit and end-to-end tests (`platform/ops/test/load.test.mjs`, run by `pnpm test:ops`); a workflow that runs it against production once after merge and by hand, and against a local `vite preview` on pull requests (`.github/workflows/load-test.yml`); the thresholds, the limits and a capacity note.

Out: write paths of any kind (`/api/count`, `/api/thanks`, `/api/unsubscribe`, the community sign-in and player RPCs, votes, suggestions, seeds), Stripe and checkout, the board's site, and the game's own runtime. Raising cache windows or plans: the capacity note says where the limits are, and a later change acts on it. `platform/site/scripts/load-test.mjs` and its test stay as they are.

## Behaviour

### What it reads

GET only, to these paths and nothing else (`targetsFor` in the tool):

| Path | Kind | CDN window (s-maxage) | Supabase calls per build | Per-address rule |
|---|---|---|---|---|
| `/`, `/how-it-works` | static page | Netlify's default | 0 | none |
| `/assets/<the home page's script>` | static, immutable | one year | 0 | none |
| `https://play.mobmachine.games/` | the game's static page | Netlify's default | 0 | none |
| `/api/live`, `/api/cards`, `/api/reports` | function | 60 s, 300 s, 3600 s | 1 | snapshot.mts: 300 a minute |
| `/feed.xml` | function | 120 s | 2 | none |
| `/api/community/feed`, `goals`, `studio`, `seeds?sort=trending`, `suggestions?sort=top` | function | 5, 30, 30, 15, 15 s | 1 | none |
| `/card/<id>` | edge function over `/api/card/<id>` | runs every request | 0 (reads the cached document) | counted with card.mts |
| `/api/card/<id>`, `/api/card/<id>/preview.png` | function | 60 s, 600 s | 1 | card.mts: 300 a minute |

The card id is the newest live card in `/api/live` (as the live check picks it), or `--card`. A path's answer must carry the expected Content-Type, so a page served in place of a missing document (the site's catch-all rewrite answers 200) counts as an error. A 3xx counts as an error too.

### How it loads

Open loop at a fixed arrival rate: each 20 ms tick hands every path the requests its rate has earned and sends them without waiting for earlier answers, so a slow answer never slows the next request. The rate climbs in steps to `--rate`: 10%, 30%, 60% and 100% of it, each held a quarter of `--duration`. The default production run is 5, 15, 30 and 50 requests a second, 30 seconds each: 2,992 requests over two minutes, never more than `--max-requests` (3,000).

The mix weights the static pages over the functions and holds each function group under a cap: 3 a second for the snapshot documents, 3 for the card documents and page, 4 for the community documents and 1 for the feed. One address runs the whole test, and the site's per-address rules allow 300 a minute (5 a second), so the test can never be why a rule answers 429 to anyone else, and it stays far under the rule itself. At the 50-a-second peak the functions take 9.4 requests a second (19% of the run, 568 requests); the rest are static files the CDN serves without a function.

### Supabase load

With the CDN working, Netlify's durable cache builds each document at most once per window whatever the traffic, so the default run causes at most 69 Supabase RPC calls in two minutes (the plan's figure, `--plan`): 25 of them the community feed's 5-second window. If nothing were cached, the 568 function requests would be 533 RPC calls; the origin budget below stops the run long before that, at 200 function answers built by the function, so the worst case is about 250 RPC calls over two minutes, about 2 a second, all read-only RPCs that anon may call. Real visitors' reads are served from the same cache entries, so they see no change.

### Stop conditions

The run aborts at once, stops sending and prints `ABORTED` with the reason when:

- a step's error rate is over 2% once it has 50 answers;
- a step's p95 is over 2,000 ms once it has 50 answers;
- more than 200 function answers came from the function rather than the CDN (a Cache-Status with no `hit`, or, in production, none at all).

It stops sending, without failing, when it has sent `--max-requests`. A production run is refused above 100 requests a second, 300 seconds or 10,000 requests, and any production host is refused without `--i-mean-production`.

### Thresholds

The run passes only when all of these hold over every answer:

| Threshold | Value | Source |
|---|---|---|
| Error rate (non-2xx, timeouts, wrong Content-Type) | 1% or less; 0.1% printed as the target | `docs/strategy/benchmarks.md` §2, Site error rate: target below 0.1%, floor 1% |
| Cache hit ratio over the function documents | 80% or more; 95% printed as the target | `benchmarks.md` §7, Edge cache hit rate: target 95%, floor 80% |
| p95 response time | 800 ms or less | `benchmarks.md` §8 sets Largest Contentful Paint at 2.5 s; the server's share of it is held to web.dev's "good" Time to First Byte, 800 ms |
| p99 response time | 1,800 ms or less | web.dev's "poor" Time to First Byte line, 1.8 s |

The response time is the whole answer, body included, from the runner, which is stricter than Time to First Byte. A stale answer served while the CDN rebuilds counts as a hit; the edge page `/card/<id>` runs on every request and is left out of the hit ratio.

### How to read the result

The first line is the verdict: `PASS`, `FAIL` or `ABORTED`, the requests, the throughput and p50, p95, p99, the error rate and the cache hit ratio. Then the thresholds and the stop conditions, a `stopped:` line when the run stopped early, one row per step and one per path (requests, requests a second, p50, p95, p99 in ms, error rate, hit ratio), each failed answer as `error: <path> <status> x<count>`, the 429 count, and a `supabase:` line with the function answers built or revalidated and the RPC calls they cost. Read a FAIL by its `over threshold:` lines. A step whose p95 climbs with the rate while its error rate stays at zero is the place where capacity starts to bend; a path whose hit ratio is low is a cache key that misses.

### Where it runs

- **After merge:** the `load-test` workflow's production job runs once on the push to main that adds or changes the tool or the workflow, against `https://mobmachine.games` and the game at `https://play.mobmachine.games`, with the defaults above.
- **By hand:** the workflow's Run workflow button (workflow_dispatch) takes the base URL, the peak rate, the duration and the request cap. A cloud session cannot start a workflow, so it reads the latest run instead: the first line of the Load test step, also in the run's summary.
- **Locally and on pull requests:** `node platform/ops/load/load-test.mjs http://127.0.0.1:<port> --profile static` against `vite preview` of a site build (no functions there, so the static profile reads the pages, the script, `/version.json` and `/og.png`). The workflow's local job does this on any pull request that changes the tool.
- **Before a growth beat:** `operating-system.md` asks for 10 times the last beat's peak against a preview deploy. Run it by hand with that rate against the deploy preview's address, which the tool treats as production (`*.netlify.app`) and holds to the same ceilings.

### Capacity note

What breaks first, and at what level. Inferred means reasoned from the code and the providers' published limits; measured means read from a run. The production run after merge replaces the inferred levels it can reach with measured ones in Evidence.

1. **The per-address rules, for crowds behind one address (inferred).** `/api/live`, `/api/cards` and `/api/reports` share one rule of 300 requests a minute per address, and the card documents another. Every page load reads `/api/live` and `/api/cards`, and each open tab polls `/api/live` once a minute. So about 150 page loads a minute from one address answer 429 on the documents: a school, an office, or a mobile carrier's shared address during a launch link spike. The page still draws (the documents fail soft), but the figures go missing. This is the first thing a spike breaks, and it breaks for some visitors while the site is otherwise fine.
2. **Netlify's monthly allowances under a sustained spike (inferred).** The code's comments name the legacy Free plan: about 100 GB of bandwidth, 125,000 function invocations and 1,000,000 edge function invocations a month (Netlify's published allowances; check the team's plan). A first home visit moves about 0.4 MB (the 165 KB gzipped script, the stylesheet, two fonts, the explainer's poster and loop), so about 250,000 first visits a month exhaust the bandwidth before anything else slows down. Cached document hits cost no function invocation; `/card/<id>` runs its edge function on every view, so a card link that goes viral spends edge invocations one per view.
3. **Function cold starts and the preview image (inferred).** A cold Netlify Function adds a few hundred milliseconds; `/api/card/<id>/preview.png` also loads resvg's wasm and two fonts and draws a 1200x630 image, likely 1 s or more cold. It is cached 10 minutes, so it shows only in p99 and in the first share of a new card.
4. **Supabase, only through cache-key fan-out (inferred).** With the documents cached, the fixed documents cost about 0.5 RPC calls a second whatever the traffic (the community feed's 5-second window is most of it), far below the free tier's connection pool. Load reaches Supabase in proportion to traffic only through keys that are each cached on their own: every card id, every profile handle, every page cursor and sort. A crawler walking every card, or someone requesting random card ids, makes one RPC call per request, bounded by the 300-a-minute rule per address.
5. **The writes (not tested here).** Votes, suggestions and counts are never cached and go through the RPCs' per-account limits; `operating-system.md` puts a queue in front of them from 10,000 concurrent visitors. This test leaves them alone by design.

## Acceptance criteria

- [x] The tool reads only the GET paths in the table above; no path is a write, checkout, sign-in or RPC route (`load.test.mjs`, no target is a write path).
- [x] The default production plan climbs 5, 15, 30, 50 requests a second over 30-second steps, sends 3,000 requests or fewer, sends under a quarter of them to functions, and bounds Supabase at under 100 RPC calls with the CDN working (`load.test.mjs`, the production plan).
- [x] Every capped group stays under its per-address rule even at the 100-a-second ceiling (`load.test.mjs`).
- [x] A step over 2% errors or a 2-second p95 aborts the run at once and says why; the origin budget aborts on function answers that did not come from the cache; the request cap stops sending (`load.test.mjs`, the stop conditions, and the run against a failing server).
- [x] Production hosts are refused without `--i-mean-production`, and a production run is refused above 100 requests a second, 300 seconds or 10,000 requests (`load.test.mjs`, the command line).
- [x] The report gives p50, p95, p99, the error rate, the throughput and the cache hit ratio per step and per path, and fails on the thresholds above (`load.test.mjs`, the stats math and the verdict).
- [x] The workflow reads contents only, persists no credential, names no secret, hands its inputs to the tool through the environment, and runs production once after a push to main that changes the tool, and by hand (`load.test.mjs`, the workflow).
- [x] The production run after merge passes, and its first line is quoted in Evidence (run 39069065198, at the 30-a-second peak).

## Verification

- `node --test platform/ops/test/load.test.mjs`, and `pnpm test:ops`, which imports it.
- A site build served by `vite preview` on a port from 4430 to 4439, then `node platform/ops/load/load-test.mjs http://127.0.0.1:<port> --profile static --rate 50 --duration 120`: its first line reads `PASS`.
- `node platform/ops/load/load-test.mjs https://mobmachine.games --i-mean-production --plan`: the plan's request count and Supabase bound.
- After merge: the `load-test` workflow's production run on the merge commit; quote the first line of its Load test step.
- `pnpm test:docs`, `pnpm secret-scan`, `pnpm verify:changed`.

## Evidence

First production run, `load-test` run 39067389558 on the merge commit 68fd76a (#197), 2026-10-17 20:36 UTC, one Actions runner:

```
ABORTED load-test https://mobmachine.games requests=1693 rps=18.0 p50=6ms p95=107ms p99=621ms error_rate=1.1% cache_hit=89.5%
stopped: step error rate 8.59% over 2.00% after 198 requests
step                                   reqs    rps    p50    p95    p99  errors   cache
1: 5 req/s x 30s                        140    4.7      8    909   2004    0.0%   87.9%
2: 15 req/s x 30s                       448   14.9      7    182    710    0.0%   96.4%
3: 30 req/s x 30s                       906   30.2      6     32    120    0.0%   98.9%
4: 50 req/s x 30s                       199   49.5      5     52    116    9.0%   98.3%
error: / 403 x15
error: /how-it-works 403 x2
error: /api/live 403 x1
supabase: 30 function answers were built or revalidated (miss 30, stale 0), so at most 31 RPC calls
```

What it measured:

- Up to 30 requests a second from one address the site answered every request: 0 errors, p95 32 ms and a 98.9% cache hit ratio in that step. The first step's slower p95 and p99 are the cold edge and preview image filling the cache.
- Four seconds into the 50-a-second step, static pages (`/`, `/how-it-works`) began answering 403 to the runner. No rule in this repository limits the static pages (the code-based rules sit on the documents and answer 429), so the 403 comes from Netlify's own per-address protection in front of the site (inferred from the status and the paths). It refused one address sending about 17 home page loads a second; it is not the site running out of capacity, and visitors at other addresses are not refused by it.
- The stop condition worked as designed: the run aborted at once, with 1,693 requests sent and at most 31 RPC calls reaching Supabase.

Second production run, `load-test` run 39069065198 on eab933d (#200), 2026-10-17 21:00 UTC, peak 30 a second:

```
PASS load-test https://mobmachine.games requests=1791 rps=14.9 p50=6ms p95=178ms p99=580ms error_rate=0.0% cache_hit=88.8%
step                                   reqs    rps    p50    p95    p99  errors   cache
1: 3 req/s x 30s                         88    2.9     10   1107   2094    0.0%   81.8%
2: 9 req/s x 30s                        269    9.0      7    549    626    0.0%   97.0%
3: 18 req/s x 30s                       536   17.9      6    257    429    0.0%   97.6%
4: 30 req/s x 30s                       898   29.9      6     21    107    0.0%   98.9%
supabase: 34 function answers were built or revalidated (miss 34, stale 0), so at most 35 RPC calls
```

So a single runner measures the site up to about 30 requests a second and the per-address protection above that. Capacity above that needs load from many addresses, which this test does not do (Decisions).

## Decisions

- 2026-10-17: the load test runs from Actions, one address, so its mix holds each function group under the per-address rules instead of spreading over many runners. A test that trips the rules measures the rule, not the site, and a single runner is enough for the default 50 requests a second.
- 2026-10-17: after the first production run, the workflow's production peak defaults to 30 requests a second, the highest step one runner held with no errors. A higher peak from one runner measures Netlify's per-address protection, not the site. Testing beyond it means many addresses at once, which is a later decision because it looks like the abuse the protection exists to stop.
- 2026-10-17: latency thresholds come from Time to First Byte guidance under the LCP benchmark, because `benchmarks.md` has no server latency row. The review team may replace them with a measured baseline.
