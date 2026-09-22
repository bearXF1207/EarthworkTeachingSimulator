import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { FakeRenderer, FakeResizeObserver } from './scene-test-kit';
import { SceneManager } from '../src/scene/SceneManager';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type * as Three from 'three';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof Three>();
  const { FakeRenderer: Renderer } = await import('./scene-test-kit');
  return { ...actual, WebGLRenderer: Renderer };
});

beforeEach(() => {
  FakeRenderer.instances = []; FakeRenderer.active.clear(); FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('M1 界面与场景生命周期（仅替换GPU边界）', () => {
  it('StrictMode不产生双canvas/双循环，支持四视角、网格与重置', () => {
    const setView = vi.spyOn(SceneManager.prototype, 'setView');
    const grid = vi.spyOn(SceneManager.prototype, 'setGridVisible');
    const reset = vi.spyOn(SceneManager.prototype, 'resetCamera');
    const controlsDispose = vi.spyOn(OrbitControls.prototype, 'dispose');
    const app = render(<StrictMode><App /></StrictMode>);
    expect(screen.getByRole('heading', { level: 1, name: '土方开挖教学模拟器' })).toBeVisible();
    expect(screen.getAllByRole('img', { name: '三维施工场地' })).toHaveLength(1);
    expect(FakeRenderer.active.size).toBe(1);
    for (const label of ['俯视', '前视', '侧视', '自由视角']) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
    }
    expect(setView).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole('checkbox', { name: '显示网格' }));
    expect(grid).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: '重置镜头' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('combobox', { name: '显示模式' })).toBeDisabled();
    app.unmount();
    expect(FakeRenderer.active.size).toBe(0);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    for (const renderer of FakeRenderer.instances) {
      expect(renderer.dispose).toHaveBeenCalledTimes(1);
      expect(renderer.forceContextLoss).toHaveBeenCalledTimes(1);
    }
    expect(controlsDispose).toHaveBeenCalledTimes(7);
    for (const observer of FakeResizeObserver.instances) expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });

  it('10次重新加载保留单一活动循环，卸载后事件与资源不再活动', () => {
    render(<App />);
    for (let i = 0; i < 10; i++) {
      fireEvent.click(screen.getByRole('button', { name: '重新加载场景' }));
      expect(document.querySelectorAll('canvas')).toHaveLength(1);
      expect(FakeRenderer.active.size).toBe(1);
    }
    cleanup();
    expect(FakeRenderer.active.size).toBe(0);
    for (const renderer of FakeRenderer.instances) {
      expect(renderer.dispose).toHaveBeenCalledTimes(1);
      renderer.domElement.dispatchEvent(new Event('webglcontextrestored'));
    }
    expect(FakeRenderer.active.size).toBe(0);
  });

  it('上下文丢失暂停循环、恢复后重新启动', () => {
    render(<App />);
    const canvas = screen.getByRole('img', { name: '三维施工场地' });
    const lost = new Event('webglcontextlost', { cancelable: true });
    fireEvent(canvas, lost);
    expect(lost.defaultPrevented).toBe(true);
    expect(FakeRenderer.active.size).toBe(0);
    expect(screen.getByRole('button', { name: '俯视' })).toBeDisabled();
    fireEvent(canvas, new Event('webglcontextrestored'));
    expect(FakeRenderer.active.size).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent('场景已恢复');
  });

  it('初始化失败时显示明确错误，不留canvas或活动循环', () => {
    vi.stubGlobal('ResizeObserver', class { constructor() { throw new Error('observer failed'); } });
    render(<App />);
    expect(screen.getByRole('alert')).toHaveTextContent('无法启动三维场景');
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
    expect(FakeRenderer.active.size).toBe(0);
    expect(FakeRenderer.instances[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('显示模式接口不改动相机，重复销毁安全', () => {
    const host = document.createElement('div'); document.body.append(host);
    const scene = new SceneManager(host, () => undefined);
    const camera = scene.cameras.active.position.clone();
    scene.setDisplayMode('wireframe'); expect(scene.getDisplayMode()).toBe('wireframe');
    expect(scene.cameras.active.position.equals(camera)).toBe(true);
    scene.dispose(); scene.dispose(); host.remove();
    expect(FakeRenderer.instances[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('真实OrbitControls响应左键旋转、右键平移，正交拖动不旋转', () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    const host = document.createElement('div'); document.body.append(host);
    const scene = new SceneManager(host, () => undefined);
    const canvas = host.querySelector('canvas');
    if (!canvas) throw new Error('missing canvas');
    Object.defineProperty(canvas, 'setPointerCapture', { value: vi.fn() });
    Object.defineProperty(canvas, 'releasePointerCapture', { value: vi.fn() });
    function drag(button: number): void {
      for (const [type, x, y] of [['pointerdown', 100, 100], ['pointermove', 150, 140], ['pointerup', 150, 140]] as const) {
        const event = new MouseEvent(type, { button, clientX: x, clientY: y, bubbles: true });
        Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
        (type === 'pointerdown' ? canvas : document)?.dispatchEvent(event);
      }
    }
    try {
      const initial = scene.cameras.active.position.clone();
      drag(0);
      expect(scene.cameras.active.position.distanceTo(initial)).toBeGreaterThan(.1);
      scene.resetCamera();
      drag(2);
      scene.setView('top'); // captures the actual controller target
      expect(scene.cameras.target.length()).toBeGreaterThan(.1);
      const orientation = scene.cameras.active.quaternion.clone();
      const position = scene.cameras.active.position.clone();
      drag(0);
      expect(scene.cameras.active.position.distanceTo(position)).toBeGreaterThan(.1);
      expect(scene.cameras.active.quaternion.angleTo(orientation)).toBeLessThan(1e-7);
    } finally { scene.dispose(); host.remove(); }
  });

  it('容器resize更新画布和投影，零尺寸不生成无效投影', () => {
    const host = document.createElement('div'); document.body.append(host);
    const scene = new SceneManager(host, () => undefined);
    try {
      const observer = FakeResizeObserver.instances[0];
      const renderer = FakeRenderer.instances[0];
      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1000, 500));
      observer?.callback([], observer as unknown as ResizeObserver);
      expect(renderer?.setSize).toHaveBeenLastCalledWith(1000, 500, false);
      expect(scene.cameras.perspective.aspect).toBe(2);
      vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));
      observer?.callback([], observer as unknown as ResizeObserver);
      expect(scene.cameras.perspective.aspect).toBe(2);
    } finally { scene.dispose(); host.remove(); }
  });
});
