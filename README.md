# Tally

Offline-first travel budget tracker for iOS and Android. Log spending in local currency, see the NZD equivalent, share a trip with a partner via join code, and sync when you get wifi.

Built for a Europe trip with Expo (SDK 57), React Native, SQLite on device, and Supabase for auth + cloud sync.

## Features

- Trips as single-country or multi-country itineraries (legs drive country/currency defaults)
- Categories: Transport, Accommodation, Activity, Food, Souvenir, Material
- Live FX rates (frankfurter.app, with open.er-api.com fallback), cached offline and frozen per expense
- Budgets (trip + per category) with charts
- Partner sharing via join code / `tally://` deep link
- Excel (`.xlsx`) and CSV export
- Light / dark / system appearance
- Works fully offline; sync is wifi-only by default

## Setup

```bash
npm install
cp .env.example .env
```

Fill `.env` from your Supabase project (**Project Settings → API**):

```bash
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
```

Leaving both blank is fine: the app runs as a local-only ledger with no sign-in or sharing.

### Supabase

1. Create a project (Sydney is a good region from NZ).
2. In the SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql) end to end.
3. Under **Authentication → Sign In / Providers → Email**, turn **Confirm email** off (otherwise sign-up looks broken on travel wifi).

## Develop

```bash
npx expo start
```

Scan the QR code with Expo Go (SDK 57), or press `a` / `i` for a simulator. Env changes need a restart with `--clear`.

```bash
npm test          # unit tests (dates, money, sync helpers, xlsx)
npm run typecheck
```

## Build

EAS profiles are in [`eas.json`](eas.json):

| Profile | Use |
| --- | --- |
| `development` | Dev client |
| `preview` | Internal APK / device build |
| `trip` | Ad-hoc internal build for the actual trip (auto-increments) |
| `production` | Store submission |

```bash
npx eas build --profile trip --platform android
npx eas build --profile trip --platform ios
```

Expo Go is enough for day-to-day testing. Use a real `trip` build when you need the Tally icon, splash, and `tally://join/…` links.

## How sync works

SQLite is the source of truth. The UI never waits on the network. When signed in and online (wifi by default), a background engine pushes dirty rows and pulls remote changes. Conflict resolution is last-write-wins on `updated_at`. Row Level Security scopes every table to trip members.

## Project layout

```
app/                 Expo Router screens (tabs, expense, trip, auth)
src/components/      Shared UI
src/db/              SQLite migrations + repository
src/hooks/           App, auth, rates, sync providers
src/lib/             Money, dates, FX, sync, export, xlsx
src/theme/           Light/dark palettes
supabase/schema.sql  Postgres tables, RLS, join RPC
```
