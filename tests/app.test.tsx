import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/app/App';
import { ErrorBoundary } from '../src/app/ErrorBoundary';
import { FakeRenderer, FakeResizeObserver } from './scene-test-kit';
import { SceneManager } from '../src/scene/SceneManager';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type * as Three from 'three';
import { BufferGeometry, Material, ShapeUtils, Vector3 } from 'three';
import { GroundManager } from '../src/scene/GroundManager';
import { ProjectStore } from '../src/store/ProjectStore';
import { serializeProject } from '../src/core/io/projectSchema';
import { emptyProject } from '../src/core/model/project';
import type { Pit, Project } from '../src/core/model/project';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof Three>();
  const { FakeRenderer: Renderer } = await import('./scene-test-kit');
  return { ...actual, WebGLRenderer: Renderer };
});

/** M8：文件服务用可控替身，界面只依赖 FileGateway 合同。 */
const gateway = vi.hoisted(() => ({
  open: vi.fn(), save: vi.fn(), kind: 'file-system' as 'file-system' | 'download', canReopen: true,
}));
vi.mock('../src/core/io/fileGateway', () => ({ createBrowserFileGateway: () => gateway }));
const savedOutcome = (name: string, target: null | { name: string } = null) =>
  ({ ok: true, value: { status: 'saved', file: { name }, target } });
const exportOutcome = (name: string) => ({ ok: true, value: { status: 'export-requested', file: { name } } });
const cancelledOutcome = { ok: true, value: { status: 'cancelled' } };

beforeEach(() => {
  FakeRenderer.instances = []; FakeRenderer.active.clear(); FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 500));
  gateway.kind = 'file-system';
  gateway.open.mockReset(); gateway.save.mockReset();
  gateway.save.mockResolvedValue(savedOutcome('未命名工程.excavation'));
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
/** 保留真实鼠标指针字段，使同一事件同时经过 React 和真实 OrbitControls。 */
function mousePointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'lostpointercapture',
  point: { clientX: number; clientY: number }, button = 0, pointerId = 1,
): void {
  const released = type === 'pointerup' || type === 'pointercancel' || type === 'lostpointercapture';
  const event = new MouseEvent(type, { ...point, bubbles: true, cancelable: true,
    button: type === 'pointermove' ? -1 : button, buttons: released ? 0 : button === 2 ? 2 : 1 });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, pointerType: { value: 'mouse' }, isPrimary: { value: true },
  });
  fireEvent(canvasElement(), event);
}
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
    // rotation 从 1 开始：与初始 0 相同的更新属于“无变化命令”，按设计不重建几何也不入历史。
    for (let i = 0; i < 100; i++) expect(store.dispatch({ type: 'update', element: { ...element, rotation: i + 1 } }, prepare).ok).toBe(true);
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
    mousePointer('pointerdown', groundClient(0, 0));
    mousePointer('pointermove', groundClient(30, 0));
    mousePointer('pointerup', groundClient(30, 0));
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
    const summary = screen.getByRole('region', { name: '工程量合计' });
    expect(summary).toHaveTextContent('预计土方量合计 182.67 m³');
    expect(summary).toHaveTextContent('其中连接补充开挖 2.67 m³');
    expect(screen.getByText(/此处为单槽设计估算，不含连接处补充开挖/)).toBeVisible();
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

  it('M6 画布点选：点击开挖实体即选中该对象', () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '俯视' })); // 拾取与拖动都基于俯视投影
    const select = screen.getByRole('combobox', { name: '当前对象' });
    const id = (select as HTMLSelectElement).options[1]!.value;
    fireEvent.change(select, { target: { value: '' } });
    expect(select).toHaveValue('');
    // 点击基槽中心线上的一点：应重新选中该基槽
    fireEvent.click(canvasElement(), groundClient(10, 0));
    expect(select).toHaveValue(id);
  });

  it('M6 拖动节点：拖动中只出预览，松手提交一次更新', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '俯视' }));
    dispatch.mockClear();
    // 选中状态下拖动第一个节点 (0,0) → (0,6)
    const start = groundClient(0, 0), end = groundClient(0, 6);
    mousePointer('pointerdown', start);
    mousePointer('pointermove', end);
    mousePointer('pointerup', end);
    const calls = dispatch.mock.calls.filter(([command]) => command.type === 'update');
    expect(calls).toHaveLength(1); // 拖动全程只提交一次
    const updated = dispatch.mock.results.at(-1)?.value;
    expect(updated.ok).toBe(true);
    expect(updated.value.elements[0].points[0]).toEqual({ x: 0, y: 6 });
    expect(screen.getByRole('textbox', { name: '起点 X（m）' })).toHaveValue('0');
    expect(screen.getByRole('textbox', { name: '起点 Y（m）' })).toHaveValue('6');
    // 拖动完成后直接修改截面，不能把节点重新写回拖动前的位置。
    fireEvent.change(screen.getByRole('textbox', { name: '开挖深度（m）' }), { target: { value: '3' } });
    const resized = dispatch.mock.results.at(-1)?.value;
    expect(resized.ok).toBe(true);
    expect(resized.value.elements[0].depth).toBe(3);
    expect(resized.value.elements[0].points).toEqual([{ x: 0, y: 6 }, { x: 20, y: 0 }]);
  });

  it('M6 拖动阈值：小于 3 像素的移动不提交更新', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '俯视' }));
    dispatch.mockClear();
    const start = groundClient(0, 0);
    mousePointer('pointerdown', start);
    mousePointer('pointermove', { clientX: start.clientX + 1, clientY: start.clientY + 1 });
    mousePointer('pointerup', start);
    expect(dispatch.mock.calls.filter(([command]) => command.type === 'update')).toHaveLength(0);
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

