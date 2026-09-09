import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Every claim, and the caps that stop a bug being expensive.
 *
 * Attestation stops other people's scripts. This stops ours: a loop that pays
 * the same address forever is a mistake anyone can write, and the difference
 * between noticing it at 300 KAS and at an empty wallet is a ceiling.
 *
 * The address is stored hashed. The operator needs to answer "has this been
 * claimed" and "what did today cost", and neither question needs a list of who
 * received what sitting in a file on a server.
 */
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

export class Ledger {
    constructor(dir) {
        this.file = path.join(dir, 'claims.json');
        this.state = this.#read();
    }

    #read() {
        try {
            return JSON.parse(fs.readFileSync(this.file, 'utf8'));
        } catch {
            return { claims: [], totals: {} };
        }
    }

    #write() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        // Written beside and renamed: a half-written ledger loses the record of
        // who has already been paid, which is the one file worth being careful
        // with here.
        const tmp = `${this.file}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
        fs.renameSync(tmp, this.file);
    }

    static today() {
        return new Date().toISOString().slice(0, 10);
    }

    paidToday() {
        return this.state.totals[Ledger.today()] ?? 0;
    }

    /** True when this address has been given a gift before. */
    hasAddressClaimed(address) {
        const key = hash(address);
        return this.state.claims.some((c) => c.address === key);
    }

    /**
     * Records a claim before the payment is attempted, and returns a handle for
     * writing the outcome back. Recording first is deliberate: a claim that
     * crashes mid-payment must not look like one that never happened.
     */
    open({ platform, address, amountKas }) {
        const entry = {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            platform,
            address: hash(address),
            amountKas,
            status: 'opened',
            txid: null,
            error: null,
        };
        this.state.claims.push(entry);
        this.state.totals[Ledger.today()] = this.paidToday() + amountKas;
        this.#write();

        return {
            id: entry.id,
            settle: (txid) => {
                entry.status = 'paid';
                entry.txid = txid;
                this.#write();
            },
            fail: (message) => {
                entry.status = 'failed';
                entry.error = String(message).slice(0, 300);
                // A failure gives the day's budget back. It was never spent.
                this.state.totals[Ledger.today()] = Math.max(0, this.paidToday() - amountKas);
                this.#write();
            },
        };
    }

    summary() {
        const claims = this.state.claims;
        const byPlatform = (platform) => claims.filter((c) => c.platform === platform && c.status === 'paid');
        return {
            paid: claims.filter((c) => c.status === 'paid').length,
            failed: claims.filter((c) => c.status === 'failed').length,
            apple: byPlatform('apple').length,
            android: byPlatform('android').length,
            paidTodayKas: this.paidToday(),
            lastAt: claims.at(-1)?.at ?? null,
        };
    }

    /**
     * The most recent claims, newest first, for the operator's screen.
     *
     * The receiving address is never returned in the clear -- it is stored
     * hashed, and the operator's questions ("how many, when, did it pay") do
     * not need it. A short slice of that hash goes out as `ref` so distinct
     * recipients can be told apart on screen without identifying anyone; the
     * txid is on-chain already, so it is safe to show and links to the gift.
     */
    recent(limit = 100) {
        return this.state.claims
            .slice(-limit)
            .reverse()
            .map((c) => ({
                at: c.at,
                platform: c.platform,
                amountKas: c.amountKas,
                status: c.status,
                txid: c.txid,
                ref: String(c.address ?? '').slice(0, 12),
                error: c.error ? String(c.error).slice(0, 200) : null,
            }));
    }
}
