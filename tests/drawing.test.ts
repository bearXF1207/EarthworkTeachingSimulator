import { describe, expect, it } from 'vitest';
import { OrthographicCamera, Vector3 } from 'three';
import { applyLock, isDragGesture, nextPoint, orthoLock, orthoPoint, polylineReport, shouldAppendNode, snapPoint } from '../src/core/geometry/pointMath';
import { resolveSnap, snapLabel, trenchSnapTargets } from '../src/core/geometry/snapTargets';
import { normalizeDegrees } from '../src/core/model/project';
import type { ExcavationElement, Point2 } from '../src/core/model/project';
import { DrawingManager, isTextEntryTarget } from '../src/scene/DrawingManager';
import { groundPointFromPointer, pointerNdc } from '../src/scene/groundPointer';

const p = (x: number, y: number): { x: number; y: number } => ({ x, y });
const trench = (id: string, points: Point2[], over: Record<string, number> = {}): ExcavationElement =>
  ({ id, type: 'trench', points, bottomWidth: 2, depth: 2, slope: .5, ...over } as ExcavationElement);

describe('M5 吸附、精确输入与读数', () => {
  it('开启吸附取最近整米格点，关闭时保留原值', () => {
    expect(snapPoint(p(1.2, 2.7), true)).toEqual(p(1, 3));
    expect(snapPoint(p(1.2, 2.7), false)).toEqual(p(1.2, 2.7));
    expect(snapPoint(p(-1.2, -2.7), true)).toEqual(p(-1, -3));
  });
  it('负数与半格使用统一策略', () => {
    expect(snapPoint(p(1.5, -1.5), true)).toEqual(p(2, -1));
    expect(snapPoint(p(-2.5, 0.5), true)).toEqual(p(-2, 1));
    expect(snapPoint(p(0.49, -0.49), true)).toEqual(p(0, 0));
  });
  it('按绝对方位角推算下一点，结果不做吸附', () => {
    const first = nextPoint(p(1, 2), 8, 90);
    expect(first.x).toBeCloseTo(1, 9); expect(first.y).toBeCloseTo(10, 9);
    const second = nextPoint(p(0, 0), 12.5, 30);
    expect(second.x).toBeCloseTo(10.8253175473, 9); expect(second.y).toBeCloseTo(6.25, 9);
    expect(Math.hypot(second.x, second.y)).toBeCloseTo(12.5, 12);
  });
  it('角度 -90、450 与 360 正规化', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(450)).toBe(90);
    expect(normalizeDegrees(360)).toBe(0);
    const down = nextPoint(p(1, 2), 4, -90), around = nextPoint(p(1, 2), 4, 450);
    expect(down.y).toBeCloseTo(-2, 9);
    expect(around.x).toBeCloseTo(1, 9); expect(around.y).toBeCloseTo(6, 9);
  });
  it('段读数保留完整精度并给出规范化方位角', () => {
    const report = polylineReport([p(0, 0), p(3, 4), p(3, 4 - 2)]);
    expect(report).toHaveLength(2);
    expect(report[0]?.length).toBeCloseTo(5, 12);
    expect(report[0]?.angle).toBeCloseTo(53.1301023542, 9);
    expect(report[1]?.length).toBeCloseTo(2, 12);
    expect(report[1]?.angle).toBeCloseTo(270, 9);
  });
});

