import { describe, expect, it } from 'vitest';
import { ShapeUtils, Vector2, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { buildTrench } from '../src/core/geometry/trench';
import { signedArea } from '../src/core/geometry/polygon';
import { emptyProject } from '../src/core/model/project';
import type { ExcavationElement, Pit, Point2, Project, Trench } from '../src/core/model/project';
import { validateProject } from '../src/core/validation/project';
import { validateTrench } from '../src/core/validation/trench';
import { ProjectStore } from '../src/store/ProjectStore';

const nodes = (...pairs: [number, number][]): Point2[] => pairs.map(([x, y]) => ({ x, y }));
const trench = (points: Point2[], over: Partial<Trench> = {}): Trench =>
  ({ id: 't1', type: 'trench', points, bottomWidth: 2, depth: 2, slope: .5, ...over });
const centerlineLength = (points: Point2[]): number =>
  points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);
/** 断面面积 A=(B+T)H/2，T=B+2Hm。 */
const sectionArea = (t: Trench): number => (t.bottomWidth + t.bottomWidth + 2 * t.depth * t.slope) / 2 * t.depth;
const projectWith = (...elements: ExcavationElement[]): Project => ({ ...emptyProject(), elements });
const xy = (ring: Point2[]): number[] => ring.flatMap(p => [p.x, p.y]);
const expectRing = (ring: Point2[], expected: number[]): void => {
  const actual = xy(ring);
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i]!, 6));
};
const hasPoint = (ring: Point2[], x: number, y: number): boolean => ring.some(p => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
/** 便于与镜像结果比较：按 x 与 y（可取向反）排序后逐点对照。 */
const sortedRing = (ring: Point2[], flipY = false): [number, number][] =>
  ring.map(p => [p.x, flipY ? -p.y : p.y] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
/** 相对容差比较，避免 Float32 顶点精度影响几何总量断言。 */
const expectClose = (actual: number, expected: number, relative = 1e-3): void =>
  expect(Math.abs(actual - expected)).toBeLessThan(relative * Math.max(1, Math.abs(expected)));

type MeshStats = { volume: number; bottomArea: number; triangleCount: number };
/**
 * 开挖面法向朝空腔，补上朝下的顶盖即构成闭合曲面，有向体积积分的相反数就是开挖体积。
 * 同时给出槽底面积与三角形数量，用于检查裂缝、重叠面与零面积面。
 */
function meshStats(geometry: BufferGeometry, topOutline: Point2[]): MeshStats {
  const position = geometry.getAttribute('position'), groups = geometry.groups;
  const term = (a: Vector3, b: Vector3, c: Vector3): number =>
    a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x);
  const vertex = (index: number): Vector3 => new Vector3(position.getX(index), position.getY(index), position.getZ(index));
  let sum = 0, bottomArea = 0;
  const bottomVertices = groups[0]?.count ?? 0;
  for (let i = 0; i < position.count; i += 3) {
    const a = vertex(i), b = vertex(i + 1), c = vertex(i + 2);
    sum += term(a, b, c) / 6;
    if (i < bottomVertices) bottomArea += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  for (const triangle of ShapeUtils.triangulateShape(topOutline.map(p => new Vector2(p.x, p.y)), [])) {
    const a = new Vector3(topOutline[triangle[0]!]!.x, topOutline[triangle[0]!]!.y, 0);
    const b = new Vector3(topOutline[triangle[1]!]!.x, topOutline[triangle[1]!]!.y, 0);
    const c = new Vector3(topOutline[triangle[2]!]!.x, topOutline[triangle[2]!]!.y, 0);
    sum += term(a, c, b) / 6; // 顶盖法向朝下，闭合曲面的朝向才一致
  }
  return { volume: -sum, bottomArea, triangleCount: position.count / 3 };
}

/** 顶点与法线全部有限、无零面积三角形、槽底朝上且侧面法向不朝下。 */
function expectHealthyMesh(geometry: BufferGeometry): void {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  expect(position.count).toBeGreaterThan(0);
  for (const value of [...position.array, ...normal.array]) expect(Number.isFinite(value)).toBe(true);
  const bottomVertices = geometry.groups[0]?.count ?? 0;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
    const cross = b.clone().sub(a).cross(c.clone().sub(a));
    expect(cross.length()).toBeGreaterThan(1e-9);
    const faceZ = cross.z / cross.length();
    // 槽底必须水平朝上；侧面接近竖直，只要求不朝下（体积断言负责朝向的整体正确性）。
    if (i < bottomVertices) expect(faceZ).toBeGreaterThan(0.999);
    else expect(faceZ).toBeGreaterThan(-1e-3);
  }
}

describe('M4 折线基槽几何', () => {
  it('L 型(0,0),(10,0),(10,10)：miter 内角、连续槽底与边坡，总长20、体积120', () => {
    const built = buildTrench(trench(nodes([0, 0], [10, 0], [10, 10])));
    try {
      expectRing(built.bottomOutline, [0, -1, 11, -1, 11, 10, 9, 10, 9, 1, 0, 1]);
      expectRing(built.topOutline, [0, -2, 12, -2, 12, 10, 8, 10, 8, 2, 0, 2]);
      expect(signedArea(built.bottomOutline)).toBeGreaterThan(0);
      expect(signedArea(built.topOutline)).toBeGreaterThan(0);
      const stats = meshStats(built.geometry, built.topOutline);
      expectClose(stats.bottomArea, 2 * 20);
      expectClose(stats.volume, 6 * 20);
      expect(stats.triangleCount).toBe(4 + 2 * 6); // 槽底4个三角形 + 6条边各2个侧面
      expectHealthyMesh(built.geometry);
    } finally { built.geometry.dispose(); }
  });

  it('多折点(0,0),(10,0),(15,5),(25,5)：45° 转角，总长 20+√50', () => {
    const points = nodes([0, 0], [10, 0], [15, 5], [25, 5]);
    const length = 10 + Math.hypot(5, 5) + 10;
    expect(centerlineLength(points)).toBeCloseTo(length, 9);
    const built = buildTrench(trench(points));
    try {
      expect(built.bottomOutline).toHaveLength(8);
      const stats = meshStats(built.geometry, built.topOutline);
      expectClose(stats.bottomArea, 2 * length);
      expectClose(stats.volume, 6 * length);
      expectHealthyMesh(built.geometry);
    } finally { built.geometry.dispose(); }
  });

  it('钝角与左右镜像对称，miter 交点取自角平分线', () => {
    const points = nodes([0, 0], [10, 0], [15, 8.6602540378]);
    const mirrored = points.map(p => ({ x: p.x, y: -p.y }));
    const built = buildTrench(trench(points)), mirror = buildTrench(trench(mirrored));
    try {
      expect(hasPoint(built.bottomOutline, 9.4226497308, 1)).toBe(true);
      expect(hasPoint(built.topOutline, 8.8452994616, 2)).toBe(true);
      expect(hasPoint(built.bottomOutline, 10.5773502692, -1)).toBe(true);
      expect(mirror.bottomOutline).toHaveLength(built.bottomOutline.length);
      sortedRing(built.bottomOutline).forEach(([x, y], i) => {
        const other = sortedRing(mirror.bottomOutline, true)[i]!;
        expect(other[0]).toBeCloseTo(x, 6); expect(other[1]).toBeCloseTo(y, 6);
      });
      expectClose(meshStats(built.geometry, built.topOutline).volume, 6 * 20);
      expectClose(meshStats(mirror.geometry, mirror.topOutline).volume, 6 * 20);
      expectHealthyMesh(built.geometry); expectHealthyMesh(mirror.geometry);
    } finally { built.geometry.dispose(); mirror.geometry.dispose(); }
  });

  it('共线中间节点保留，输出无退化三角形', () => {
    const built = buildTrench(trench(nodes([0, 0], [10, 0], [20, 0])));
    try {
      expectRing(built.bottomOutline, [0, -1, 10, -1, 20, -1, 20, 1, 10, 1, 0, 1]);
      const stats = meshStats(built.geometry, built.topOutline);
      expectClose(stats.bottomArea, 40);
      expect(stats.triangleCount).toBe(4 + 2 * 6); // 共线顶点不产生退化三角形，侧面仍为6条边各2个
      expectClose(stats.volume, 120);
      expectHealthyMesh(built.geometry);
    } finally { built.geometry.dispose(); }
  });

  it('坡比0的折线为竖直槽壁，顶底轮廓重合', () => {
    const built = buildTrench(trench(nodes([0, 0], [10, 0], [10, 10]), { slope: 0 }));
    try {
      expect(built.topOutline).toEqual(built.bottomOutline);
      expectClose(meshStats(built.geometry, built.topOutline).volume, 2 * 2 * 20);
      expectHealthyMesh(built.geometry);
    } finally { built.geometry.dispose(); }
  });

  it('200 节点共线基槽仍可生成有限几何', () => {
    const points = Array.from({ length: 200 }, (_, i) => ({ x: i, y: 0 }));
    const built = buildTrench(trench(points));
    try {
      expect(built.bottomOutline).toHaveLength(400);
      expectClose(meshStats(built.geometry, built.topOutline).volume, 6 * 199);
      expectHealthyMesh(built.geometry);
    } finally { built.geometry.dispose(); }
  });
});

describe('M4 折线校验', () => {
  /** 只保留校验入口需要的字段，模拟从界面或文件传入的未知对象。 */
  const input = (points: Point2[], over: Partial<Trench> = {}): Record<string, unknown> => {
    const source = trench(points, over);
    return { points: source.points, bottomWidth: source.bottomWidth, depth: source.depth, slope: source.slope };
  };
  it('合法的 90°、45°、钝角与共线折线都通过校验', () => {
    for (const points of [
      nodes([0, 0], [10, 0], [10, 10]),
      nodes([0, 0], [10, 0], [15, 5]),
      nodes([0, 0], [10, 0], [15, 8.6602540378]),
      nodes([0, 0], [10, 0], [20, 0]),
    ]) expect(validateTrench(input(points), 't1', 'elements[0]')).toEqual({ ok: true, value: trench(points) });
  });
  it('折返与连续重复节点被拒绝，且不产生 NaN', () => {
    const folded = validateTrench(input(nodes([0, 0], [10, 0], [0, 0])), 't1', 'elements[0]');
    expect(folded.ok).toBe(false);
    if (!folded.ok) expect(folded.issues.map(i => i.message).join(' ')).toMatch(/重合|折返/);
    const repeated = validateTrench(input(nodes([0, 0], [10, 0], [10, 0], [20, 0])), 't1', 'elements[0]');
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.issues.some(i => i.message.includes('重合'))).toBe(true);
  });
  it('中心线自交、非相邻段接触与闭合回路被拒绝', () => {
    const crossed = validateTrench(input(nodes([0, 0], [10, 10], [0, 10], [10, 0])), 't1', 'elements[0]');
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) {
      expect(crossed.issues[0]?.path).toBe('elements[0].points[2]');
      expect(crossed.issues[0]?.message).toContain('相交');
    }
    for (const points of [nodes([0, 0], [10, 0], [20, 0], [10, 0])]) {
      expect(validateTrench(input(points), 't1', 'elements[0]').ok).toBe(false);
    }
    // 首尾闭合的三节点回路不再是折线，按环形基槽接受（见 closure.test.ts）
    expect(validateTrench(input(nodes([0, 0], [10, 0], [10, 10], [0, 0])), 't1', 'elements[0]').ok).toBe(true);
  });
  it('160° 转向超出 miter 上限被拒绝并指明节点', () => {
    const result = validateTrench(input(nodes([0, 0], [10, 0], [0.6030737921, 3.4202014333])), 't1', 'elements[0]');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('elements[0].points[1]');
      expect(result.issues[0]?.message).toMatch(/miter|转角/);
    }
  });
  it('中心线不交叉但槽宽贴近自身时按偏移失效拒绝', () => {
    const result = validateTrench(input(nodes([0, 0], [10, 0], [10, 1], [0, 1])), 't1', 'elements[0]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map(i => i.message).join(' ')).toMatch(/轮廓|包含/);
  });
  it('合法折线槽与既有开口重叠仍拒绝，移开后创建成功', () => {
    const square: Pit = { id: 'p1', type: 'square-pit', position: { x: 0, y: 0 }, depth: 2, slope: .5, bottomSize: 4, rotation: 0 };
    const crossing = trench(nodes([-10, 0], [0, 0], [0, 10]));
    const moved = trench(nodes([-10, 20], [0, 20], [0, 30]));
    expect(validateProject(projectWith(square, crossing)).ok).toBe(false);
    expect(validateProject(projectWith(square, moved)).ok).toBe(true);
  });
  it('数百个随机候选要么结构化拒绝，要么生成闭合、体积正确的几何', () => {
    let state = 20240922;
    const random = (): number => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
    let accepted = 0, rejected = 0;
    for (let trial = 0; trial < 300; trial++) {
      const count = 3 + Math.floor(random() * 4);
      const step = 6 + random() * 8, turn = (random() - .5) * Math.PI / 1.1;
      let heading = random() * Math.PI * 2;
      const points: Point2[] = [{ x: 0, y: 0 }];
      for (let i = 1; i < count; i++) {
        if (i > 1) heading += turn;
        const previous = points[i - 1]!;
        points.push({ x: previous.x + Math.cos(heading) * step, y: previous.y + Math.sin(heading) * step });
      }
      const candidate = trench(points, { bottomWidth: 1 + random() * 5, depth: 1 + random() * 2, slope: random() * 2 });
      const checked = validateTrench(input(points, candidate), 't1', `case${trial}`);
      if (!checked.ok) {
        rejected++;
        expect(checked.issues.length).toBeGreaterThan(0);
        for (const issue of checked.issues) { expect(issue.path).toBeTruthy(); expect(issue.message).toBeTruthy(); }
        continue;
      }
      accepted++;
      const length = centerlineLength(candidate.points), area = sectionArea(candidate);
      const built = buildTrench(checked.value);
      try {
        expectHealthyMesh(built.geometry);
        const stats = meshStats(built.geometry, built.topOutline);
        expectClose(stats.bottomArea, candidate.bottomWidth * length);
        expectClose(stats.volume, area * length);
      } finally { built.geometry.dispose(); }
    }
    expect(accepted, `合法候选仅 ${accepted}/300，几何覆盖不足`).toBeGreaterThan(30);
    expect(rejected, `随机候选未覆盖拒绝路径（接受 ${accepted}/300）`).toBeGreaterThan(0);
  });
});

describe('M4 命令与场景接入', () => {
  it('折线基槽经命令原子提交，非法候选不进入 prepare', () => {
    const store = new ProjectStore();
    let prepared = 0;
    const prepare = (): { commit: () => void; dispose: () => void } => {
      prepared++;
      return { commit: () => undefined, dispose: () => undefined };
    };
    const lShape = trench(nodes([0, 0], [10, 0], [10, 10]));
    expect(store.dispatch({ type: 'add', element: lShape }, prepare).ok).toBe(true);
    const before = store.getSnapshot();
    expect(store.dispatch({ type: 'update', element: trench(nodes([0, 0], [10, 10], [0, 0])) }, prepare).ok).toBe(false);
    expect(store.getSnapshot()).toEqual(before);
    expect(store.getSnapshot().elements[0]).toEqual(lShape);
    expect(prepared).toBe(1);
  });
});
