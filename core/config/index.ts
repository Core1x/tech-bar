// core/config —— 配置聚合门面（唯一读 env/密钥的层，ADR A8）
// 统一 re-export AI 接入配置与功能开关，并提供"key 来源"判定（keySource，对应 app/api/config F15 语义）。
import { readAiConfig } from "./ai-config";

export * from "./ai-config";
export * from "./features";

/** API key 生效来源（app/api/config 设置页展示用）：file=网站在线设置；env=.env.local/环境变量；none=未配 */
export type KeySource = "file" | "env" | "none";

export async function resolveKeySource(): Promise<KeySource> {
  const cfg = await readAiConfig();
  if (cfg.apiKey) return "file";
  if (process.env.DEEPSEEK_API_KEY) return "env";
  return "none";
}
