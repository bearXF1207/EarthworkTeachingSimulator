import type { ExcavationElement, Point2 } from '../model/project';
import { SNAP_RADIUS } from '../validation/limits';
import { closestPointOnSegment } from './polygon';
import { snapPoint } from './pointMath';
import type { AxisLock } from './pointMath';
import { trenchOutlines } from './trenchOutline';

/**
 * `ring-close` 为草稿起点（首尾闭合），`node`/`centerline` 为相邻基槽的中心线骨架，
 * `flush-line` 为次级目标（把对方槽顶边界再外移新槽顶半宽，用于平行并排且只共边）。
 */
export type SnapKind = 'ring-close' | 'node' | 'centerline' | 'flush-line' | 'grid' | 'none';

/**
 * 吸附目标一律取自**中心线**（相邻基槽的节点与线段）：
 * 鼠标落在对方槽带范围内就吸附到它的中心线，不再吸附槽顶边界，
 * 这样容易瞄准贯通位置；确认时再按对方槽顶边界自动收边，使开口只共边。
 * `band` 是对方槽顶半宽，作为中心线目标的附加吸附范围（槽带内都能吸附到中心）。
 */
export type SnapTarget =
  | { shape: 'point'; kind: 'ring-close'; point: Point2; sourceId: null; band: number }
  | { shape: 'point'; kind: 'node'; point: Point2; sourceId: string; band: number }
  | { shape: 'segment'; kind: 'centerline'; from: Point2; to: Point2; sourceId: string; band: number }
  | { shape: 'segment'; kind: 'flush-line'; from: Point2; to: Point2; sourceId: string; band: number };

export type SnapResolution = { point: Point2; kind: SnapKind; sourceId: string | null };

/** 首尾闭合目标：把草稿起点作为可吸附点，命中后中心线闭合为环形基槽。 */
export function ringCloseTarget(point: Point2): SnapTarget {
  return { shape: 'point', kind: 'ring-close', point: { x: point.x, y: point.y }, sourceId: null, band: 0 };
}

/**
 * 分层优先：闭合 > 中心线骨架 > 贴合线 > 网格。
 * 中心线骨架层只要在范围内就压过贴合线，保证“吸附到中心”先于“贴边”。
 */
const KIND_TIER: Record<SnapKind, number> = { 'ring-close': 0, node: 1, centerline: 1, 'flush-line': 2, grid: 3, none: 4 };
const KIND_RANK: Record<SnapKind, number> = { 'ring-close': 0, node: 1, centerline: 2, 'flush-line': 3, grid: 4, none: 5 };

const LOCK_TOLERANCE = 1e-6;

/**
 * 收集相邻基槽的中心线骨架：每个节点与每段中心线。
 * band = 对方槽顶半宽（B/2 + mH），使鼠标在对方槽带内外一个吸附半径内都命中中心线。
 */
export function trenchSnapTargets(elements: ExcavationElement[], options: { excludeId?: string; halfWidth?: number } = {}): SnapTarget[] {
  const { excludeId, halfWidth = 0 } = options;
  const targets: SnapTarget[] = [];
  for (const element of elements) {
    if (element.type !== 'trench' || element.id === excludeId) continue;
    const band = element.bottomWidth / 2 + element.depth * element.slope;
    const points = element.points;
    for (let i = 0; i < points.length; i++) {
      const node = points[i]!;
      targets.push({ shape: 'point', kind: 'node', point: { x: node.x, y: node.y }, sourceId: element.id, band });
      const next = points[i + 1];
      if (!next || (next.x === node.x && next.y === node.y)) continue;
      targets.push({ shape: 'segment', kind: 'centerline', from: { x: node.x, y: node.y }, to: { x: next.x, y: next.y }, sourceId: element.id, band });
    }
    if (!(halfWidth > 0)) continue;
    // 贴合线：并行布槽时把新槽中心线放到“对方槽顶边界再外移新槽顶半宽”的位置，两槽只共边。
    const ring = trenchOutlines(element).topOutline;
    for (let i = 0; i < ring.length; i++) {
      const corner = ring[i]!, next = ring[(i + 1) % ring.length]!;
      const dx = next.x - corner.x, dy = next.y - corner.y, length = Math.hypot(dx, dy);
      if (!(length > 0)) continue;
      // 逆时针环的内侧在前进方向左边，向外平移取右法向。
      const out = { x: dy / length * halfWidth, y: -dx / length * halfWidth };
      targets.push({ shape: 'segment', kind: 'flush-line', from: { x: corner.x + out.x, y: corner.y + out.y },
        to: { x: next.x + out.x, y: next.y + out.y }, sourceId: element.id, band: 0 });
    }
  }
  return targets;
}

/** 距离并列（例如端点同时属于节点目标与中心线目标）的容差。 */
const TIE_TOLERANCE = 1e-9;
/** 节点目标的等效距离优惠（米）：端部附近优先吸附端点。 */
const NODE_BONUS = 0.8;
/**
 * 首尾闭合目标的等效距离优惠（米）：略大于吸附半径，
 * 使鼠标只要落回起点附近就稳定闭合成环形基槽，而不会被相邻槽的中心线抢走。
 */
const CLOSE_BONUS = 1.2;

/**
 * 在（吸附半径 + 目标槽带半宽）内取最近目标：先比分层，再比等效距离。
 * 中心线骨架层内点目标带等效距离优惠，端部附近因此优先吸附端点；
 * 没有目标时回退 1m 网格。正交模式传入 `lock` 时只接受锁定轴一致的目标。
 */
export function resolveSnap(raw: Point2, targets: SnapTarget[], options: {
  radius?: number; grid?: boolean; spacing?: number; lock?: AxisLock | null;
} = {}): SnapResolution {
  const radius = options.radius ?? SNAP_RADIUS, lock = options.lock ?? null;
  const onLock = (point: Point2): boolean =>
    !lock || Math.abs((lock.axis === 'x' ? point.x : point.y) - lock.value) <= LOCK_TOLERANCE;
  let best: SnapResolution | null = null;
  let bestTier = Infinity, bestScore = Infinity, bestRank = Infinity;
  for (const target of targets) {
    const point = target.shape === 'point' ? target.point : closestPointOnSegment(raw, target.from, target.to);
    if (!onLock(point)) continue;
    const distance = Math.hypot(point.x - raw.x, point.y - raw.y);
    if (distance > radius + target.band) continue;
    const tier = KIND_TIER[target.kind], rank = KIND_RANK[target.kind];
    const bonus = target.kind === 'ring-close' ? CLOSE_BONUS : target.kind === 'node' ? NODE_BONUS : 0;
    const score = distance - bonus;
    const better = tier < bestTier || (tier === bestTier && (
      score < bestScore - TIE_TOLERANCE ||
      (Math.abs(score - bestScore) <= TIE_TOLERANCE && rank < bestRank)));
    if (!better) continue;
    best = { point: { x: point.x, y: point.y }, kind: target.kind, sourceId: target.sourceId };
    bestTier = tier; bestScore = score; bestRank = rank;
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
    case 'ring-close': return '吸附到起点：首尾闭合，确认后生成环形基槽';
    case 'node': return `吸附到 ${source} 端点`;
    case 'centerline': return `吸附到 ${source} 中心线`;
    case 'flush-line': return `吸附到 ${source} 贴合线（平行并排只共边）`;
    case 'grid': return '吸附到 1m 网格';
    default: return '自由坐标（无吸附）';
  }
}
