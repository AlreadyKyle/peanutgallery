import { legal } from '../lib/legal';

/**
 * One figure as a row: the label and a plain description on the left, the amount on the right.
 * The description is always visible, so a figure never needs a tap to explain itself; a note is a
 * second muted line under it (the tokens behind the agent spend). Kernel
 * (docs/specs/board-site.md): every money and ledger figure is drawn here.
 *
 * A figure whose read failed passes `value={null}`: the row says "Not available right now." as a
 * muted line stacked under its label, the same treatment as a band whose read failed, and never puts
 * a sentence in the figure's place, where it cannot wrap and would squeeze the label into a sliver
 * on a phone (docs/specs/money-surfaces.md).
 */
export function Stat({ label, description, note, value }: { label: string; description?: string; note?: string; value: string | null }) {
  return (
    <div className={value === null ? 'stat stat-unavailable' : 'stat'}>
      <dt>
        <span className="stat-label">{label}</span>
        {description === undefined ? null : <span className="stat-description">{description}</span>}
        {note === undefined ? null : <span className="stat-description">{note}</span>}
      </dt>
      <dd>{value ?? legal.partUnavailable}</dd>
    </div>
  );
}
