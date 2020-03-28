export interface Config {
    ethereumNode: string
}

const DEFAULT_CONFIG: Config = {
    ethereumNode: "ws://localhost:8545"
}

export function getConfigFromEnv(): Config {
    const ethereumNode = process.env["ETHEREUM_NODE"] || DEFAULT_CONFIG.ethereumNode;
    return {
        ethereumNode
    }
}
