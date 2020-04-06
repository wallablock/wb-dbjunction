export interface Config {
    ethereumNode: string,
    elasticUrl: string,
    elasticUsername: string,
    elasticPassword: string
}

const DEFAULT_CONFIG: Config = {
    ethereumNode: "ws://localhost:8545",
    elasticUrl: "https://f90c7dc79c2b425caf77079b50ec5677.eu-central-1.aws.cloud.es.io:9243/",
    elasticUsername: "sync",
    // BUG: Yes, I'm fully aware that we have the password here in plain text.
    // This will be fixed for the final release
    elasticPassword: "wallablocksync"
}

export function getConfigFromEnv(): Config {
    const ethereumNode = process.env["ETHEREUM_NODE"] || DEFAULT_CONFIG.ethereumNode;
    const elasticUrl = process.env["ELASTIC_URL"] || DEFAULT_CONFIG.elasticUrl;
    const elasticUsername = process.env["ELASTIC_USERNAME"] || DEFAULT_CONFIG.elasticUsername;
    const elasticPassword = process.env["ELASTIC_PASSWORD"] || DEFAULT_CONFIG.elasticPassword;
    return {
        ethereumNode,
        elasticUrl,
        elasticUsername,
        elasticPassword
    }
}
