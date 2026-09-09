import crypto from 'node:crypto';

/**
 * Google Play Integrity.
 *
 * The app asks Google for an integrity token and sends it here; we hand it back
 * to Google to decode. The verdict is Google's, about our package, and cannot
 * be produced by an attacker holding our app: that is the whole value of it.
 *
 * What it does not give us is a device identifier that survives a reinstall.
 * Apple's DeviceCheck does, Play Integrity does not, and pretending otherwise
 * would be the security hole in this service. So Android leans on the ledger
 * and the caps for repeat claims, and the difference is documented rather than
 * papered over. See docs/ANDROID_SETUP.md.
 */

const SCOPE = 'https://www.googleapis.com/auth/playintegrity';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const b64url = (input) => Buffer.from(input).toString('base64url');

let cachedToken = { value: null, expiresAt: 0 };

/** An access token for the service account, minted from its own key. */
async function accessToken(serviceAccount) {
    if (cachedToken.value && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.value;

    const now = Math.floor(Date.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64url(
        JSON.stringify({
            iss: serviceAccount.client_email,
            scope: SCOPE,
            aud: TOKEN_URL,
            iat: now,
            exp: now + 3600,
        }),
    );
    const signature = crypto
        .sign('sha256', Buffer.from(`${header}.${payload}`), serviceAccount.private_key)
        .toString('base64url');

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: `${header}.${payload}.${signature}`,
        }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Google refused the service account: ${res.status} ${await res.text()}`);

    const body = await res.json();
    cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cachedToken.value;
}

/**
 * Decodes an integrity token and decides whether to trust it.
 *
 * Every verdict is checked rather than just the app one. A genuine build of our
 * app running on a rooted emulator is still a farm of them, and the request
 * hash ties the verdict to this particular claim so a captured token cannot be
 * replayed against a different address.
 */
export async function verify(token, { packageName, serviceAccount, expectedRequestHash }) {
    const res = await fetch(
        `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
        {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${await accessToken(serviceAccount)}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ integrityToken: token }),
            signal: AbortSignal.timeout(20_000),
        },
    );
    if (!res.ok) throw new Error(`Play Integrity ${res.status}: ${await res.text()}`);

    const verdict = (await res.json()).tokenPayloadExternal ?? {};
    const request = verdict.requestDetails ?? {};
    const app = verdict.appIntegrity ?? {};
    const device = verdict.deviceIntegrity ?? {};
    const account = verdict.accountDetails ?? {};

    const reasons = [];
    if (request.requestPackageName !== packageName) reasons.push('the verdict is for a different package');
    // The client binds the token to this claim by putting SHA-256(address), as
    // lowercase hex, into the request. Play Integrity surfaces that value as
    // `requestHash` on the standard API and `nonce` on the classic one, so
    // accept it in either field -- the binding is what matters, not which API
    // produced it. A token carrying neither is treated as unbound and rejected.
    if (
        expectedRequestHash &&
        request.requestHash !== expectedRequestHash &&
        request.nonce !== expectedRequestHash
    ) {
        reasons.push('the verdict does not match this request, so it may be replayed');
    }
    if (app.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {
        reasons.push(`the app is not the one Play published (${app.appRecognitionVerdict ?? 'no verdict'})`);
    }
    if (!(device.deviceRecognitionVerdict ?? []).includes('MEETS_DEVICE_INTEGRITY')) {
        reasons.push('the device does not meet Play integrity');
    }
    if (account.appLicensingVerdict === 'UNLICENSED') reasons.push('the app is not licensed to this account');

    // Old verdicts are as good as fresh ones unless we say otherwise.
    const age = Date.now() - Number(request.timestampMillis ?? 0);
    if (!Number.isFinite(age) || age > 5 * 60_000) reasons.push('the verdict is older than five minutes');

    return { ok: reasons.length === 0, reasons, verdict };
}
