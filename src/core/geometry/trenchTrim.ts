import type { Point2 } from '../model/project';
import { EPSILON } from '../validation/limits';
import { distanceToSegment, inside, strictlyInside } from './polygon';

/** 收边最大轮次：相邻对象较多或需要连续丢端点时的安全上限。 */
const MAX_PASSES = 64;

/**
 * 收边让出的极小缝隙（米，10nm 量级）。
 * 两个地面孔洞若完全共边，earcut 的孔洞桥接会产生重叠三角形导致面积校验失败；
 * 留出远小于任何工程容差的缝隙既能稳定三角化，开口在视觉与判定上仍是共边接触
 * （接触容差为 1e-6，面积影响约 1e-8 m²，远小于总面积守卫）。
 */
const TRIM_CLEARANCE = 1e-8;

/**
 * 相邻开挖对象参与收边的区域：`ring` 为槽顶开口，环形基槽再带一个 `island`（岛仍是地面）。
 */
export type TrimNeighbour = { ring: Point2[]; island?: Point2[] };

/**
 * 岛边界的“靠岛侧”判定容差（米）：落在岛内或离岛边界 10µm 以内的点都算岛侧、不参与收边。
 * 必须明显大于收边让出的 1e-8 缝隙，否则收边后的端点会被反复推走而无法收敛。
 */
const ISLAND_TOLERANCE = 1e-5;

/** 点是否在岛的“靠岛侧”：岛内、或离岛边界不超过容差（含贴边）。 */
function onIslandSide(point: Point2, island: Point2[]): boolean {
  for (let i = 0; i < island.length; i++) {
    if (distanceToSegment(point, island[i]!, island[(i + 1) % island.length]!) <= ISLAND_TOLERANCE) return true;
  }
  return inside(point, island);
}

/** 点是否落在需要避让的槽带内：在外圈内、且不在岛（岛属地面，允许开挖）。 */
function insideBand(point: Point2, neighbour: TrimNeighbour): boolean {
  if (!strictlyInside(point, neighbour.ring)) return false;
  return !neighbour.island || !onIslandSide(point, neighbour.island);
}

/**
 * 从槽带内一点沿 `direction` 前进，与槽带边界的第一个交点距离（外圈或岛边界都算）。
 * 没有交点（整段仍在槽带内）时返回 `maxDistance`。
 */
function firstExit(from: Point2, direction: Point2, maxDistance: number, neighbour: TrimNeighbour): number {
  const loops = neighbour.island ? [neighbour.ring, neighbour.island] : [neighbour.ring];
  let best = maxDistance;
  for (const ring of loops) for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const ex = b.x - a.x, ey = b.y - a.y;
    const denominator = direction.x * ey - direction.y * ex;
    if (Math.abs(denominator) < 1e-12) continue; // 与这条边平行
    const cx = a.x - from.x, cy = a.y - from.y;
    const along = (cx * ey - ex * cy) / denominator;
    if (!(along > 0) || along > best) continue;
    const ratio = (direction.y * cx - direction.x * cy) / denominator;
    if (ratio < -1e-9 || ratio > 1 + 1e-9) continue;
    best = along;
  }
  return best;
}

/**
 * 端部需要收边的距离，按“端面两个角点沿中心线退出相邻槽顶边界”的最大值确定，
 * 保证收边后整条端面都不再落入对方槽内（只可能共边接触）。
 * 返回 null 表示这一段整体都在对方槽内，需要丢掉该端点。
 */
function endCut(from: Point2, to: Point2, halfWidth: number, neighbour: TrimNeighbour): number | null {
  const dx = to.x - from.x, dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > EPSILON)) return 0;
  const direction = { x: dx / length, y: dy / length };
  const normal = { x: -direction.y, y: direction.x };
  let cut = 0;
  for (const sign of [1, -1]) {
    const corner = { x: from.x + normal.x * halfWidth * sign, y: from.y + normal.y * halfWidth * sign };
    // 只有严格落在槽带内的角点才需要收边：正好落在边界上的角点属于共边接触，岛内则允许开挖。
    if (!insideBand(corner, neighbour)) continue;
    cut = Math.max(cut, firstExit(corner, direction, length, neighbour));
  }
  if (!(cut > 0)) return 0;
  const cleared = cut + TRIM_CLEARANCE;
  return cleared >= length - 1e-9 ? null : cleared;
}

/** 对起点端或终点端收边；返回新点列（可能需要少一个端点）。 */
function trimEnd(points: Point2[], halfWidth: number, neighbour: TrimNeighbour, atStart: boolean): Point2[] {
  if (points.length < 2) return points;
  const from = atStart ? points[0]! : points[points.length - 1]!;
  const to = atStart ? points[1]! : points[points.length - 2]!;
  const cut = endCut(from, to, halfWidth, neighbour);
  if (cut === null) return atStart ? points.slice(1) : points.slice(0, -1);
  if (!(cut > 0)) return points;
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  const moved = { x: from.x + dx / length * cut, y: from.y + dy / length * cut };
  const result = points.map(point => ({ x: point.x, y: point.y }));
  if (atStart) result[0] = moved; else result[result.length - 1] = moved;
  return result;
}

const samePoints = (a: Point2[], b: Point2[]): boolean =>
  a.length === b.length && a.every((point, index) => point.x === b[index]!.x && point.y === b[index]!.y);

/**
 * 按相邻开挖对象的槽顶边界把中心线两端自动收边：
 * 绘制时可以吸附到相邻基槽的中心线，确认后收边到对方槽顶边界，
 * 两条基槽的开口因此只共边接触，多条基槽相互贯通而不交叠。
 * `halfWidth` 传顶半宽（B/2 + mH），用最宽的顶面判断重叠。
 * 返回收边后的点列；整条都落在相邻槽内（不再构成一段）时返回 null。
 */
export function trimEndsToNeighbours(points: Point2[], halfWidth: number, neighbours: TrimNeighbour[]): Point2[] | null {
  if (!(halfWidth >= 0) || !neighbours.length) return points.map(point => ({ x: point.x, y: point.y }));
  let result = points.map(point => ({ x: point.x, y: point.y }));
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const neighbour of neighbours) {
      for (const atStart of [true, false]) {
        const trimmed = trimEnd(result, halfWidth, neighbour, atStart);
        if (!samePoints(trimmed, result)) { result = trimmed; changed = true; }
        if (result.length < 2) return null;
      }
    }
    if (!changed) return result;
  }
  return null;
}
