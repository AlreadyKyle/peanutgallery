import { copy } from '../lib/copy';
import { formatUsd } from '../lib/format';
import { Stat } from './Stat';

/**
 * The In the pool figure and its description. The ledger records true cost and is never floored,
 * so the balance can go below zero; the figure then shows $0.00 and the description says by how much
 * agent work has cost more than came in.
 */
export function poolFigure(balance: number): { value: string; description: string } {
  const shortfall = formatUsd(Math.max(0, -balance));
  if (shortfall === formatUsd(0)) {
    return { value: formatUsd(Math.max(0, balance)), description: copy.describeAvailable };
  }
  return {
    value: formatUsd(0),
    description: `${copy.describeAvailable} ${copy.shortfall.replace('{amount}', shortfall)}`,
  };
}

export function PoolStat({ balance }: { balance: number }) {
  const { value, description } = poolFigure(balance);
  return <Stat label={copy.poolBalance} description={description} value={value} />;
}
