# Android setup

What the panel's Android wizard walks you through.

## What we use and why

**Play Integrity** answers, from Google's servers, whether a request came from
your app, installed from Play, on a device that passes Google's checks. An
attacker with your APK on a rooted phone cannot produce that answer, which is
what makes it worth asking.

## Where it differs from Apple, and why that matters

Apple's DeviceCheck remembers a device across reinstalls. **Play Integrity does
not.** There is no equivalent bit of Google-held storage in the standard
verdict, so on Android "has this device already claimed" cannot be answered the
way it is on iOS.

This service does not pretend otherwise. On Android it relies on:

- the integrity verdict, which stops the app being faked at all
- the claim ledger, keyed by receiving address
- the daily ceiling, which bounds what any campaign of repeat claims can cost

Which means a determined person with many devices, or one device and many
factory resets, can claim more than once on Android. The ceiling is what decides
how much that is worth to them. Set it to what you are willing to lose in a day.

## What to fetch

1. **Package name** — exactly as published. `com.kachat.app` unless yours
   differs. The debug build has its own; it will not pass with the release one.
2. **A Google Cloud service account** with Play Integrity access:
   - Google Cloud console → the project linked to your Play Console listing
   - *IAM and Admin* → *Service Accounts* → **Create**
   - Grant it the Play Integrity API. Enable that API on the project if it is
     not already
   - *Keys* → *Add key* → **JSON**. Downloaded once
3. In **Play Console** → *Monetise* → *App integrity*, link the same Cloud
   project.

## What to do with the JSON

Hand it to the wizard. It goes into the stack's configuration directory, not
into this repository and not into the app. It reads your Play data; treat a leak
as a reason to delete the key in Google Cloud rather than as an embarrassment to
tidy up quietly.

## What the app has to do

```kotlin
val manager = IntegrityManagerFactory.createStandard(context)
// requestHash ties the verdict to this claim: use the receiving address, or a
// replayed token can pay somebody else.
manager.requestIntegrityToken(
    StandardIntegrityTokenRequest.builder().setRequestHash(kaspaAddress).build()
)
// POST { platform: "android", address: <kaspa address>, integrityToken: <token> }
```

The service rejects a verdict whose request hash does not match the address it
was asked to pay, and one older than five minutes.
