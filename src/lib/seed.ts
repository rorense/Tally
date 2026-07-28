import type { SQLiteDatabase } from 'expo-sqlite';
import { CATEGORIES } from '../db/types';
import {
  createExpense,
  createTrip,
  setCategoryBudget,
  upsertLeg,
} from '../db/repository';
import { addDays, todayLocal } from './dates';
import { convertToNzd } from './money';

/**
 * Builds a throwaway trip for the pre-departure rehearsal: put both phones in
 * airplane mode, log expenses independently on each, reconnect, and confirm the
 * two devices converge on the same totals.
 */
export async function seedRehearsalTrip(db: SQLiteDatabase): Promise<string> {
  const start = addDays(todayLocal(), -3);
  const end = addDays(todayLocal(), 11);

  const trip = await createTrip(db, {
    name: 'Rehearsal trip',
    start_date: start,
    end_date: end,
    total_budget_nzd: 6000,
    trip_type: 'multi',
  });

  const legs: { country: string; currency: string; from: string; to: string }[] = [
    { country: 'FR', currency: 'EUR', from: start, to: addDays(start, 4) },
    { country: 'CH', currency: 'CHF', from: addDays(start, 5), to: addDays(start, 8) },
    { country: 'GB', currency: 'GBP', from: addDays(start, 9), to: end },
  ];

  const legIds: string[] = [];
  for (const leg of legs) {
    legIds.push(
      await upsertLeg(db, {
        trip_id: trip.id,
        country_code: leg.country,
        currency_code: leg.currency,
        start_date: leg.from,
        end_date: leg.to,
      })
    );
  }

  for (const cat of CATEGORIES) {
    await setCategoryBudget(db, trip.id, cat, 1000);
  }

  const samples = [
    { cat: 'Transport', desc: 'Airport train', amount: 12.5, legIndex: 0, dayOffset: 0 },
    { cat: 'Accommodation', desc: 'Hotel Marais', amount: 180, legIndex: 0, dayOffset: 0 },
    { cat: 'Food', desc: 'Dinner', amount: 46.8, legIndex: 0, dayOffset: 1 },
    { cat: 'Activity', desc: 'Louvre tickets', amount: 34, legIndex: 0, dayOffset: 2 },
    { cat: 'Food', desc: 'Coffee and pastry', amount: 9.4, legIndex: 0, dayOffset: 3 },
    { cat: 'Souvenir', desc: 'Postcards', amount: 6, legIndex: 0, dayOffset: 3 },
  ] as const;

  // A rough stand-in rate so the rehearsal works with no cached rates present.
  const placeholderRate = 1.9;

  for (const s of samples) {
    const leg = legs[s.legIndex];
    const date = addDays(leg.from, s.dayOffset);
    await createExpense(db, {
      trip_id: trip.id,
      leg_id: legIds[s.legIndex],
      country_code: leg.country,
      category: s.cat,
      description: s.desc,
      amount: s.amount,
      currency: leg.currency,
      rate_to_nzd: placeholderRate,
      amount_nzd: convertToNzd(s.amount, placeholderRate),
      spent_at: new Date().toISOString(),
      local_date: date,
      paid_by: null,
      shopback_type: null,
      shopback_value: null,
      shopback_amount: null,
      shopback_amount_nzd: null,
      shopback_status: null,
      shopback_confirmed_at: null,
    });
  }

  return trip.id;
}
