import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    unstubGlobals: true,
    // Each test starts an in-process Postgres (PGlite), which is slow under load.
    testTimeout: 20_000,
    // More files at once than this starve each other into timeouts.
    maxWorkers: 2,
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
