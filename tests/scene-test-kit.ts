import { vi } from 'vitest';
import type { RendererPort } from '../src/scene/SceneManager';

// jsdom 的 canvas 没有指针捕获接口，OrbitControls 在 pointerdown 时会调用，补桩避免干扰测试。
Object.assign(HTMLCanvasElement.prototype, {
  setPointerCapture: (): void => undefined,
  releasePointerCapture: (): void => undefined,
  hasPointerCapture: (): boolean => false,
});

export class FakeRenderer implements RendererPort {
  static instances: FakeRenderer[] = [];
  static active = new Set<FakeRenderer>();
  readonly domElement = document.createElement('canvas');
  setSize = vi.fn<RendererPort['setSize']>();
  setPixelRatio = vi.fn<RendererPort['setPixelRatio']>();
  render = vi.fn<RendererPort['render']>();
  dispose = vi.fn<RendererPort['dispose']>();
  forceContextLoss = vi.fn<RendererPort['forceContextLoss']>();
  setAnimationLoop = vi.fn<RendererPort['setAnimationLoop']>((callback) => {
    if (callback) FakeRenderer.active.add(this); else FakeRenderer.active.delete(this);
  });
  constructor() { FakeRenderer.instances.push(this); }
}

export class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: ResizeObserverCallback) { FakeResizeObserver.instances.push(this); }
}
