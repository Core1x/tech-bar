import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": ROOT },
  },
  test: {
    // 单测统一集中到顶层 tests/（用户约定：不散落各模块）；import 一律走 @/ 别名指向 core/lib
    include: ["tests/**/*.test.ts"],
  },
});
