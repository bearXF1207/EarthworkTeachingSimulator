import { describe, expect, it } from 'vitest';
import { Raycaster, ShapeUtils, Vector2, Vector3 } from 'three';
import { nextPoint } from '../src/core/geometry/pointMath';
import { resolveSnap, ringCloseTarget, trenchSnapTargets } from '../src/core/geometry/snapTargets';
import { buildTrench } from '../src/core/geometry/trench';
import { isClosedRing, trenchOutlines } from '../src/core/geometry/trenchOutline';
import { trimEndsToNeighbours } from '../src/core/geometry/trenchTrim';
import { emptyProject } from '../src/core/model/project';
import type { ExcavationElement, Point2, Trench } from '../src/core/model/project';
import { openingsConflict, validateProject } from '../src/core/validation/project';
import { GroundManager } from '../src/scene/GroundManager';

const p = (x: number, y: number): Point2 => ({ x, y });
const section = { bottomWidth: 2, depth: 2, slope: .5 };
/** 顶半宽 T = B/2 + H·m = 1 + 1 = 2。 */
const halfWidth = 2;
const trench = (id: string, points: Point2[]): Trench => ({ id, type: 'trench', points, ...section });
const projectWith = (...elements: ExcavationElement[]): ReturnType<typeof emptyProject> => ({ ...emptyProject(), elements });
const topRings = (...elements: Trench[]): Point2[][] => elements.map(element => trenchOutlines(element).topOutline);
const area = (ring: Point2[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; sum += a.x * b.y - b.x * a.y; }
  return Math.abs(sum / 2);
};
/** 地面面积比较：顶点是 Float32，累计面积允许相对容差。 */
const expectArea = (actual: number, expected: number): void =>
  expect(Math.abs(actual - expected)).toBeLessThan(1e-6 * Math.max(1, Math.abs(expected)));

/** 地面三角形总面积：外边界面积减去孔洞面积，用于确认没有缺口也没有重复覆盖。 */
const groundArea = (ground: GroundManager): number => {
  const position = ground.ground.geometry.getAttribute('position');
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let sum = 0;
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
    sum += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
  }
  return sum;
};
const hitsGround = (ground: GroundManager, x: number, y: number): number => {
  ground.root.updateMatrixWorld(true);
  return new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1)).intersectObject(ground.ground).length;
};

