// The scoreboard of docs/strategy/benchmarks.md that the daily counts can measure (docs/specs/operations.md).
// Each row is computed from daily_metrics alone: sums over the trailing 30 days (the previous 30 for
// the trend), or the newest day's 30-day figure where a sum of days cannot give it (distinct
// supporters, the median). A row whose denominator is zero, or whose counter is not sent yet, reads
// "not measured" and nobody estimates it. The targets and floors are benchmarks.md's; where a row is a
// proxy for the benchmark's own wording, its label says what it counts.

export interface MetricsDay {
  day: string;
  metrics: Record<string, number>;
}

export interface Bounds {
  min?: number;
  max?: number;
}

export type RowStatus = 'meets_target' | 'between' | 'below_floor' | 'not_measured';

export interface ScoreRow {
  metric: string;
  area: number;
  label: string;
  unit: 'usd' | 'count' | 'share' | 'per_100';
  value: number | null;
  previous: number | null;
  target: Bounds;
  floor: Bounds | null;
  status: RowStatus;
}

type Sum = (name: string) => number;

interface RowSpec {
  metric: string;
  area: number;
  label: string;
  unit: ScoreRow['unit'];
  target: Bounds;
  // null: no floor in benchmarks.md (the row is reported only).
  floor: Bounds | null;
  // The value over one window, or null when it cannot be measured.
  value: (sum: Sum, latest: (name: string) => number | null) => number | null;
  // A floor read against the previous window: the value may not exceed previous × this.
  floorVsPrevious?: number;
}

const ratio = (top: number, bottom: number): number | null => (bottom > 0 ? top / bottom : null);

