import { loadConfig } from "./config.ts";
import { createPlatformServer } from "./http/server.ts";

const config = loadConfig();
const { server, database } = createPlatformServer(config);

server.listen(config.port, config.host, () => {
  console.info(JSON.stringify({
    level: "info",
    message: "ASH AI PLATFORM started",
    host: config.host,
    port: config.port,
    apiVersion: "v1",
  }));
});

function shutdown() {
  server.close(() => {
    void Promise.resolve(database.close()).finally(() => process.exit(0));
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

