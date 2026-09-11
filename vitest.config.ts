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
    // finance-api is a separate Node service with its own package.json, so
    // its logic was outside the suite entirely. The Xero decisions live
    // there, and those are the ones that can post to the wrong ledger.
    // scripts/ holds the local runners; their pure planning helpers are tested
    // here, the parts that spawn processes are not.
    include: ["src/**/*.test.ts", "finance-api/**/*.test.js", "scripts/**/*.test.mjs"],
  },
});
