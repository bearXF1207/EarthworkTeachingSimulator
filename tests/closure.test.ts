import { describe, expect, it } from 'vitest';
import { Raycaster, Vector3 } from 'three';
import { resolveSnap, trenchSnapTargets } from '../src/core/geometry/snapTargets';
import { trenchOutlines } from '../src/core/geometry/trenchOutline';
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

  it('边对边贴合：贴合线吸附出的中心线让两槽共边而不交叠', () => {
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
      expect(result.issues[0]?.message).toContain('折线基槽');
    }
    const shifted = trench('trench-3', [p(0, 3), p(20, 3)]); // 只平移 3m：仍与第一条交叠
    expect(openingsConflict(first, shifted)).toBe(true);
    const beside = trench('trench-4', [p(0, 4), p(20, 4)]); // 平移 4m：只共边
    expect(openingsConflict(first, beside)).toBe(false);
  });
});
