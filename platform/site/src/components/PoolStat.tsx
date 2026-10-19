import { formatUsd } from '../lib/format';
import { legal } from '../lib/legal';
import { CoinMark } from './Funding';
import { Stat } from './Stat';

/**
 * Kernel (docs/specs/board-site.md). The In the pool figure and its description. The ledger records true cost and is never floored,
 * so the balance can go below zero; the figure then shows $0.00 and the description says by how much
 * agent work has cost more than came in.
 */
export function poolFigure(balance: number): { value: string; description: string } {
  const shortfall = formatUsd(Math.max(0, -balance));
  if (shortfall === formatUsd(0)) {
    return { value: formatUsd(Math.max(0, balance)), description: legal.describeAvailable };
  }
  return {
    value: formatUsd(0),
    description: `${legal.describeAvailable} ${legal.shortfall.replace('{amount}', shortfall)}`,
  };
}

export function PoolStat({ balance }: { balance: number }) {
  const { value, description } = poolFigure(balance);
  return <Stat label={legal.poolBalance} description={description} value={value} />;
}

/**
 * The pool figure as one line on home: the coin mark, the amount and "ready for the agents to spend.",
 * then that every figure is on the ledger (the Full ledger link sits beside it). When agent work has
 * cost more than came in, the line under it says by how much first, as the ledger's figure does.
 */
export function PoolLine({ balance }: { balance: number }) {
  const { value } = poolFigure(balance);
  const shortfall = formatUsd(Math.max(0, -balance));
  return (
    <>
      <p className="pool-line with-glyph">
        <CoinMark />
        <span>
          <span className="figure">{value}</span> {legal.poolInline}
        </span>
      </p>
      <p className="muted small">
        {shortfall === formatUsd(0) ? legal.moneyLedgerLine : `${legal.shortfall.replace('{amount}', shortfall)} ${legal.moneyLedgerLine}`}
      </p>
    </>
  );
}
