import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Real-provider connectivity tests. Each suite is skipped unless its credentials are set. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: { environment: "node", include: ["tests/integration/**/*.test.ts"], testTimeout: 180_000 },
});
