// Generate (or derive) the gift service's sending wallet with the same Kaspa
// SDK the payout uses, so the address is exactly the one gifts are sent from.
// The control panel runs this to create the wallet on the Gift service tab.
//
//   node gen-wallet.js --network mainnet            -> {privateKeyHex, address}
//   node gen-wallet.js --network X --from-key <hex> -> {address}  (derive only)
import kaspa from 'kaspa-wasm';

const { Keypair, PrivateKey } = kaspa;

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const network = opt('--network', 'mainnet');
const fromKey = opt('--from-key', null);

try {
    if (fromKey !== null) {
        if (!/^[0-9a-fA-F]{64}$/.test(fromKey)) throw new Error('private key must be 64 hex characters');
        const address = new PrivateKey(fromKey).toKeypair().toAddress(network).toString();
        console.log(JSON.stringify({ address, network }));
    } else {
        const keypair = Keypair.random();
        console.log(
            JSON.stringify({
                privateKeyHex: keypair.privateKey.toString(),
                address: keypair.toAddress(network).toString(),
                network,
            }),
        );
    }
} catch (err) {
    console.error(err.message);
    process.exit(1);
}
