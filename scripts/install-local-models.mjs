import { ensureLocalModels } from "../src/local-models/installer.ts";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
if (config.autoInstallLocalModels === false) {
  console.log("Local model auto-install is disabled.");
  process.exit(0);
}
try {
  const result = await ensureLocalModels(config.ollamaBaseUrl, true);
  console.log(JSON.stringify({ hardware: result.hardware, planned: result.planned, pulled: result.pulled }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
