# Client API

The contract a phone app speaks to this service. It is small: three endpoints,
one of which matters. If a client gets `{"ok":false,"reason":"No such
endpoint."}`, it is talking to the right server on the wrong path -- that string
is this service's own 404, not a proxy's.

Base URL is wherever the service is published, e.g. `https://gift.<your-domain>`.
When the service shares a name under a path prefix (`/gift`), the proxy strips
the prefix, so the client still calls `/v1/claim` under that base.

## GET /healthz

Liveness. Returns `{"ok":true}`.

## GET /v1/status

Operator/diagnostic view. No secrets. Example:

```json
{
  "ok": true,
  "network": "mainnet",
  "amountKas": 3,
  "walletReady": true,
  "caps": { "dailyKas": 300, "poolFloorKas": 50 },
  "platforms": { "apple": true, "android": true },
  "claims": { "paid": 0, "failed": 0, "apple": 0, "android": 0, "paidTodayKas": 0, "lastAt": null }
}
```

A running service pays a valid claim -- there is no record-only mode. Stopping
payouts is done by switching the service off. `walletReady: false` means no
sending wallet has been funded yet, so a claim is refused (503) until one is.

## POST /v1/claim

The one endpoint. One device asks for its first gift. `Content-Type:
application/json`.

### Request

```json
{
  "platform": "apple" | "android",
  "address": "kaspa:qq...",           // the recipient, ^kaspa(test)?:[a-z0-9]{50,90}$
  "deviceToken": "<base64>",           // apple only
  "integrityToken": "<string>"         // android only
}
```

#### iOS (`platform: "apple"`)

This service uses **DeviceCheck**, not App Attest. There is **no challenge
round-trip** and no `/challenge` endpoint.

1. `let token = try await DCDevice.current.generateToken()`
2. Base64-encode it and send it as `deviceToken`.

The server queries DeviceCheck for this device's stored bit (has it claimed
before) and, if not, sets it **before** paying. The mark lives with Apple, so it
survives reinstall/restore/wipe -- that is the one-gift-per-device guarantee.

#### Android (`platform: "android"`)

This service uses **Play Integrity**. The old `api.kachat.app` had no Android
branch; this one does.

1. Compute the binding value **`SHA-256(address)` as lowercase hex** (a 64-char
   `[0-9a-f]` string). The input is the **exact `address` string** you send in
   the claim, and **nothing else** -- no device id, no colon, no concatenation.
   `sha256("kaspa:qr2h…")`, not `sha256("kaspa:qr2h…:someDeviceId")`.
2. Put that value in the Play Integrity request's binding field, then send the
   returned token as `integrityToken` with `platform: "android"` and the same
   `address`.
3. Either Play Integrity API is fine: on the **standard** API it is the
   `requestHash`; on the **classic** API it is the `nonce`. The server accepts
   the value in **either** `requestDetails.requestHash` **or**
   `requestDetails.nonce`, so use whichever flow you already have -- only the
   value has to match.

The binding is required: the server recomputes `SHA-256(address)` and rejects a
token whose bound value matches neither field, so a captured token cannot be
replayed to pay a different address. The server also requires `PLAY_RECOGNIZED`,
`MEETS_DEVICE_INTEGRITY`, a licensed account, the right package name, and a
verdict less than five minutes old.

> Note: Play Integrity does not persist a per-device mark across reinstalls the
> way DeviceCheck does. On Android, repeat claims are bounded by the per-address
> dedup, the daily ceiling and the pool floor, not prevented outright.

### Responses

Success (HTTP 200). The transaction id field is exactly **`txid`** (lowercase),
a hex string -- not `txId`, `transactionId`, or anything else:

```json
{ "ok": true, "sent": true, "amountKas": 3, "txid": "<hex>" }
```

Refusal (`{"ok":false,"reason":"..."}`), by status:

| Status | When |
|--------|------|
| 400 | unknown platform, malformed address, or missing device/integrity token |
| 403 | Android: the app or device did not pass Google's checks |
| 409 | this address, or this iOS device, has already had its gift |
| 502 | could not reach Apple/Google, or the payout itself failed (nothing sent) |
| 503 | this platform is off, the daily ceiling is reached, or no sending wallet is funded yet |

A client should treat any non-200 as "no gift this time" and show `reason`.

## What changed from `api.kachat.app`

- Path is **`/v1/claim`**, not `/challenge` or `/gift/challenge`.
- iOS is **DeviceCheck** (`DCDevice.generateToken`), not a challenge/App-Attest
  exchange.
- Android is supported here via **Play Integrity** (`platform:"android"`,
  `integrityToken`, `requestHash = SHA-256(address)`).
