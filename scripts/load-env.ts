/** Loads .env.local then .env for CLI scripts (Next.js does this itself for the app). Existing env vars win. */
import { existsSync } from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}
