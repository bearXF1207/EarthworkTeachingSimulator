import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { FakeRenderer, FakeResizeObserver } from './scene-test-kit';
import { SceneManager } from '../src/scene/SceneManager';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type * as Three from 'three';
import { BufferGeometry, Material, ShapeUtils } from 'three';
import { GroundManager } from '../src/scene/GroundManager';
import { ProjectStore } from '../src/store/ProjectStore';

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
  it('M2 实际三角化失败保留旧场景与数据，候选坑资源被释放', () => {
    const host = document.createElement('div'); document.body.append(host);
    const scene = new SceneManager(host, () => undefined), store = new ProjectStore();
    const element = { id: 'a', type: 'square-pit' as const, position: { x: 0, y: 0 }, bottomSize: 4, depth: 2, slope: .5, rotation: 0 };
    const prepare = (project: ReturnType<ProjectStore['getSnapshot']>) => scene.prepareProject(project);
    store.dispatch({ type: 'add', element }, prepare);
    const before = store.getSnapshot(), groundDispose = vi.spyOn(GroundManager.prototype, 'dispose');
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    // 只让带孔地面三角化失败：槽底/坑底三角化不传孔洞，仍走真实实现，
    // 这样候选坑网格已经建立，失败后必须被释放。
    const actualTriangulate = ShapeUtils.triangulateShape.bind(ShapeUtils);
    const triangulate = vi.spyOn(ShapeUtils, 'triangulateShape')
      .mockImplementation((contour, holes) => (holes.length ? [] : actualTriangulate(contour, holes)));
    try {
      expect(store.dispatch({ type: 'update', element: { ...element, depth: 3 } }, prepare).ok).toBe(false);
      expect(store.getSnapshot()).toEqual(before); expect(groundDispose).not.toHaveBeenCalled();
      expect(geometryDispose).toHaveBeenCalledTimes(1); // Only the rejected candidate pit.
      expect(FakeRenderer.active.size).toBe(1);
    } finally { triangulate.mockRestore(); scene.dispose(); host.remove(); }
  });
  it('M2 创建三类型、合法编辑、非法草稿保留模型、重载保留项目并可删除', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    for (const label of ['方形基坑', '矩形基坑', '圆形基坑']) fireEvent.click(screen.getByRole('button', { name: `添加${label}` }));
    expect(screen.getByRole('combobox', { name: '显示模式' })).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: '旋转角（°）' })).not.toBeInTheDocument();
    const depth = screen.getByRole('textbox', { name: '开挖深度（m）' });
    fireEvent.change(depth, { target: { value: '3' } });
    const last = dispatch.mock.results.at(-1)?.value;
    expect(last.ok).toBe(true); expect(last.value.elements[2].depth).toBe(3);
    fireEvent.change(depth, { target: { value: '' } }); expect(depth).toHaveValue('');
    expect(dispatch.mock.results.at(-1)?.value).toBe(last);
    fireEvent.change(depth, { target: { value: '0' } }); expect(dispatch.mock.results.at(-1)?.value.ok).toBe(false);
    fireEvent.change(screen.getByRole('combobox', { name: '当前对象' }), { target: { value: 'pit-1' } });
    fireEvent.change(screen.getByRole('combobox', { name: '当前对象' }), { target: { value: 'pit-3' } });
    expect(screen.getByRole('textbox', { name: '开挖深度（m）' })).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', { name: '重新加载场景' }));
    expect(screen.getByRole('textbox', { name: '开挖深度（m）' })).toHaveValue('3');
    fireEvent.click(screen.getByRole('button', { name: '删除当前基坑' }));
    expect(dispatch.mock.results.at(-1)?.value.value.elements).toHaveLength(2);
    expect(FakeRenderer.active.size).toBe(1);
  });

  it('M2 连续100次几何替换保持恒定资源，取消预构建与卸载全部释放', () => {
    const geometryDispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(Material.prototype, 'dispose');
    const host = document.createElement('div'); document.body.append(host);
    const scene = new SceneManager(host, () => undefined), store = new ProjectStore();
    const element = { id: 'a', type: 'square-pit' as const, position: { x: 0, y: 0 }, bottomSize: 4, depth: 2, slope: .5, rotation: 0 };
    const prepare = (project: ReturnType<ProjectStore['getSnapshot']>) => scene.prepareProject(project);
    store.dispatch({ type: 'add', element }, prepare);
    const initialGeometry = geometryDispose.mock.calls.length, initialMaterial = materialDispose.mock.calls.length;
    for (let i = 0; i < 100; i++) expect(store.dispatch({ type: 'update', element: { ...element, rotation: i } }, prepare).ok).toBe(true);
    // Per replacement: ground, grid, axes, pit (4 geometries; 5 materials).
    expect(geometryDispose.mock.calls.length - initialGeometry).toBe(400);
    expect(materialDispose.mock.calls.length - initialMaterial).toBe(500);
    const prepared = scene.prepareProject(store.getSnapshot()); prepared.dispose(); prepared.dispose();
    expect(geometryDispose.mock.calls.length - initialGeometry).toBe(404);
    scene.dispose(); host.remove();
    expect(geometryDispose.mock.calls.length - initialGeometry).toBe(408);
    expect(materialDispose.mock.calls.length - initialMaterial).toBe(510);
  });
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

