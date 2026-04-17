import { defineConfig } from "vitest/config";

// The templates/ directory ships as source assets for scaffolded apps; its
// own tests run inside those apps, not here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["templates/**", "dist/**", "node_modules/**"],
  },
});
