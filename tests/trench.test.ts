import { describe, expect, it, vi } from 'vitest';
import { Mesh, Raycaster, Vector3 } from 'three';
import type { MeshStandardMaterial } from 'three';
import { buildTrench, trenchOutlines } from '../src/core/geometry/trench';
import { emptyProject } from '../src/core/model/project';
import type { ExcavationElement, Pit, Point2, Project, Trench } from '../src/core/model/project';
import { openingsConflict, validateProject } from '../src/core/validation/project';
import { MIN_SEGMENT_LENGTH, validateTrench } from '../src/core/validation/trench';
import { GroundManager } from '../src/scene/GroundManager';
import { ExcavationMeshes } from '../src/scene/MeshFactory';
import { ProjectStore } from '../src/store/ProjectStore';

const trench = (over: Partial<Trench> = {}): Trench => ({
  id: 't1', type: 'trench', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], bottomWidth: 2, depth: 2, slope: .5, ...over,
});
const square: Pit = { id: 'p1', type: 'square-pit', position: { x: 0, y: 0 }, depth: 2, slope: .5, bottomSize: 4, rotation: 0 };
const projectWith = (...elements: ExcavationElement[]): Project => ({ ...emptyProject(), elements });
const ring = (points: Point2[]): number[] => points.flatMap(p => [p.x, p.y]);
const expectRing = (points: Point2[], expected: number[]): void => {
  const actual = ring(points);
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 9));
};

describe('M3 直线基槽几何', () => {
  it('(0,0)→(20,0)、B=2/H=2/m=0.5：长20、底半宽1、顶半宽2、端面垂直且底面位于 -2', () => {
    const built = buildTrench(trench());
    try {
      expectRing(built.bottomOutline, [0, -1, 20, -1, 20, 1, 0, 1]);
      expectRing(built.topOutline, [0, -2, 20, -2, 20, 2, 0, 2]);
      const box = built.geometry.boundingBox!;
      expect(box.min.toArray()).toEqual([0, -2, -2]);
      expect(box.max.toArray()).toEqual([20, 2, 0]);
      // 2 个槽底三角形 + 两侧各 2 + 两端各 2，没有顶盖。
      expect(built.geometry.getAttribute('position').count).toBe(30);
    } finally { built.geometry.dispose(); }
  });

  it('顶点与法线有限、无零面积面，槽底朝上、边坡与端面都朝向开挖空间', () => {
    const built = buildTrench(trench());
    const positions = built.geometry.getAttribute('position'), normals = built.geometry.getAttribute('normal');
    try {
      for (const value of [...positions.array, ...normals.array]) expect(Number.isFinite(value)).toBe(true);
      for (let i = 0; i < positions.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(positions, i), b = new Vector3().fromBufferAttribute(positions, i + 1), c = new Vector3().fromBufferAttribute(positions, i + 2);
        const normal = b.clone().sub(a).cross(c.clone().sub(a));
        expect(normal.length()).toBeGreaterThan(1e-9);
        expect(a.z === 0 && b.z === 0 && c.z === 0).toBe(false);
        const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
        if (a.z < 0 && b.z < 0 && c.z < 0) expect(normal.z).toBeGreaterThan(0); // 槽底
        else if (Math.abs(center.x) < 1e-9) expect(normal.x).toBeGreaterThan(0); // 起点端面朝 +X
        else if (Math.abs(center.x - 20) < 1e-9) expect(normal.x).toBeLessThan(0); // 终点端面朝 -X
        else expect(normal.y * center.y).toBeLessThan(0); // 左右边坡朝中心线
      }
    } finally { built.geometry.dispose(); }
  });

  it('改为纵向与旋转30°后长度、宽度与朝向保持一致', () => {
    const angle = Math.PI / 6, cos = Math.cos(angle), sin = Math.sin(angle);
    const cases = [
      { points: [{ x: 0, y: 0 }, { x: 0, y: 20 }], dir: { x: 0, y: 1 } },
      { points: [{ x: 0, y: 0 }, { x: 20 * cos, y: 20 * sin }], dir: { x: cos, y: sin } },
    ];
    for (const { points, dir } of cases) {
      const built = buildTrench(trench({ points }));
      try {
        const { bottomOutline, topOutline } = built;
        for (const [outline, halfWidth] of [[bottomOutline, 1], [topOutline, 2]] as const) {
          for (const p of outline) {
            expect(Math.abs(p.x * dir.y - p.y * dir.x)).toBeCloseTo(halfWidth, 9); // 到中心线的垂距
            const along = p.x * dir.x + p.y * dir.y;
            expect(along).toBeGreaterThan(-1e-9); expect(along).toBeLessThan(20 + 1e-9);
          }
        }
        const long = Math.hypot(bottomOutline[1]!.x - bottomOutline[0]!.x, bottomOutline[1]!.y - bottomOutline[0]!.y);
        const short = Math.hypot(bottomOutline[3]!.x - bottomOutline[0]!.x, bottomOutline[3]!.y - bottomOutline[0]!.y);
        expect(long).toBeCloseTo(20, 9); expect(short).toBeCloseTo(2, 9);
        expect(built.geometry.boundingBox?.min.z).toBe(-2);
        expect(built.geometry.boundingBox?.max.z).toBe(0);
      } finally { built.geometry.dispose(); }
    }
  });

  it('坡比0时顶底轮廓重合，槽壁竖直', () => {
    const built = buildTrench(trench({ slope: 0 }));
    try {
      expect(built.topOutline).toEqual(built.bottomOutline);
      expect(trenchOutlines(trench({ slope: 0 })).topOutline).toHaveLength(4);
      for (const p of built.topOutline) expect(Math.abs(p.y)).toBeCloseTo(1, 9);
    } finally { built.geometry.dispose(); }
  });
});

