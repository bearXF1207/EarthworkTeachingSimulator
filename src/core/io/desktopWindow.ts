/**
 * M10 桌面窗口关闭桥：Electron preload 暴露 `window.earthworkWindow`。
 * 浏览器环境没有该对象：订阅是无操作，confirmClose 也什么都不做，
 * 关闭提醒退回 SceneViewport 已有的 beforeunload 原生行为。
 */

export interface DesktopWindowService {
  /** 订阅主进程关闭请求；返回取消订阅函数。 */
  onRequestClose(callback: () => void): () => void;
  /** 确认关闭（保存成功或用户选择不保存后调用）。 */
  confirmClose(): void;
}

const isDesktopWindowService = (value: unknown): value is DesktopWindowService =>
  typeof value === 'object' && value !== null
  && typeof (value as DesktopWindowService).onRequestClose === 'function'
  && typeof (value as DesktopWindowService).confirmClose === 'function';

export function subscribeWindowCloseRequest(callback: () => void): () => void {
  const candidate = (globalThis as { earthworkWindow?: unknown }).earthworkWindow;
  return isDesktopWindowService(candidate) ? candidate.onRequestClose(callback) : () => undefined;
}

export function confirmWindowClose(): void {
  const candidate = (globalThis as { earthworkWindow?: unknown }).earthworkWindow;
  if (isDesktopWindowService(candidate)) candidate.confirmClose();
}
