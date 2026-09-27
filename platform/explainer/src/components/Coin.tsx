import { C } from '../theme';

// The coin mark (Funding.tsx CoinMark): an ink rim, the coin fill and one inner ring, never stacked
// and never a currency. `turn` squeezes it sideways, so a falling coin reads as spinning.
export function Coin({ size, turn = 1, x = 0, y = 0, opacity = 1 }: { size: number; turn?: number; x?: number; y?: number; opacity?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      style={{ position: 'absolute', left: x - size / 2, top: y - size / 2, transform: `scaleX(${Math.max(0.08, Math.abs(turn))})`, opacity, overflow: 'visible' }}
      aria-hidden="true"
    >
      <circle cx={8} cy={8} r={7.1} fill={C.coin} stroke={C.ink} strokeWidth={1.1} />
      <circle cx={8} cy={8} r={4} fill="none" stroke={C.ink} strokeWidth={0.75} />
    </svg>
  );
}