export const ROWS: readonly RowSpec[] = [
  // 1. Business viability.
  { metric: 'money.gross_30d', area: 1, label: 'Gross contributions (30d)', unit: 'usd', target: { min: 380 }, floor: null, value: (s) => s('money.gross_usd') },
  { metric: 'money.supporters_30d', area: 1, label: 'Distinct supporters (30d)', unit: 'count', target: { min: 100 }, floor: { min: 25 }, value: (s, latest) => (s('money.payments') > 0 ? latest('money.supporters_30d') : null) },
  { metric: 'money.median_30d', area: 1, label: 'Median contribution (30d)', unit: 'usd', target: { min: 8 }, floor: { min: 5 }, value: (s, latest) => (s('money.payments') > 0 ? latest('money.median_30d') : null) },
  { metric: 'money.repeat_rate', area: 1, label: 'Second payments / first payments (30d)', unit: 'share', target: { min: 0.25 }, floor: { min: 0.1 }, value: (s) => ratio(s('money.repeat_supporters'), s('money.new_supporters')) },
  { metric: 'money.studio_share', area: 1, label: 'Chosen studio share (30d mean)', unit: 'share', target: { min: 0.15, max: 0.25 }, floor: { min: 0.12, max: 0.3 }, value: (s) => ratio(s('money.studio_pct_sum') / 100, s('money.payments')) },
  { metric: 'money.machine_share', area: 1, label: 'Machine card share of money (30d)', unit: 'share', target: { min: 0.1, max: 0.3 }, floor: { max: 0.5 }, value: (s) => ratio(s('money.machine_usd'), s('money.gross_usd')) },
  { metric: 'money.refund_rate', area: 1, label: 'Refunded and disputed / gross (30d)', unit: 'share', target: { max: 0.01 }, floor: { max: 0.02 }, value: (s) => ratio(s('money.refunded_usd'), s('money.gross_usd')) },
  // 3. Game quality and pipeline robustness.
  { metric: 'cards.cost_per_live', area: 3, label: 'Agent cost per shipped card (30d)', unit: 'usd', target: {}, floor: null, floorVsPrevious: 1.5, value: (s) => ratio(s('cards.live_spend_usd'), s('cards.live')) },
  { metric: 'deploys.rollback_rate', area: 3, label: 'Deploys failing smoke / deploys (30d)', unit: 'share', target: { max: 0.05 }, floor: { max: 0.1 }, value: (s) => ratio(s('deploys.smoke_failed'), s('deploys.total')) },
  // 4. Fun, engagement and retention.
  { metric: 'play.d1', area: 4, label: 'Player D1: loads from a 1-day-old save / loads (30d)', unit: 'share', target: { min: 0.2 }, floor: { min: 0.1 }, value: (s) => (s('play.dust_return_1d') > 0 ? ratio(s('play.dust_return_1d'), s('play.dust_load')) : null) },
  { metric: 'play.d7', area: 4, label: 'Player D7: loads from a 7-day-old save / loads (30d)', unit: 'share', target: { min: 0.06 }, floor: { min: 0.03 }, value: (s) => (s('play.dust_return_7d') > 0 ? ratio(s('play.dust_return_7d'), s('play.dust_load')) : null) },
  { metric: 'play.session_4m', area: 4, label: 'Loads lasting 4 minutes or more / loads (30d)', unit: 'share', target: { min: 0.5 }, floor: { min: 0.25 }, value: (s) => (s('play.dust_session_2m') > 0 ? ratio(s('play.dust_session_4m'), s('play.dust_load')) : null) },
  // Studio dwell: the median home view lasts 15 seconds (the floor) or 45 (the target) when half the views reach it.
  { metric: 'site.dwell_mid', area: 4, label: 'Home views staying 15 seconds or more / home views (30d)', unit: 'share', target: { min: 0.5 }, floor: { min: 0.5 }, value: (s) => (s('play.home_dwell_mid') > 0 ? ratio(s('play.home_dwell_mid'), s('play.home_load')) : null) },
  { metric: 'site.dwell_long', area: 4, label: 'Home views staying 45 seconds or more / home views (30d)', unit: 'share', target: { min: 0.5 }, floor: null, value: (s) => (s('play.home_dwell_mid') > 0 ? ratio(s('play.home_dwell_long'), s('play.home_load')) : null) },
  { metric: 'community.suggestions_per_profile', area: 4, label: 'Suggestions / new profiles (30d)', unit: 'count', target: { min: 0.3 }, floor: { min: 0.05 }, value: (s) => ratio(s('community.suggestions'), s('community.profiles_new')) },
  { metric: 'community.seeds_per_load', area: 4, label: 'Seeds saved / game loads (30d)', unit: 'share', target: { min: 0.05 }, floor: { min: 0.01 }, value: (s) => ratio(s('community.seeds_saved'), s('play.dust_load')) },
  { metric: 'community.seeds_published', area: 4, label: 'Seeds published / saved (30d)', unit: 'share', target: { min: 0.1 }, floor: null, value: (s) => ratio(s('community.seeds_published'), s('community.seeds_saved')) },
  // 5. Virality and sharing.
  { metric: 'play.shares_per_100', area: 5, label: 'Shares and seed saves per 100 game loads (30d)', unit: 'per_100', target: { min: 3 }, floor: { min: 1 }, value: (s) => { const r = ratio(s('play.dust_share') + s('play.dust_seed_save'), s('play.dust_load')); return r === null ? null : r * 100; } },
  { metric: 'play.card_shares', area: 5, label: 'Card shares per contribution (30d)', unit: 'count', target: { min: 0.5 }, floor: { min: 0.1 }, value: (s) => ratio(s('play.card_share'), s('money.payments')) },
  { metric: 'play.seed_opens', area: 5, label: 'Seed opens per published seed (30d)', unit: 'count', target: { min: 2 }, floor: { min: 0.5 }, value: (s) => ratio(s('play.dust_seed_open'), s('community.seeds_published')) },
  // 6. Conversion.
  { metric: 'funnel.visitor_to_player', area: 6, label: 'Game loads / home loads (30d)', unit: 'share', target: { min: 0.25 }, floor: { min: 0.1 }, value: (s) => ratio(s('play.dust_load'), s('play.home_load')) },
  { metric: 'funnel.player_to_card', area: 6, label: 'Next-card clicks / game loads (30d)', unit: 'share', target: { min: 0.03 }, floor: { min: 0.01 }, value: (s) => ratio(s('play.dust_next_card'), s('play.dust_load')) },
  { metric: 'funnel.visitor_to_participant', area: 6, label: 'New profiles / home loads (30d)', unit: 'share', target: { min: 0.02 }, floor: { min: 0.005 }, value: (s) => ratio(s('community.profiles_new'), s('play.home_load')) },
  { metric: 'funnel.visitor_to_supporter', area: 6, label: 'New supporters / home loads (30d)', unit: 'share', target: { min: 0.01 }, floor: { min: 0.003 }, value: (s) => ratio(s('money.new_supporters'), s('play.home_load')) },
];

