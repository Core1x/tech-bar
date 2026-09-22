// AI 接入配置（data/config/ai-config.json）—— 网站在线可改，无需改 .env.local
// M1.4 由 lib/ai-config.ts 迁入（逐字）；lib/ai-config.ts 现为 re-export 垫片。
// 解析优先级：ai-config.json（网站设置） > .env.local / 环境变量 > 内置默认
// 铁律：env/密钥只在本模块读（ADR A8），lib 与脚本经 core/config 取值，杜绝散落 process.env。
import fs from 'node:fs/promises';
import path from 'node:path';

export interface AiConfig {
  /** OpenAI 兼容接口 Base URL，如 https://api.deepseek.com */
  baseUrl?: string;
  /** API Key（明文存储于本地 data/ 目录，与 .env.local 同等安全等级） */
  apiKey?: string;
  /** 模型名，如 deepseek-chat */
  model?: string;
  /** GitHub Personal Access Token（可选，配额从 60/小时 升到 5000/小时） */
  githubToken?: string;
}

const CONFIG_PATH = path.join(process.cwd(), 'data', 'config', 'ai-config.json');

export const DEFAULT_BASE_URL = 'https://api.deepseek.com';
export const DEFAULT_MODEL = 'deepseek-chat';

export async function readAiConfig(): Promise<AiConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
    const obj = JSON.parse(raw) as AiConfig;
    return obj && typeof obj === 'object' ? obj : {};
  } catch {
    return {};
  }
}

export async function writeAiConfig(cfg: AiConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  // 合并语义：只更新传入的字段，绝不覆盖其他已配置项（如 AI key 与 GitHub token 互不影响）
  const current = await readAiConfig();
  const merged: AiConfig = { ...current, ...cfg };
  // 空字段不落盘（表示回退默认）
  const clean: AiConfig = {};
  if (merged.baseUrl) clean.baseUrl = merged.baseUrl;
  if (merged.apiKey) clean.apiKey = merged.apiKey;
  if (merged.model) clean.model = merged.model;
  if (merged.githubToken) clean.githubToken = merged.githubToken;
  await fs.writeFile(CONFIG_PATH, JSON.stringify(clean, null, 2) + '\n', 'utf-8');
}

export async function clearAiConfig(
  fields: Array<'baseUrl' | 'apiKey' | 'model' | 'githubToken'> = ['baseUrl', 'apiKey', 'model', 'githubToken'],
): Promise<void> {
  // 注意：直接写盘，不能走 writeAiConfig（它的合并逻辑会把要删的字段从文件读回来）
  const cfg = await readAiConfig();
  for (const f of fields) delete cfg[f];
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

/** 解析最终生效的配置（AI + GitHub） */
export async function resolveAiConfig(): Promise<{
  baseUrl: string;
  apiKey: string;
  model: string;
  githubToken: string;
}> {
  const cfg = await readAiConfig();
  return {
    baseUrl: (cfg.baseUrl || process.env.DEEPSEEK_API_BASE || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    apiKey: cfg.apiKey || process.env.DEEPSEEK_API_KEY || '',
    model: cfg.model || process.env.DEEPSEEK_MODEL || DEFAULT_MODEL,
    githubToken: cfg.githubToken || process.env.GITHUB_TOKEN || '',
  };
}

export async function hasAiKey(): Promise<boolean> {
  return Boolean((await resolveAiConfig()).apiKey);
}
