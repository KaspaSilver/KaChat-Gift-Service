import http from 'node:http';
import crypto from 'node:crypto';
import { load } from './lib/config.js';
import { Ledger } from './lib/ledger.js';
import * as apple from './lib/apple.js';
import * as android from './lib/android.js';
import { sendGift } from './lib/payer.js';

/**
 * The gift service.
 *
 * One endpoint that matters: a device asks for its first 3 KAS, and this
 * decides whether to believe it. Everything else is reporting.
 *
 * The order of checks is the design. Cheap and local first, so a flood costs us
 * nothing; the store round-trip only for requests that would otherwise be paid;
 * the device marked before the money moves. Read `claim` from the top and the
 * money is the last thing that happens.
 */

const PORT = Number(process.env.GIFT_PORT ?? 8770);
const config = load(process.env.GIFT_CONF ?? '/conf/gift.json', { dataDir: process.env.GIFT_DATA ?? '/data' });
const ledger = new Ledger(config.dataDir);

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

const json = (res, status, body) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
    res.end(text);
};

/** Refusals say what to fix and never say how the check works. */
const refuse = (res, status, reason) => json(res, status, { ok: false, reason });

async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > 64 * 1024) throw new Error('body too large');
        chunks.push(chunk);
    }
    return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

/**
 * A Kaspa address, checked for shape before anything is done with it.
 *
 * Not a full validation -- the payer rejects a bad address on its own -- but
 * enough that a malformed one is refused before it reaches Apple, Google or the
 * node, and enough that nothing weird ends up in the ledger.
 */
const ADDRESS = /^kaspa(test)?:[a-z0-9]{50,90}$/;

async function claim(req, res) {
    const body = await readBody(req);
    const platform = String(body.platform ?? '');
    const address = String(body.address ?? '');

    if (platform !== 'apple' && platform !== 'android') return refuse(res, 400, 'Unknown platform.');
    if (!ADDRESS.test(address)) return refuse(res, 400, 'That is not a Kaspa address.');

    const settings = platform === 'apple' ? config.apple : config.android;
    if (!settings) return refuse(res, 503, `${platform} gifting is not switched on here.`);

    // --- the free checks, before anyone is asked anything -------------------
    if (ledger.hasAddressClaimed(address)) return refuse(res, 409, 'That address has already had its gift.');
    if (ledger.paidToday() + config.amountKas > config.caps.dailyKas) {
        log('refused: the daily ceiling is reached');
        return refuse(res, 503, 'Today\'s gifts are all given out. Try tomorrow.');
    }

    // --- the store round trip ----------------------------------------------
    let deviceToken = null;
    if (platform === 'apple') {
        deviceToken = String(body.deviceToken ?? '');
        if (!deviceToken) return refuse(res, 400, 'No device token.');
        try {
            if (await apple.hasClaimed(deviceToken, config.apple)) {
                return refuse(res, 409, 'This device has already had its gift.');
            }
        } catch (err) {
            log('apple devicecheck failed:', err.message);
            return refuse(res, 502, 'Could not check with Apple. Try again shortly.');
        }
    } else {
        const token = String(body.integrityToken ?? '');
        if (!token) return refuse(res, 400, 'No integrity token.');
        // Ties the verdict to this address, so a captured token cannot be
        // replayed to pay somebody else.
        const expectedRequestHash = crypto.createHash('sha256').update(address).digest('hex');
        try {
            const verdict = await android.verify(token, { ...config.android, expectedRequestHash });
            if (!verdict.ok) {
                log('android refused:', verdict.reasons.join('; '));
                return refuse(res, 403, 'This app or device did not pass Google\'s checks.');
            }
        } catch (err) {
            log('play integrity failed:', err.message);
            return refuse(res, 502, 'Could not check with Google. Try again shortly.');
        }
    }

    // --- mark first, pay second --------------------------------------------
    const entry = ledger.open({ platform, address, amountKas: config.amountKas });
    if (platform === 'apple') {
        try {
            await apple.markClaimed(deviceToken, config.apple);
        } catch (err) {
            entry.fail(`could not mark the device: ${err.message}`);
            log('apple mark failed:', err.message);
            return refuse(res, 502, 'Could not record the claim with Apple. Nothing was sent.');
        }
    }

    if (config.mode !== 'live') {
        entry.settle(null);
        log(`recorded a ${platform} claim for ${config.amountKas} KAS, not sent: the service is in record-only mode`);
        return json(res, 200, {
            ok: true,
            sent: false,
            amountKas: config.amountKas,
            note: 'Recorded. This service is in record-only mode and has not sent anything.',
        });
    }

    // Live: send the gift. The claim is already recorded (open, above), so a
    // failed send is marked failed and nothing is paid twice.
    try {
        const txid = await sendGift({
            privateKeyHex: config.wallet.privateKeyHex,
            network: config.network,
            kaspadUrl: config.kaspad.url,
            toAddress: address,
            amountKas: config.amountKas,
            poolFloorKas: config.caps.poolFloorKas,
        });
        entry.settle(txid);
        log(`sent ${config.amountKas} KAS to ${address}: ${txid}`);
        return json(res, 200, { ok: true, sent: true, amountKas: config.amountKas, txid });
    } catch (err) {
        entry.fail(err.message);
        log('payout failed:', err.message);
        return refuse(res, 502, 'Could not send the gift right now. Nothing was sent.');
    }
}

const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://gift');
        if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { ok: true });

        if (req.method === 'GET' && url.pathname === '/v1/status') {
            return json(res, 200, {
                ok: true,
                network: config.network,
                mode: config.mode,
                amountKas: config.amountKas,
                caps: config.caps,
                platforms: { apple: Boolean(config.apple), android: Boolean(config.android) },
                claims: ledger.summary(),
            });
        }

        if (req.method === 'POST' && url.pathname === '/v1/claim') return await claim(req, res);
        return refuse(res, 404, 'No such endpoint.');
    } catch (err) {
        log('request failed:', err.message);
        return refuse(res, 500, 'Something went wrong.');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    log(`gift service on :${PORT}`);
    log(`network        : ${config.network}`);
    log(`mode           : ${config.mode}${config.mode === 'live' ? '' : ' (records claims, sends nothing)'}`);
    log(`gift           : ${config.amountKas} KAS, ceiling ${config.caps.dailyKas} KAS a day`);
    log(`platforms      : ${[config.apple && 'apple', config.android && 'android'].filter(Boolean).join(', ')}`);
});
