import path from "node:path";
import { config } from "dotenv";
import { loadEnv } from "./env";
import { startServer } from "./server";

config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });

const env = loadEnv();
const server = await startServer(env);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void server.close().finally(() => process.exit(0));
  });
}
