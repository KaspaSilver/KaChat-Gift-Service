import fs from 'node:fs';
import { walletAddress } from './payer.js';

/**
 * Reads the configuration and the secrets it points at, and refuses to start
 * when a platform is switched on without the credentials it needs.
 *
 * Refusing at startup rather than at the first claim is the whole point. A
 * service that starts happily and fails when a real user taps the button turns
 * a missing file into a support conversation, and every one of these is a file
 * somebody had to fetch from a console by hand.
 */
export function load(file, { dataDir }) {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        throw new Error(`Could not read ${file}: ${err.message}. Copy gift.json.example and fill it in.`);
    }

    const problems = [];
    const cfg = {
        network: raw.network ?? 'testnet-10',
        amountKas: Number(raw.amountKas ?? 3),
        caps: {
            dailyKas: Number(raw.caps?.dailyKas ?? 300),
            poolFloorKas: Number(raw.caps?.poolFloorKas ?? 50),
        },
        kaspad: { url: raw.kaspad?.url ?? 'ws://kaspad:18110' },
        apple: null,
        android: null,
        dataDir,
    };

    if (!(cfg.amountKas > 0)) problems.push('amountKas must be more than zero.');

    if (raw.apple?.enabled) {
        const a = raw.apple;
        for (const field of ['teamId', 'keyId', 'bundleId', 'keyFile']) {
            if (!a[field]) problems.push(`apple.${field} is required when Apple is switched on.`);
        }
        let privateKeyPem = null;
        if (a.keyFile) {
            try {
                privateKeyPem = fs.readFileSync(a.keyFile, 'utf8');
            } catch (err) {
                problems.push(`Could not read the Apple key at ${a.keyFile}: ${err.message}`);
            }
        }
        cfg.apple = { teamId: a.teamId, keyId: a.keyId, bundleId: a.bundleId, privateKeyPem };
    }

    if (raw.android?.enabled) {
        const g = raw.android;
        if (!g.packageName) problems.push('android.packageName is required when Android is switched on.');
        let serviceAccount = null;
        if (g.serviceAccountFile) {
            try {
                serviceAccount = JSON.parse(fs.readFileSync(g.serviceAccountFile, 'utf8'));
                if (!serviceAccount.client_email || !serviceAccount.private_key) {
                    problems.push('The Google service account file has no client_email or private_key.');
                }
            } catch (err) {
                problems.push(`Could not read the Google service account at ${g.serviceAccountFile}: ${err.message}`);
            }
        } else {
            problems.push('android.serviceAccountFile is required when Android is switched on.');
        }
        cfg.android = { packageName: g.packageName, serviceAccount };
    }

    if (!cfg.apple && !cfg.android) {
        problems.push('Neither platform is switched on, so nothing could ever claim a gift.');
    }

    // The wallet gifts are sent from. The service always pays a valid claim
    // when it is running -- turning the service off is how you stop payouts --
    // so a missing or malformed key is validated here but does not stop the
    // service starting: it starts, and a claim is refused at the money with a
    // clear reason until a wallet is created and funded on the panel. That is
    // gentler than refusing to start, which would read as a crash.
    let wallet = null;
    if (raw.wallet?.privateKeyHex) {
        if (!/^[0-9a-fA-F]{64}$/.test(raw.wallet.privateKeyHex)) {
            problems.push('wallet.privateKeyHex must be 64 hexadecimal characters.');
        } else {
            try {
                wallet = { privateKeyHex: raw.wallet.privateKeyHex, address: walletAddress(raw.wallet.privateKeyHex, cfg.network) };
            } catch (err) {
                problems.push(`The wallet key could not be used: ${err.message}`);
            }
        }
    }
    cfg.wallet = wallet;

    if (problems.length) {
        throw new Error(`The gift service cannot start:\n  - ${problems.join('\n  - ')}`);
    }
    return cfg;
}
