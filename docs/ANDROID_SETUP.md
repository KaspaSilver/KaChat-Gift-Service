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

The request hash binds the verdict to this claim, so a replayed token cannot pay
somebody else. It must be **`SHA-256(address)` as lowercase hex** -- the exact
address string and nothing else -- because that is what the server recomputes.
Not the raw address.

```kotlin
val requestHash = MessageDigest.getInstance("SHA-256")
    .digest(kaspaAddress.toByteArray(Charsets.UTF_8))
    .joinToString("") { "%02x".format(it) }

val manager = IntegrityManagerFactory.createStandard(context)
manager.requestIntegrityToken(
    StandardIntegrityTokenRequest.builder().setRequestHash(requestHash).build()
)
// POST { platform: "android", address: <kaspa address>, integrityToken: <token> }
```

The service rejects a verdict whose request hash does not match, and one older
than five minutes. The classic API works too: put the same hex value in the
`nonce` instead. See CLIENT_API.md for the full contract.

## Device recall: one gift per device (beta)

Play Integrity on its own proves the app and device are genuine but forgets
everything across a reinstall, so without this a determined user can reinstall
and claim again (bounded only by the caps). Device recall is Google's answer to
Apple's DeviceCheck: a bit stored against the device that survives reinstall and
factory reset. With it on, the service reads that bit and refuses a device that
has already been paid, and sets it after paying -- true one-per-device.

To turn it on:

1. Express interest in the beta and wait for approval:
   <https://developer.android.com/google/play/integrity/device-recall>.
2. Play Console -> your app -> **Protected with Play** -> **Play Integrity API**
   -> **Manage** -> **Change responses** -> turn **Device recall** on -> Save.

Nothing else is needed. The service reads `deviceIntegrity.deviceRecall` from the
verdict and writes the bit back with the same service account, using the same
integrity token (valid 14 days). It is best-effort: until the beta is approved
and the toggle is on, recall is simply absent and Android falls back to the
per-address dedup, the daily ceiling and the per-IP rate limit -- no claim
breaks. The account must be Play-licensed for a recall verdict to be evaluated,
and there is a propagation delay of up to ~30 seconds between writing the bit and
reading it back.