describe('M5 闭合连接', () => {
  it('端点对接：同向基槽端面贴合，接受且地面无缺口', () => {
    const first = trench('trench-1', [p(0, 0), p(20, 0)]);
    const second = trench('trench-2', [p(20, 0), p(40, 0)]);
    expect(openingsConflict(first, second)).toBe(false);
    expect(validateProject(projectWith(first, second)).ok).toBe(true);
    const rings = topRings(first, second);
    const ground = new GroundManager(rings);
    try {
      expectArea(groundArea(ground), 10000 - 160);
      expect(hitsGround(ground, 10, 0)).toBe(0);
      expect(hitsGround(ground, 30, 0)).toBe(0);
      expect(hitsGround(ground, 10, 10)).toBe(1);
    } finally { ground.dispose(); }
  });

  it('连续三段同向基槽依次端点对接：全部接受且地面无缺口', () => {
    const first = trench('trench-1', [p(0, 40), p(0, 20)]);
    const second = trench('trench-2', [p(0, 20), p(0, 0)]);
    const third = trench('trench-3', [p(0, 0), p(0, -20)]);
    expect(openingsConflict(second, third)).toBe(false);
    expect(openingsConflict(first, third)).toBe(false);
    expect(validateProject(projectWith(first, second, third)).ok).toBe(true);
    const rings = topRings(first, second, third);
    const ground = new GroundManager(rings);
    try {
      const holes = rings.reduce((sum, ring) => sum + area(ring), 0);
      expectArea(groundArea(ground), 10000 - holes);
      expect(hitsGround(ground, 0, 30)).toBe(0);
      expect(hitsGround(ground, 0, 10)).toBe(0);
      expect(hitsGround(ground, 0, -10)).toBe(0);
      expect(hitsGround(ground, 5, 30)).toBe(1);
    } finally { ground.dispose(); }
  });

  it('精确输入推算的下一段做端点对接：轴上方向精确、不会带入浮点噪声', () => {
    // cos(270°) 的原始结果是 -1.8e-16；方向分量取整后竖直方向必须是精确的 0 与 -1。
    const next = nextPoint(p(0, 0), 20, 270);
    expect(next).toEqual({ x: 0, y: -20 });
    const first = trench('trench-1', [p(0, 20), p(0, 0)]);
    const second = trench('trench-2', [next, { x: next.x, y: next.y - 20 }]);
    expect(openingsConflict(first, second)).toBe(false);
    expect(validateProject(projectWith(first, second)).ok).toBe(true);
  });

  it('接触判定对亚微米偏差稳健，真正的交叠仍被发现', () => {
    const first = trench('trench-1', [p(0, 20), p(0, 0)]);
    // 1e-12 量级偏移仍然属于边界接触，不能判成内部交叠
    expect(openingsConflict(first, trench('trench-2', [p(0, 1e-12), p(0, -20)]))).toBe(false);
    // 1mm 与 1cm 的条带交叠必须被发现
    expect(openingsConflict(first, trench('trench-3', [p(0, 0.001), p(0, -19.999)]))).toBe(true);
    expect(openingsConflict(first, trench('trench-4', [p(0, 0.01), p(0, -19.99)]))).toBe(true);
    expect(openingsConflict(first, trench('trench-5', [p(0, 10), p(0, -10)]))).toBe(true);
  });

  it('吸附到中心后自动收边：两槽共边贴合而非半宽叠合', () => {
    const first = trench('trench-1', [p(0, 0), p(20, 0)]);
    const snapped = resolveSnap(p(10, 0.6), trenchSnapTargets([first]));
    expect(snapped.kind).toBe('centerline');
    // 从相邻槽中心线起画，顶半宽 2 的端面收边后退到对方槽顶边界 y=2
    const trimmed = trimEndsToNeighbours([snapped.point, p(10, 12)], 2, [{ ring: trenchOutlines(first).topOutline }])!;
    expect(trimmed).toHaveLength(2);
    // 收边留 10nm 级缝隙保证地面三角化稳定，按微米级容差比较
    expect(trimmed[0]!.x).toBeCloseTo(10, 6);
    expect(trimmed[0]!.y).toBeCloseTo(2, 6);
    expect(trimmed[1]).toEqual(p(10, 12));
    const second = trench('trench-2', trimmed!);
    expect(openingsConflict(first, second)).toBe(false);
    expect(validateProject(projectWith(first, second)).ok).toBe(true);
    const rings = topRings(first, second);
    const ground = new GroundManager(rings);
    try {
      const holes = rings.reduce((sum, item) => sum + area(item), 0);
      // 两个孔洞沿部分边共边时 earcut 会留下零面积级碎片，面积按 1e-4 m² 容差核对
      expect(Math.abs(groundArea(ground) - (10000 - holes))).toBeLessThan(1e-4);
      expect(hitsGround(ground, 10, 1)).toBe(0); // 两槽覆盖范围都没有地面（贯通）
      expect(hitsGround(ground, 10, 8)).toBe(0);
      expect(hitsGround(ground, 5, 8)).toBe(1);
    } finally { ground.dispose(); }
  });

  it('整条中心线落在相邻槽内时收边失败：返回 null 由命令层拒绝', () => {
    const first = trench('trench-1', [p(0, 0), p(20, 0)]);
    const neighbour = { ring: trenchOutlines(first).topOutline };
    // 整段（含端面角点）都在对方槽内：收边后不再构成一段
    expect(trimEndsToNeighbours([p(5, 0), p(5, 1)], 2, [neighbour])).toBeNull();
    // 一端在槽内、一端在外：收边后仍然是一段合法中心线
    const trimmed = trimEndsToNeighbours([p(5, 0), p(5, 12)], 2, [neighbour])!;
    expect(trimmed[0]!.x).toBeCloseTo(5, 6);
    expect(trimmed[0]!.y).toBeCloseTo(2, 6);
    expect(trimmed[1]).toEqual(p(5, 12));
    // 与对方边界正好共边时不收边
    expect(trimEndsToNeighbours([p(5, 2), p(5, 12)], 2, [neighbour])).toEqual([p(5, 2), p(5, 12)]);
  });

  it('平行并排：贴合线（次级目标）让两槽共边贴合', () => {
    const first = trench('trench-1', [p(0, 0), p(20, 0)]);
    const targets = trenchSnapTargets([first], { halfWidth });
    const snapped = resolveSnap(p(5.3, -3.7), targets);
    expect(snapped.kind).toBe('flush-line');
    expect(snapped.point.x).toBeCloseTo(5.3, 12); // 沿边方向的坐标保持鼠标位置
    expect(snapped.point.y).toBe(-4); // 垂直方向落在贴合线上
    // 平行于第一条槽、中心线在贴合线上的第二段：顶半宽 2，槽顶边界正好落在 y=-2。
    const second = trench('trench-2', [snapped.point, p(20, -4)]);
    expect(openingsConflict(first, second)).toBe(false);
    expect(validateProject(projectWith(first, second)).ok).toBe(true);
    const rings = topRings(first, second);
    expect(rings[1]!.every(point => point.y === -2 || point.y === -6)).toBe(true);
    const ground = new GroundManager(rings);
    try {
      const holes = rings.reduce((sum, ring) => sum + area(ring), 0);
      expectArea(groundArea(ground), 10000 - holes);
      expect(hitsGround(ground, 15, 0)).toBe(0);
      expect(hitsGround(ground, 15, -4)).toBe(0);
      expect(hitsGround(ground, 15, -1.9)).toBe(0);
      expect(hitsGround(ground, 30, 0)).toBe(1);
    } finally { ground.dispose(); }
  });

  it('四段基槽共边围合成封闭区域：校验通过，地面无缺口且岛被覆盖', () => {
    // 每个转角各只属于一段（底段贯通两个下角、右段贯通右上角、顶段贯通左上角），
    // 因此四段只共边不交叠，同时把中间的岛完整围合。
    const ring = [
      trench('trench-b', [p(-4, 0), p(24, 0)]), // 槽顶 [-4,24]×[-2,2]
      trench('trench-r', [p(22, 2), p(22, 14)]), // 槽顶 [20,24]×[2,14]
      trench('trench-t', [p(-4, 12), p(20, 12)]), // 槽顶 [-4,20]×[10,14]
      trench('trench-l', [p(-2, 2), p(-2, 10)]), // 槽顶 [-4,0]×[2,10]
    ];
    for (let i = 0; i < ring.length; i++) {
      for (let k = i + 1; k < ring.length; k++) expect(openingsConflict(ring[i]!, ring[k]!)).toBe(false);
    }
    expect(validateProject(projectWith(...ring)).ok).toBe(true);
    const rings = topRings(...ring);
    const holes = rings.reduce((sum, item) => sum + area(item), 0);
    const ground = new GroundManager(rings);
    try {
      expectArea(groundArea(ground), 10000 - holes);
      // 被围合的岛仍是地面；退化孔洞排列下 earcut 可能在岛内留下零面积级的重复三角形，
      // 因此只断言“有覆盖”，总面积由上一行严格校验。
      expect(hitsGround(ground, 10, 6)).toBeGreaterThanOrEqual(1);
      expect(hitsGround(ground, 0.5, 2.5)).toBeGreaterThanOrEqual(1);
      expect(hitsGround(ground, 10, 0)).toBe(0); // 各段槽内没有地面
      expect(hitsGround(ground, 22, 5)).toBe(0);
      expect(hitsGround(ground, 10, 12)).toBe(0);
      expect(hitsGround(ground, -2, 5)).toBe(0);
    } finally { ground.dispose(); }
  });

  it('内部交叠的基槽仍然拒绝，并给出闭合方式指引', () => {
    const first = trench('trench-1', [p(0, 0), p(20, 0)]);
    const crossing = trench('trench-2', [p(10, 0), p(10, 10)]); // 中心线相交的 T 形分叉
    expect(openingsConflict(first, crossing)).toBe(true);
    const result = validateProject(projectWith(first, crossing));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0]?.path).toBe('elements[1]');
      expect(result.issues[0]?.message).toContain('内部交叠');
      expect(result.issues[0]?.message).toContain('端点');
      expect(result.issues[0]?.message).toContain('折线基槽');
    }
    const shifted = trench('trench-3', [p(0, 3), p(20, 3)]); // 只平移 3m：仍与第一条交叠
    expect(openingsConflict(first, shifted)).toBe(true);
    const beside = trench('trench-4', [p(0, 4), p(20, 4)]); // 平移 4m：只共边
    expect(openingsConflict(first, beside)).toBe(false);
  });
});

