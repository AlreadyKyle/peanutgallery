#!/usr/bin/env python3
"""The fallback metrics in src/tokens.css, computed from the font files, never guessed.

usage (from platform/site): python3 scripts/font-metrics.py [path to Arial.ttf]

While the woff2 loads, text is set in Arial scaled and spaced to take the same room, so the swap
moves nothing. size-adjust is the ratio of the two fonts' average advance widths over English text
(lower-case letters and the space weighted by how often they occur, the method capsize uses);
ascent, descent and line gap come from the woff2's hhea table (it sets USE_TYPO_METRICS, and its
typo values are the same), divided by the size adjustment so the line box matches.
"""
import sys
from fontTools.ttLib import TTFont

WOFF2 = 'public/fonts/atkinson-hyperlegible-next-400-700.woff2'
ARIAL = sys.argv[1] if len(sys.argv) > 1 else '/System/Library/Fonts/Supplemental/Arial.ttf'

# English letter frequencies (per cent), and the space at about one character in six.
FREQUENCIES = {
    'a': 8.2, 'b': 1.5, 'c': 2.8, 'd': 4.3, 'e': 12.7, 'f': 2.2, 'g': 2.0, 'h': 6.1, 'i': 7.0,
    'j': 0.15, 'k': 0.77, 'l': 4.0, 'm': 2.4, 'n': 6.7, 'o': 7.5, 'p': 1.9, 'q': 0.095, 'r': 6.0,
    's': 6.3, 't': 9.1, 'u': 2.8, 'v': 0.98, 'w': 2.4, 'x': 0.15, 'y': 2.0, 'z': 0.074, ' ': 18.0,
}


def average_width(font: TTFont) -> float:
    cmap = font.getBestCmap()
    metrics = font['hmtx'].metrics
    upem = font['head'].unitsPerEm
    total = sum(FREQUENCIES.values())
    return sum(metrics[cmap[ord(ch)]][0] / upem * weight for ch, weight in FREQUENCIES.items()) / total


atkinson = TTFont(WOFF2)
arial = TTFont(ARIAL)
size_adjust = average_width(atkinson) / average_width(arial)
upem = atkinson['head'].unitsPerEm
hhea = atkinson['hhea']
print(f'size-adjust: {size_adjust * 100:.2f}%;')
print(f'ascent-override: {hhea.ascent / upem / size_adjust * 100:.2f}%;')
print(f'descent-override: {abs(hhea.descent) / upem / size_adjust * 100:.2f}%;')
print(f'line-gap-override: {hhea.lineGap / upem / size_adjust * 100:.2f}%;')
