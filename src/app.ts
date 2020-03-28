import { startSyncer } from "./syncer";
import { getConfigFromEnv } from "./config";

const config = getConfigFromEnv();
startSyncer(config);