describe('M6 对象拖动与相机平移互斥', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  });

  function selectedPit() {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    const prepare = vi.spyOn(SceneManager.prototype, 'prepareProject');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '放置基坑' }));
    clickGround(0, 0);
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    fireEvent.click(screen.getByRole('button', { name: '俯视' }));
    const store = dispatch.mock.contexts[0];
    const scene = prepare.mock.contexts.at(-1);
    if (!(store instanceof ProjectStore) || !(scene instanceof SceneManager)) throw new Error('missing store or scene');
    // jsdom 不实现原生指针捕获，仅在当前 canvas 上记录捕获状态。
    const captured = new Set<number>();
    const capture = vi.spyOn(scene.domElement, 'setPointerCapture').mockImplementation(id => { captured.add(id); });
    const release = vi.spyOn(scene.domElement, 'releasePointerCapture').mockImplementation(id => { captured.delete(id); });
    vi.spyOn(scene.domElement, 'hasPointerCapture').mockImplementation(id => captured.has(id));
    dispatch.mockClear();
    return { dispatch, store, scene, captured, capture, release };
  }

  it.each([
    { label: '右键拖动空白', button: 2, x: 30 },
    { label: '右键拖动坑面', button: 2, x: 0 },
    { label: '左键拖动空白', button: 0, x: 30 },
  ])('$label 只平移相机，不修改已选基坑', ({ button, x }) => {
    const { dispatch, store, scene } = selectedPit();
    const before = store.getSnapshot();
    const camera = scene.cameras.active.position.clone();
    mousePointer('pointerdown', groundClient(x, 0), button);
    mousePointer('pointermove', groundClient(x + 10, 6), button);
    mousePointer('pointerup', groundClient(x + 10, 6), button);
    expect(dispatch.mock.calls.filter(([command]) => command.type === 'update')).toHaveLength(0);
    expect(store.getSnapshot()).toEqual(before);
    expect(scene.cameras.active.position.distanceTo(camera)).toBeGreaterThan(.1);
  });

  it('左键命中基坑只在松手时提交一次位置更新，相机保持不动', () => {
    const { dispatch, store, scene, captured, capture, release } = selectedPit();
    const before = store.getSnapshot();
    const camera = scene.cameras.active.position.clone();
    mousePointer('pointerdown', groundClient(0, 0));
    expect(capture).toHaveBeenCalledExactlyOnceWith(1);
    expect(captured.has(1)).toBe(true);
    mousePointer('pointermove', groundClient(5, 3));
    mousePointer('pointermove', groundClient(10, 6));
    const animate = FakeRenderer.instances.at(-1)!.setAnimationLoop.mock.calls.at(-1)?.[0];
    expect(animate).toBeTypeOf('function');
    if (animate) act(() => { Reflect.apply(animate, undefined, [0]); });
    expect(store.getSnapshot()).toEqual(before);
    expect(dispatch.mock.calls).toHaveLength(0);
    expect(scene.preview.line.visible).toBe(true);
    expect(scene.cameras.active.position.distanceTo(camera)).toBeLessThan(1e-9);
    mousePointer('pointerup', groundClient(10, 6));
    expect(dispatch.mock.calls.filter(([command]) => command.type === 'update')).toHaveLength(1);
    expect(store.getSnapshot().elements[0]).toMatchObject({ position: { x: 10, y: 6 } });
    expect(scene.cameras.active.position.distanceTo(camera)).toBeLessThan(1e-9);
    expect(scene.preview.line.visible).toBe(false);
    expect(release).toHaveBeenCalledExactlyOnceWith(1);
    expect(captured.size).toBe(0);
  });

  it('平移惯性未结束时开始拖动，编辑期间及结束后镜头都不漂移', () => {
    const { dispatch, store, scene } = selectedPit();
    const animate = FakeRenderer.instances.at(-1)!.setAnimationLoop.mock.calls.at(-1)?.[0];
    expect(animate).toBeTypeOf('function');
    const frame = (): void => { if (animate) act(() => { Reflect.apply(animate, undefined, [0]); }); };
    const client = (x: number, y: number) => {
      scene.cameras.active.updateMatrixWorld();
      const ndc = new Vector3(x, y, 0).project(scene.cameras.active);
      return { clientX: (ndc.x + 1) * 400, clientY: (1 - ndc.y) * 250 };
    };
    mousePointer('pointerdown', groundClient(30, 0), 2);
    mousePointer('pointermove', groundClient(40, 6), 2);
    mousePointer('pointerup', groundClient(40, 6), 2);
    const beforeFrame = scene.cameras.active.position.clone();
    frame();
    // 确认测试开始时确有未消耗完的相机惯性。
    expect(scene.cameras.active.position.distanceTo(beforeFrame)).toBeGreaterThan(.1);
    const camera = scene.cameras.active.position.clone();
    mousePointer('pointerdown', client(0, 0));
    const end = client(10, 6);
    mousePointer('pointermove', end);
    frame(); frame(); frame();
    expect(scene.preview.line.visible).toBe(true);
    expect(scene.cameras.active.position.distanceTo(camera)).toBeLessThan(1e-9);
    expect(dispatch.mock.calls).toHaveLength(0);
    mousePointer('pointerup', end);
    frame(); frame(); frame();
    expect(scene.cameras.active.position.distanceTo(camera)).toBeLessThan(1e-9);
    expect(dispatch.mock.calls.filter(([command]) => command.type === 'update')).toHaveLength(1);
    expect(store.getSnapshot().elements[0]).toMatchObject({ position: { x: 10, y: 6 } });
  });

  it('无关指针的松手与取消不会结束当前拖动，只由原指针提交', () => {
    const { dispatch, store, scene, captured, capture, release } = selectedPit();
    const before = store.getSnapshot();
    mousePointer('pointerdown', groundClient(0, 0));
    mousePointer('pointermove', groundClient(10, 6));
    mousePointer('pointerup', groundClient(30, 20), 0, 2);
    mousePointer('pointercancel', groundClient(30, 20), 0, 2);
    mousePointer('lostpointercapture', groundClient(30, 20), 0, 2);
    expect(store.getSnapshot()).toEqual(before);
    expect(dispatch.mock.calls).toHaveLength(0);
    expect(scene.preview.line.visible).toBe(true);
    expect(captured.has(1)).toBe(true);
    expect(release).not.toHaveBeenCalledWith(1);
    mousePointer('pointermove', groundClient(15, 8));
    mousePointer('pointerup', groundClient(15, 8));
    expect(dispatch.mock.calls.filter(([command]) => command.type === 'update')).toHaveLength(1);
    expect(store.getSnapshot().elements[0]).toMatchObject({ position: { x: 15, y: 8 } });
    expect(capture).toHaveBeenCalledExactlyOnceWith(1);
    expect(release.mock.calls.filter(([id]) => id === 1)).toHaveLength(1);
    expect(captured.size).toBe(0);
  });

  it.each(['pointercancel', 'lostpointercapture', 'Escape', 'blur'] as const)('%s 取消拖动不提交，随后仍可正常平移相机', cancellation => {
    const { dispatch, store, scene, captured, capture, release } = selectedPit();
    const before = store.getSnapshot();
    mousePointer('pointerdown', groundClient(0, 0));
    mousePointer('pointermove', groundClient(10, 6));
    expect(scene.preview.line.visible).toBe(true);
    expect(capture).toHaveBeenCalledExactlyOnceWith(1);
    expect(captured.has(1)).toBe(true);
    if (cancellation === 'pointercancel') mousePointer('pointercancel', groundClient(10, 6));
    else if (cancellation === 'lostpointercapture') {
      captured.delete(1); // 浏览器已经释放捕获后通知应用。
      mousePointer('lostpointercapture', groundClient(10, 6));
    }
    else if (cancellation === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
    else fireEvent.blur(window);
    mousePointer('pointerup', groundClient(10, 6));
    expect(dispatch.mock.calls).toHaveLength(0);
    expect(store.getSnapshot()).toEqual(before);
    expect(scene.preview.line.visible).toBe(false);
    expect(captured.size).toBe(0);
    if (cancellation === 'lostpointercapture') expect(release).not.toHaveBeenCalled();
    else expect(release).toHaveBeenCalledExactlyOnceWith(1);

    const camera = scene.cameras.active.position.clone();
    mousePointer('pointerdown', groundClient(30, 0), 2, 2);
    mousePointer('pointermove', groundClient(40, 6), 2, 2);
    mousePointer('pointerup', groundClient(40, 6), 2, 2);
    expect(scene.cameras.active.position.distanceTo(camera)).toBeGreaterThan(.1);
    expect(dispatch.mock.calls).toHaveLength(0);
    expect(store.getSnapshot()).toEqual(before);
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

describe('M7 工程量与测量界面', () => {
  it('基槽与基坑都显示预计土方量，合计只对已通过校验的对象求和', () => {
    render(<App />);
    const summary = (): HTMLElement => screen.getByRole('region', { name: '工程量合计' });
    expect(summary()).toHaveTextContent('预计土方量合计 0.00 m³');
    expect(screen.getByText(/0 个开挖对象/)).toBeVisible();
    drawTrench([[0, 0], [20, 0]]); // B=2/H=2/m=.5 → A=6，V=120
    expect(screen.getByText('直线基槽工程量')).toBeVisible();
    expect(screen.getByText('120.00 m³')).toBeVisible();
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    expect(summary()).toHaveTextContent('预计土方量合计 120.00 m³');
    // 基坑默认 4×4/H=2/m=.5 → 152/3≈50.67，合计 ≈170.67
    fireEvent.click(screen.getByRole('button', { name: '放置基坑' }));
    clickGround(-40, 0);
    expect(screen.getByText('50.67 m³')).toBeVisible();
    expect(screen.getByText(/2 个开挖对象/)).toBeVisible();
    expect(summary()).toHaveTextContent('预计土方量合计 170.67 m³');
  });

  it('编辑参数后工程量随之更新，删除对象后合计归零', () => {
    render(<App />);
    drawTrench([[0, 0], [10, 0]]); // V=60
    expect(screen.getByText('60.00 m³')).toBeVisible();
    fireEvent.change(screen.getByRole('textbox', { name: '开挖深度（m）' }), { target: { value: '4' } });
    // H=4/m=.5：T=6，A=16，V=160
    expect(screen.getByText('160.00 m³')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '删除当前基槽' }));
    expect(screen.getByText(/0 个开挖对象/)).toBeVisible();
    expect(screen.getByRole('region', { name: '工程量合计' })).toHaveTextContent('预计土方量合计 0.00 m³');
  });

  it('撤销重做同步属性输入，随后修改坡比不恢复已撤销的深度', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    const depth = (): HTMLElement => screen.getByRole('textbox', { name: '开挖深度（m）' });
    const summary = (): HTMLElement => screen.getByRole('region', { name: '工程量合计' });
    expect(depth()).toHaveValue('2');
    fireEvent.change(depth(), { target: { value: '3' } });
    expect(depth()).toHaveValue('3');
    expect(summary()).toHaveTextContent('预计土方量合计 210.00 m³');

    fireEvent.click(screen.getByRole('button', { name: '撤销（Ctrl+Z）' }));
    expect(depth()).toHaveValue('2');
    expect(summary()).toHaveTextContent('预计土方量合计 120.00 m³');
    fireEvent.click(screen.getByRole('button', { name: '重做（Ctrl+Y）' }));
    expect(depth()).toHaveValue('3');
    expect(summary()).toHaveTextContent('预计土方量合计 210.00 m³');

    fireEvent.click(screen.getByRole('button', { name: '撤销（Ctrl+Z）' }));
    fireEvent.change(screen.getByRole('textbox', { name: '放坡系数 m' }), { target: { value: '1' } });
    const updated = dispatch.mock.results.at(-1)?.value;
    expect(updated.ok).toBe(true);
    expect(updated.value.elements[0]).toMatchObject({ depth: 2, slope: 1 });
    expect(depth()).toHaveValue('2');
    expect(summary()).toHaveTextContent('预计土方量合计 160.00 m³');
  });

  it('测量工具：两点得到距离，重新测量与 Esc 都不改变工程数据', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '测量' }));
    expect(screen.getByText(/请单击设置第一点/)).toBeVisible();
    clickGround(0, 0);
    expect(screen.getByText(/请单击设置第二点/)).toBeVisible();
    clickGround(3, 4); // 网格吸附下仍是 (3,4)，距离 5m
    expect(screen.getByText(/测量距离：5.00 m/)).toBeVisible();
    // 画布标签也显示距离
    expect(document.querySelector('.measure-label')?.textContent).toBe('5.00 m');
    // 重新测量清空两点，再点一次即从新点开始
    fireEvent.click(screen.getByRole('button', { name: '重新测量' }));
    expect(screen.getByText(/请单击设置第一点/)).toBeVisible();
    clickGround(0, 0); clickGround(6, 0);
    expect(screen.getByText(/测量距离：6.00 m/)).toBeVisible();
    expect(dispatch.mock.calls.every(call => (call[0] as { type: string }).type !== 'add')).toBe(true);
    expect(screen.getByText(/0 个开挖对象/)).toBeVisible();
    // Esc 取消：回到选择工具，标签与提示都清除
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText(/测量距离/)).not.toBeInTheDocument();
    expect(document.querySelector('.measure-label')).toBeNull();
    expect(screen.getByText(/0 个开挖对象/)).toBeVisible();
  });

  it('界面链路：从相邻槽中心线起画并回车，垂直接口把连接补挖量计入合计', () => {
    render(<App />);
    const summary = (): HTMLElement => screen.getByRole('region', { name: '工程量合计' });
    drawTrench([[0, 0], [20, 0]]); // 主槽 B=2/H=2/m=.5 → V=120
    expect(summary()).toHaveTextContent('预计土方量合计 120.00 m³');
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(10, 12); clickGround(10, 0); // 终点吸附主槽中心线，收边到槽顶边界
    fireEvent.keyDown(window, { key: 'Enter' });
    // 支槽 10m×6m²=60m³，加上正交接口的 8/3m³ 土楔
    expect(summary()).toHaveTextContent('其中连接补充开挖 2.67 m³');
    expect(summary()).toHaveTextContent('预计土方量合计 182.67 m³');
    expect(screen.getByText(/2 个开挖对象/)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('界面链路：亚像素倾角（终点落在中心线非整数位置）同样贯通，且不改写中心线数据', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    const summary = (): HTMLElement => screen.getByRole('region', { name: '工程量合计' });
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    clickGround(10, 12); clickGround(10.3, 0); // 起点与终点不共线 → 端面与主槽边界斜交
    fireEvent.keyDown(window, { key: 'Enter' });
    const text = summary().textContent ?? '';
    const correction = Number(/其中连接补充开挖 ([\d.]+) m³/.exec(text)?.[1]);
    expect(correction).toBeGreaterThan(8 / 3); // 8/3 土楔 + 端面外偏留下的土墙
    expect(correction).toBeLessThan(3.4);
    const total = Number(/预计土方量合计 ([\d.]+) m³/.exec(text)?.[1]);
    expect(total).toBeGreaterThan(182.6);
    expect(total).toBeLessThan(183.1);
    // 派生连接不写回数据：存储的中心线仍是收边结果，不是原始点击坐标
    const stored = dispatch.mock.results.at(-1)?.value.value.elements[1];
    expect(stored.points[1]).not.toEqual({ x: 10.3, y: 0 });
    expect(stored.points[0]).toEqual({ x: 10, y: 12 });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('保存与脏状态：真实写入才变干净，取消与仅请求导出都保持未保存', async () => {
    render(<App />);
    expect(screen.getByText('已保存')).toBeVisible();
    drawTrench([[0, 0], [20, 0]]);
    expect(screen.getByText('未保存')).toBeVisible();
    // 真实写入成功
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('已保存');
    expect(gateway.save).toHaveBeenCalledTimes(1);
    // 再次编辑 → 未保存；用户取消保存 → 仍未保存
    fireEvent.change(screen.getByRole('textbox', { name: '开挖深度（m）' }), { target: { value: '4' } });
    expect(screen.getByText('未保存')).toBeVisible();
    gateway.save.mockResolvedValueOnce(cancelledOutcome);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(gateway.save).toHaveBeenCalledTimes(2));
    expect(screen.getByText('未保存')).toBeVisible();
    // Blob 回退：只请求下载 → 保持未保存，确认已导出后才干净
    gateway.save.mockResolvedValueOnce(exportOutcome('副本.excavation'));
    fireEvent.click(screen.getByRole('button', { name: '另存为…' }));
    await screen.findByRole('button', { name: '确认已导出' });
    expect(screen.getByText('未保存')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '确认已导出' }));
    expect(screen.getByText('已保存')).toBeVisible();
  });

  it('保存后撤销并进行不同编辑仍显示未保存，离开与新建保留修改保护', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('checkbox', { name: '显示网格' }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await screen.findByText('已保存');
    expect(gateway.save).toHaveBeenCalledTimes(1);

    // 撤销后改动另一项设置：操作次数相同，内容与已保存的工程不同。
    fireEvent.click(screen.getByRole('button', { name: '撤销（Ctrl+Z）' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '吸附1m网格' }));
    expect(screen.getByText('未保存')).toBeVisible();

    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    expect(screen.getByRole('dialog', { name: '未保存的修改' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.getByRole('checkbox', { name: '吸附1m网格' })).not.toBeChecked();
    expect(screen.getByText('未保存')).toBeVisible();
  });

  it('未保存时新建：取消保留工程，不保存才清空；保存失败不执行原动作', async () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    const dialog = screen.getByRole('dialog', { name: '未保存的修改' });
    expect(dialog).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();

    // 保存失败：留在对话框并保留工程
    gateway.save.mockResolvedValueOnce({ ok: false, issues: [{ code: 'io', path: '', message: '磁盘只读' }] });
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    await screen.findByText(/未执行原动作/);
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();

    // 不保存并继续：清空为新的空工程
    fireEvent.click(screen.getByRole('button', { name: '不保存并继续' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/0 个开挖对象/)).toBeVisible();
    expect(screen.getByText('已保存')).toBeVisible();
    expect(dispatch).toHaveBeenCalled();
  });

  it('打开文件：合法内容替换工程并清空选择/历史，非法内容保留当前工程', async () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    // 未保存 → 需要确认；选择“不保存并继续”
    const opened: Project = { ...emptyProject(), name: '打开的工程', elements: [
      { id: 'p1', type: 'square-pit', position: { x: 0, y: 0 }, bottomSize: 4, depth: 2, slope: .5, rotation: 0 } as Pit,
    ] };
    gateway.open.mockResolvedValueOnce({ ok: true, value: { name: '样例.excavation', target: null, text: serializeProject(opened) } });
    fireEvent.click(screen.getByRole('button', { name: '打开…' }));
    fireEvent.click(screen.getByRole('button', { name: '不保存并继续' }));
    await screen.findByText('打开的工程');
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    expect(screen.getByText('已保存')).toBeVisible();

    // 非法内容：报错并保留当前工程
    gateway.open.mockResolvedValueOnce({ ok: true, value: { name: 'bad.excavation', target: null, text: '{"version":999}' } });
    fireEvent.click(screen.getByRole('button', { name: '打开…' }));
    await screen.findByText(/打开失败/);
    expect(screen.getByText('打开的工程')).toBeVisible();
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
  });

  it('Ctrl+Z / Ctrl+Y 在画布生效，在文本输入框内保留文本编辑行为', () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(screen.getByText(/0 个开挖对象/)).toBeVisible();
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    // 撤销/重做会清空选择：重新选中对象后，输入框内 Ctrl+Z 不触发文档撤销
    const select = screen.getByRole('combobox', { name: '当前对象' });
    const id = [...select.querySelectorAll('option')].map(option => option.value).find(value => value !== '')!;
    fireEvent.change(select, { target: { value: id } });
    const depth = screen.getByRole('textbox', { name: '开挖深度（m）' });
    fireEvent.keyDown(depth, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(depth, { key: 'z', ctrlKey: true });
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
  });

  it('保存等待期间禁止并发编辑，未保存时 beforeunload 触发原生提醒', async () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    let release: (value: unknown) => void = () => undefined;
    gateway.save.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(gateway.save).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '放置基坑' }));
    clickGround(60, 0);
    expect(screen.getByRole('alert')).toHaveTextContent('正在保存或打开文件');
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    release(savedOutcome('未命名工程.excavation'));
    await screen.findByText('已保存');
    // 已保存 → 不拦截离开
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    // 再次编辑 → 触发原生提醒
    fireEvent.change(screen.getByRole('textbox', { name: '开挖深度（m）' }), { target: { value: '4' } });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });

  it('错误边界：场景渲染抛错时给出提示与重试入口，而不是白屏', () => {
    const noise = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Boom = (): never => { throw new Error('渲染失败'); };
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('界面渲染出错');
    fireEvent.click(screen.getByRole('button', { name: '重试渲染' }));
    expect(screen.getByRole('alert')).toHaveTextContent('界面渲染出错');
    noise.mockRestore();
  });

  it('测量不拦截选择：切回选择工具后仍能点选开挖对象', () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '测量' }));
    clickGround(0, 30); clickGround(0, 40);
    fireEvent.click(screen.getByRole('button', { name: '选择' }));
    clickGround(10, 0);
    expect(screen.getByText('直线基槽工程量')).toBeVisible();
  });
});

