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

`schema.sql` is the only file to run, and it is idempotent: re-run the whole thing to upgrade an existing project. It is also the migration, so there is no patch order to remember and nothing older to apply afterwards.

### Keeping the project awake

Free-tier projects pause after ~7 days of inactivity and need a manual restore. Tally goes months between trips, so [`.github/workflows/supabase-keepalive.yml`](.github/workflows/supabase-keepalive.yml) pings the database twice a week to reset that timer.

Under **Settings → Secrets and variables → Actions → Variables**, add two repository variables:

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://YOUR_PROJECT.supabase.co` (no trailing slash) |
| `SUPABASE_ANON_KEY` | the same anon key as `.env` |

Variables rather than secrets, and rather than environment secrets. The anon key is publishable — it ships inside every installed copy of the app, and RLS is what actually scopes access — so there is nothing to hide. Environment secrets would need the job to declare an `environment:`, and any approval rule on that environment would leave every scheduled run waiting on a human, which is the opposite of what a keep-alive wants.

Then run it once from the **Actions** tab to confirm it goes green. A red run means the project is already paused or the `anon` grant on `server_now()` is missing.

One caveat: GitHub disables scheduled workflows after 60 days with no commits to the repo. It emails you first, and re-enabling is one click — but if Tally sits untouched for a couple of months, check the Actions tab before a trip.

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

The CLI is published as `eas-cli`; `eas` is only the binary name inside it, so `npx eas` fails with "could not determine executable to run" unless the package is installed. Either install it once:

```bash
npm install -g eas-cli
```

and then use `eas build …`, or name the package in full every time:

```bash
npx eas-cli@latest build --profile trip --platform android
```

```bash
npx eas-cli@latest build --profile trip --platform ios
```

Expo Go is enough for day-to-day testing. Use a real `trip` build when you need the Tally icon, splash, and `tally://join/…` links.

### Shipping without a rebuild

`expo-updates` is enabled, so a change that touches no native config — no new packages, nothing in `app.json` — reaches phones already running a `trip` build over the air:

```bash
npx eas-cli@latest update --branch trip --message "what changed"
```

`runtimeVersion` follows `appVersion`, so an update only reaches builds whose `app.json` version matches. Bump the version and you need a new binary.

## How sync works

SQLite is the source of truth. The UI never waits on the network. When signed in and online (wifi by default), a background engine pushes dirty rows and pulls remote changes. Row Level Security scopes every table to trip members, and membership is the only key to a trip — it is written in the same transaction as the trip itself, by `upsert_own_trip`.

Conflict resolution is last-write-wins on `updated_at`, with two rules that make that trustworthy:

- **`updated_at` comes from Postgres, never from the phone.** A trigger stamps it and the client stores what comes back. Taking the device's clock meant a phone running fast won every conflict while its clock stayed ahead, and a phone running slow wrote rows stamped in the past that the partner's watermark had already passed — those expenses were never pulled at all.
- **A dirty row is never overwritten by a pull.** It holds an edit the server has not seen, so it wins until the next push carries it up.

Signing out erases the trips and expenses on that phone, after a prompt that says how many changes are still waiting to sync — those are the ones that will not come back. Everything already synced returns on the next sign-in. Appearance, the wifi-only preference, and the cached FX rates stay, because they describe the phone rather than the person.

Pulls page until a request comes back empty. PostgREST silently truncates at the project's `max-rows` (1000 by default), and a truncated page is indistinguishable from a complete one, so a single request would have quietly capped a busy trip and then advanced the watermark past everything it missed.

## Known issues

`npm audit` reports advisories in Expo's build tooling (`@expo/config-plugins` and friends). They are denial-of-service classes reachable only from local build inputs, and none of that code runs in the shipped app. `npm audit fix --force` "resolves" them by downgrading Expo to SDK 53 and React Native to 0.72, which is not a trade worth making — so they are left alone deliberately. Re-check when Expo bumps the pins.

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
