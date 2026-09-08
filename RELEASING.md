# Releasing Tally

Tally gets used in bursts — one trip, then months of nothing. This is written for the version of you who last touched it a year ago and is flying on Thursday.

Start with the [pre-trip checklist](#pre-trip-checklist) if a trip is coming up. Otherwise work down from here.

## The CLI

The published package is **`eas-cli`**. `eas` is only the binary name inside it, so `npx eas …` fails with `could not determine executable to run`. Install it once:

```bash
npm install -g eas-cli
```

Every command below is written as `eas …`. Without the global install, spell the package out instead — `npx eas-cli@latest build …` and so on.

```bash
eas login
```

## Update or rebuild?

Most changes do not need a build. `expo-updates` is enabled, so JavaScript reaches installed apps over the air in seconds instead of a build queue.

**An update is enough** when the change is JS, TypeScript, or assets only.

**You need a new build** when any of these changed:

- a dependency in `package.json` — a new native module has to be compiled in
- anything in `app.json` — icon, splash, scheme, permissions, plugins
- the `version` in `app.json` (see [runtime versions](#runtime-versions-and-why-an-update-can-miss))

One exception: the `platforms` key in `app.json` only tells the bundler which
platforms to export for (it exists so `eas update` does not try to build a web
bundle this app cannot make). Changing it changes nothing native, so it does
not need a build.

Quick check before assuming:

```bash
git diff <last-release-tag> --stat -- package.json app.json eas.json
```

Empty output means an update will do.

## Shipping an update

```bash
eas update --branch trip --message "what changed"
```

That reaches every build on the `trip` channel — the Android `trip` build, the iOS `trip` ad-hoc build, and the iOS `trip-testflight` build alike. They share the channel on purpose.

The app checks for updates on launch (`checkAutomatically: "ON_LOAD"`), so testers get it next time they open the app, with a 3 second fallback to the cached version if the network is slow.

### Runtime versions, and why an update can miss

`runtimeVersion` follows the `appVersion` policy, so a build only accepts updates published against the same `version` in `app.json`. Bump `1.0.0` to `1.1.0` and your existing installs stop seeing new updates — they need a fresh binary. That is the intended safety behaviour, not a bug: a version bump usually means native code moved.

If an update seems not to arrive, check the version match first.

## Building

| Profile | Platform | Use |
| --- | --- | --- |
| `trip` | either | The trip build — Android APK, iOS ad-hoc |
| `trip-testflight` | iOS | Trip build over TestFlight, when 90 days is long enough |
| `preview` | either | One-off internal build |
| `production` | either | App Store / Play Store submission |

### Android

```bash
eas build --profile trip --platform android
```

Produces an APK. Download it on the phone and install — Android will ask you to allow installs from that source once.

An APK does not expire. Nothing below about expiry applies to Android.

### iOS

Two routes, and the choice is only about how long the build has to keep working.

#### Ad-hoc — use this for a long trip

The provisioning profile lasts a year, so the app keeps launching for the whole
trip with nothing to do mid-way.

Every phone must be registered *before* the build. On an Individual team the
ad-hoc profile carries a hardcoded list of device UDIDs, and a phone added
afterwards cannot be reached without building again.

```bash
eas device:create
```

That prints a link and a QR code. Open it on the phone itself — not on your
laptop — install the profile it offers, and the device is registered. Repeat per
phone. `eas device:list` shows who is on the list.

```bash
eas build --profile trip --platform ios
```

Send them the build page link and they install straight from it. No TestFlight
app in the picture at all.

#### TestFlight — fine for anything under 90 days

```bash
eas build --profile trip-testflight --platform ios
```

```bash
eas submit --profile production --platform ios
```

Then add testers in App Store Connect (below). The build takes a few minutes to finish processing on Apple's side before it shows up in TestFlight.

**A TestFlight build expires 90 days after upload** — not 90 days after install — and an expired one refuses to launch. Any trip longer than that wants the ad-hoc build instead.

#### Either way

**Do not use `--profile production` for iOS trip builds.** It works, but its channel is `production`, so the build stops receiving `eas update --branch trip` pushes. Both trip profiles keep the `trip` channel for exactly this reason.

### Swapping a phone from TestFlight to ad-hoc

Same bundle identifier, different signing identity. The install can replace the
app container rather than merge into it, so treat it as a fresh install and
assume the local database does not survive.

Do the swap before the trip, while there is nothing on the phone worth losing,
and rehearse sync again afterwards.

### First iOS build only

`eas submit` offers to create the App Store Connect app record. Let it. One snag: the App Store Connect name must be unique across the entire App Store, and "Tally" is taken. Use anything free — "Tally Travel Budget" works. It only affects the App Store Connect listing; the home screen name comes from `expo.name` in `app.json`, so it still installs as **Tally**.

This only matters on the TestFlight route. An ad-hoc build needs no App Store Connect record at all.

## Adding a travel partner

They need the app, then a Tally account, then the trip code — three separate things.

**The app, on iOS.** Register their phone with `eas device:create`, build, and send them the build page link — see [iOS](#ios). Nothing to set up in App Store Connect.

On the TestFlight route instead: add them in App Store Connect → **Users and Access** (Developer or App Manager role), then TestFlight → **+** next to Internal Testing → create a group → add them. They install the TestFlight app and the build appears. Internal testers skip Beta App Review entirely, up to 100 of them. An Individual account can add users this way — they get App Store Connect access only, not Apple Developer Program membership. Only *external* testers need a review, and you do not need any.

**The app, on Android.** Send them the APK.

**The trip.** They create their own account in the app, then Settings → Join a trip, and enter the code from your Share screen. They must be online for that one step; everything after works offline.

## Supabase

The schema lives in [`supabase/schema.sql`](supabase/schema.sql) and it is the only file to run. It is idempotent, so it is both the initial setup and the migration — re-run the whole thing after pulling schema changes.

Nothing in the app breaks if you forget, which is the trap: the client stays backward compatible and simply runs without the newer server-side guarantees. Row Level Security, the `updated_at` triggers, and the join-code collision handling only exist once it has been run.

## Pre-trip checklist

A week out, not the night before.

- [ ] **Wake Supabase.** Free-tier projects pause after ~7 days idle. The [keep-alive workflow](.github/workflows/supabase-keepalive.yml) handles this, but GitHub disables scheduled workflows after 60 days with no commits — check the Actions tab shows recent green runs. If it is paused, un-pausing is a manual click in the Supabase dashboard.
- [ ] **Run `supabase/schema.sql`** if you have pulled any changes since the last trip.
- [ ] **Check the Apple certificate expiry.** `eas credentials` shows it. A distribution certificate lasts a year and the ad-hoc provisioning profile dies with it, so a certificate with four months left gives you an app with four months left however long the trip is. If less time remains than the trip needs, regenerate the certificate *before* building. A replacement runs a year from the day you create it, so do that here in the pre-trip window rather than months early, or you buy back less time than you think. Never revoke a certificate mid-trip — it kills the installed ad-hoc app immediately, on every phone. On the TestFlight route an expired certificate only fails the next build, not the installed app.
- [ ] **Check the Apple Developer Program renewal date**, and that the card on file outlives the trip. A lapsed membership revokes the profiles and the app stops launching on every phone at once, mid-trip, with no way to fix it from a beach.
- [ ] **Register every phone** with `eas device:create` before the iOS build. A phone added afterwards needs a whole new build to reach it.
- [ ] **Build and install on both phones**, and confirm the app opens offline with aeroplane mode on.
- [ ] **Rehearse sync on the real builds.** Create a throwaway trip, share the code to the second phone, put both in aeroplane mode, log expenses independently on each, then reconnect and confirm both converge on the same total. (Settings has a "Seed rehearsal trip" button that does the setup for you, but it is `__DEV__`-only — it will not appear in a `trip` build, which is the one you actually want to rehearse with.)
- [ ] **Fetch rates once on wifi** before flying — Settings → Refresh rates now. Rates are cached and frozen per expense, but an unseen currency has no rate to freeze.
- [ ] **Confirm the partner can see the trip** before you are relying on airport wifi.

## Troubleshooting

**`npm error could not determine executable to run`**
The package is `eas-cli`, not `eas`. See [The CLI](#the-cli).

**`Failed to set up credentials. Run 'eas device:create' to register your devices first`**
An ad-hoc build with a device that is not on the profile. Register it and build again — see [iOS](#ios). `--profile trip-testflight` sidesteps UDIDs entirely if you need something installable right now.

**The app will not launch, and iOS says the build expired or is no longer available**
A TestFlight build past its 90 days, or an ad-hoc profile whose certificate expired. Either way it needs a new build — an update cannot fix it.

**An update does not reach a device**
Check `version` in `app.json` matches the version the build was made from, then check the build's channel matches the branch you published to. `eas build:list` shows the channel per build.

**Sync says "Could not read the server clock"**
`server_now()` is missing or not granted to `authenticated`. Re-run `supabase/schema.sql`. Sync still works; it just re-checks a wider window each pass.

**A partner's expenses never arrive**
Check they are actually a member — Settings shows the member list for the active trip. If they joined but see an empty budget, their device skipped the initial full pull; joining again through the code re-requests it.

**The app opens to a blank screen after an update**
Republish a known-good update. Run without arguments beyond the branch and it lists the update groups to pick from:

```bash
eas update:republish --branch trip
```

If every published update is bad, fall back to the JS that shipped inside the binary:

```bash
eas update:rollback
```