describe('M9 界面与教学体验', () => {
  it('状态栏显示工具、网格、吸附、对象数与保存状态，俯视时跟随光标坐标', () => {
    render(<App />);
    const status = screen.getByRole('group', { name: '状态栏' });
    expect(status).toHaveTextContent('工具：选择');
    expect(status).toHaveTextContent('坐标：—');
    expect(status).toHaveTextContent('网格：显示');
    expect(status).toHaveTextContent('吸附：1m 网格开');
    expect(status).toHaveTextContent('对象：0 个');
    expect(status).toHaveTextContent('保存状态：已保存');
    // 俯视时指针在画布内移动：显示取整到厘米的地面坐标；移到画布外即清空
    fireEvent.click(screen.getByRole('button', { name: '俯视' }));
    fireEvent.pointerMove(canvasElement(), groundClient(10, 5));
    expect(status).toHaveTextContent('坐标：X 10.00 · Y 5.00');
    fireEvent.pointerMove(canvasElement(), { clientX: -50, clientY: -50 });
    expect(status).toHaveTextContent('坐标：—');
    // 开关状态同时用文字表达，不只靠勾选框
    fireEvent.click(screen.getByRole('checkbox', { name: '显示网格' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '吸附1m网格' }));
    expect(status).toHaveTextContent('网格：隐藏');
    expect(status).toHaveTextContent('吸附：关');
    // 对象数与保存状态随工程变化
    drawTrench([[0, 0], [20, 0]]);
    expect(status).toHaveTextContent('对象：1 个');
    expect(status).toHaveTextContent('保存状态：未保存');
  });

  it('左侧工具面板切换工具，无选中时删除禁用并说明原因', () => {
    const reason = '未选择对象：请先在画布或“当前对象”中选择要删除的对象';
    render(<App />);
    const panel = screen.getByRole('complementary', { name: '施工工具' });
    const remove = screen.getByRole('button', { name: '删除对象' });
    expect(remove).toBeDisabled();
    expect(remove).toHaveAttribute('title', reason);
    expect(within(panel).getByText(reason)).toBeVisible();
    // 切换工具用 aria-pressed 表达，无需依赖颜色
    fireEvent.click(screen.getByRole('button', { name: '放置基坑' }));
    expect(screen.getByRole('button', { name: '放置基坑' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '选择' })).toHaveAttribute('aria-pressed', 'false');
    // 放置并选中对象后，删除入口按类型命名且可用
    clickGround(0, 0);
    const removePit = screen.getByRole('button', { name: '删除当前基坑' });
    expect(removePit).toBeEnabled();
    fireEvent.click(removePit);
    expect(screen.getByText(/0 个开挖对象/)).toBeVisible();
    expect(screen.getByRole('button', { name: '删除对象' })).toBeDisabled();
  });

  it('属性输入给出取值范围提示，非法输入用 aria-invalid 与文字同时表达', () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    const depth = screen.getByRole('textbox', { name: '开挖深度（m）' });
    expect(depth).toHaveAttribute('title', '取值范围 0.02～1000');
    expect(depth).toHaveAttribute('min', '0.02');
    expect(depth).toHaveAttribute('max', '1000');
    // 越界值被拒绝：字段标为无效并给出文字原因，模型保持不变
    fireEvent.change(depth, { target: { value: '0' } });
    expect(depth).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('必须是 0.02～1000 范围内的有限数值');
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
    // 恢复合法值：无效标记与错误提示同时清除
    fireEvent.change(depth, { target: { value: '3' } });
    expect(depth).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('绘制期间锁定视角，禁用按钮给出原因提示', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: '自由视角' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '绘制基槽' }));
    const free = screen.getByRole('button', { name: '自由视角' });
    expect(free).toBeDisabled();
    expect(free).toHaveAttribute('title', '绘制期间锁定视角');
    expect(screen.getByRole('button', { name: '俯视' })).toHaveAttribute('aria-pressed', 'true');
    // 取消绘制后恢复可用并给出常规说明
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: '自由视角' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '自由视角' })).toHaveAttribute('title', '切换到自由视角');
  });

  it('键盘可聚焦工具与视角控制，输入法组合按键不触发场景命令', () => {
    const dispatch = vi.spyOn(ProjectStore.prototype, 'dispatch');
    render(<App />);
    // 工具按钮用原生 button：可获得焦点并通过 Enter 激活
    const tool = screen.getByRole('button', { name: '绘制基槽' });
    tool.focus();
    expect(tool).toHaveFocus();
    fireEvent.click(tool);
    expect(tool).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(window, { key: 'Enter' });
    // 尚无节点：只提示，不产生命令
    expect(screen.getByRole('alert')).toHaveTextContent('至少需要两个节点');
    expect(dispatch).not.toHaveBeenCalled();
    // 中文输入法组合中的 Enter 一律忽略
    const composing = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    Object.defineProperty(composing, 'isComposing', { value: true });
    window.dispatchEvent(composing);
    expect(dispatch).not.toHaveBeenCalled();
    // 退出绘制后视角控制恢复可用且可获得焦点
    fireEvent.keyDown(window, { key: 'Escape' });
    const top = screen.getByRole('button', { name: '俯视' });
    top.focus();
    expect(top).toHaveFocus();
  });
});

