import { EPSILON } from '../validation/limits';
import type { Point2 } from '../model/project';
import { GeometryError } from './geometryError';
import { leftNormal, solveJoin } from './joinSolver';
import type { Join, Segment } from './joinSolver';
import { signedArea } from './polygon';

/** 每段的单位方向、左法向与长度；零长段直接报错并指明线段。 */
export function polylineSegments(points: Point2[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!, b = points[i + 1]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(length) || length <= EPSILON) {
      throw new GeometryError(`第 ${i + 1} 段中心线过短，无法计算方向`, i + 1, i);
    }
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    segments.push({ d, n: leftNormal(d), length });
  }
  if (!segments.length) throw new GeometryError('基槽至少需要两个节点', 0);
  return segments;
}

/** 每个节点的偏移方向：端点使用所属段法向形成垂直端面，内部节点用 miter 交点。 */
export function polylineJoins(points: Point2[], segments: Segment[]): Join[] {
  return points.map((_, k) => {
    const previous = segments[k - 1], next = segments[k];
    if (!previous) return { node: k, j: next!.n, denom: 1, turn: 0 };
    if (!next) return { node: k, j: previous.n, denom: 1, turn: 0 };
    return solveJoin(previous, next, k);
  });
}

/**
 * 按“左侧正序 + 右侧倒序”构成闭合环，返回原始绕序。
 * 该构造对逆时针中心线是顺时针环，绕序统一由 orientRings 处理，保持底/顶节点一一对应。
 */
export function rawOffsetRing(points: Point2[], joins: Join[], halfWidth: number): Point2[] {
  const side = (sign: number): Point2[] => points.map((p, k) => {
    const { j, denom } = joins[k]!;
    const scale = sign * halfWidth / denom;
    return { x: p.x + j.x * scale, y: p.y + j.y * scale };
  });
  return [...side(1), ...side(-1).reverse()];
}

/** 偏移环下标到节点序号的映射：前 n 个为左侧正序，后 n 个为右侧倒序。 */
export const offsetRingNode = (index: number, nodeCount: number): number =>
  index < nodeCount ? index : 2 * nodeCount - 1 - index;

/** 环形中心线的段：末段由末点回到首点，数量与不重复节点数相同。 */
export function ringSegments(nodes: Point2[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!, b = nodes[(i + 1) % nodes.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!Number.isFinite(length) || length <= EPSILON) {
      throw new GeometryError(`环形中心线第 ${i + 1} 段过短，无法计算方向`, i, i);
    }
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    segments.push({ d, n: leftNormal(d), length });
  }
  return segments;
}

/** 环形中心线每个节点都是前后两段的 miter 交点，没有端面。 */
export function ringJoins(nodes: Point2[], segments: Segment[]): Join[] {
  return nodes.map((_, k) => {
    const previous = segments[(k - 1 + segments.length) % segments.length]!;
    return solveJoin(previous, segments[k]!, k);
  });
}

/** 环形中心线的单侧偏移：外圈与内圈各是一个独立闭合环，不再首尾拼接。 */
export function rawRingSide(nodes: Point2[], joins: Join[], halfWidth: number, sign: number): Point2[] {
  return nodes.map((p, k) => {
    const { j, denom } = joins[k]!;
    const scale = sign * halfWidth / denom;
    return { x: p.x + j.x * scale, y: p.y + j.y * scale };
  });
}

/** 统一成逆时针绕序（返回新数组，不修改入参）。 */
export function toCounterClockwise(ring: Point2[]): Point2[] {
  return signedArea(ring) < 0 ? [...ring].reverse() : [...ring];
}

/** 底/顶轮廓共用一次绕序决策，统一成逆时针并保持节点一一对应。 */
export function orientRings(bottom: Point2[], top: Point2[]): [Point2[], Point2[]] {
  const bottomArea = signedArea(bottom), topArea = signedArea(top);
  if (!Number.isFinite(bottomArea) || !Number.isFinite(topArea) || bottomArea === 0 || topArea === 0) {
    throw new GeometryError('偏移轮廓面积为零，无法确定绕序');
  }
  if ((bottomArea < 0) !== (topArea < 0)) throw new GeometryError('槽顶与槽底轮廓绕序不一致，偏移无效');
  if (bottomArea < 0) { bottom.reverse(); top.reverse(); }
  return [bottom, top];
}
