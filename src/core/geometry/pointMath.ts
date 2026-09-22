import type { Point2 } from '../model/project';
import { normalizeDegrees } from '../model/project';
import { EPSILON } from '../validation/limits';

/** 双击判定的拖动阈值（CSS 像素）：超过就按拖动平移处理，不落点。 */
export const DRAG_THRESHOLD = 3;

/**
 * 网格吸附：每轴独立取最近格点 `Math.round(value / spacing) * spacing`。
 * 负数与半格使用同一策略（Math.round(-1.5) = -1、Math.round(1.5) = 2）；关闭时原值返回。
 */
export function snapPoint(point: Point2, enabled: boolean, spacing = 1): Point2 {
  if (!enabled || !Number.isFinite(spacing) || spacing <= 0) return { x: point.x, y: point.y };
  const snap = (value: number): number => {
    const snapped = Math.round(value / spacing) * spacing;
    return snapped === 0 ? 0 : snapped; // 归一化 -0，避免与 +0 产生无意义的比较差异
  };
  return { x: snap(point.x), y: snap(point.y) };
}

/**
 * 按绝对方位角推算下一点：`q = (p.x + L·cosθ, p.y + L·sinθ)`，θ 为度、逆时针为正。
 * 结果不做网格吸附，避免改变用户输入的长度。
 */
export function nextPoint(from: Point2, length: number, angleDegrees: number): Point2 {
  const radians = normalizeDegrees(angleDegrees) * Math.PI / 180;
  return { x: from.x + length * Math.cos(radians), y: from.y + length * Math.sin(radians) };
}

export type SegmentReport = { length: number; angle: number };

/** 单段长度与规范化方位角（0° 沿 +X，逆时针为正）；保留完整精度，只在显示层格式化。 */
export function segmentReport(a: Point2, b: Point2): SegmentReport {
  const dx = b.x - a.x, dy = b.y - a.y;
  return { length: Math.hypot(dx, dy), angle: normalizeDegrees(Math.atan2(dy, dx) * 180 / Math.PI) };
}

/** 依次给出折线每一段的长度与方位角。 */
export function polylineReport(points: Point2[]): SegmentReport[] {
  const reports: SegmentReport[] = [];
  for (let i = 0; i + 1 < points.length; i++) reports.push(segmentReport(points[i]!, points[i + 1]!));
  return reports;
}

/** 两点在容差内是否重合。 */
export const samePoint = (a: Point2, b: Point2): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON;

/**
 * 单击是否追加节点：忽略双击产生的第二下（`event.detail > 1`），
 * 也忽略与末节点重合的位置，因此不依赖最终校验去解决双击重复点。
 */
export function shouldAppendNode(nodes: Point2[], point: Point2, detail: number): boolean {
  if (detail > 1) return false;
  const last = nodes[nodes.length - 1];
  return last === undefined || !samePoint(last, point);
}

/** 按下与抬起之间移动超过阈值视为拖动（平移/缩放），不产生节点。 */
export function isDragGesture(down: Point2, up: Point2, threshold = DRAG_THRESHOLD): boolean {
  return Math.hypot(up.x - down.x, up.y - down.y) > threshold;
}
