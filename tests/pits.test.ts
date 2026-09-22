import { describe, expect, it, vi } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { buildPit, outline } from '../src/core/geometry/pit';
import { emptyProject } from '../src/core/model/project';
import type { Pit, SquarePit } from '../src/core/model/project';
import { openingsConflict, validateProject } from '../src/core/validation/project';
import { GroundManager } from '../src/scene/GroundManager';
import { ExcavationMeshes } from '../src/scene/MeshFactory';
import { ProjectStore } from '../src/store/ProjectStore';

const square: SquarePit = { id: 'a', type: 'square-pit', position: { x: 0, y: 0 }, depth: 2, slope: .5, bottomSize: 4, rotation: 0 };
const rectangle: Pit = { id: 'b', type: 'rect-pit', position: { x: 0, y: 0 }, depth: 2, slope: .5, bottomLength: 6, bottomWidth: 4, rotation: 90 };
const circle: Pit = { id: 'c', type: 'circular-pit', position: { x: 0, y: 0 }, depth: 2, slope: .5, bottomDiameter: 4 };
const projectWith = (...pits: Pit[]) => ({ ...emptyProject(), elements: pits });

describe('M2 几何与开口', () => {
  it.each([square, rectangle, circle])('$type 顶底标高、有限顶点、非退化三角形、内向法线且没有顶盖', pit => {
    const built = buildPit(pit), positions = built.geometry.getAttribute('position');
    const normals = built.geometry.getAttribute('normal');
    try {
      expect(built.geometry.boundingBox?.min.z).toBe(-2); expect(built.geometry.boundingBox?.max.z).toBe(0);
      for (const value of [...positions.array, ...normals.array]) expect(Number.isFinite(value)).toBe(true);
      for (let i = 0; i < positions.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(positions, i), b = new Vector3().fromBufferAttribute(positions, i + 1), c = new Vector3().fromBufferAttribute(positions, i + 2);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        expect(normal.length()).toBeGreaterThan(1e-8);
        expect(a.z === 0 && b.z === 0 && c.z === 0).toBe(false);
        if (a.z === -2 && b.z === -2 && c.z === -2) expect(normal.z).toBeGreaterThan(0);
        else expect(normal.dot(new Vector3(-a.x - b.x - c.x, -a.y - b.y - c.y, 0))).toBeGreaterThan(0);
      }
      if (pit.type === 'square-pit') expect(built.topOutline).toEqual([{ x: -3, y: -3 }, { x: 3, y: -3 }, { x: 3, y: 3 }, { x: -3, y: 3 }]);
      if (pit.type === 'rect-pit') {
        expect(built.geometry.boundingBox?.max.x).toBeCloseTo(3); expect(built.geometry.boundingBox?.max.y).toBeCloseTo(4);
      }
      if (pit.type === 'circular-pit') {
        expect(built.topOutline).toHaveLength(96); expect(built.bottomOutline).toHaveLength(96);
        for (const p of built.topOutline) expect(Math.hypot(p.x, p.y)).toBeCloseTo(3);
        for (const p of built.bottomOutline) expect(Math.hypot(p.x, p.y)).toBeCloseTo(2);
      }
    } finally { built.geometry.dispose(); }
  });
  it('地面真开孔、坑底 FrontSide 可命中、网格不横跨坑口；删除恢复地面', () => {
    const ground = new GroundManager([outline(square, true)]), pits = new ExcavationMeshes([square]);
    const ray = new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1));
    try {
      ground.root.updateMatrixWorld(true); pits.root.updateMatrixWorld(true);
      expect(ray.intersectObject(ground.ground)).toHaveLength(0);
      expect(ray.intersectObject(pits.root)[0]?.point.z).toBeCloseTo(-2);
      const grid = ground.grid.geometry.getAttribute('position');
      for (let i = 0; i < grid.count; i += 2) {
        const x = (grid.getX(i) + grid.getX(i + 1)) / 2, y = (grid.getY(i) + grid.getY(i + 1)) / 2;
        expect(Math.abs(x) < 3 && Math.abs(y) < 3).toBe(false);
      }
      const p = ground.ground.geometry.getAttribute('position');
      let area = 0;
      for (let i = 0; i < p.count; i += 3) area += Math.abs((p.getX(i + 1) - p.getX(i)) * (p.getY(i + 2) - p.getY(i)) - (p.getY(i + 1) - p.getY(i)) * (p.getX(i + 2) - p.getX(i))) / 2;
      expect(area).toBeCloseTo(10000 - 36);
      const restored = new GroundManager(); restored.root.updateMatrixWorld(true);
      expect(ray.intersectObject(restored.ground).length).toBeGreaterThan(0); restored.dispose();
    } finally { ground.dispose(); pits.dispose(); }
  });
  it('移动开口回填旧位置，偏心场地按轮廓扩展并保留10m边距', () => {
    const moved = { ...square, position: { x: 90, y: -70 } };
    const ground = new GroundManager([outline(moved, true)]);
    try {
      ground.root.updateMatrixWorld(true); ground.ground.geometry.computeBoundingBox();
      expect(ground.ground.geometry.boundingBox?.max.x).toBe(103); expect(ground.ground.geometry.boundingBox?.min.y).toBe(-83);
      expect(new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1)).intersectObject(ground.ground).length).toBeGreaterThan(0);
      expect(new Raycaster(new Vector3(90, -70, 10), new Vector3(0, 0, -1)).intersectObject(ground.ground)).toHaveLength(0);
    } finally { ground.dispose(); }
  });
  it('多个分离孔洞使用相同轮廓，圆孔与旋转矩形中心均无遮挡', () => {
    const pits: Pit[] = [{ ...rectangle, position: { x: -10, y: 0 }, rotation: 37 }, { ...circle, position: { x: 10, y: 0 } }];
    const ground = new GroundManager(pits.map(p => outline(p, true)));
    try {
      ground.root.updateMatrixWorld(true);
      for (const pit of pits) expect(new Raycaster(new Vector3(pit.position.x, pit.position.y, 10), new Vector3(0, 0, -1)).intersectObject(ground.ground)).toHaveLength(0);
      expect(new Raycaster(new Vector3(0, 0, 10), new Vector3(0, 0, -1)).intersectObject(ground.ground).length).toBeGreaterThan(0);
    } finally { ground.dispose(); }
  });
});

