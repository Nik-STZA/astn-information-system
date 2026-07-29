import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Tests cover pure logic only: parsers, money handling, feature flags. Nothing
// here touches the database or the network, so the suite runs in CI without
// credentials and finishes in seconds.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
