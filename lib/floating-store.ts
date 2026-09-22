// 右下角悬浮组件互斥开关：打开「AI 问答」自动关闭「AI 翻译」，反之亦然。
// 纯模块级状态 + useSyncExternalStore，供客户端悬浮组件订阅。
type WidgetKey = "chat" | "translate";

let activeWidget: WidgetKey | null = null;
const listeners = new Set<() => void>();

export function getActiveWidget(): WidgetKey | null {
  return activeWidget;
}

export function setActiveWidget(k: WidgetKey | null) {
  if (activeWidget === k) return;
  activeWidget = k;
  for (const l of listeners) l();
}

export function subscribeFloating(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
