// Line icons for the shop's unit buttons, drawn like the diorama: 2px ink strokes, flat creature
// fills. Decorative only (aria-hidden); the button's label carries the words.
const INK = '#151515';

const ICONS: Record<string, string> = {
  gatherer: `<ellipse cx="16" cy="18" rx="8" ry="10" fill="#8db9e8"/><circle cx="13" cy="15" r="1.6" fill="${INK}" stroke="none"/><circle cx="19" cy="15" r="1.6" fill="${INK}" stroke="none"/><path d="M16 8V4"/><circle cx="16" cy="3.5" r="2" fill="#8db9e8"/><path d="M12 28h-2M20 28h2"/>`,
  cart: `<path d="M5 12h22l-3 10H8z" fill="#f5b97a"/><path d="M8 12c2-5 14-5 16 0" fill="#f1d99c"/><circle cx="11" cy="25" r="3" fill="${INK}"/><circle cx="21" cy="25" r="3" fill="${INK}"/>`,
  mill: `<path d="M11 29l2-14h6l2 14z" fill="#fdfcf8"/><path d="M10 15l6-5 6 5z" fill="#8db9e8"/><path d="M16 12L7 3M16 12l9-9M16 12L7 21M16 12l9 9"/><circle cx="16" cy="12" r="1.8" fill="#b0226a"/>`,
  forge: `<path d="M5 29V15l11-7 11 7v14z" fill="#c3c7cc"/><path d="M11 29v-7h10v7z" fill="#f5b97a"/><path d="M16 27c-2-2-1-4 0-6 1 2 2 4 0 6z" fill="#f5dc7a"/><path d="M21 11V5h3v8"/>`,
  foundry: `<path d="M4 29V16l6-4v4l6-4v4l6-4v17z" fill="#cbbdee"/><path d="M22 29V6h5v23z" fill="#fdfcf8"/><path d="M22 9h5" stroke="#b0226a" stroke-width="3"/><path d="M9 29v-6h5v6z" fill="${INK}"/>`,
};

const FALLBACK = `<circle cx="16" cy="17" r="10" fill="#f1d99c"/>`;

export function unitIcon(unit: string): string {
  return `<svg class="unit-icon" viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false" fill="none" stroke="${INK}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${ICONS[unit] ?? FALLBACK}</svg>`;
}
