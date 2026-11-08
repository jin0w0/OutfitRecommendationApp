import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    unstubGlobals: true,
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
