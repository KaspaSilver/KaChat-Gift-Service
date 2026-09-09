import kaspa from 'kaspa-wasm';

const { RpcClient, Encoding, PrivateKey, createTransactions, kaspaToSompi } = kaspa;

/** The address a wallet key sends from, in the given network. */
export function walletAddress(privateKeyHex, network) {
    return new PrivateKey(privateKeyHex).toKeypair().toAddress(network).toString();
}

/**
 * Sends `amountKas` from the gift wallet to `toAddress` and returns the
 * transaction id.
 *
 * The flow mirrors the notifier's proven one: connect, read the wallet's own
 * UTXOs, build one transaction with the change coming back to the wallet, sign
 * it with the wallet key, submit. Two guards sit before the money moves -- an
 * empty wallet, and a payment that would drop the pool below its floor -- so a
 * misconfigured or drained wallet fails loudly rather than doing something
 * surprising. The caller records the claim before calling this and marks it
 * failed if it throws, so nothing is ever paid twice.
 */
export async function sendGift({ privateKeyHex, network, kaspadUrl, toAddress, amountKas, poolFloorKas = 0 }) {
    const pk = new PrivateKey(privateKeyHex);
    const fromAddress = pk.toKeypair().toAddress(network).toString();

    // Port 17110 is wRPC Borsh, 18110 is JSON; match the encoding to the URL so
    // the client speaks what the node is listening for.
    const encoding = kaspadUrl.includes('17110') ? Encoding.Borsh : Encoding.SerdeJson;
    const rpc = new RpcClient(kaspadUrl, encoding, network);
    await rpc.connect({});
    try {
        const resp = await rpc.getUtxosByAddresses({ addresses: [fromAddress] });
        const entries = resp?.entries ?? [];
        if (entries.length === 0) throw new Error('the gift wallet has no funds');

        const amountSompi = kaspaToSompi(amountKas);
        const floorSompi = kaspaToSompi(poolFloorKas);
        const balanceSompi = entries.reduce((sum, e) => sum + BigInt(e?.utxoEntry?.amount ?? e?.amount ?? 0), 0n);
        if (balanceSompi - amountSompi < floorSompi) {
            throw new Error('paying this would drop the pool below its floor');
        }

        const { transactions } = await createTransactions({
            entries,
            outputs: [{ address: toAddress, amount: amountSompi }],
            changeAddress: fromAddress,
            priorityFee: 0n,
            networkId: network,
        });
        if (!transactions || transactions.length === 0) throw new Error('no transaction could be built');

        let txid = null;
        for (const tx of transactions) {
            tx.sign([pk]);
            txid = await tx.submit(rpc);
        }
        return txid;
    } finally {
        try {
            await rpc.disconnect();
        } catch {
            /* already gone */
        }
    }
}
