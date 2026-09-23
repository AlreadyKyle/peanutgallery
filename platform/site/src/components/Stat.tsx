/**
 * One figure as a row: the label and a plain description on the left, the amount on the right.
 * The description is always visible, so a figure never needs a tap to explain itself. Kernel
 * (docs/specs/board-site.md): every money and ledger figure is drawn here.
 */
export function Stat({ label, description, value }: { label: string; description?: string; value: string }) {
  return (
    <div className="stat">
      <dt>
        <span className="stat-label">{label}</span>
        {description === undefined ? null : <span className="stat-description">{description}</span>}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
