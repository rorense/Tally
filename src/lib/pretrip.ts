import type { Expense } from '../db/types';

/**
 * Whether an expense belongs to the pre-trip bucket rather than to a day of the
 * trip.
 *
 * The flag is the explicit answer, but an expense dated before the trip starts
 * belongs in the same bucket: the charts draw an axis from the start date, so
 * anything earlier has no column to land in and would vanish from the daily
 * bars and the cumulative line without appearing anywhere else.
 *
 * That second case is reachable even though the editor clamps its date picker
 * to the trip window. Moving a trip's start date later strands every expense
 * before it, and a row can arrive from a partner phone that recorded the flag
 * differently.
 *
 * This used to be written out at each call site, and the two spellings had
 * drifted: the aggregates and the export applied both halves, while the
 * Expenses list, the dashboard's Recent card and the Cashback tab tested only
 * the flag. The same row was pre-trip on one screen and an ordinary trip day
 * on the next.
 */
export function isPretrip(
  expense: Pick<Expense, 'is_pretrip' | 'local_date'>,
  tripStartDate: string
): boolean {
  return expense.is_pretrip === 1 || expense.local_date < tripStartDate;
}

/**
 * The same rule in SQL, for the aggregates that cannot call the function.
 *
 * Takes the trip start date as its one bound parameter, so a query using it
 * has to pass `startDate` in the matching position. Kept in this file rather
 * than in the repository so the two spellings sit together and a test can hold
 * them against each other — see pretrip.test.ts, which runs this string on a
 * real SQLite database and compares row for row with `isPretrip`.
 */
export const IS_PRETRIP_SQL = `(is_pretrip = 1 OR local_date < ?)`;