describe('M5 绘制状态机', () => {
  it('第一次点击设置起点，后续点击追加节点', () => {
    const drawing = new DrawingManager();
    expect(drawing.setTool('drawTrench')).toEqual({ kind: 'drawTrench', nodes: [], cursor: null });
    expect(drawing.addNode(p(0, 0))).toMatchObject({ added: true });
    expect(drawing.addNode(p(10, 0)).state).toMatchObject({ nodes: [p(0, 0), p(10, 0)] });
  });
  it('双击的第二下与重合点都不追加节点', () => {
    const nodes = [p(0, 0), p(10, 0)];
    expect(shouldAppendNode(nodes, p(10, 10), 1)).toBe(true);
    expect(shouldAppendNode(nodes, p(10, 10), 2)).toBe(false);
    expect(shouldAppendNode(nodes, p(10, 0), 1)).toBe(false);
    const drawing = new DrawingManager();
    drawing.setTool('drawTrench');
    drawing.addNode(p(0, 0)); drawing.addNode(p(10, 0));
    expect(drawing.addNode(p(10, 0), 1).added).toBe(false);
    expect(drawing.addNode(p(10, 10), 2).added).toBe(false);
    expect(drawing.addNode(p(10, 10), 1).added).toBe(true);
    expect(drawing.getState()).toMatchObject({ nodes: [p(0, 0), p(10, 0), p(10, 10)] });
  });
  it('切换工具与取消都会清空上一工具的草稿', () => {
    const drawing = new DrawingManager();
    drawing.setTool('drawTrench'); drawing.addNode(p(3, 3));
    expect(drawing.setTool('placePit')).toEqual({ kind: 'placePit', cursor: null });
    expect(drawing.getState()).toEqual({ kind: 'placePit', cursor: null });
    drawing.moveCursor(p(1, 1));
    expect(drawing.setTool('drawTrench')).toEqual({ kind: 'drawTrench', nodes: [], cursor: null });
    drawing.addNode(p(5, 5));
    expect(drawing.cancel()).toEqual({ kind: 'select' });
    expect(drawing.previewPoints()).toEqual([]);
  });
  it('预览折线不产生重复末点，report 同时给出已提交段与光标段', () => {
    const drawing = new DrawingManager();
    drawing.setTool('drawTrench');
    drawing.addNode(p(0, 0)); drawing.addNode(p(10, 0)); drawing.addNode(p(10, 10));
    drawing.moveCursor(p(20, 10));
    expect(drawing.previewPoints()).toEqual([p(0, 0), p(10, 0), p(10, 10), p(20, 10)]);
    const report = drawing.report();
    expect(report.segments.map(s => s.angle)).toEqual([0, 90]);
    expect(report.cursor?.length).toBeCloseTo(10, 9);
    expect(report.cursor?.angle).toBeCloseTo(0, 9);
    drawing.moveCursor(p(10, 10));
    expect(drawing.previewPoints()).toEqual([p(0, 0), p(10, 0), p(10, 10)]);
    expect(drawing.report().cursor).toBeNull();
    drawing.moveCursor(null);
    expect(drawing.previewPoints()).toEqual([p(0, 0), p(10, 0), p(10, 10)]);
  });
  it('拖动超过阈值按平移处理，不产生节点', () => {
    expect(isDragGesture(p(0, 0), p(2, 2))).toBe(false);
    expect(isDragGesture(p(0, 0), p(4, 0))).toBe(true);
    expect(isDragGesture(p(0, 0), p(3, 0), 3)).toBe(false);
  });
  it('文本输入、下拉与可编辑区域内的按键不触发场景命令', () => {
    const input = document.createElement('input'), area = document.createElement('textarea');
    const text = document.createElement('div'), select = document.createElement('select');
    text.setAttribute('contenteditable', 'true');
    for (const target of [input, area, text]) expect(isTextEntryTarget(target)).toBe(true);
    expect(isTextEntryTarget(select)).toBe(true);
    expect(isTextEntryTarget(document.body)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe('M5 正交模式', () => {
  it('取位移较大的分量作为水平或竖直约束', () => {
    expect(orthoPoint(p(0, 0), p(3, 2))).toEqual(p(3, 0));
    expect(orthoPoint(p(0, 0), p(2, 3))).toEqual(p(0, 3));
    expect(orthoPoint(p(0, 0), p(-3, 2.5))).toEqual(p(-3, 0));
    expect(orthoPoint(p(1, 1), p(1.4, 1.5))).toEqual(p(1, 1.5));
    expect(orthoPoint(p(0, 0), p(2, 2))).toEqual(p(2, 0)); // 相等取水平
  });
  it('锁定轴与压轴一致：正交后锁定分量保持前的节点值', () => {
    const lock = orthoLock(p(5, 5), p(9, 6));
    expect(lock).toEqual({ axis: 'y', value: 5 });
    expect(applyLock(lock, p(9, 6))).toEqual(p(9, 5));
    const vertical = orthoLock(p(5, 5), p(6, 11));
    expect(vertical).toEqual({ axis: 'x', value: 5 });
    expect(applyLock(vertical, p(6, 11))).toEqual(p(5, 11));
  });
});

describe('M5 相邻基槽吸附', () => {
  const line = trench('trench-1', [p(0, 0), p(10, 0)]);
  const targets = trenchSnapTargets([line]);
  it('目标包含中心线节点、中心线、槽顶边界角点与边界边', () => {
    expect(targets.filter(t => t.kind === 'node')).toHaveLength(2);
    expect(targets.filter(t => t.kind === 'centerline')).toHaveLength(1);
    expect(targets.filter(t => t.kind === 'boundary-corner')).toHaveLength(4);
    expect(targets.filter(t => t.kind === 'boundary-edge')).toHaveLength(4);
    expect(targets.filter(t => t.kind === 'flush-line')).toHaveLength(0); // 未给顶半宽时不生成贴合线
    expect(trenchSnapTargets([line], { excludeId: 'trench-1' })).toHaveLength(0);
    expect(trenchSnapTargets([line], { halfWidth: 2 }).filter(t => t.kind === 'flush-line')).toHaveLength(4);
  });
  it('贴合线把槽顶边界向外平移新槽顶半宽，用于边对边贴合', () => {
    const flush = trenchSnapTargets([line], { halfWidth: 2 });
    const bottom = flush.find(t => t.kind === 'flush-line' && t.shape === 'segment' && t.from.y === -4);
    expect(bottom).toBeDefined();
    const snapped = resolveSnap(p(5, -3.6), flush);
    expect(snapped.kind).toBe('flush-line');
    expect(snapped.point).toEqual(p(5, -4)); // 顶半宽 2 时，中心线 y=-4 的槽顶边界正好落在 y=-2
    expect(snapLabel(snapped)).toBe('吸附到 trench-1 贴合线（边对边）');
    const clamped = resolveSnap(p(-1.2, -4.3), flush); // 超出贴合线端点时投到端点
    expect(clamped.kind).toBe('flush-line');
    expect(clamped.point).toEqual(p(0, -4));
  });
  it('鼠标位置决定吸附到端点、中心线还是槽顶边界', () => {
    const endpoint = resolveSnap(p(-0.1, 0.1), targets);
    expect(endpoint.kind).toBe('node');
    expect(endpoint.point).toEqual(p(0, 0));
    expect(endpoint.sourceId).toBe('trench-1');
    const middle = resolveSnap(p(5, 0.4), targets);
    expect(middle.kind).toBe('centerline');
    expect(middle.point).toEqual(p(5, 0));
    const boundary = resolveSnap(p(5, 1.2), targets);
    expect(boundary.kind).toBe('boundary-edge');
    expect(boundary.point).toEqual(p(5, 2));
    const corner = resolveSnap(p(10.2, 2.1), targets);
    expect(corner.kind).toBe('boundary-corner');
    expect(corner.point).toEqual(p(10, 2));
  });
  it('超出半径回到 1m 网格，关闭吸附时保留原始坐标', () => {
    const far = resolveSnap(p(30.2, 30.7), targets);
    expect(far.kind).toBe('grid');
    expect(far.point).toEqual(p(30, 31));
    const free = resolveSnap(p(30.2, 30.7), targets, { grid: false });
    expect(free.kind).toBe('none');
    expect(free.point).toEqual(p(30.2, 30.7));
    const near = resolveSnap(p(3.4, 0.2), targets, { radius: 0.05 });
    expect(near.kind).toBe('grid');
  });
  it('正交锁定只接受锁定轴一致的目标，网格也只吸附自由坐标', () => {
    const lock = { axis: 'y' as const, value: 0 };
    const onLine = resolveSnap(p(4.2, 0), targets, { lock });
    expect(onLine.kind).toBe('centerline');
    expect(onLine.point).toEqual(p(4.2, 0));
    const boundaryOnAxis = resolveSnap(p(10.1, 2), targets, { lock: { axis: 'y', value: 2 } });
    expect(boundaryOnAxis.kind).toBe('boundary-corner');
    expect(boundaryOnAxis.point).toEqual(p(10, 2));
    // 锁定轴与所有目标都不一致时只吸附自由坐标
    const incompatible = resolveSnap(p(5, 2.9), targets, { lock: { axis: 'y', value: 3 } });
    expect(incompatible.kind).toBe('grid');
    expect(incompatible.point).toEqual(p(5, 3));
    const far = resolveSnap(p(30.2, 30.7), targets, { lock });
    expect(far.point).toEqual(p(30, 0));
  });
  it('吸附提示可读', () => {
    expect(snapLabel(resolveSnap(p(-0.1, 0.1), targets))).toBe('吸附到 trench-1 端点');
    expect(snapLabel(resolveSnap(p(5, 1.2), targets))).toBe('吸附到 trench-1 槽顶边界');
    expect(snapLabel(resolveSnap(p(30.2, 30.7), targets))).toBe('吸附到 1m 网格');
    expect(snapLabel(resolveSnap(p(30.2, 30.7), targets, { grid: false }))).toBe('自由坐标（无吸附）');
  });
});

describe('M5 屏幕到地面投影', () => {
  /** 仿俯视正交相机：位置在 +Z、up=+Y，与 CameraManager 的俯视布置一致。 */
  const topCamera = (aspect = 1.6, height = 140): OrthographicCamera => {
    const camera = new OrthographicCamera(-height * aspect / 2, height * aspect / 2, height / 2, -height / 2, 0.1, 5000);
    camera.up.set(0, 1, 0);
    camera.position.set(0, 0, 1500);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    return camera;
  };
  const rect = { left: 40, top: 25, width: 800, height: 500 };
  /** 地面点对应的画布客户端坐标：用相机自身投影反算，避免手写公式。 */
  const clientOf = (camera: OrthographicCamera, x: number, y: number): { clientX: number; clientY: number } => {
    const ndc = new Vector3(x, y, 0).project(camera);
    return { clientX: rect.left + (ndc.x + 1) / 2 * rect.width, clientY: rect.top + (1 - ndc.y) / 2 * rect.height };
  };
  it('画布边界偏移与缩放都不影响地面坐标', () => {
    const camera = topCamera();
    for (const [x, y] of [[0, 0], [10, 10], [-12.5, 7.25], [100, -60]] as const) {
      const client = clientOf(camera, x, y);
      const ground = groundPointFromPointer(client.clientX, client.clientY, camera, rect);
      expect(ground?.x).toBeCloseTo(x, 6); expect(ground?.y).toBeCloseTo(y, 6);
    }
    const other = topCamera(1, 400);
    const client = clientOf(other, 25, -30);
    const ground = groundPointFromPointer(client.clientX, client.clientY, other, rect);
    expect(ground?.x).toBeCloseTo(25, 6); expect(ground?.y).toBeCloseTo(-30, 6);
  });
  it('画布外、零尺寸与平行视线返回 null', () => {
    const camera = topCamera();
    expect(pointerNdc(rect.left - 1, rect.top + 10, rect)).toBeNull();
    expect(pointerNdc(rect.left + 10, rect.top + rect.height + 1, rect)).toBeNull();
    expect(groundPointFromPointer(50, 50, camera, { ...rect, width: 0 })).toBeNull();
    // 前视相机与地面平行，视线不与地面相交；视线正好落在地面内时由调用方按视角拒绝。
    const level = camera.clone();
    level.position.set(0, -1500, 50); level.up.set(0, 0, 1); level.lookAt(0, 0, 50); level.updateMatrixWorld(true);
    const client = clientOf(camera, 5, 5);
    expect(groundPointFromPointer(client.clientX, client.clientY, level, rect)).toBeNull();
  });
});
