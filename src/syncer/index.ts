import { Blockchain } from "wb-blockchain";

export function startSyncer() {
    asyncStartSyncer();
}

async function asyncStartSyncer() {
    let blockchain = new Blockchain();
    let syncedUntil = await getLastBlock();
    let syncUpdates = await blockchain.resync((syncedUntil != null) ? syncedUntil : undefined);
    // Process syncUpdates
    // Set callbacks
}

async function getLastBlock(): Promise<string | number | null> {
    throw "Not implemented";
}

