import type { Point2, Trench } from '../model/project';
import { EPSILON, MAX_NODES, MIN_NODES } from '../validation/limits';
import { GeometryError } from './geometryError';
import { inside, ringConflict } from './polygon';
import { offsetRingNode, orientRings, polylineJoins, polylineSegments, rawOffsetRing } from './polylineOffset';

export type TrenchOutlines = { bottomOutline: Point2[]; topOutline: Point2[] };

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
