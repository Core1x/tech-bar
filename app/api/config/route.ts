// GET  /api/config — 读取当前 AI 接入 + GitHub Token + 功能开关配置（key 打码返回）
// POST /api/config — 保存配置
//   body: { baseUrl?, model?, apiKey?, clearKey?, githubToken?, clearGithubToken?, features? }
//   - baseUrl/model 传空字符串 → 回退默认；apiKey/githubToken 传非空 → 覆盖；clear* = true → 清空
//   - features: 部分功能开关对象（值必须为布尔），仅写入给定键（「设置 → 功能设置」开关即时保存）
import { NextRequest } from "next/server";
import { DEFAULT_BASE_URL, DEFAULT_MODEL, clearAiConfig, readAiConfig, resolveAiConfig, writeAiConfig } from "@/lib/ai-config";
import { FEATURE_KEYS, readFeatures, writeFeatures, type FeatureKey } from "@/lib/features";
import { clearWeeklyAnchor } from "@/lib/weekly-anchor";

export const dynamic = "force-dynamic";

function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

export async function GET() {
  const cfg = await readAiConfig();
  const resolved = await resolveAiConfig();
  return Response.json({
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    keyConfigured: Boolean(resolved.apiKey),
    keySource: resolved.apiKey === cfg.apiKey && cfg.apiKey ? "website" : resolved.apiKey ? "env" : "none",
    keyMasked: maskKey(resolved.apiKey),
    githubTokenConfigured: Boolean(resolved.githubToken),
    githubTokenMasked: maskKey(resolved.githubToken),
    defaultBaseUrl: DEFAULT_BASE_URL,
    defaultModel: DEFAULT_MODEL,
    features: await readFeatures(),
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { baseUrl, model, apiKey, clearKey, githubToken, clearGithubToken, features } = (body ?? {}) as {
    baseUrl?: unknown;
    model?: unknown;
    apiKey?: unknown;
    clearKey?: unknown;
    githubToken?: unknown;
    clearGithubToken?: unknown;
    features?: unknown;
  };

  // 校验：baseUrl 必须是 http(s) 地址
  if (baseUrl !== undefined) {
    if (typeof baseUrl !== "string") {
      return Response.json({ error: "baseUrl 必须是字符串" }, { status: 400 });
    }
    const url = baseUrl.trim();
    if (url !== "" && !/^https?:\/\/\S+$/.test(url)) {
      return Response.json({ error: "接入地址必须以 http:// 或 https:// 开头" }, { status: 400 });
    }
  }
  if (model !== undefined && typeof model !== "string") {
    return Response.json({ error: "model 必须是字符串" }, { status: 400 });
  }
  if (apiKey !== undefined && typeof apiKey !== "string") {
    return Response.json({ error: "apiKey 必须是字符串" }, { status: 400 });
  }
  if (githubToken !== undefined && typeof githubToken !== "string") {
    return Response.json({ error: "githubToken 必须是字符串" }, { status: 400 });
  }
  // 功能开关：普通对象、每个已知键的值必须是布尔
  const featureUpdates: Partial<Record<FeatureKey, boolean>> = {};
  if (features !== undefined) {
    if (typeof features !== "object" || features === null || Array.isArray(features)) {
      return Response.json({ error: "features 必须是对象" }, { status: 400 });
    }
    const raw = features as Record<string, unknown>;
    for (const key of FEATURE_KEYS) {
      const value = raw[key];
      if (value === undefined) continue;
      if (typeof value !== "boolean") {
        return Response.json({ error: `features.${key} 必须是布尔值` }, { status: 400 });
      }
      featureUpdates[key] = value;
    }
  }

  const updates: Parameters<typeof writeAiConfig>[0] = {};
  if (typeof baseUrl === "string" && baseUrl.trim() !== "") updates.baseUrl = baseUrl.trim();
  if (typeof model === "string" && model.trim() !== "") updates.model = model.trim();
  if (typeof apiKey === "string" && apiKey.trim() !== "") updates.apiKey = apiKey.trim();
  if (typeof githubToken === "string" && githubToken.trim() !== "") updates.githubToken = githubToken.trim();

  await writeAiConfig(updates);

  // 清空（独立开关，避免空串误清）
  if (clearKey === true) await clearAiConfig(["apiKey"]);
  if (clearGithubToken === true) await clearAiConfig(["githubToken"]);

  // 功能开关（仅写给定键；空对象不落盘）
  if (Object.keys(featureUpdates).length > 0) {
    await writeFeatures(featureUpdates);
    // 关闭「自动生成 AI 周报」→ 清冷启动锚点：下次开启从当周周一起重新统计，不回补关闭期间
    if (featureUpdates.autoWeeklyReport === false) await clearWeeklyAnchor();
  }

  const resolved = await resolveAiConfig();
  const cfg = await readAiConfig();
  return Response.json({
    ok: true,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    keyConfigured: Boolean(resolved.apiKey),
    keySource: resolved.apiKey === cfg.apiKey && cfg.apiKey ? "website" : resolved.apiKey ? "env" : "none",
    keyMasked: maskKey(resolved.apiKey),
    githubTokenConfigured: Boolean(resolved.githubToken),
    githubTokenMasked: maskKey(resolved.githubToken),
    features: await readFeatures(),
  });
}
