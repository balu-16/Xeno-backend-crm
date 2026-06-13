import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.spec.ts", "src/**/__tests__/**/*.spec.ts"],
    exclude: ["dist/**", "node_modules/**"]
  }
});
