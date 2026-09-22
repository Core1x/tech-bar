// cli 构建（esbuild JS API）：把 cli/*.ts 打成 node 直跑的 dist/cli/*.mjs。
// 用 JS API 以便带 tsconfig paths 别名（@ → repo 根），esbuild CLI 不认 tsconfig paths。
// 使用：node scripts/cli-build.mjs（package.json "build:cli"）。
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "cli");

rmSync(OUT, { recursive: true, force: true });

await build({
  entryPoints: [
    path.join(ROOT, "cli", "run-source.ts"),
    path.join(ROOT, "cli", "daily.ts"),
    path.join(ROOT, "cli", "hot.ts"),
  ],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outExtension: { ".js": ".mjs" },
  outdir: OUT,
  alias: { "@": ROOT },
  logLevel: "info",
});
