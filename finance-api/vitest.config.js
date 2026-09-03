import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Do not walk up to the parent project's config.
    root: ".",
  },
});