export const WINDOW_DAYS = 30;

function outside(value: number, bounds: Bounds): boolean {
  return (bounds.min !== undefined && value < bounds.min) || (bounds.max !== undefined && value > bounds.max);
}

function windowOf(days: readonly MetricsDay[], fromEnd: number): { sum: Sum; latest: (name: string) => number | null } {
  const end = days.length - fromEnd;
  const slice = days.slice(Math.max(0, end - WINDOW_DAYS), Math.max(0, end));
  return {
    sum: (name) => slice.reduce((total, day) => total + (Number.isFinite(day.metrics[name]) ? day.metrics[name]! : 0), 0),
    latest: (name) => {
      for (let i = slice.length - 1; i >= 0; i -= 1) {
        const v = slice[i]!.metrics[name];
        if (Number.isFinite(v)) return v!;
      }
      return null;
    },
  };
}

const round = (value: number | null): number | null => (value === null || !Number.isFinite(value) ? null : Math.round(value * 10_000) / 10_000);

// Every row, from the days oldest first (daily_metrics_window): the last 30 days, and the 30 before
// them for the trend.
export function scoreboard(days: readonly MetricsDay[]): ScoreRow[] {
  const current = windowOf(days, 0);
  const before = windowOf(days, WINDOW_DAYS);
  return ROWS.map((spec) => {
    const value = round(spec.value(current.sum, current.latest));
    const previous = days.length > WINDOW_DAYS ? round(spec.value(before.sum, before.latest)) : null;
    let status: RowStatus;
    if (value === null) status = 'not_measured';
    else if (spec.floor && outside(value, spec.floor)) status = 'below_floor';
    else if (spec.floorVsPrevious !== undefined && previous !== null && previous > 0 && value > previous * spec.floorVsPrevious) status = 'below_floor';
    else if (!outside(value, spec.target)) status = 'meets_target';
    else status = 'between';
    return { metric: spec.metric, area: spec.area, label: spec.label, unit: spec.unit, value, previous, target: spec.target, floor: spec.floor, status };
  });
}

export function formatValue(row: Pick<ScoreRow, 'unit'>, value: number): string {
  switch (row.unit) {
    case 'usd':
      return `$${value.toFixed(2)}`;
    case 'share':
      return `${(value * 100).toFixed(1)}%`;
    default:
      return `${Math.round(value * 100) / 100}`;
  }
}

function formatBounds(row: ScoreRow, bounds: Bounds): string {
  if (bounds.min !== undefined && bounds.max !== undefined) return `${formatValue(row, bounds.min)} to ${formatValue(row, bounds.max)}`;
  if (bounds.min !== undefined) return `at least ${formatValue(row, bounds.min)}`;
  if (bounds.max !== undefined) return `at most ${formatValue(row, bounds.max)}`;
  return 'none';
}

// "Median contribution (30d) is $4.00, below its floor (at least $5.00)".
export function findingSubject(row: ScoreRow): string {
  const value = row.value === null ? 'not measured' : formatValue(row, row.value);
  const floor = row.floor ? formatBounds(row, row.floor) : row.previous !== null ? `at most 1.5 times the previous ${formatValue(row, row.previous)}` : 'none';
  return `${row.label} is ${value}, below its floor (${floor})`;
}