describe('M2 参数与冲突校验', () => {
  it.each([0, -.1, NaN, Infinity, null, '2', ''])('拒绝非法深度 %s', depth => {
    const result = validateProject(projectWith({ ...square, depth } as SquarePit));
    expect(result.ok).toBe(false); if (!result.ok) expect(result.issues[0]?.path).toBe('elements[0].depth');
  });
  it('允许垂直边坡，角度归一化，JSON快照不含渲染对象', () => {
    const result = validateProject(projectWith({ ...square, slope: 0, rotation: -450 }));
    expect(result.ok).toBe(true);
    if (result.ok) { expect((result.value.elements[0] as SquarePit).rotation).toBe(270); expect(JSON.parse(JSON.stringify(result.value))).toEqual(result.value); }
  });
  it('拒绝越界、重复ID、维度为零、过量对象和未知类型', () => {
    for (const project of [projectWith({ ...square, position: { x: 9999, y: 0 } }), projectWith(square, square),
      projectWith({ ...square, bottomSize: 0 }), { ...emptyProject(), elements: Array(501).fill(square) },
      { ...emptyProject(), elements: [{ ...square, type: 'curved-trench' }] }, { ...emptyProject(), settings: null }]) expect(validateProject(project).ok).toBe(false);
  });
  it.each([[7, false], [6, true], [5, true], [0, true]] as const)('方坑间距%s 冲突=%s', (x, expected) => {
    expect(openingsConflict(square, { ...square, id: 'b', position: { x, y: 0 } })).toBe(expected);
  });
  it('矩形相交/包含、旋转分离、圆与多边形相切均正确处理', () => {
    expect(openingsConflict(square, { ...square, bottomSize: .1 })).toBe(true);
    expect(openingsConflict(square, { ...square, position: { x: 7, y: 7 }, rotation: 45 })).toBe(false);
    expect(openingsConflict(circle, { ...square, position: { x: 6, y: 0 } })).toBe(true);
    expect(openingsConflict(circle, { ...square, position: { x: 6.001, y: 0 } })).toBe(false);
    expect(openingsConflict(circle, { ...square, bottomSize: .02, slope: 0 })).toBe(true);
    expect(openingsConflict({ ...circle, bottomDiameter: .02, slope: 0 }, square)).toBe(true);
  });
  it('圆圆在96分段中点方向相切也必须拒绝（使用精确半径）', () => {
    const angle = Math.PI / 96;
    expect(openingsConflict(circle, { ...circle, id: 'd', position: { x: 6 * Math.cos(angle), y: 6 * Math.sin(angle) } })).toBe(true);
  });
});

describe('M2 命令原子性', () => {
  it('失败不进入prepare、不改变快照；prepare抛错保留旧数据；所有写入隔离引用', () => {
    const store = new ProjectStore(), commit = vi.fn(), prepare = vi.fn(() => ({ commit, dispose: vi.fn() }));
    expect(store.dispatch({ type: 'add', element: square }, prepare).ok).toBe(true);
    const before = store.getSnapshot();
    expect(store.dispatch({ type: 'update', element: { ...square, depth: 0 } }, prepare).ok).toBe(false);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(store.dispatch({ type: 'update', element: { ...square, depth: 3 } }, () => { throw new Error('failed'); }).ok).toBe(false);
    expect(store.getSnapshot()).toEqual(before);
    before.elements.length = 0; expect(store.getSnapshot().elements).toHaveLength(1);
    expect(store.dispatch({ type: 'delete', id: 'missing' }, prepare).ok).toBe(false);
    expect(store.dispatch({ type: 'delete', id: square.id }, prepare).ok).toBe(true);
    expect(store.getSnapshot().elements).toHaveLength(0);
  });
});
