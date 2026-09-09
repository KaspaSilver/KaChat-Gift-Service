# KaChat Gift Service

Gives a new KaChat user their first 3 KAS, once, so they can send a message
before they have ever bought anything.

It runs beside a KaChat deployment and a Kaspa node, takes a claim from the iOS
or Android app, proves the claim came from a genuine install on a real device,
and pays out from a wallet the operator funds.

This is only useful to somebody who runs KaChat. It is not a public faucet and
it is not a service anyone else can point an app at: every credential it needs
belongs to a specific App Store and Play Console listing.

---

## The problem it actually solves

Handing out money on request is easy to write and trivial to drain. A faucet with
no proof of who is asking is emptied by one script in an afternoon, and the
usual defences are all weak:

| Defence | Why it fails |
| --- | --- |
| IP address | One phone on mobile data has thousands of addresses; one VPN has millions |
| Wallet address | Free and unlimited. A script makes a new one per claim |
| Device identifier the app sends | The app is on the attacker's phone. Anything it says can be said again |
| A secret compiled into the app | Extractable from the binary in minutes |

The only claims worth trusting are the ones **Apple and Google** vouch for,
because the answer comes from their servers rather than from the handset:

- **iOS** — App Attest proves the request came from a genuine, unmodified build
  of *your* app on real Apple hardware. DeviceCheck then stores two bits against
  the device itself, which survive reinstalling the app and wiping it, so
  "already claimed" cannot be cleared by the person claiming.
- **Android** — Play Integrity proves the app is your app, installed from Play,
  on a device that passes Google's checks.

Both are configured in the setup wizards. Until they are, the service will
refuse to pay anyone.

## What stays out of this repository

This repository is public. Everything below lives on the operator's machine, is
mounted into the container at runtime, and must never be committed here:

| Secret | What it does if leaked |
| --- | --- |
| Payer wallet key | The pool is emptied. This is the one that costs money directly |
| Apple `.p8` key | Impersonates your app to Apple's DeviceCheck and App Attest |
| Google service account JSON | Reads your Play Console and validates against your app |

The ignore list refuses all three by name, and the service reads them from the
mounted configuration directory rather than from anywhere in this tree. A key
committed to a public repository is drained by bots before you have finished
reverting it: treat any leak as spent and rotate rather than un-push.

## How a claim goes through

```
app                     gift service                 Apple / Google        kaspad
 |  claim + attestation      |                             |                 |
 |------------------------->|                             |                 |
 |                          |  is this really your app?   |                 |
 |                          |---------------------------->|                 |
 |                          |<--- verdict ----------------|                 |
 |                          |                                               |
 |                          |  has this device claimed before?              |
 |                          |  (DeviceCheck bits / recall / ledger)         |
 |                          |                                               |
 |                          |  send 3 KAS ------------------------------->  |
 |<--- txid ----------------|                                               |
```

Every step can refuse, and a refusal never pays. The order matters: the device
is marked as having claimed **before** the payment is submitted, so a crash
between the two costs the operator one unclaimed gift rather than an open
faucet.

## Limits that exist because bugs happen

Attestation stops other people's scripts. These stop your own mistakes:

- one claim per device, enforced from the ledger and from DeviceCheck
- a daily payout ceiling, after which the service stops paying and says so
- a pool floor, below which it stops paying rather than emptying the wallet
- every claim recorded with its verdict, address, amount and transaction id

## Configuration

Nothing is configured in this repository. The service reads one directory,
mounted at `/conf`:

```
/conf/gift.json           amounts, ceilings, network, which platforms are on
/conf/payer.key           the wallet that pays. chmod 600, never committed
/conf/apple/AuthKey.p8    App Store Connect key for DeviceCheck and App Attest
/conf/google/service-account.json   Play Integrity access
/data/claims.json         the ledger. Losing this loses the record of who claimed
```

`gift.json.example` shows the shape. The Quick Start panel writes all of it for
you through its Apple and Android wizards; the files are documented here so the
service can be run without the panel.

See [docs/APPLE_SETUP.md](docs/APPLE_SETUP.md) and
[docs/ANDROID_SETUP.md](docs/ANDROID_SETUP.md) for what to fetch from each
console, which is the part nobody can do for you.

## Running it

The panel builds and runs this for you. Standalone:

```bash
docker build -t kachat-gift-service .
docker run --rm -p 8770:8770 \
  -v "$PWD/conf:/conf:ro" -v "$PWD/data:/data" \
  kachat-gift-service
```

It refuses to start if `gift.json` names a platform whose credentials are
missing, rather than starting and failing at the first real claim.

## Status

Early. The attestation, the ledger, the caps and the accounting are the parts
worth reviewing first, because they are what stands between the pool and a
script. A running service pays a valid claim for real; stopping payouts is done
by switching the service off. Test on testnet-10 before pointing it at mainnet.
