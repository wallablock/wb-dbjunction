export interface Config {
    ethereumNode: string,
    elasticUrl: string,
    elasticApiKey: string | null
}

const DEFAULT_CONFIG = {
    ethereumNode: "ws://localhost:8545",
    elasticUrl: "https://localhost:9200"
}

export function getConfigFromEnv(): Config {
    const ethereumNode = process.env["WB_ETHEREUM_NODE"] ?? DEFAULT_CONFIG.ethereumNode;
    const elasticUrl = process.env["WB_ELASTIC_URL"] ?? DEFAULT_CONFIG.elasticUrl;
    const elasticApiKey = process.env["WB_ELASTIC_API_KEY"] ?? null;
    return {
        ethereumNode,
        elasticUrl,
        elasticApiKey
    }
}
