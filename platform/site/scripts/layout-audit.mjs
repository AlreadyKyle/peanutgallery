// The layout audit (DESIGN.md, No dead space): the checks that catch an ugly gap before anyone sees
// it. `auditLayout` runs inside the page (Playwright's page.evaluate), so it closes over nothing and
// reads only the DOM. e2e/layout-balance.spec.ts runs it on every public route in the gate, and
// scripts/gap-audit.mjs runs it on any preview, mockup or page before it is shown to the board.
//
// It returns one line per finding, and none when the page is clean:
// - overflow: no element reaches past the viewport's edges once its clipping ancestors are applied,
//   and the page never scrolls sideways;
// - seam: the top bar, each band and the footer touch, so no strip of page ground shows between two
//   grounds;
// - balance: two blocks side by side in one row (grid cells or flex items) differ in the height of
//   their content by no more than max(160px, 35% of the taller), unless the container or a block is
//   marked data-balance="ignore" (with a comment in the code saying why);
// - hollow: inside a band, no vertical run of empty space between two blocks is longer than 240px;
// - grid cells: a grid of like items in two or more columns puts one item in each cell: no item is
//   wider than one column and every row starts at the grid's content edge; a part-empty last row is
//   fine (the board, 26 Sep 2026; PLAN §10 decision 49);
// - frame: a box with an edge on every side that holds a card, a row or a box is filled by it: its
//   content ends within 2px of the frame's inner right edge, so no empty column runs beside a card
//   inside a dashed example frame;
// - cards, from 768px: across a row of cards the bottoms, titles and funding bars line up, the space
//   above a card's pinned bottom block (its hollow) is at most 80px, the bottom block ends at the
//   card's inner edge, and the corner index stays on one line;
// - buttons: a button's label stays on one line (at most 47px tall);
// - orphan: no glyph or chip narrower than 32px is left alone on a wrapped line of a flex row, and
//   no item of a wrapped row of links or chips (list items, links or buttons) sits alone on a line
//   while another line holds two or more (the footer's Discord link at 375px, 26 Sep 2026);
// - rhythm: a heading in main sits at least as far below the block before it as that block sits
//   below its own predecessor, so no line reads as the caption of the section under it;
// - top bar: at most 61px tall from 360px to 390px wide.

/** The thresholds, in CSS pixels. */
export const LIMITS = {
  balanceFloor: 160,
  balanceShare: 0.35,
  hollow: 240,
  cardHollow: 80,
  frame: 2,
  button: 47,
  topBar: 61,
};

/**
 * Runs in the page. `limits` is LIMITS (passed in, since the function closes over nothing). Returns
 * the findings as strings.
 */