/** M10 桌面关闭桥：模拟 preload 暴露的 earthworkWindow，收集关闭请求与确认。 */
const closeBridge = vi.hoisted(() => {
  const listeners: Array<() => void> = [];
  const confirm = vi.fn();
  return {
    confirm,
    requestClose: (): void => { for (const listener of [...listeners]) listener(); },
    install: (): void => {
      (globalThis as { earthworkWindow?: unknown }).earthworkWindow = {
        onRequestClose: (callback: () => void) => {
          listeners.push(callback);
          return () => { const index = listeners.indexOf(callback); if (index >= 0) listeners.splice(index, 1); };
        },
        confirmClose: confirm,
      };
    },
    reset: (): void => { listeners.length = 0; confirm.mockClear(); },
    uninstall: (): void => { delete (globalThis as { earthworkWindow?: unknown }).earthworkWindow; },
  };
});

describe('M10 桌面关闭流程（保存/不保存/取消后才确认关闭）', () => {
  /** 关闭请求会触发 renderer 状态更新，用 act 包裹避免 React 告警。 */
  const requestClose = (): void => { act(() => { closeBridge.requestClose(); }); };
  beforeEach(() => { closeBridge.install(); closeBridge.reset(); });
  afterEach(() => { closeBridge.uninstall(); });

  it('干净工程请求关闭：不弹对话框，直接确认关闭', () => {
    render(<App />);
    requestClose();
    expect(closeBridge.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('未保存时请求关闭：取消保留工程，不保存才确认关闭', async () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    requestClose();
    const dialog = screen.getByRole('dialog', { name: '未保存的修改' });
    expect(dialog).toHaveTextContent('关闭窗口将丢弃这些修改。');
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(closeBridge.confirm).not.toHaveBeenCalled();
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();

    requestClose();
    fireEvent.click(screen.getByRole('button', { name: '不保存并继续' }));
    await waitFor(() => expect(closeBridge.confirm).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('选择保存并继续：保存成功后才确认关闭；失败则保留窗口与工程', async () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    requestClose();
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    await waitFor(() => expect(closeBridge.confirm).toHaveBeenCalledTimes(1));
    expect(gateway.save).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // 再次编辑后关闭并保存失败：停留在对话框，窗口保持打开
    fireEvent.change(screen.getByRole('textbox', { name: '开挖深度（m）' }), { target: { value: '4' } });
    gateway.save.mockResolvedValueOnce({ ok: false, issues: [{ code: 'io', path: '', message: '磁盘只读' }] });
    requestClose();
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));
    await screen.findByText(/保存失败，未执行原动作/);
    expect(closeBridge.confirm).toHaveBeenCalledTimes(1); // 失败不新增确认
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByText(/1 个开挖对象/)).toBeVisible();
  });

  it('已有待确认动作时忽略关闭请求：新建对话框保持原样，不被覆盖', () => {
    render(<App />);
    drawTrench([[0, 0], [20, 0]]);
    fireEvent.click(screen.getByRole('button', { name: '新建' }));
    requestClose();
    expect(screen.getByRole('dialog')).toHaveTextContent('继续新建工程会丢弃这些修改。');
    expect(closeBridge.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    // 取消后关闭请求不再被挡：工程仍脏，走关闭确认对话框
    requestClose();
    expect(screen.getByRole('dialog', { name: '未保存的修改' })).toHaveTextContent('关闭窗口将丢弃这些修改。');
  });
});
