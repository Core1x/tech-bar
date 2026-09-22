import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 依赖边界（ADR A10 = eslint import/no-restricted-paths 白名单）。
  // "import" 插件已由 eslint-config-next/typescript 注册，此处只加规则、不再重复注册。
  // M1.1 先以空 zones 验证规则可加载且 lint 不破坏基线；
  // M1.7 再按 core/README.md 的依赖表收紧 zones（目标形态见 docs/architecture.md §3 依赖规则）。
  {
    rules: {
      // M1.1：只放一条当前必然通过的守卫，验证规则真在运行且不破坏基线；
      // M1.7 按 core/README.md 依赖表收紧成完整白名单（见 docs/architecture.md §3）。
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            // presentation（app/components）不得 import scripts/（脚本自成体系，走 core）
            { target: path.join(ROOT, "scripts"), from: [path.join(ROOT, "app"), path.join(ROOT, "components")] },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // cli 构建产物
    "dist/**",
  ]),
]);

export default eslintConfig;
