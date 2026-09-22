import type { Point2, Trench } from '../model/project';
import { EPSILON, MAX_NODES, MIN_NODES } from '../validation/limits';
import { GeometryError } from './geometryError';
import { edgesProperlyCross, inside, ringConflict, signedArea } from './polygon';
import {
  offsetRingNode, orientRings, polylineJoins, polylineSegments, rawOffsetRing, rawRingSide,
  ringJoins, ringSegments, toCounterClockwise,
} from './polylineOffset';

export type TrenchOutlines = {
  bottomOutline: Point2[];
  topOutline: Point2[];
  /** 首尾闭合的环形基槽：内圈轮廓。开口取外圈，内圈包围的岛保持地面。 */
  bottomHole?: Point2[];
  topHole?: Point2[];
};

/** 环形基槽至少 3 个不重复节点（末点回到首点作为闭合标记，故数据至少 4 个点）。 */
export const MIN_RING_NODES = 3;

/** 末点与首点重合（容差内）即视为首尾闭合的环形中心线。 */
export function isClosedRing(points: Point2[]): boolean {
  if (points.length < MIN_RING_NODES + 1) return false;
  const first = points[0]!, last = points[points.length - 1]!;
  return Math.hypot(first.x - last.x, first.y - last.y) <= EPSILON;
}

/** 单段基槽方向与长度；非法输入抛出可读错误，不返回 NaN。 */
export function segmentVector(a: Point2, b: Point2): { dx: number; dy: number; length: number } {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0) throw new Error('基槽中心线长度必须大于 0');
  return { dx, dy, length };
}

/**
 * 折线基槽：2～200 节点的简单折线，整槽统一底宽/深度/坡比。
 * 底部半宽 b=B/2、顶部半宽 t=b+mH；内部节点取相邻两段偏移直线的 miter 交点，
 * 端点使用所属段法向形成垂直端面（butt cap），不沿中心线方向额外放坡。
 * 两个环都逆时针给出且节点一一对应、末点不重复首点，可直接用于地面开孔。
 */
export function trenchOutlines(trench: Trench): TrenchOutlines {
  const points = trench.points;
  if (points.length < MIN_NODES || points.length > MAX_NODES) {
    throw new GeometryError(`基槽节点数量必须为 ${MIN_NODES}～${MAX_NODES}`, 0);
  }
  if (isClosedRing(points)) return ringOutlines(trench);
  const segments = polylineSegments(points);
  const joins = polylineJoins(points, segments);
  const halfBottom = trench.bottomWidth / 2, halfTop = halfBottom + trench.depth * trench.slope;
  const [bottomOutline, topOutline] = orientRings(
    rawOffsetRing(points, joins, halfBottom),
    rawOffsetRing(points, joins, halfTop));
  const nodeOf = (index: number): number => offsetRingNode(index, points.length);
  for (const [label, ring] of [['槽底', bottomOutline], ['槽顶', topOutline]] as const) {
    const conflict = ringConflict(ring);
    if (conflict) {
      const node = nodeOf(conflict.index);
      throw new GeometryError(`${label}轮廓无效：${conflict.message}（节点 ${node + 1} 附近），请调整节点、底宽或坡比`, node);
    }
  }
  // 坡比大于零时顶部轮廓必须完整包住底部轮廓，否则边坡会自相穿插。
  // 坡比极小时两条轮廓的间距小于容差，按重合处理（与 m=0 一致）。
  if (halfTop - halfBottom > 10 * EPSILON && !bottomOutline.every(p => inside(p, topOutline))) {
    throw new GeometryError('槽顶轮廓没有包含槽底轮廓：局部短段或窄槽导致边坡穿插，请调整节点、底宽或坡比');
  }
  return { bottomOutline, topOutline };
}

/**
 * 首尾闭合的环形基槽：末点即首点，因此每个节点都是 miter 转角、没有端面。
 * 外圈是开挖开口，内圈包围的岛保持原地面，顶部轮廓比底部宽（m>0 时）或重合（m=0）。
 * 内外圈都由同一次偏移构造得到且一一对应，可直接用于环形地面开孔。
 */
function ringOutlines(trench: Trench): TrenchOutlines {
  const nodes = trench.points.slice(0, -1);
  if (nodes.length < MIN_RING_NODES) {
    throw new GeometryError(`环形基槽至少需要 ${MIN_RING_NODES} 个不重复节点（末点回到首点表示闭合）`, 0);
  }
  const segments = ringSegments(nodes);
  const joins = ringJoins(nodes, segments);
  const halfBottom = trench.bottomWidth / 2, halfTop = halfBottom + trench.depth * trench.slope;
  // 面积大的那一圈是外圈；与中心线的绘制绕向无关。
  const sides = (halfWidth: number): [Point2[], Point2[]] => {
    const left = rawRingSide(nodes, joins, halfWidth, 1);
    const right = rawRingSide(nodes, joins, halfWidth, -1);
    const pair: [Point2[], Point2[]] = Math.abs(signedArea(left)) >= Math.abs(signedArea(right))
      ? [left, right] : [right, left];
    return [toCounterClockwise(pair[0]), toCounterClockwise(pair[1])];
  };
  const [bottomOutline, bottomHole] = sides(halfBottom);
  const [topOutline, topHole] = sides(halfTop);
  const rings = [
    ['槽底外圈', bottomOutline], ['槽底内圈', bottomHole],
    ['槽顶外圈', topOutline], ['槽顶内圈', topHole],
  ] as const;
  for (const [label, ring] of rings) {
    const conflict = ringConflict(ring);
    if (conflict) {
      throw new GeometryError(`${label}轮廓无效：${conflict.message}（节点 ${conflict.index + 1} 附近），请调整节点顺序、底宽或坡比`, conflict.index);
    }
  }
  for (const [outer, hole, label] of [
    [bottomOutline, bottomHole, '槽底'], [topOutline, topHole, '槽顶'],
  ] as const) {
    if (!hole.every(p => inside(p, outer))) {
      throw new GeometryError(`${label}内圈超出外圈：环形中心线过窄或节点顺序自交，请调整节点顺序、底宽或坡比`);
    }
    if (edgesProperlyCross(hole, outer)) {
      throw new GeometryError(`${label}内外圈相交：环形中心线存在局部折返，请调整节点顺序、底宽或坡比`);
    }
  }
  // 坡比大于零时顶部必须完整包住底部的环形截面，否则边坡自相穿插。
  if (halfTop - halfBottom > 10 * EPSILON) {
    if (!bottomOutline.every(p => inside(p, topOutline))) {
      throw new GeometryError('槽顶外圈没有包含槽底外圈：局部短段或窄槽导致边坡穿插，请调整节点、底宽或坡比');
    }
    if (!topHole.every(p => inside(p, bottomHole))) {
      throw new GeometryError('槽顶内圈超出槽底内圈：岛一侧边坡穿插，请调整节点、底宽或坡比');
    }
  }
  return { bottomOutline, topOutline, bottomHole, topHole };
}
