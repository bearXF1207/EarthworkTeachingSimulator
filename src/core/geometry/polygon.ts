import type { Point2 } from '../model/project';
import { EPSILON, TOUCH_TOLERANCE } from '../validation/limits';

/** 点到线段的距离（含端点投影）。 */
export function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** 点是否在轮廓边界上（容差内视为命中）或内部。 */
export function inside(p: Point2, ring: Point2[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (distanceToSegment(p, a, b) <= EPSILON) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

/** 线段上距 p 最近的点（含端点投影）。 */
export function closestPointOnSegment(p: Point2, a: Point2, b: Point2): Point2 {
  const dx = b.x - a.x, dy = b.y - a.y;
  const square = dx * dx + dy * dy;
  if (!(square > 0)) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / square));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/** 严格内部：与边界保持容差以上距离且被轮廓包围。 */
export function strictlyInside(p: Point2, ring: Point2[], tolerance = TOUCH_TOLERANCE): boolean {
  for (let i = 0; i < ring.length; i++) {
    if (distanceToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!) <= tolerance) return false;
  }
  return inside(p, ring);
}

/**
 * 两条线段是否存在量级可观的真交叉：交点不在端点、不共线。
 * 叉积必须超过与线段长度同量级的容差才算交叉——否则“精确相切”的两条边
 * 会因为 cos(270°) 之类的浮点噪声（约 1e-16）被判成交叉，闭合连接会被误判为内部交叠。
 */
export function properCrossing(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const cross = (p: Point2, q: Point2, r: Point2): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const first = cross(a, b, c), second = cross(a, b, d), third = cross(c, d, a), fourth = cross(c, d, b);
  const tolerance = TOUCH_TOLERANCE * (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(d.x - c.x, d.y - c.y));
  return ((first > tolerance && second < -tolerance) || (first < -tolerance && second > tolerance)) &&
    ((third > tolerance && fourth < -tolerance) || (third < -tolerance && fourth > tolerance));
}

/**
 * 沿边向内侧的采样距离（米）：多档取值，避免“交叠厚度恰好等于采样步长”的条带被漏判。
 * 都远大于接触容差，因此贴着边界的接触点不会被当成内部点。
 */
const OVERLAP_PROBES = [1e-3, 1e-4];

/**
 * 沿逆时针环的每条边取多档内侧采样点，检查是否落在另一个环内部。
 * 共边同侧的矩形或条带交叠（顶点都落在对方边界上、边又相互平行）只能靠这种采样识别。
 */
function edgeProbesInside(ring: Point2[], other: Point2[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
    if (!(length > 0)) continue;
    const inward = { x: -dy / length, y: dx / length }; // 逆时针环的内侧在前进方向左边
    for (const step of OVERLAP_PROBES) {
      const inset = Math.min(step, length / 8);
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const probe = { x: a.x + dx * t + inward.x * inset, y: a.y + dy * t + inward.y * inset };
        if (inside(probe, ring) && strictlyInside(probe, other)) return true;
      }
    }
  }
  return false;
}

/**
 * 两个轮廓的内部是否真正交叠：存在真交叉边、一侧顶点落在另一侧内部，
 * 或沿边的内侧采样点落入对方内部。相切、共边与仅接触都不算交叠，
 * 因此基槽之间可以闭合连接。
 */
export function ringsOverlap(a: Point2[], b: Point2[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i]!, a1 = a[(i + 1) % a.length]!;
    for (let k = 0; k < b.length; k++) {
      if (properCrossing(a0, a1, b[k]!, b[(k + 1) % b.length]!)) return true;
    }
  }
  return a.some(p => strictlyInside(p, b)) || b.some(p => strictlyInside(p, a)) ||
    edgeProbesInside(a, b) || edgeProbesInside(b, a);
}

/** 两条线段是否相交、接触或共线重叠；端点相接与相切都按容差判为命中。 */
export function segmentsTouch(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const cross = (p: Point2, q: Point2, r: Point2): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b)) <= EPSILON ||
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0);
}

/** 有向面积；逆时针为正。 */
/**
 * 两个闭合环的边是否存在量级可观的真交叉（用于环形基槽的内外圈互检）。
 * 共边、相切与顶点接触不算交叉，只有真正穿过对方才算。
 */
export function edgesProperlyCross(ring: Point2[], other: Point2[]): boolean {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    for (let k = 0; k < other.length; k++) {
      const c = other[k]!, d = other[(k + 1) % other.length]!;
      if (properCrossing(a, b, c, d)) return true;
    }
  }
  return false;
}

export function signedArea(ring: Point2[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** 三角形有向面积；逆时针为正，用于三角剖分的绕序与退化判断。 */
export function triangleArea(a: Point2, b: Point2, c: Point2): number {
  return ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

export type RingConflict = { index: number; message: string };

/**
 * 简单多边形检查：顶点有限、无零长边、面积不小于一个容差宽度、无自交或自相切。
 * 合法返回 null；否则给出相关边的起点下标与中文原因，便于定位到具体节点。
 */
export function ringConflict(ring: Point2[]): RingConflict | null {
  const n = ring.length;
  if (n < 3) return { index: 0, message: '轮廓至少需要三个顶点' };
  if (!ring.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))) return { index: 0, message: '轮廓包含非有限坐标' };
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length <= EPSILON) return { index: i, message: '轮廓存在重合顶点或零长边' };
    perimeter += length;
  }
  if (!(Math.abs(signedArea(ring)) > EPSILON * perimeter)) return { index: 0, message: '轮廓面积不足一个容差宽度，偏移已塌缩' };
  for (let i = 0; i < n; i++) {
    const a = ring[i]!, b = ring[(i + 1) % n]!;
    for (let k = i + 1; k < n; k++) {
      const c = ring[k]!, d = ring[(k + 1) % n]!;
      if (k === i + 1) {
        // 相邻边只允许共享一个端点：远端顶点不能落在对方边上（共线回折）。
        if (distanceToSegment(a, c, d) <= EPSILON || distanceToSegment(d, a, b) <= EPSILON) {
          return { index: i, message: `第 ${i + 1} 与第 ${k + 1} 条边共线回折` };
        }
        continue;
      }
      if (i === 0 && k === n - 1) {
        if (distanceToSegment(b, c, d) <= EPSILON || distanceToSegment(c, a, b) <= EPSILON) {
          return { index: k, message: `第 ${n} 与第 1 条边共线回折` };
        }
        continue;
      }
      if (segmentsTouch(a, b, c, d)) return { index: i, message: `第 ${i + 1} 与第 ${k + 1} 条边相交或接触` };
    }
  }
  return null;
}

/** 轮廓是否为简单多边形。 */
export const ringIsSimple = (ring: Point2[]): boolean => ringConflict(ring) === null;
