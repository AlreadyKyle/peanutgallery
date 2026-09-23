#!/usr/bin/env bash
# The site's one font file (platform/site/DESIGN.md, Type): Atkinson Hyperlegible Next (SIL OFL 1.1,
# public/fonts/OFL.txt), cut from the variable source in brand/fonts to weights 400-700 and to the
# characters the site's words use. Run it from platform/site after changing the ranges or the source,
# then commit public/fonts/atkinson-hyperlegible-next-400-700.woff2 and update the fallback metrics in
# src/tokens.css (scripts/font-metrics.py prints them).
#
# Needs fontTools with brotli: python3 -m pip install 'fonttools[woff]'.
#
# The layout features are pinned: pyftsubset's defaults drop tnum, and money and counts use tabular
# figures (styles.test.ts checks tnum is in the committed file). The ranges are Basic Latin, Latin-1,
# the general punctuation block from the hyphen to the ellipsis, and the minus sign (U+2212) that
# money out uses. The font has no arrows, so arrows are SVG glyphs (src/components/Glyph.tsx).
set -euo pipefail

cd "$(dirname "$0")/.."
PYTHON=${PYTHON:-python3}
SOURCE=brand/fonts/AtkinsonHyperlegibleNext-VF.ttf
OUT=public/fonts/atkinson-hyperlegible-next-400-700.woff2
UNICODES='U+0020-007E,U+00A0-00FF,U+2010-2027,U+2212'
FEATURES='kern,tnum,case,locl'

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Limit the weight axis to 400-700: nothing on the site is lighter than body or heavier than bold.
"$PYTHON" -m fontTools.varLib.instancer "$SOURCE" wght=400:700 --output "$work/instanced.ttf" --quiet

"$PYTHON" -m fontTools.subset "$work/instanced.ttf" \
  --unicodes="$UNICODES" \
  --layout-features="$FEATURES" \
  --flavor=woff2 \
  --output-file="$OUT"

bytes=$(wc -c < "$OUT" | tr -d ' ')
echo "$OUT: $bytes bytes"
