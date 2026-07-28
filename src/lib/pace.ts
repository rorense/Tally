import { daysBetween } from './dates.ts';
import { round2 } from './money.ts';

/**
 * Straight-line budget used by the dashboard and the cumulative chart.
 * Spreads the trip total evenly across every day of the trip, then reports how
 * much of that line you should have spent by `elapsedDays`.
 */
export function budgetPaceNzd(
  budgetNzd: number,
  startDate: string,
  endDate: string,
  elapsedDays: number
): number {
  if (budgetNzd <= 0 || elapsedDays <= 0) return 0;
  const tripDays = daysBetween(startDate, endDate) + 1;
  if (tripDays <= 0) return 0;
  return round2((budgetNzd / tripDays) * Math.min(elapsedDays, tripDays));
}
