import type { Point2 } from '../model/project';

/**
 * M7 平面测量：距离与折线长度都是纯二维计算，不依赖 Three、React 或格式化字符串。
 * 非有限输入一律返回 null，由 UI 决定如何提示；不把 NaN 当成 0 显示。
 */

const finitePoint = (point: Point2): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

/** 两点平面距离（m）。 */
export function distance(from: Point2, to: Point2): number | null {
  if (!finitePoint(from) || !finitePoint(to)) return null;
  const value = Math.hypot(to.x - from.x, to.y - from.y);
  return Number.isFinite(value) ? value : null;
}

/**
 * 折线总长（m）：依次累加相邻点距离。
 * 首尾闭合的中心线末点等于首点，闭合段因此自然被计入；少于两个点返回 null。
 */
export function polylineLength(points: Point2[]): number | null {
  if (points.length < 2) return null;
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const segment = distance(points[i - 1]!, points[i]!);
    if (segment === null) return null;
    total += segment;
  }
  return Number.isFinite(total) ? total : null;
}
