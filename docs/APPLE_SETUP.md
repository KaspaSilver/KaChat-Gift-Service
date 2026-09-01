# Apple setup

What the panel's Apple wizard walks you through, and what it needs from you.
None of it can be scripted: Apple only hands these out through a signed-in
console.

## What we use and why

**DeviceCheck** stores two bits against a device, on Apple's servers. That is
where "this device has had its free gift" lives, because it is the only place
the person holding the device cannot reach. Deleting the app does not clear it.
Restoring from a backup does not clear it. Wiping the phone does not clear it.

We never learn a device identifier. The app sends a token that means something
only to Apple, and Apple answers yes or no.

## What to fetch

1. **Team ID** — App Store Connect → *Membership*. Ten characters.
2. **Bundle ID** — the app's, exactly. `com.kachat.app` unless yours differs.
3. **A key with DeviceCheck access** — App Store Connect → *Users and Access* →
   *Integrations* → *App Store Connect API* → **+**. Tick **DeviceCheck**.
   - Download the **`.p8`** file. Apple gives it to you **once**. There is no
     second chance and no way to re-download it.
   - Note the **Key ID** shown beside it.

## What to do with the `.p8`

Give it to the panel's wizard, which writes it into the stack's own
configuration directory with restrictive permissions. Do not put it in this
repository, in the app, or in any repository: it authenticates as your app to
Apple, and it is not revocable by editing a file afterwards.

If you ever paste it somewhere public, revoke the key in App Store Connect and
issue a new one. Deleting the message or the commit is not enough.

## What the app has to do

The service can only check a device that identifies itself to Apple:

```swift
DCDevice.current.generateToken { token, error in
    // POST { platform: "apple", address: <kaspa address>, deviceToken: <base64 token> }
    // to the gift service
}
```

`DCDevice.current.isSupported` is false on the simulator, so claims can only be
tested on a real device.

## Checking it works

The wizard's last step asks Apple to answer a query with your key. A wrong key
id, an expired key or the wrong team gives a bare `401` with no explanation, so
the wizard reports which of the three it could not rule out rather than passing
Apple's silence on to you.
