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

/** 俯视正交相机（视高 140、画布 800×500）下地面坐标到画布客户端坐标的换算。 */
const HALF_WIDTH = 112, HALF_HEIGHT = 70;
const groundClient = (x: number, y: number): { clientX: number; clientY: number } =>
  ({ clientX: 400 + x / HALF_WIDTH * 400, clientY: 250 - y / HALF_HEIGHT * 250 });
const canvasElement = (): Element => {
  const canvas = document.querySelector('.viewport canvas');
  if (!canvas) throw new Error('missing canvas');
  return canvas;
};
const clickGround = (x: number, y: number, detail = 1): void => { fireEvent.click(canvasElement(), { ...groundClient(x, y), detail }); };
/** 走完整绘制流程：切换工具、逐点单击、Enter 完成。 */
const drawTrench = (points: [number, number][]): void => {
  fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
  for (const [x, y] of points) clickGround(x, y);
  fireEvent.keyDown(window, { key: 'Enter' });
};

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
    fireEvent.click(screen.getByRole('button', { name: '放置基坑' }));
    clickGround(0, 0);
    fireEvent.change(screen.getByRole('combobox', { name: '基坑类型' }), { target: { value: 'rect-pit' } });
    clickGround(40, 0);
    fireEvent.change(screen.getByRole('combobox', { name: '基坑类型' }), { target: { value: 'circular-pit' } });
    clickGround(80, 0);
    expect(screen.getByRole('combobox', { name: '显示模式' })).toBeEnabled();
    expect(screen.queryByRole('textbox', { name: '旋转角（°）' })).not.toBeInTheDocument();
    const depth = screen.getByRole('textbox', { name: '开挖深度（m）' });
    fireEvent.change(depth, { target: { value: '3' } });
    const last = dispatch.mock.results.at(-1)?.value;
    expect(last.ok).toBe(true); expect(last.value.elements[2].depth).toBe(3);
    fireEvent.change(depth, { target: { value: '' } }); expect(depth).toHaveValue('');
    expect(dispatch.mock.results.at(-1)?.value).toBe(last);
    fireEvent.change(depth, { target: { value: '0' } }); expect(dispatch.mock.results.at(-1)?.value.ok).toBe(false);
    const select = screen.getByRole('combobox', { name: '当前对象' }) as HTMLSelectElement;
    const ids = [...select.options].map(option => option.value).filter(value => value !== '');
    expect(ids).toHaveLength(3);
    fireEvent.change(select, { target: { value: ids[0] } });
    expect(screen.getByRole('textbox', { name: '旋转角（°）' })).toBeVisible();
    fireEvent.change(select, { target: { value: ids[2] } });
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
    // 卸载时额外释放预览线：折线 + 起点标记共 2 个几何与 2 个材质。
    expect(geometryDispose.mock.calls.length - initialGeometry).toBe(410);
    expect(materialDispose.mock.calls.length - initialMaterial).toBe(512);
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
  it('绘制两节点基槽、编辑节点与截面参数、拒绝非法输入并删除', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [8, 0]]);
    const depth = screen.getByRole('textbox', { name: '开挖深度（m）' });
    expect(screen.getByRole('textbox', { name: '起点 X（m）' })).toHaveValue('0');
    expect(screen.getByRole('textbox', { name: '终点 X（m）' })).toHaveValue('8');
    expect(screen.getByRole('textbox', { name: '底宽（m）' })).toHaveValue('2');
    fireEvent.change(depth, { target: { value: '3' } });
    const accepted = dispatch.mock.results.at(-1)?.value;
    expect(accepted.ok).toBe(true);
    expect(accepted.value.elements[0].depth).toBe(3);
    fireEvent.change(depth, { target: { value: '' } });
    expect(dispatch.mock.results.at(-1)?.value).toBe(accepted);
    expect(depth).toHaveValue('');
    fireEvent.change(depth, { target: { value: '3' } });
    fireEvent.change(screen.getByRole('textbox', { name: '终点 X（m）' }), { target: { value: '0' } });
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
    fireEvent.click(screen.getByRole('button', { name: '放置基坑' }));
    clickGround(30, 30);
    drawTrench([[0, 0], [8, 0]]);
    expect(screen.getByRole('textbox', { name: '起点 X（m）' })).toBeVisible();
    const select = screen.getByRole('combobox', { name: '当前对象' }) as HTMLSelectElement;
    const pitId = [...select.options].map(option => option.value).find(value => value !== select.value && value !== '');
    expect(pitId).toBeTruthy();
    fireEvent.change(select, { target: { value: pitId } });
    expect(screen.getByRole('textbox', { name: '底边长（m）' })).toHaveValue('4');
    expect(screen.queryByRole('textbox', { name: '起点 X（m）' })).not.toBeInTheDocument();
    expect(screen.getByText(/2 个开挖对象/)).toBeVisible();
  });
});

