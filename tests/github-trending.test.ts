// Explore 趋势榜页面解析单测：用与真实页面同构的最小 fixture 验证正则解析的关键行为
// （仓名取自 h2 内锚点而非文首 login 星按钮；实体解码；剥 svg 后取尾部计数；语言/描述缺省；stars today 数字）。
import { describe, expect, it } from "vitest";
import { parseTrendingHtml, decodeEntities } from "@/core/sources/github/trending";

function article(opts: {
  name: string;
  desc?: string;
  lang?: string;
  stars: number;
  forks?: number;
  today?: string;
}) {
  const langSpan = opts.lang
    ? `<span class="tmp-mr-3 d-inline-block"><span class="repo-language-color" style="background-color: #3572A5"></span>
  <span itemprop="programmingLanguage">${opts.lang}</span></span>`
    : "";
  const starsA = `<a href="/${opts.name}/stargazers" class="tmp-mr-3 Link Link--muted d-inline-block"><svg aria-label="star" height="16" viewBox="0 0 16 16" width="16"><path d="M8 .25"></path></svg>
        ${opts.stars.toLocaleString("en-US")}</a>`;
  const forksA = opts.forks
    ? `<a href="/${opts.name}/forks" class="tmp-mr-3 Link Link--muted d-inline-block"><svg height="16" viewBox="0 0 16 16"></svg>
        ${opts.forks.toLocaleString("en-US")}</a>`
    : "";
  const today =
    opts.today ??
    `<span data-view-component="true" class="tmp-mr-3 d-inline-block float-sm-right"><svg height="16" viewBox="0 0 16 16"></svg>
        3,882 stars today</span>`;
  const descP = opts.desc !== undefined ? `<p class="col-9 color-fg-muted my-1 tmp-pr-4">
      ${opts.desc}
    </p>` : "";
  return `<article class="Box-row">
  <div class="float-right d-flex"><a href="/login?return_to=%2F${encodeURIComponent(opts.name)}" class="btn-sm">Star</a></div>
  <h2 class="h3 lh-condensed">
    <a href="/${opts.name}" class="Link"><svg height="16" viewBox="0 0 16 16"></svg>
      <span class="text-normal">${opts.name.split("/")[0]} /</span>
      ${opts.name.split("/")[1]}</a>  </h2>
    ${descP}
  <div class="f6 color-fg-muted mt-2">
      ${langSpan}
      ${starsA}
      ${forksA}
      ${typeof today === "string" ? today : ""}
  </div>
</article>`;
}

const page = (inner: string) => `<html><body><div class="Box">${inner}</div></body></html>`;

describe("parseTrendingHtml", () => {
  it("解析完整条目：仓名/描述/语言/总star/fork/今日新增（不被 login 按钮与 svg 数字干扰）", () => {
    const items = parseTrendingHtml(page(article({
      name: "ayghri/i-have-adhd",
      desc: "A skill to stop your coding agent &amp; bury nothing.",
      lang: "Python",
      stars: 38509,
      forks: 2208,
    })));
    expect(items).toHaveLength(1);
    const t = items[0];
    expect(t.rank).toBe(1);
    expect(t.full_name).toBe("ayghri/i-have-adhd");
    expect(t.description).toBe("A skill to stop your coding agent & bury nothing.");
    expect(t.language).toBe("Python");
    expect(t.stars).toBe(38509);
    expect(t.forks).toBe(2208);
    expect(t.stars_today).toBe(3882);
    expect(t.html_url).toBe("https://github.com/ayghri/i-have-adhd");
  });

  it("无语言/无描述/无今日增量 → null/0 优雅缺省；rank 顺序递增", () => {
    const items = parseTrendingHtml(
      page(
        article({ name: "a/one", stars: 100, today: `<span>just built by</span>` }) +
          article({ name: "b/two", desc: "x", stars: 412, today: `<span>7 stars this week</span>` }),
      ),
    );
    expect(items).toHaveLength(2);
    expect(items[0].language).toBeNull();
    expect(items[0].description).toBeNull();
    expect(items[0].stars_today).toBe(0);
    expect(items[1].rank).toBe(2);
    expect(items[1].stars).toBe(412);
    expect(items[1].stars_today).toBe(7);
  });

  it("h2 缺失或结构异常的文章被跳过（结构变更防误解析）", () => {
    const items = parseTrendingHtml(page(`<article class="Box-row"><div>garbage</div></article>`) +
      page(article({ name: "ok/repo", stars: 5 })));
    expect(items).toHaveLength(1);
    expect(items[0].full_name).toBe("ok/repo");
  });

  it("空页面 → 空数组（调用方据此降级）", () => {
    expect(parseTrendingHtml("<html></html>")).toEqual([]);
  });
});

describe("decodeEntities", () => {
  it("命名/数字/十六进制实体；非法码点保留原文", () => {
    expect(decodeEntities("a &amp; b &lt;c&gt; &#39;d&#39; &#x26; &#xD800;")).toBe("a & b <c> 'd' & &#xD800;");
  });
});
