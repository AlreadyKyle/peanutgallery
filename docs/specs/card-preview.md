# Card link preview

Status: built. Card: none (board work). Owner: board.

## Problem

A card's link shows the site's own preview wherever it is shared, so a shared card looks like every other link to the studio. The Share button is built; the preview per card is not (docs/research/comparables.md, item 2).

## Scope

In: a 1200×630 PNG per card drawn in code from the card's public record, served at `/api/card/:id/preview.png`, and the card page's link preview tags (`og:title`, `og:description`, `og:url`, `og:image`, `og:image:alt`, `description`, `<title>`) set to the card's own before the page leaves the CDN.
Out: a picture of the game, supporter names, amounts per supporter, and any change to the page the app draws.

## Behaviour

- `GET /api/card/:id/preview.png` reads `site_card(p_id)` once with the publishable key, as `/api/card/:id` does, and answers the card's face as a PNG. It shares card.mts's rate limit rule, so it takes no rule of its own (legacy Free allows two). The CDN keeps it ten minutes. A card id that is not a uuid or a query string answers 400 before Supabase is called; no card answers 404; a failed read or draw answers 502, never cached.
- The face shows the studio name, the card's state word (copy.ts's), its title and summary (clipped to fit), its supporter count, what the agents have spent on it, its draft-to-live time once it is live, and its Supporter numbers in number order. Colours are tokens.css's; the type is the site's face. The Building and Being checked face is the work colour, as on the site.
- Nothing on the face counts down, suggests chance, or ranks supporters by amount (docs/research/comparables.md).
- An edge function on `/card/*` reads `/api/card/:id` on the same origin (cached 60 seconds) and puts the card's title, summary, address and preview into index.html's tags. When the path is not a card id, the read fails, or the answer has no title, the page goes out unchanged with the site's preview.

## Acceptance criteria

- [x] The preview is a 1200×630 PNG drawn from one `site_card` call (`netlify/card.test.ts`).
- [x] A bad id or query string answers 400 with no Supabase call; no card 404; a failed read 502 no-store (`netlify/card.test.ts`).
- [x] The face's colours equal tokens.css's and its words copy.ts's (`netlify/card-preview.test.ts`).
- [x] Supporters are listed by number only; draft to live shows only once live (`netlify/card-preview.test.ts`).
- [x] The card page's tags name the card, its address and its preview, HTML-escaped, and leave the other tags alone (`netlify/card-preview.test.ts`).
- [ ] Production's newest live card page names its own preview, and that preview is a 1200x630 PNG (the `live-check` workflow, `live-check.mjs`).

## Verification

- `pnpm --filter @backseat/site exec vitest run netlify/`
- `pnpm verify`
- On the pull request's deploy preview: `curl -s <preview>/card/<a live card id> | grep og:image` names `/api/card/<id>/preview.png`, and that address answers `image/png` at 1200×630.

## Decisions

- 2026-10-11: satori lays out the face and resvg (wasm) draws it, inside card.mts, so the image takes no rate-limit rule of its own; the renderer is imported only on the preview path. satori reads woff, so the face comes from @fontsource's static 400 and 700 weights rather than the site's variable woff2.
