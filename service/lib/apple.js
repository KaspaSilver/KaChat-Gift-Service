import crypto from 'node:crypto';

/**
 * Apple DeviceCheck.
 *
 * Two bits of storage per device, held by Apple rather than by us. That is a
 * strange-sounding API until you want exactly this: a mark that says "this
 * device has had its free gift" and that the person holding the device cannot
 * clear. Deleting the app does not clear it. Wiping the phone does not clear
 * it. Nothing the app can do clears it, because the app never holds it.
 *
 * The device token comes from the app (DCDevice.generateToken) and is only
 * meaningful to Apple. We never see a device identifier, which is the point:
 * there is nothing here to correlate users with, and nothing to leak.
 *
 * Requires an App Store Connect key with DeviceCheck access: the .p8 file, its
 * key id, and the team id. See docs/APPLE_SETUP.md.
 */

const QUERY = 'https://api.devicecheck.apple.com/v1/query_two_bits';
const UPDATE = 'https://api.devicecheck.apple.com/v1/update_two_bits';

const b64url = (input) => Buffer.from(input).toString('base64url');

/**
 * The bearer token Apple wants, signed with the App Store Connect key.
 *
 * ES256 signatures are raw r||s in JOSE, and node's default output is DER,
 * which Apple rejects with a bare 401 that says nothing about why. Hence
 * `dsaEncoding`.
 */
export function bearerToken({ teamId, keyId, privateKeyPem }) {
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
    const payload = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) }));
    const signature = crypto
        .sign('sha256', Buffer.from(`${header}.${payload}`), {
            key: privateKeyPem,
            dsaEncoding: 'ieee-p1363',
        })
        .toString('base64url');
    return `${header}.${payload}.${signature}`;
}

async function call(url, credentials, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${bearerToken(credentials)}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    });

    const text = (await res.text()).trim();
    // DeviceCheck answers a query about an untouched device with 200 and the
    // literal string "Failed to find bit state", which is not a failure: it is
    // how it says "this device has never been marked".
    if (res.status === 200 && /failed to find bit state/i.test(text)) return { unset: true };
    if (!res.ok) throw new Error(`DeviceCheck ${res.status}: ${text || 'no detail'}`);
    return text ? JSON.parse(text) : {};
}

const transaction = () => crypto.randomUUID();
const timestamp = () => Date.now();

/** True when this device has already been given its gift. */
export async function hasClaimed(deviceToken, credentials) {
    const answer = await call(QUERY, credentials, {
        device_token: deviceToken,
        transaction_id: transaction(),
        timestamp: timestamp(),
    });
    if (answer.unset) return false;
    return Boolean(answer.bit0);
}

/**
 * Marks the device, before any money moves.
 *
 * The order is deliberate and worth keeping: a crash between marking and paying
 * costs one unclaimed gift, where marking afterwards would leave a device that
 * can claim again every time the payment succeeds and the mark fails.
 */
export async function markClaimed(deviceToken, credentials) {
    await call(UPDATE, credentials, {
        device_token: deviceToken,
        transaction_id: transaction(),
        timestamp: timestamp(),
        bit0: true,
        bit1: false,
    });
}