describe('M3 直线基槽界面', () => {
  it('创建基槽、编辑节点与截面参数、拒绝非法输入并删除', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '添加直线基槽' }));
    const depth = screen.getByRole('textbox', { name: '开挖深度（m）' });
    expect(screen.getByRole('textbox', { name: '起点 X（m）' })).toHaveValue('-12');
    expect(screen.getByRole('textbox', { name: '底宽（m）' })).toHaveValue('2');
    fireEvent.change(depth, { target: { value: '3' } });
    const accepted = dispatch.mock.results.at(-1)?.value;
    expect(accepted.ok).toBe(true);
    expect(accepted.value.elements[0].depth).toBe(3);
    fireEvent.change(depth, { target: { value: '' } });
    expect(dispatch.mock.results.at(-1)?.value).toBe(accepted);
    expect(depth).toHaveValue('');
    fireEvent.change(depth, { target: { value: '3' } });
    fireEvent.change(screen.getByRole('textbox', { name: '终点 X（m）' }), { target: { value: '-12' } });
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('中心线长度必须大于');
    fireEvent.change(screen.getByRole('textbox', { name: '终点 X（m）' }), { target: { value: '8' } });
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '删除当前基槽' }));
    expect(dispatch.mock.results.at(-1)?.value.value.elements).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: '起点 X（m）' })).not.toBeInTheDocument();
    expect(FakeRenderer.active.size).toBe(1);
  });

  it('基槽与基坑可共存，选中对象切换时属性面板同步', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '添加方形基坑' }));
    fireEvent.click(screen.getByRole('button', { name: '添加直线基槽' }));
    expect(screen.getByRole('textbox', { name: '起点 X（m）' })).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: '当前对象' }), { target: { value: 'pit-1' } });
    expect(screen.getByRole('textbox', { name: '底边长（m）' })).toHaveValue('4');
    expect(screen.queryByRole('textbox', { name: '起点 X（m）' })).not.toBeInTheDocument();
    expect(screen.getByText(/2 个开挖对象/)).toBeVisible();
  });
});

describe('M4 折线基槽界面', () => {
  it('创建 90° 折线基槽、编辑中间节点、拒绝非法节点并恢复', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '添加折线基槽' }));
    expect(screen.getByRole('textbox', { name: '起点 X（m）' })).toHaveValue('-12');
    expect(screen.getByRole('textbox', { name: '节点 2 X（m）' })).toHaveValue('8');
    expect(screen.getByRole('textbox', { name: '节点 2 Y（m）' })).toHaveValue('-220');
    expect(screen.getByRole('textbox', { name: '终点 Y（m）' })).toHaveValue('-232');
    const added = dispatch.mock.results.at(-1)?.value;
    expect(added.ok).toBe(true);
    expect(added.value.elements[0].points).toHaveLength(3);
    expect(screen.getByRole('combobox', { name: '当前对象' })).toHaveValue('polyline-1');
    fireEvent.change(screen.getByRole('textbox', { name: '终点 Y（m）' }), { target: { value: '-220' } });
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('中心线长度必须大于');
    fireEvent.change(screen.getByRole('textbox', { name: '终点 Y（m）' }), { target: { value: '-232' } });
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(true);
    expect(dispatch.mock.results.at(-1)?.value.value.elements[0].points).toHaveLength(3);
    expect(FakeRenderer.active.size).toBe(1);
  });
});
