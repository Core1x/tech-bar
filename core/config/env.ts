// CLI/updater 运行环境加载（镜像原 scripts/_shared.mjs loadEnv，M1.4 config 纪律 ADR A8 下收进 core/config）。
// 用途：CLI（node dist/cli/*.mjs）不像 Next 那样自动读 .env.local，需手动合并：
//   .env.local（根目录）→ 填充未设置的环境变量；data/config/ai-config.json（网站在线设置）→ 覆盖生效。
// 语义与原脚本一致：.env.local 只在 env 未设时填；ai-config.json 值优先（覆盖）。
import { readFileSync } from "node:fs";
import path from "node:path";

/** 合并 .env.local + ai-config.json 进 process.env（幂等；无文件则跳过）。默认 root=process.cwd() */
export function loadCliEnv(root: string = process.cwd()): void {
  // 1) .env.local：仅填未被系统环境变量覆盖的项
  try {
    const raw = readFileSync(path.join(root, ".env.local"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env.local 不存在则仅用系统环境变量
  }

  // 2) data/config/ai-config.json（网站设置，配置优先）
  try {
    const cfg = JSON.parse(
      readFileSync(path.join(root, "data", "config", "ai-config.json"), "utf-8"),
    ) as {
      baseUrl?: string;
      apiKey?: string;
      model?: string;
      githubToken?: string;
    };
    if (typeof cfg.baseUrl === "string" && cfg.baseUrl.trim()) {
      process.env.DEEPSEEK_API_BASE = cfg.baseUrl.trim().replace(/\/+$/, "");
    }
    if (typeof cfg.apiKey === "string" && cfg.apiKey.trim()) {
      process.env.DEEPSEEK_API_KEY = cfg.apiKey.trim();
    }
    if (typeof cfg.model === "string" && cfg.model.trim()) {
      process.env.DEEPSEEK_MODEL = cfg.model.trim();
    }
    if (typeof cfg.githubToken === "string" && cfg.githubToken.trim()) {
      process.env.GITHUB_TOKEN = cfg.githubToken.trim();
    }
  } catch {
    // ai-config.json 不存在则跳过
  }
}
