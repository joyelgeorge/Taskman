---
status: open
priority: P2
level: 4
opened: 2026-09-18
---

# Mobile app (APK/IPA) hardcoded-secret extraction — new surface, not new logic

Raised from an `/expanding-the-search` pass, 2026-09-18 (surface axis: same
web-bundle secret-exposure mistake, on compiled mobile binaries instead of
JS bundles or repos — a surface with zero code footprint anywhere in this
repo today, checked directly).

## Why P2, not P1 like the Firebase detector opened today

Firebase closes a gap in a market CLAUDE.md already names as the target.
Mobile apps are not named anywhere in the critical finding — this is a real
widening into unproven territory, not confirmation of an existing bet. Worth
having parked; not worth jumping the two detector tasks that fill a known gap.

## The five-perspective check

- **Adversarial:** APKs are trivially unzippable with no build step
  (`unzip app.apk`); React Native/Expo apps ship their JS bundle inside the
  package, often with the same embedded-API-key mistake `findExposedSecret`
  already catches on web — just a different container to open first.
- **Reachability — the miss this exists to prevent:** the secret must be in
  the **shipped** binary, not a build-time `.env` excluded from the final
  artifact. Most mobile apps don't have public source at all, which is
  exactly why this is a genuinely separate surface from repos and from web
  bundles, not a restatement of either.
- **Symbolic refuter:** no new detection logic — the existing regex
  key-prefix patterns in `findExposedSecret` apply unchanged once the binary
  is unzipped and its JS/strings extracted. This task is an extraction
  pipeline (`unzip` → locate the JS bundle or run `strings` on native
  binaries → feed the existing function), not a new detector.
- **Temporal:** App Store / Play Store review cycles are slow; a finding
  here likely stays live longer than a web bundle one, similar upside to the
  Firebase case.
- **Economic:** Play Store install count and rating is a free, immediate
  reality-gate check — arguably cheaper than the git-activity check
  currently used for repos, since it needs no `gh` API call.

## Scope

1. Given an APK, `unzip` it and locate `assets/`/`res/` JS bundles (React
   Native/Expo/Cordova hybrid apps) or run `strings` across the binary for
   compiled/native apps (Flutter AOT, native Kotlin/Swift-adjacent).
2. Feed the extracted text through the existing `findExposedSecret` (and,
   once built, the Firebase/RLS detectors — a mobile app talking to Supabase
   or Firebase carries the identical service-role/RLS exposure risk).
3. IPA (iOS) follows the same shape — it's a zip too — but App Store apps are
   harder to acquire without a device/sideloading path; start with
   Android/APK, which can be pulled from public APK mirrors or downloaded
   directly for apps that allow it.

## Not yet answered — resolve before building

Where do APKs for real, non-toy apps come from at zero cost and without
violating a store's terms? (Google Play's own terms restrict bulk/automated
downloading.) This is the actual blocker, not the extraction code — answer it
first, cheaply, before writing the unzip pipeline.

## Done looks like

One real APK (a genuine small business's published app, not a toy) processed
through the pipeline, confirming or ruling out that the same class of finding
exists on mobile — before any decision to build this into the regular scan
path.