describe('M3 基槽参数与冲突校验', () => {
  it('接受合法基槽且只保留白名单字段', () => {
    const result = validateProject({ ...projectWith(trench()), elements: [{ ...trench(), junk: 'x' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.elements[0]).toEqual(trench());
  });
  it.each([
    ['节点重合', [{ x: 0, y: 0 }, { x: 0, y: 0 }]],
    ['段长等于下限', [{ x: 0, y: 0 }, { x: MIN_SEGMENT_LENGTH, y: 0 }]],
    ['段长低于下限', [{ x: 0, y: 0 }, { x: 0.001, y: 0 }]],
    ['节点重合但坐标非零', [{ x: 5, y: 5 }, { x: 5, y: 5 }]],
  ] as const)('拒绝%s', (_label, points) => {
    const result = validateProject(projectWith(trench({ points: [...points] })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.path).toBe('elements[0].points');
  });
  it('拒绝节点数量、节点格式、坐标范围与非有限值', () => {
    const valid = { points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], bottomWidth: 2, depth: 2, slope: .5 };
    for (const input of [
      { ...valid, points: [] }, { ...valid, points: [{ x: 0, y: 0 }] },
      { ...valid, points: [...valid.points, { x: 40, y: 0 }] },
      { ...valid, points: [{ x: 0, y: 0 }, { x: 20000, y: 0 }] },
      { ...valid, points: [{ x: 0, y: 0 }, [20, 0]] }, { ...valid, points: '0,0;20,0' },
      { ...valid, points: [{ x: 0, y: 0 }, { x: Number.NaN, y: 0 }] },
    ]) expect(validateTrench(input, 't1', 'elements[0]').ok).toBe(false);
    expect(validateTrench(valid, 't1', 'elements[0]')).toEqual({ ok: true, value: trench() });
  });
  it('段长略大于下限合法，并能生成有限几何', () => {
    const candidate = trench({ points: [{ x: 0, y: 0 }, { x: 0.0101, y: 0 }], bottomWidth: .02, slope: 0 });
    expect(validateProject(projectWith(candidate)).ok).toBe(true);
    const built = buildTrench(candidate as Trench);
    try {
      expect(built.geometry.getAttribute('position').count).toBe(30);
      for (const value of built.geometry.getAttribute('position').array) expect(Number.isFinite(value)).toBe(true);
    } finally { built.geometry.dispose(); }
  });
  it.each([['depth', 0], ['depth', -1], ['depth', Number.NaN], ['depth', Number.POSITIVE_INFINITY], ['depth', '2'],
    ['bottomWidth', 0], ['bottomWidth', 1001], ['slope', -.1], ['slope', 5.1]])(
    '拒绝截面参数 %s=%s', (key, value) => {
      const result = validateProject(projectWith({ ...trench(), [key]: value }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.issues[0]?.path).toBe(`elements[0].${key}`);
    });
  it('与既有基坑开口重叠或相切拒绝，移到分离位置后创建成功', () => {
    expect(openingsConflict(square, trench())).toBe(true); // 穿过方坑顶部开口
    expect(openingsConflict(square, trench({ points: [{ x: -12, y: 5 }, { x: 8, y: 5 }] }))).toBe(true); // 相切 y=3
    expect(openingsConflict(square, trench({ points: [{ x: -12, y: 6 }, { x: 8, y: 6 }] }))).toBe(false);
    expect(validateProject(projectWith(square, trench({ points: [{ x: -12, y: 6 }, { x: 8, y: 6 }] }))).ok).toBe(true);
    expect(validateProject(projectWith(square, trench())).ok).toBe(false);
  });
  it('基槽之间、基槽与圆坑、包含关系同样拒绝', () => {
    expect(openingsConflict(trench(), trench({ id: 't2', points: [{ x: 0, y: 4 }, { x: 20, y: 4 }] }))).toBe(true);
    expect(openingsConflict(trench(), trench({ id: 't2', points: [{ x: 0, y: 4.001 }, { x: 20, y: 4.001 }] }))).toBe(false);
    const circle: Pit = { id: 'p2', type: 'circular-pit', position: { x: 10, y: 0 }, depth: 2, slope: .5, bottomDiameter: 4 };
    expect(openingsConflict(circle, trench())).toBe(true); // 圆坑顶半径3 与槽顶边缘2 相交
    expect(openingsConflict(circle, trench({ points: [{ x: 0, y: 20 }, { x: 20, y: 20 }] }))).toBe(false);
    const bigPit: Pit = { id: 'p3', type: 'rect-pit', position: { x: 10, y: 0 }, depth: 2, slope: .5, bottomLength: 40, bottomWidth: 20, rotation: 0 };
    expect(openingsConflict(bigPit, trench())).toBe(true); // 基槽完全落在方坑开口内
  });
});

describe('M3 命令原子性与场景接入', () => {
  it('非法更新被拒绝时不进入prepare、快照与场景保持不变', () => {
    const store = new ProjectStore(), commit = vi.fn(), prepare = vi.fn(() => ({ commit, dispose: vi.fn() }));
    expect(store.dispatch({ type: 'add', element: trench() }, prepare).ok).toBe(true);
    const before = store.getSnapshot();
    for (const element of [trench({ depth: 0 }), trench({ bottomWidth: -1 }), trench({ slope: 5.5 }), trench({ points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] })]) {
      expect(store.dispatch({ type: 'update', element }, prepare).ok).toBe(false);
      expect(store.getSnapshot()).toEqual(before);
    }
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(store.dispatch({ type: 'delete', id: 'missing' }, prepare).ok).toBe(false);
    expect(store.dispatch({ type: 'delete', id: 't1' }, prepare).ok).toBe(true);
    expect(store.getSnapshot().elements).toHaveLength(0);
  });
  it('几何构建失败时保留原基槽数据', () => {
    const store = new ProjectStore();
    const ok = (): { commit: () => void; dispose: () => void } => ({ commit: vi.fn(), dispose: vi.fn() });
    store.dispatch({ type: 'add', element: trench() }, ok);
    const before = store.getSnapshot();
    expect(store.dispatch({ type: 'update', element: trench({ depth: 4 }) }, () => { throw new Error('build failed'); }).ok).toBe(false);
    expect(store.getSnapshot()).toEqual(before);
  });
  it('地面按槽顶开口真实开孔，网格不跨槽口，槽外地面保留', () => {
    const built = buildTrench(trench()), ground = new GroundManager([built.topOutline]), meshes = new ExcavationMeshes([trench()]);
    try {
      ground.root.updateMatrixWorld(true); meshes.root.updateMatrixWorld(true);
      const drop = (x: number, y: number): Raycaster => new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1));
      expect(drop(10, 0).intersectObject(ground.ground)).toHaveLength(0);
      expect(meshes.root.children.map(child => child.name)).toEqual(['t1']);
      expect(drop(10, 0).intersectObject(meshes.root)[0]?.point.z).toBeCloseTo(-2);
      for (const [x, y] of [[10, 20], [-5, 0], [25, 0], [10, 2.5]] as const) expect(drop(x, y).intersectObject(ground.ground).length).toBeGreaterThan(0);
      const grid = ground.grid.geometry.getAttribute('position');
      for (let i = 0; i < grid.count; i += 2) {
        const x = (grid.getX(i) + grid.getX(i + 1)) / 2, y = (grid.getY(i) + grid.getY(i + 1)) / 2;
        expect(x > 0 && x < 20 && Math.abs(y) < 2).toBe(false);
      }
    } finally { built.geometry.dispose(); ground.dispose(); meshes.dispose(); }
  });
  it('线框切换作用于槽体材质，释放幂等', () => {
    const meshes = new ExcavationMeshes([trench()], true);
    const materials = (): MeshStandardMaterial[] => meshes.root.children.flatMap(child => child instanceof Mesh ? child.material as MeshStandardMaterial[] : []);
    try {
      expect(meshes.holes).toHaveLength(1);
      for (const material of materials()) expect(material.wireframe).toBe(true);
      meshes.setWireframe(false);
      for (const material of materials()) expect(material.wireframe).toBe(false);
    } finally { meshes.dispose(); meshes.dispose(); }
    expect(meshes.root.children).toHaveLength(0);
  });
  it('基槽与基坑混合工程可同时生成开口与网格', () => {
    const store = new ProjectStore();
    const prepare = (project: Project): { commit: () => void; dispose: () => void } => {
      const meshes = new ExcavationMeshes(project.elements);
      const ground = new GroundManager(meshes.holes, project.settings.groundSize);
      return { commit: vi.fn(), dispose: (): void => { ground.dispose(); meshes.dispose(); } };
    };
    expect(store.dispatch({ type: 'add', element: square }, prepare).ok).toBe(true);
    expect(store.dispatch({ type: 'add', element: trench({ points: [{ x: -12, y: 6 }, { x: 8, y: 6 }] }) }, prepare).ok).toBe(true);
    const snapshot = store.getSnapshot();
    expect(snapshot.elements.map(e => e.type)).toEqual(['square-pit', 'trench']);
    const meshes = new ExcavationMeshes(snapshot.elements);
    try {
      expect(meshes.holes).toHaveLength(2);
      const raycaster = new Raycaster(new Vector3(0, 6, 10), new Vector3(0, 0, -1));
      meshes.root.updateMatrixWorld(true);
      expect(raycaster.intersectObject(meshes.root)[0]?.point.z).toBeCloseTo(-2);
    } finally { meshes.dispose(); }
  });
});
