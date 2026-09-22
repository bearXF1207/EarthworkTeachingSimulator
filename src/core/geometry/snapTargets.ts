import type { ExcavationElement, Point2 } from '../model/project';
import { SNAP_RADIUS } from '../validation/limits';
import { closestPointOnSegment } from './polygon';
import { snapPoint } from './pointMath';
import type { AxisLock } from './pointMath';
import { trenchOutlines } from './trenchOutline';

export type SnapKind = 'node' | 'centerline' | 'flush-line' | 'boundary-corner' | 'boundary-edge' | 'grid' | 'none';

/**
 * 相邻基槽提供的吸附目标：
 * - `node`/`centerline`：中心线节点与线段（端点对接、对齐）；
 * - `flush-line`：槽顶边界向外平移“新槽顶半宽”后的贴合线（边对边贴合）；
 * - `boundary-corner`/`boundary-edge`：槽顶边界角点与边界边。
 */
export type SnapTarget =
  | { shape: 'point'; kind: 'node' | 'boundary-corner'; point: Point2; sourceId: string }
  | { shape: 'segment'; kind: 'centerline' | 'flush-line' | 'boundary-edge'; from: Point2; to: Point2; sourceId: string };

export type SnapResolution = { point: Point2; kind: SnapKind; sourceId: string | null };

/** 距离并列时的类型优先：节点 > 中心线 > 贴合线 > 边界角点 > 边界边 > 网格。 */
const KIND_ORDER: Record<SnapKind, number> = {
  node: 0, centerline: 1, 'flush-line': 2, 'boundary-corner': 3, 'boundary-edge': 4, grid: 5, none: 6,
};

const LOCK_TOLERANCE = 1e-6;

/**
 * 收集相邻基槽的吸附目标：中心线节点与线段、槽顶边界顶点与边，
 * 以及把槽顶边界向外平移“新槽顶半宽”得到的贴合线（边对边贴合用）。
 * 只使用直线段，不做曲线细分，数量与节点数线性相关。
 */
export function trenchSnapTargets(elements: ExcavationElement[], options: {
  excludeId?: string; halfWidth?: number;
} = {}): SnapTarget[] {
  const { excludeId, halfWidth = 0 } = options;
  const targets: SnapTarget[] = [];
  for (const element of elements) {
    if (element.type !== 'trench' || element.id === excludeId) continue;
    const points = element.points;
    for (let i = 0; i < points.length; i++) {
      const node = points[i]!;
      targets.push({ shape: 'point', kind: 'node', point: { x: node.x, y: node.y }, sourceId: element.id });
      const next = points[i + 1];
      if (next) targets.push({ shape: 'segment', kind: 'centerline', from: { x: node.x, y: node.y }, to: { x: next.x, y: next.y }, sourceId: element.id });
    }
    const ring = trenchOutlines(element).topOutline;
    for (let i = 0; i < ring.length; i++) {
      const corner = ring[i]!, next = ring[(i + 1) % ring.length]!;
      targets.push({ shape: 'point', kind: 'boundary-corner', point: { x: corner.x, y: corner.y }, sourceId: element.id });
      targets.push({ shape: 'segment', kind: 'boundary-edge', from: { x: corner.x, y: corner.y }, to: { x: next.x, y: next.y }, sourceId: element.id });
      if (!(halfWidth > 0)) continue;
      const dx = next.x - corner.x, dy = next.y - corner.y, length = Math.hypot(dx, dy);
      if (!(length > 0)) continue;
      // 逆时针环的内侧在前进方向左边，向外平移取右法向。
      const out = { x: dy / length * halfWidth, y: -dx / length * halfWidth };
      targets.push({ shape: 'segment', kind: 'flush-line',
        from: { x: corner.x + out.x, y: corner.y + out.y }, to: { x: next.x + out.x, y: next.y + out.y }, sourceId: element.id });
    }
  }
  return targets;
}

/** 距离并列（例如端点同时属于节点目标与中心线目标）的容差。 */
const TIE_TOLERANCE = 1e-9;
/**
 * 端点与角点的等效距离优惠（米）：点目标比线段目标更容易被命中。
 * 取值接近吸附半径，使鼠标在相邻基槽端部附近时稳定吸附到“端点”而不是“中心线”，
 * 这样端点对接得到的是共边闭合；否则中心线吸附会让新槽与邻槽内部交叠而被拒绝。
 */
const POINT_BONUS = 0.8;

/**
 * 在半径内取最近目标；距离并列时按类型优先（节点 > 中心线 > 边界角点 > 边界边）。
 * 先按距离可以让“想贴边就贴边、想接端点就接端点”直接由鼠标位置决定；
 * 点目标带等效距离优惠，使端点与角点在附近时优先被吸附。没有目标时回退 1m 网格。
 * 正交模式传入 `lock` 时只接受锁定轴一致的目标，网格兜底也只吸附自由坐标。
 */
export function resolveSnap(raw: Point2, targets: SnapTarget[], options: {
  radius?: number; grid?: boolean; spacing?: number; lock?: AxisLock | null;
} = {}): SnapResolution {
  const radius = options.radius ?? SNAP_RADIUS, lock = options.lock ?? null;
  const onLock = (point: Point2): boolean =>
    !lock || Math.abs((lock.axis === 'x' ? point.x : point.y) - lock.value) <= LOCK_TOLERANCE;
  let best: SnapResolution | null = null;
  let bestRank = Infinity, bestScore = Infinity;
  for (const target of targets) {
    const point = target.shape === 'point' ? target.point : closestPointOnSegment(raw, target.from, target.to);
    if (!onLock(point)) continue;
    const distance = Math.hypot(point.x - raw.x, point.y - raw.y);
    if (distance > radius) continue;
    const rank = KIND_ORDER[target.kind];
    const score = target.shape === 'point' ? distance - POINT_BONUS : distance;
    if (score < bestScore - TIE_TOLERANCE || (Math.abs(score - bestScore) <= TIE_TOLERANCE && rank < bestRank)) {
      best = { point: { x: point.x, y: point.y }, kind: target.kind, sourceId: target.sourceId };
      bestRank = rank; bestScore = score;
    }
  }
  if (best) return best;
  if (options.grid === false) return { point: { x: raw.x, y: raw.y }, kind: 'none', sourceId: null };
  const snapped = snapPoint(raw, true, options.spacing ?? 1);
  return { point: lock ? (lock.axis === 'x' ? { x: lock.value, y: snapped.y } : { x: snapped.x, y: lock.value }) : snapped, kind: 'grid', sourceId: null };
}

/** 吸附来源的中文说明，用于绘制面板提示。 */
export function snapLabel(resolution: SnapResolution): string {
  const source = resolution.sourceId ?? '';
  switch (resolution.kind) {
    case 'node': return `吸附到 ${source} 端点`;
    case 'centerline': return `吸附到 ${source} 中心线`;
    case 'flush-line': return `吸附到 ${source} 贴合线（边对边）`;
    case 'boundary-corner': return `吸附到 ${source} 槽顶边界角点`;
    case 'boundary-edge': return `吸附到 ${source} 槽顶边界`;
    case 'grid': return '吸附到 1m 网格';
    default: return '自由坐标（无吸附）';
  }
}