export function auditLayout(limits) {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const box = (el) => el.getBoundingClientRect();
  const style = (el) => getComputedStyle(el);
  const name = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className.trim() !== '' ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    const text = (el.querySelector('h1, h2, h3')?.textContent ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls} "${text}"`;
  };
  const hidden = (el) => {
    // A closed <details> lays its content out without painting it (Chrome's ::details-content is
    // content-visibility: hidden), so its boxes have a size though nothing shows: only its summary
    // is drawn. checkVisibility() reports that; the closed-details test covers a browser without it.
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility()) return true;
    const closed = el.parentElement?.closest('details:not([open])');
    if (closed && el.closest('summary')?.parentElement !== closed) return true;
    const cs = style(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    if (cs.position === 'absolute' && cs.clip !== 'auto' && cs.clip !== '') return true;
    const b = box(el);
    return b.width <= 1 && b.height <= 1;
  };
  const transparent = (colour) => colour === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(colour);
  const REPLACED = new Set(['IMG', 'svg', 'SVG', 'VIDEO', 'CANVAS', 'INPUT', 'TEXTAREA', 'SELECT', 'HR']);
  const paints = (el, cs) => {
    if (REPLACED.has(el.tagName)) return true;
    if (!transparent(cs.backgroundColor) || cs.backgroundImage !== 'none') return true;
    return ['Top', 'Right', 'Bottom', 'Left'].some(
      (side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none' && !transparent(cs[`border${side}Color`]),
    );
  };
  const union = (a, b) => (a === null ? b : b === null ? a : { top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.min(a.left, b.left), right: Math.max(a.right, b.right) });
  const rectOf = (r) => ({ top: r.top, bottom: r.bottom, left: r.left, right: r.right });

  // What each element draws: its own box when it paints (a fill, an edge or a replaced element),
  // its text, and what its children draw. Leaves are kept too, for the hollow check.
  const extent = new Map();
  const leaves = [];
  const walk = (el) => {
    if (hidden(el)) {
      extent.set(el, null);
      return null;
    }
    const cs = style(el);
    let ext = null;
    if (paints(el, cs)) {
      const r = rectOf(box(el));
      ext = r;
      leaves.push({ el, r });
    }
    if (!REPLACED.has(el.tagName)) {
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          if (child.textContent.trim() === '') continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          for (const r of range.getClientRects()) {
            if (r.width === 0 || r.height === 0) continue;
            ext = union(ext, rectOf(r));
            leaves.push({ el, r: rectOf(r) });
          }
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          ext = union(ext, walk(child));
        }
      }
    }
    extent.set(el, ext);
    return ext;
  };
  walk(document.body);

  const ignored = (el) => el.closest('[data-balance="ignore"]') !== null;

  // Overflow: the page never scrolls sideways, and no element reaches past the viewport once its
  // clipping ancestors are applied.
  if (document.documentElement.scrollWidth > vw + 0.5) out.push(`overflow: the page is ${document.documentElement.scrollWidth}px wide at ${vw}px`);
  let overflowing = 0;
  for (const el of document.body.querySelectorAll('*')) {
    if (extent.get(el) === null || extent.get(el) === undefined) continue;
    let r = rectOf(box(el));
    if (r.right - r.left <= 1) continue;
    for (let a = el.parentElement; a !== null && a !== document.body; a = a.parentElement) {
      const cs = style(a);
      if (cs.overflowX !== 'visible') {
        const c = box(a);
        r = { ...r, left: Math.max(r.left, c.left), right: Math.min(r.right, c.right) };
      }
    }
    if (r.right - r.left <= 0) continue;
    if (r.left < -0.5 || r.right > vw + 0.5) {
      overflowing += 1;
      if (overflowing <= 3) out.push(`overflow: ${name(el)} spans ${Math.round(r.left)} to ${Math.round(r.right)} at ${vw}px`);
    }
  }

  // Seams: on a page of bands, the top bar, each band and the footer touch exactly.
  const bandList = [...document.querySelectorAll('main > .band')];
  const stack = bandList.length === 0 ? [] : [document.querySelector('.topbar'), ...bandList, document.querySelector('.site-footer')].filter((el) => el !== null);
  for (let i = 1; i < stack.length; i += 1) {
    const gap = box(stack[i]).top - box(stack[i - 1]).bottom;
    if (Math.abs(gap) > 0.5) out.push(`seam: ${gap.toFixed(1)}px of page ground above ${name(stack[i])}`);
  }

  // Rows of side-by-side blocks, in any grid or row-direction flex container.
  const rowsOf = (items) => {
    const sorted = [...items].sort((a, b) => box(a).top - box(b).top);
    const rows = [];
    for (const item of sorted) {
      const b = box(item);
      const row = rows.find((r) => b.top < r.bottom - 1 && b.bottom > r.top + 1);
      if (row === undefined) rows.push({ top: b.top, bottom: b.bottom, items: [item] });
      else {
        row.items.push(item);
        row.bottom = Math.max(row.bottom, b.bottom);
      }
    }
    return rows;
  };
  const inFlow = (el) => extent.get(el) && !['absolute', 'fixed'].includes(style(el).position);

  for (const container of document.body.querySelectorAll('*')) {
    const cs = style(container);
    const grid = cs.display === 'grid' || cs.display === 'inline-grid';
    const flexRow = (cs.display === 'flex' || cs.display === 'inline-flex') && cs.flexDirection.startsWith('row');
    if ((!grid && !flexRow) || extent.get(container) === null || extent.get(container) === undefined) continue;
    const items = [...container.children].filter(inFlow);
    if (items.length < 2) continue;
    const rows = rowsOf(items);

    // Balance.
    if (!ignored(container)) {
      for (const row of rows) {
        const side = row.items.filter((item) => !ignored(item));
        if (side.length < 2) continue;
        const heights = side.map((item) => {
          const e = extent.get(item);
          return e.bottom - e.top;
        });
        const tall = Math.max(...heights);
        const diff = tall - Math.min(...heights);
        if (diff > Math.max(limits.balanceFloor, limits.balanceShare * tall)) {
          out.push(`balance: side-by-side blocks in ${name(container)} differ by ${Math.round(diff)}px (${heights.map(Math.round).join(' / ')})`);
        }
      }
    }

    // Grid cells: a multi-column grid of like items (a list of cards, boxes or demos, all one kind of
    // element) puts one item in each cell, so every item is one column wide, and fills each row from
    // its content edge; the last row may be part-empty. A grid that lays out one component's parts
    // (an avatar beside its text) is not a list. The computed tracks are the used widths in px.
    if (grid && new Set(items.map((item) => item.tagName)).size === 1) {
      const tracks = cs.gridTemplateColumns.split(' ').filter((t) => /px$/.test(t)).map(parseFloat);
      if (tracks.length >= 2 && !ignored(container)) {
        const widest = Math.max(...tracks);
        const left = box(container).left + parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth);
        for (const item of items) {
          if (box(item).width > widest + 1) out.push(`grid cells: ${name(item)} spans more than one column in ${name(container)} (${Math.round(box(item).width)}px, columns ${Math.round(widest)}px)`);
        }
        for (const row of rows) {
          const start = Math.min(...row.items.map((k) => box(k).left)) - left;
          if (start > 2) out.push(`grid cells: a row in ${name(container)} starts ${Math.round(start)}px in`);
        }
      }
    }

    // Orphans: a glyph or chip alone on a wrapped line of a flex row; and, at any width, one item
    // alone on a line of a wrapped row of links or chips (list items, links or buttons, all one kind
    // of element) while another line holds two or more. A row that stacks one item to a line is a
    // column, not an orphan, and a line of inline text pieces (spans) wraps as prose does.
    if (flexRow && cs.flexWrap === 'wrap' && rows.length > 1) {
      const tags = new Set(items.map((item) => item.tagName));
      const like = tags.size === 1 && ['LI', 'A', 'BUTTON'].includes([...tags][0]);
      const crowded = rows.some((row) => row.items.length > 1);
      for (const row of rows) {
        if (row.items.length !== 1) continue;
        const width = box(row.items[0]).width;
        if (width < 32) out.push(`orphan: a ${Math.round(width)}px item alone on a line in ${name(container)}`);
        else if (like && crowded) out.push(`orphan: ${name(row.items[0])} alone on a line of ${name(container)}`);
      }
    }
  }

  // Hollows: inside a band, no vertical run of empty space between two blocks is longer than the
  // limit. A band that grows to fill a short page's window (flex-grow) sets its content at one end
  // by design, so its leading and trailing space is not a hollow; the runs between its blocks are.
  const bands = [...document.querySelectorAll('main > .band')];
  bands.forEach((band, index) => {
    const b = box(band);
    const cs = style(band);
    const top = b.top + parseFloat(cs.paddingTop);
    const bottom = b.bottom - parseFloat(cs.paddingBottom);
    const spans = leaves
      .filter(({ el }) => el !== band && band.contains(el))
      .map(({ r }) => [r.top, r.bottom])
      .sort((x, y) => x[0] - y[0]);
    if (spans.length === 0) return;
    const merged = [];
    for (const [t, btm] of spans) {
      const last = merged[merged.length - 1];
      if (last !== undefined && t <= last[1]) last[1] = Math.max(last[1], btm);
      else merged.push([t, btm]);
    }
    const grows = parseFloat(cs.flexGrow) > 0;
    const gaps = grows ? [] : [merged[0][0] - top, bottom - merged[merged.length - 1][1]];
    for (let i = 1; i < merged.length; i += 1) gaps.push(merged[i][0] - merged[i - 1][1]);
    if (gaps.length === 0) return;
    const widest = Math.max(...gaps);
    if (widest > limits.hollow) out.push(`hollow: ${Math.round(widest)}px of empty space in band ${index + 1} (${name(band)})`);
  });

  // Frames: a box drawn with an edge on every side that holds a block with an edge or a fill of its
  // own (a card, a row, a box) is filled by what it holds: its content reaches within the limit of
  // its inner right edge, so no empty column runs down beside a card inside a dashed example frame.
  // The hollow check only measures vertical runs, so it cannot see this. A frame that holds only
  // text, glyphs and inline chips is not checked: a line of prose ends where it ends. Nor is a frame
  // under 96px wide: a chip or a colour swatch centres its mark by design.
  const BLOCKS = new Set(['block', 'flow-root', 'grid', 'flex', 'list-item', 'table']);
  const edged = (cs) => ['Top', 'Right', 'Bottom', 'Left'].every((side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== 'none' && !transparent(cs[`border${side}Color`]));
  for (const frame of document.body.querySelectorAll('*')) {
    if (!inFlow(frame) || REPLACED.has(frame.tagName) || ignored(frame)) continue;
    const fcs = style(frame);
    if (!edged(fcs) || box(frame).width < 96) continue;
    const holds = [...frame.querySelectorAll('*')].some((el) => {
      if (!extent.get(el) || REPLACED.has(el.tagName)) return false;
      const cs = style(el);
      return BLOCKS.has(cs.display) && paints(el, cs);
    });
    if (!holds) continue;
    let content = null;
    for (const child of frame.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE && inFlow(child)) content = union(content, extent.get(child));
      else if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
        const range = document.createRange();
        range.selectNodeContents(child);
        for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) content = union(content, rectOf(r));
      }
    }
    if (content === null) continue;
    const inner = box(frame).right - parseFloat(fcs.borderRightWidth) - parseFloat(fcs.paddingRight);
    const empty = inner - content.right;
    if (empty > limits.frame) out.push(`frame: ${Math.round(empty)}px of empty column inside the right edge of ${name(frame)}`);
  }

  // Cards, per grid and per row, from 768px.
  if (vw >= 768) {
    for (const grid of document.querySelectorAll('.card-grid')) {
      const cards = [...grid.children].filter((c) => c.classList.contains('card') && inFlow(c));
      for (const row of rowsOf(cards)) {
        const cs = row.items;
        for (const card of cs) {
          const index = card.querySelector('.card-index');
          if (index !== null) {
            const tops = [...index.children].filter(inFlow).map((k) => box(k).top);
            if (tops.length > 1 && Math.max(...tops) - Math.min(...tops) > 8) out.push(`card: the corner index wraps in ${name(card)}`);
          }
          const bottom = card.querySelector(':scope > .card-bottom');
          if (bottom === null) continue;
          const ccs = style(card);
          const tail = box(card).bottom - parseFloat(ccs.borderBottomWidth) - parseFloat(ccs.paddingBottom) - box(bottom).bottom;
          if (tail > 1) out.push(`card: ${Math.round(tail)}px under the bottom block of ${name(card)}`);
          if (cs.length < 2) continue;
          const above = [...card.children].filter((k) => k !== bottom && inFlow(k) && box(k).bottom <= box(bottom).top + 1);
          if (above.length === 0) continue;
          const hollow = box(bottom).top - Math.max(...above.map((k) => box(k).bottom));
          if (hollow > limits.cardHollow) out.push(`card: a ${Math.round(hollow)}px hollow above the bottom block of ${name(card)}`);
        }
        if (cs.length < 2) continue;
        const spread = (xs) => Math.max(...xs) - Math.min(...xs);
        if (spread(cs.map((c) => box(c).bottom)) > 1) out.push(`card: bottoms differ in a row of ${name(grid)}`);
        const titles = cs.map((c) => c.querySelector('h3')).filter((h) => h !== null);
        if (titles.length > 1 && spread(titles.map((h) => box(h).top)) > 1) out.push(`card: titles misaligned in a row of ${name(grid)}`);
        const bars = cs.map((c) => c.querySelector('.funding-bar')).filter((b) => b !== null);
        if (bars.length > 1 && spread(bars.map((b) => box(b).top)) > 1) out.push(`card: funding bars misaligned by ${Math.round(spread(bars.map((b) => box(b).top)))}px in a row of ${name(grid)}`);
      }
    }
  }

  // Rhythm: space groups a line with what it belongs to. A heading opens what follows it, so it sits
  // at least as far below the block before it as that block sits below its own predecessor; a line
  // closer to the next heading than to the block it captions reads as part of the wrong section.
  const shown = (el) => extent.get(el) && !['absolute', 'fixed'].includes(style(el).position);
  const before = (el) => {
    let prev = el.previousElementSibling;
    while (prev !== null && !shown(prev)) prev = prev.previousElementSibling;
    return prev;
  };
  for (const heading of document.querySelectorAll('main h2, main h3')) {
    if (!shown(heading)) continue;
    const prev = before(heading);
    const prior = prev === null ? null : before(prev);
    if (prior === null) continue;
    const above = box(heading).top - box(prev).bottom;
    const between = box(prev).top - box(prior).bottom;
    if (above + 1 < between) out.push(`rhythm: ${name(heading)} sits ${Math.round(above)}px under ${name(prev)}, which sits ${Math.round(between)}px under the block before it`);
  }

  // Buttons keep their label on one line.
  for (const button of document.querySelectorAll('.button, button')) {
    if (!extent.get(button) || button.classList.contains('link')) continue;
    if (box(button).height > limits.button) out.push(`button: ${name(button)} wraps to ${Math.round(box(button).height)}px`);
  }

  // The top bar stays one row on phones.
  const bar = document.querySelector('.topbar');
  if (bar !== null && vw >= 360 && vw <= 390 && box(bar).height > limits.topBar) out.push(`top bar: ${Math.round(box(bar).height)}px tall at ${vw}px`);

  return out;
}
