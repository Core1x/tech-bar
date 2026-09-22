// 中文摘要缓存键（服务端/脚本用；纯函数）：full_name + 原描述哈希，
// 避免仓库描述更新后复用旧摘要。原实现驻 scripts/update-trending.mjs，M2 收进 domain。
import { createHash } from "node:crypto";

export function summaryKey(fullName: string, description: string): string {
  const hash = createHash("sha256").update(description ?? "").digest("hex").slice(0, 12);
  return `${fullName}::${hash}`;
}