describe('M5 俯视绘制与放置', () => {
  it('单击三点后 Enter 只产生一个三节点基槽，绘制期间锁定视角', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    expect(screen.getByRole('button', { name: '俯视' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '自由视角' })).toBeDisabled();
    clickGround(0, 0); clickGround(10, 0); clickGround(10, 10);
    expect(screen.getByText(/已设置 3 个节点/)).toBeVisible();
    expect(screen.getByText('第 2 段：10.00m · 方位角 90.0°')).toBeVisible();
    fireEvent.keyDown(window, { key: 'Enter' });
    const result = dispatch.mock.results.at(-1)?.value;
    expect(result.ok).toBe(true);
    expect(result.value.elements).toHaveLength(1);
    expect(result.value.elements[0].points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(screen.getByRole('button', { name: '自由视角' })).toBeEnabled();
    expect(FakeRenderer.active.size).toBe(1);
  });

  it('真实双击序列不产生重复尾点，也不产生第二个对象', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(0, 0); clickGround(10, 0);
    clickGround(10, 10, 1);
    clickGround(10, 10, 2);
    fireEvent.doubleClick(canvasElement(), groundClient(10, 10));
    expect(dispatch.mock.results).toHaveLength(1);
    const result = dispatch.mock.results[0]?.value;
    expect(result.ok).toBe(true);
    expect(result.value.elements).toHaveLength(1);
    expect(result.value.elements[0].points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  });

  it('仅一个节点时 Enter 提示至少两个节点，Esc 取消不改变项目', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(3, 3);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('至少需要两个节点');
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/已设置/)).not.toBeInTheDocument();
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText(/0 个开挖对象/)).toBeVisible();
  });

  it('拖动平移不落点，画布外点击不添加节点', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    // jsdom 未实现指针捕获，OrbitControls 会直接调用，这里补上替身。
    Object.defineProperty(canvasElement(), 'setPointerCapture', { value: () => undefined });
    Object.defineProperty(canvasElement(), 'releasePointerCapture', { value: () => undefined });
    fireEvent.pointerDown(canvasElement(), groundClient(0, 0));
    fireEvent.click(canvasElement(), groundClient(30, 0));
    fireEvent.click(document.body, groundClient(40, 0));
    expect(screen.getByText(/已设置 0 个节点/)).toBeVisible();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('长度与角度输入推算下一点，精确输入不受吸附影响', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(1, 2);
    fireEvent.change(screen.getByRole('textbox', { name: '本段长度（m）' }), { target: { value: '8' } });
    fireEvent.change(screen.getByRole('textbox', { name: '方位角（°）' }), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: '添加下一点' }));
    expect(screen.getByText(/已设置 2 个节点/)).toBeVisible();
    fireEvent.keyDown(window, { key: 'Enter' });
    const points = dispatch.mock.results.at(-1)?.value.value.elements[0].points;
    expect(points[1]?.x).toBeCloseTo(1, 9);
    expect(points[1]?.y).toBeCloseTo(10, 9);
  });

  it('角度 -90 与 450 正规化后得到同一下一点', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(0, 0);
    fireEvent.change(screen.getByRole('textbox', { name: '本段长度（m）' }), { target: { value: '12.5' } });
    fireEvent.change(screen.getByRole('textbox', { name: '方位角（°）' }), { target: { value: '-90' } });
    fireEvent.click(screen.getByRole('button', { name: '添加下一点' }));
    fireEvent.change(screen.getByRole('textbox', { name: '方位角（°）' }), { target: { value: '450' } });
    fireEvent.click(screen.getByRole('button', { name: '添加下一点' }));
    expect(screen.getByText('第 1 段：12.50m · 方位角 270.0°')).toBeVisible();
    expect(screen.getByText('第 2 段：12.50m · 方位角 90.0°')).toBeVisible();
  });

  it('吸附开关只影响鼠标落点，输入框 Enter 提交输入段而不完成整槽', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '放置基坑' }));
    clickGround(1.2, 2.7);
    const center = (): number => Number((screen.getByRole('textbox', { name: '中心 X（m）' }) as HTMLInputElement).value);
    expect(center()).toBe(1);
    expect(screen.getByRole('textbox', { name: '中心 Y（m）' })).toHaveValue('3');
    fireEvent.click(screen.getByRole('checkbox', { name: '吸附1m网格' }));
    clickGround(41.2, 32.7);
    expect(center()).toBeCloseTo(41.2, 6);
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(0, 0);
    const length = screen.getByRole('textbox', { name: '本段长度（m）' });
    length.focus();
    fireEvent.keyDown(length, { key: 'Enter' });
    expect(screen.getByText(/已设置 2 个节点/)).toBeVisible();
    expect(dispatch.mock.results.at(-1)?.value.value.elements).toHaveLength(2);
    fireEvent.keyDown(length, { key: 'Escape' });
    expect(screen.getByText(/已设置 2 个节点/)).toBeVisible();
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    window.dispatchEvent(composing);
    expect(screen.getByText(/已设置 2 个节点/)).toBeVisible();
    expect(dispatch.mock.results.at(-1)?.value.value.elements).toHaveLength(2);
  });

  it('正交模式把鼠标点约束到水平或竖直方向', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '正交模式（仅水平/竖直）' }));
    clickGround(0, 0);
    clickGround(3, 2); // 水平位移更大，压到 y=0
    fireEvent.keyDown(window, { key: 'Enter' });
    const points = dispatch.mock.results.at(-1)?.value.value.elements[0].points;
    expect(points).toEqual([{ x: 0, y: 0 }, { x: 3, y: 0 }]);
  });

  it('吸附到相邻基槽中心线后自动收边，两槽共边贯通', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    // 画在相邻槽槽带内（y=0.6）也吸附到它的中心线 y=0
    fireEvent.pointerMove(canvasElement(), groundClient(10, 0.6));
    expect(screen.getByText(/当前吸附：吸附到 .* 中心线/)).toBeVisible();
    clickGround(10, 0.6);
    clickGround(10, 12);
    fireEvent.keyDown(window, { key: 'Enter' });
    const added = dispatch.mock.results.at(-1)?.value;
    expect(added.ok).toBe(true);
    expect(added.value.elements).toHaveLength(2);
    // 首端自动退到相邻槽顶边界 y=2：开口只共边，两条基槽相互贯通
    const points = added.value.elements[1].points;
    expect(points).toHaveLength(2);
    expect(points[0]!.x).toBeCloseTo(10, 6);
    expect(points[0]!.y).toBeCloseTo(2, 6);
    expect(points[1]).toEqual({ x: 10, y: 12 });
    expect(screen.getByText(/2 个开挖对象/)).toBeVisible();
  });

  it('吸附到相邻基槽端点，端点对接只共边不交叠', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    fireEvent.pointerMove(canvasElement(), groundClient(19.9, 0.2));
    expect(screen.getByText(/当前吸附：吸附到 .* 端点/)).toBeVisible();
    clickGround(19.9, 0.2);
    clickGround(40, 0);
    fireEvent.keyDown(window, { key: 'Enter' });
    const added = dispatch.mock.results.at(-1)?.value;
    expect(added.ok).toBe(true);
    expect(added.value.elements[1].points).toEqual([{ x: 20, y: 0 }, { x: 40, y: 0 }]);
  });

  it('中心线相交的分叉被拒绝并提示改用折线基槽', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(10, -5);
    clickGround(10, 5);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('内部交叠');
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    expect(screen.getByText(/已设置 2 个节点/)).toBeVisible(); // 草稿保留，可继续修改
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
  });

  it('双击终点即可确认，重复 Enter 不再创建第二个对象', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(0, 0); clickGround(10, 0);
    fireEvent.doubleClick(canvasElement(), groundClient(10, 0));
    expect(dispatch.mock.results).toHaveLength(1);
    expect(dispatch.mock.results[0]?.value.ok).toBe(true);
    expect(dispatch.mock.results[0]?.value.value.elements[0].points).toHaveLength(2);
    // 完成即回到选择工具：再按 Enter 不应再产生任何命令或提示
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(dispatch.mock.results).toHaveLength(1);
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('输入框内普通 Enter 只提交本段，Ctrl+Enter 完成整槽', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(0, 0); clickGround(10, 0);
    const length = screen.getByRole('textbox', { name: '本段长度（m）' });
    fireEvent.keyDown(length, { key: 'Enter' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.getByText(/已设置 3 个节点/)).toBeVisible();
    fireEvent.keyDown(length, { key: 'Enter', ctrlKey: true });
    expect(dispatch.mock.results).toHaveLength(1);
    const added = dispatch.mock.results[0]?.value;
    expect(added.ok).toBe(true);
    expect(added.value.elements[0].points).toHaveLength(3);
    expect(added.value.elements[0].points[2]).toEqual({ x: 20, y: 0 });
  });

  it('验收流程：吸附闭合后双击与 Enter 都能确认', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    // 第二段起点吸附到第一段的端点，再双击终点确认
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(19.9, 0.2);
    expect(screen.getByText(/当前吸附：吸附到 .* 端点/)).toBeVisible();
    clickGround(40, 0);
    fireEvent.doubleClick(canvasElement(), groundClient(40, 0));
    const closed = dispatch.mock.results.at(-1)?.value;
    expect(closed.ok).toBe(true);
    expect(closed.value.elements).toHaveLength(2);
    expect(closed.value.elements[1].points[0]).toEqual({ x: 20, y: 0 });
    // 第三段继续同向延伸，改用 Enter 确认，验证两种确认方式都能在闭合位置生效
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    fireEvent.pointerMove(canvasElement(), groundClient(40, 0.1));
    expect(screen.getByText(/当前吸附：吸附到 .* 端点/)).toBeVisible();
    clickGround(40, 0.1);
    clickGround(60, 0);
    fireEvent.keyDown(window, { key: 'Enter' });
    const extended = dispatch.mock.results.at(-1)?.value;
    expect(extended.ok).toBe(true);
    expect(extended.value.elements).toHaveLength(3);
    expect(extended.value.elements[2].points).toEqual([{ x: 40, y: 0 }, { x: 60, y: 0 }]);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('环形基槽：末点吸附回起点闭合后可确认，生成单个闭合对象', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(0, 0);
    clickGround(20, 0);
    clickGround(20, 20);
    clickGround(0, 20);
    fireEvent.pointerMove(canvasElement(), groundClient(0.4, 0.3));
    expect(screen.getByText(/吸附到起点：首尾闭合/)).toBeVisible();
    clickGround(0.4, 0.3);
    expect(screen.getByText(/已首尾闭合/)).toBeVisible();
    fireEvent.keyDown(window, { key: 'Enter' });
    const added = dispatch.mock.results.at(-1)?.value;
    expect(added.ok).toBe(true);
    expect(added.value.elements).toHaveLength(1);
    expect(added.value.elements[0].points).toEqual([
      { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }, { x: 0, y: 0 },
    ]);
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('三种基坑都能放置，重叠时拒绝并保持工具与既有模型', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '放置基坑' }));
    clickGround(0, 0);
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(true);
    clickGround(0, 0);
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('重叠');
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    fireEvent.change(screen.getByRole('combobox', { name: '基坑类型' }), { target: { value: 'rect-pit' } });
    clickGround(40, 0);
    fireEvent.change(screen.getByRole('combobox', { name: '基坑类型' }), { target: { value: 'circular-pit' } });
    clickGround(80, 0);
    expect(screen.getByText(/3 个开挖对象/)).toBeVisible();
    expect(dispatch.mock.results.at(-1)?.value.value.elements.map((e: { type: string }) => e.type))
      .toEqual(['square-pit', 'rect-pit', 'circular-pit']);
  });
});

