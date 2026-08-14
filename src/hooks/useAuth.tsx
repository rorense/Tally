import type { Session } from '@supabase/supabase-js';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { isSyncConfigured, supabase } from '../lib/supabase';
import { clearAccountData } from '../lib/sync';

interface AuthContextValue {
  session: Session | null;
  userId: string | null;
  email: string | null;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (
    email: string,
    password: string
  ) => Promise<{ error: string | null; needsEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the Supabase session, and nothing else. Screens deliberately do not
 * gate on this: tokens expire hourly and refresh over the network, so any UI
 * that required a valid session would lock you out of your own expense list
 * after a week in poor signal. The session matters only when sync runs.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) return { error: 'Sync is not configured on this build.' };
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return { error: error?.message ?? null };
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return { error: 'Sync is not configured on this build.', needsEmailConfirmation: false };
    }

    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
    if (error) return { error: error.message, needsEmailConfirmation: false };

    // With Supabase's default "Confirm email" setting the account is created but
    // no session is issued until the emailed link is clicked. Surfacing that is
    // the difference between a clear instruction and appearing to do nothing.
    return { error: null, needsEmailConfirmation: data.session === null };
  }, []);

  /**
   * Ends the session and takes the account's data off the device with it.
   *
   * The wipe lives here rather than at the button so there is no way to sign
   * out without it, and it runs first on purpose: if the two steps cannot both
   * complete, a signed-in session holding its own data is a better place to
   * land than a signed-out phone still holding somebody else's.
   *
   * Callers are expected to have confirmed with the traveller — unsynced work
   * does not survive this.
   */
  const signOut = useCallback(async () => {
    await clearAccountData(db);
    await supabase?.auth.signOut();
  }, [db]);

  const value = useMemo(
    () => ({
      session,
      userId: session?.user.id ?? null,
      email: session?.user.email ?? null,
      configured: isSyncConfigured,
      signIn,
      signUp,
      signOut,
    }),
    [session, signIn, signUp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
