export interface Config {
  ethereumNode: string;
  elasticUrl: string;
  elasticApiKey: string | null;
  registryContract: string;
}

const DEFAULT_CONFIG: Config = {
  ethereumNode: "ws://localhost:8546",
  elasticUrl: "https://localhost:9200",
  elasticApiKey: null,
  registryContract: "",
};

export function getConfigFromEnv(): Config {
  const ethereumNode =
    process.env["WB_ETHEREUM_NODE"] || DEFAULT_CONFIG.ethereumNode;
  const elasticUrl = process.env["WB_ELASTIC_URL"] || DEFAULT_CONFIG.elasticUrl;
  const elasticApiKey = process.env["WB_ELASTIC_API_KEY"] || DEFAULT_CONFIG.elasticApiKey;
  const registryContract = process.env["WB_REGISTRY_CONTRACT"] || DEFAULT_CONFIG.registryContract;
  return {
    ethereumNode,
    elasticUrl,
    elasticApiKey,
    registryContract,
  };
}
