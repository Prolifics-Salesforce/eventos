import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 }, // each file starts its own embedded Postgres, which can take over 10s when all run at once
});
