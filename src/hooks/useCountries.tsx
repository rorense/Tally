import { useSQLiteContext } from 'expo-sqlite';
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { listCountries } from '../db/repository';
import type { Country } from '../db/types';

interface CountriesContextValue {
  countries: Country[];
  /**
   * The row for a country code, or null. Backed by a Map, so a list does not
   * scan the whole table once per rendered row.
   */
  countryFor: (code: string | null | undefined) => Country | null;
}

const CountriesContext = createContext<CountriesContextValue | null>(null);

/**
 * The country table, read once for the life of the app.
 *
 * Migration 1 seeds it and nothing writes it afterwards, so the five screens
 * that each loaded the whole table on focus were re-reading a constant — and
 * then scanning it linearly for every expense row they drew.
 */
export function CountriesProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [countries, setCountries] = useState<Country[]>([]);

  useEffect(() => {
    let cancelled = false;
    listCountries(db).then((rows) => {
      if (!cancelled) setCountries(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [db]);

  const value = useMemo(() => {
    const byCode = new Map(countries.map((c) => [c.country_code, c]));
    return {
      countries,
      countryFor: (code: string | null | undefined) => (code ? (byCode.get(code) ?? null) : null),
    };
  }, [countries]);

  return <CountriesContext.Provider value={value}>{children}</CountriesContext.Provider>;
}

export function useCountries() {
  const ctx = useContext(CountriesContext);
  if (!ctx) throw new Error('useCountries must be used inside CountriesProvider');
  return ctx;
}