describe('M5 环形基槽（中心线首尾闭合）', () => {
  /** 20m 见方、B=2、H=2、m=0.5：顶半宽 2、底半宽 1，外圈 24²、内圈 18²。 */
  const ring = (points: Point2[]): Trench => trench('ring-1', points);
  const square = (): Trench => ring([p(0, 0), p(20, 0), p(20, 20), p(0, 20), p(0, 0)]);

  it('末点回到首点即判定闭合，闭合点写入规范坐标', () => {
    expect(isClosedRing(square().points)).toBe(true);
    expect(isClosedRing([p(0, 0), p(20, 0), p(0, 1e-12)])).toBe(false); // 与首段重合的普通折线
    expect(isClosedRing([p(0, 0), p(20, 0), p(20, 20)])).toBe(false);
  });

  it('轮廓：外圈为开口、内圈为岛，90° 转角按 miter 生成', () => {
    const outlines = trenchOutlines(square());
    // 顶半宽 2：外圈向外 2、岛边界向内 2；底半宽 1：外圈向外 1、岛边界向内 1。
    expect(outlines.topOutline).toEqual([p(-2, -2), p(22, -2), p(22, 22), p(-2, 22)]);
    expect(outlines.topHole).toEqual([p(2, 2), p(18, 2), p(18, 18), p(2, 18)]);
    expect(outlines.bottomOutline).toEqual([p(-1, -1), p(21, -1), p(21, 21), p(-1, 21)]);
    expect(outlines.bottomHole).toEqual([p(1, 1), p(19, 1), p(19, 19), p(1, 19)]);
  });

  it('环形实体：底面为环形面，外圈与内圈各一圈侧面，体积等于环形面积×深度', () => {
    const built = buildTrench(square());
    expect(built.topHole).toBeDefined();
    const position = built.geometry.getAttribute('position');
    const at = (i: number): Vector3 => new Vector3(position.getX(i), position.getY(i), position.getZ(i));
    const term = (a: Vector3, b: Vector3, c: Vector3): number =>
      a.x * (b.y * c.z - b.z * c.y) - a.y * (b.x * c.z - b.z * c.x) + a.z * (b.x * c.y - b.y * c.x);
    let sum = 0;
    for (let i = 0; i < position.count; i += 3) sum += term(at(i), at(i + 1), at(i + 2)) / 6;
    // 补虚拟顶面（外圈减内圈、法向朝下）使曲面闭合，再作有向体积积分
    const combined = [...built.topOutline, ...built.topHole!];
    for (const triangle of ShapeUtils.triangulateShape(
      built.topOutline.map(v => new Vector2(v.x, v.y)), [built.topHole!.map(v => new Vector2(v.x, v.y))])) {
      const [a, b, c] = triangle.map(index => combined[index]!) as [Point2, Point2, Point2];
      sum += term(new Vector3(a.x, a.y, 0), new Vector3(c.x, c.y, 0), new Vector3(b.x, b.y, 0)) / 6;
    }
    // 底截面 22²−18² = 160、顶截面 24²−16² = 320，深度 2，棱台体积 = (160+320)/2×2 = 480
    expect(Math.abs(sum)).toBeCloseTo(480, 6);
    // 侧面朝向直接检查（组 1 为侧面，跳过底面）：
    // 外圈南侧墙面在 y < 0 一侧、法向朝槽内（+y）；内圈南侧墙面在 y > 0 一侧、法向背向岛（−y）。
    const wallNormals = (side: (v: Vector3) => boolean): Vector3[] => {
      const found: Vector3[] = [];
      const a = new Vector3(), b = new Vector3(), c = new Vector3();
      const wallStart = built.geometry.groups[0]?.count ?? 0;
      for (let i = wallStart; i < position.count; i += 3) {
        a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, i + 1); c.fromBufferAttribute(position, i + 2);
        if (![a, b, c].every(side)) continue;
        found.push(new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize());
      }
      return found;
    };
    // 只取南侧一带（|y| 在 0.5～2.5 之间），避免混入岛的其它三面墙
    const outerWall = wallNormals(v => v.y < -0.5 && v.y > -2.5);
    expect(outerWall.length).toBeGreaterThan(0);
    expect(outerWall.every(normal => normal.y > 0.5)).toBe(true);
    const innerWall = wallNormals(v => v.y > 0.5 && v.y < 2.5);
    expect(innerWall.length).toBeGreaterThan(0);
    expect(innerWall.every(normal => normal.y < -0.5)).toBe(true);
  });

  it('校验：节点过少、中心线自交与过窄环被拒绝，正常环接受', () => {
    // 只有 3 个点且末点复首点：不构成环形，仍按折线的重复节点拒绝
    const tooFew = validateProject(projectWith(ring([p(0, 0), p(10, 0), p(0, 0)])));
    expect(tooFew.ok).toBe(false);
    if (!tooFew.ok) expect(tooFew.issues[0]?.message).toContain('重复节点');
    // 中心线自交的回环（八字形）
    const crossed = validateProject(projectWith(ring([p(0, 0), p(20, 0), p(0, 20), p(20, 20), p(0, 0)])));
    expect(crossed.ok).toBe(false);
    // 过窄的环：内圈在短边方向翻折，偏移轮廓无效
    const narrow = validateProject(projectWith(ring([p(0, 0), p(10, 0), p(10, 0.2), p(0, 0.2), p(0, 0)])));
    expect(narrow.ok).toBe(false);
    if (!narrow.ok) expect(narrow.issues[0]?.message).toContain('内圈');
    const ok = validateProject(projectWith(square()));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const element = ok.value.elements[0]!;
      expect(element.type).toBe('trench');
      if (element.type === 'trench') expect(element.points).toHaveLength(5);
    }
  });

  it('地面：外圈开孔、内圈补回地面岛，槽内无地面', () => {
    const outlines = trenchOutlines(square());
    const ground = new GroundManager([outlines.topOutline], 100, [outlines.topHole!]);
    try {
      expectArea(groundArea(ground), 10000 - area(outlines.topOutline));
      const patches = ground.root.children.filter(child => child.name === 'ground-island');
      expect(patches).toHaveLength(1);
      // 岛上仍是地面：射线只对主地面与补片求交，避免命中坐标轴辅助线
      ground.root.updateMatrixWorld(true);
      const hit = (x: number, y: number): number =>
        new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1)).intersectObjects([ground.ground, ...patches], false).length;
      // 取非整数且避开三角化对角线的点，避免落在共享边上被重复命中
      expect(hit(10.4, 14.6)).toBe(1); // 岛上是补片
      expect(hit(30.4, 10.6)).toBe(1); // 场地仍是主地面
      expect(hit(0.4, 10.6)).toBe(0); // 环形槽内没有地面
      expect(hit(21.4, 10.6)).toBe(0);
    } finally { ground.dispose(); }
  });

  it('开口冲突：平行贴边可接受，槽带内仍拒绝', () => {
    // 环形外圈槽顶为 x∈[-2,22]、y∈[-2,22]；这一条的槽顶 x∈[22,26]、y∈[-2,22]，只共边。
    const beside = trench('trench-2', [p(24, 0), p(24, 20)]);
    expect(openingsConflict(square(), beside)).toBe(false);
    expect(validateProject(projectWith(square(), beside)).ok).toBe(true);
    // 压在外圈槽带上的仍然拒绝
    const onBand = trench('trench-3', [p(0, 8), p(0, 12)]);
    expect(openingsConflict(square(), onBand)).toBe(true);
    const result = validateProject(projectWith(square(), onBand));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toContain('内部交叠');
  });

  it('岛内允许继续开槽：整体落在岛内不冲突，压到内边界时自动收边到岛边', () => {
    const islandTrench = trench('trench-2', [p(10, 10), p(10, 16)]);
    expect(openingsConflict(square(), islandTrench)).toBe(false);
    expect(validateProject(projectWith(square(), islandTrench)).ok).toBe(true);
    // 越过内边界继续往外画：按岛边界收边，开口与环形槽内壁共边（打通）
    const crossings = { ring: trenchOutlines(square()).topOutline, island: trenchOutlines(square()).topHole! };
    const trimmed = trimEndsToNeighbours([p(10, 10), p(10, 20)], 2, [crossings])!;
    expect(trimmed[0]).toEqual(p(10, 10));
    expect(trimmed[1]!.x).toBeCloseTo(10, 6);
    expect(trimmed[1]!.y).toBeCloseTo(18, 5);
    const connected = trench('trench-3', trimmed);
    expect(openingsConflict(square(), connected)).toBe(false);
    expect(validateProject(projectWith(square(), connected)).ok).toBe(true);
    // 岛内沟槽的地面：岛面被挖掉，槽内有开口、岛其余部分仍有地面
    const outlines = trenchOutlines(square());
    const ground = new GroundManager([outlines.topOutline, trenchOutlines(connected).topOutline], 100, [outlines.topHole!]);
    try {
      ground.root.updateMatrixWorld(true);
      const patches = ground.root.children.filter(child => child.name === 'ground-island');
      const hit = (x: number, y: number): number =>
        new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1)).intersectObjects([ground.ground, ...patches], false).length;
      expect(hit(10, 14)).toBe(0); // 岛内基槽处没有地面
      expect(hit(6, 14)).toBe(1); // 岛其余部分仍是地面
    } finally { ground.dispose(); }
  });

  it('吸附：草稿起点参与吸附，靠近起点时优先闭合', () => {
    const targets = [...trenchSnapTargets([]), ringCloseTarget(p(0, 0))];
    const near = resolveSnap(p(0.4, 0.3), targets);
    expect(near.kind).toBe('ring-close');
    expect(near.point).toEqual(p(0, 0));
    const far = resolveSnap(p(3, 3), targets);
    expect(far.kind).toBe('grid');
  });
});