describe('M4 折线基槽界面', () => {
  it('绘制 90° 折线基槽、编辑中间节点、拒绝非法节点并恢复', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [10, 0], [10, 10]]);
    expect(screen.getByRole('textbox', { name: '起点 X（m）' })).toHaveValue('0');
    expect(screen.getByRole('textbox', { name: '节点 2 X（m）' })).toHaveValue('10');
    expect(screen.getByRole('textbox', { name: '节点 2 Y（m）' })).toHaveValue('0');
    expect(screen.getByRole('textbox', { name: '终点 Y（m）' })).toHaveValue('10');
    const added = dispatch.mock.results.at(-1)?.value;
    expect(added.ok).toBe(true);
    expect(added.value.elements[0].points).toHaveLength(3);
    fireEvent.change(screen.getByRole('textbox', { name: '终点 Y（m）' }), { target: { value: '0' } });
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent('中心线长度必须大于');
    fireEvent.change(screen.getByRole('textbox', { name: '终点 Y（m）' }), { target: { value: '10' } });
    expect(dispatch.mock.results.at(-1)?.value.ok).toBe(true);
    expect(dispatch.mock.results.at(-1)?.value.value.elements[0].points).toHaveLength(3);
    expect(FakeRenderer.active.size).toBe(1);
  });
});
