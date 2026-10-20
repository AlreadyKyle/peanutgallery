import type { WeekProps } from '../schema';
import week20261020 from './2026-10-20';

// Every week's props, by its last day. Add next week's file here and point LATEST at it.
export const WEEKS: Record<string, WeekProps> = {
  [week20261020.date]: week20261020,
};
export const LATEST = week20261020.date;
