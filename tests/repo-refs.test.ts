// M4 §10.2：从 AI 长文提取被点名的仓库 + 站内链接改写（保守防误报，供行动区与渲染复用）。
import { describe, expect, it } from "vitest";
import { extractRepoRefs, linkifyRepoMentions } from "@/core/domain/repo-refs";

describe("extractRepoRefs", () => {
  it("识别 github.com 链接、加粗与行内代码记号，保序去重", () => {
    const md = [
      "先看 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 与 [openclaw/openclaw](https://github.com/openclaw/openclaw)。",
      "- **JustVugg/colibri**：纯 C 引擎",
      "同类的 `cloudflare/security-audit-skill` 也值得看",
      "重复的 **JustVugg/colibri** 不再计",
    ].join("\n");
    expect(extractRepoRefs(md)).toEqual([
      "deepseek-ai/deepseek-harness",
      "openclaw/openclaw",
      "JustVugg/colibri",
      "cloudflare/security-audit-skill",
    ]);
  });
  it("拒绝伪仓库：docs/ 路径、带文件后缀、停用词、中文标题链接文本", () => {
    const md = [
      "见 [docs/readme.md](https://example.com/docs/readme.md) 与 src/index.ts 说明。",
      "[中文标题](https://example.com/x)",
      "`and/or` 是常式；`n/a` 不算",
      "路径 https://github.com/torvalds/linux/tree/master 仍提取 torvalds/linux",
    ].join("\n");
    const refs = extractRepoRefs(md);
    expect(refs).toContain("torvalds/linux");
    expect(refs).not.toContain("docs/readme.md");
    expect(refs).not.toContain("src/index.ts");
    expect(refs).not.toContain("and/or");
    expect(refs).not.toContain("n/a");
  });
  it("上限截断", () => {
    const md = Array.from({ length: 20 }, (_, i) => `- **owner${i}/repo${i}**`).join("\n");
    expect(extractRepoRefs(md).length).toBe(12);
    expect(extractRepoRefs(md, 5).length).toBe(5);
  });
});

describe("linkifyRepoMentions", () => {
  it("加粗与行内代码记号补站内链接；已是链接的不重复包", () => {
    const md = ["**JustVugg/colibri** 很强", "`alibaba/open-code-review` 发布", "[Cloudflare 外链](https://github.com/cloudflare/workers-sdk) 不变"].join("\n");
    const out = linkifyRepoMentions(md);
    expect(out).toContain("**[JustVugg/colibri](/repo/JustVugg/colibri)**");
    expect(out).toContain("[`alibaba/open-code-review`](/repo/alibaba/open-code-review)");
    expect(out).toContain("[Cloudflare 外链](https://github.com/cloudflare/workers-sdk)");
    expect(out).not.toContain("](/repo/cloudflare");
  });
  it("链接文本里已有的 **o/r** 不被二次包（避免嵌套链接）", () => {
    const md = "[**torvalds/linux**](https://github.com/torvalds/linux)";
    expect(linkifyRepoMentions(md)).toBe(md);
  });
  it("伪仓库不链接", () => {
    const md = "参考 **docs/readme.md** 与 `and/or` 用法";
    expect(linkifyRepoMentions(md)).toBe(md);
  });
});
