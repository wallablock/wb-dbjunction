import { Blockchain } from "wb-blockchain";
import { Config } from "../config";

export function startSyncer(config: Config) {
    asyncStartSyncer(config);
}

async function asyncStartSyncer(config: Config) {
    let blockchain = new Blockchain(config.ethereumNode);
    let syncedUntil = await getLastBlock();
    let syncUpdates = await blockchain.resync((syncedUntil != null) ? syncedUntil : undefined);
    // Process syncUpdates
    // Set callbacks
}

async function getLastBlock(): Promise<string | number | null> {
    throw "Not implemented";
}

