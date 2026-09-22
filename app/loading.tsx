// 路由切换即时骨架（性能体验）：本页全部路由都是 force-dynamic——按 Next 16 的导航模型，
// 动态路由没有 loading.tsx 时「预取被跳过、点击后必须等服务端整页响应」，切换体感卡顿；
// 有了它：Link 进入视口/悬停即预取外壳，点击立即完成导航并展示此骨架，页面内容就绪后无感替换。
// 形状刻意贴近通用版式（标题行 + 主卡 + 列表），避免各页差异造成的跳动。
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-16" aria-busy="true" aria-label="页面加载中">
      {/* 页头 */}
      <div className="flex items-center justify-between border-b border-[#21262d] py-4">
        <div className="space-y-2">
          <div className="h-5 w-40 animate-pulse rounded bg-[#21262d]" />
          <div className="h-3 w-56 animate-pulse rounded bg-[#21262d]/70" />
        </div>
        <div className="h-8 w-24 animate-pulse rounded-md bg-[#21262d]" />
      </div>

      {/* 主卡（简报/信息卡位） */}
      <div className="mt-6 rounded-lg border border-[#30363d] bg-[#161b22] p-4">
        <div className="flex items-center gap-2">
          <div className="h-4 w-28 animate-pulse rounded bg-[#21262d]" />
          <div className="ml-auto h-4 w-20 animate-pulse rounded-full bg-[#21262d]" />
        </div>
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <div className="mt-1 h-4 w-4 shrink-0 animate-pulse rounded bg-[#21262d]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-1/2 animate-pulse rounded bg-[#21262d]" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-[#21262d]/70" />
              </div>
              <div className="h-5 w-16 shrink-0 animate-pulse rounded bg-[#21262d]" />
            </div>
          ))}
        </div>
      </div>

      {/* 列表区 */}
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="h-64 animate-pulse rounded-lg border border-[#30363d] bg-[#161b22]" />
        <div className="hidden space-y-6 xl:block">
          <div className="h-28 animate-pulse rounded-lg border border-[#30363d] bg-[#161b22]" />
          <div className="h-28 animate-pulse rounded-lg border border-[#30363d] bg-[#161b22]" />
        </div>
      </div>
    </main>
  );
}
