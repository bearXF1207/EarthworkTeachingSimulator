import { ShapeUtils, Vector2 } from 'three';
import type { Point2 } from '../core/model/project';
import { segmentsTouch, triangleArea } from '../core/geometry/polygon';

/** 地面面积单位为 m²，退化碎片不进入几何和面积统计。 */
const DEGENERATE_AREA = 1e-9;
const MAX_PIECES = 50000;
type Polygon = Point2[];
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

// 用首点作局部原点，避免大坐标的小轮廓发生鞋带公式消减误差。
function area(points: Polygon): number {
  let sum = 0;
  for (let i = 1; i + 1 < points.length; i++) sum += triangleArea(points[0]!, points[i]!, points[i + 1]!);
  return Math.abs(sum);
}
const tolerance = (expected: number): number => Math.max(1e-6, Math.abs(expected) * 1e-10);
const acceptable = (actual: number, expected: number): boolean => Math.abs(actual - expected) <= tolerance(expected);

function triangulate(outer: Polygon, holes: Polygon[]): Polygon[] {
  const contour = outer.map(p => new Vector2(p.x, p.y));
  const inner = holes.map(ring => ring.map(p => new Vector2(p.x, p.y)));
  const indices = ShapeUtils.triangulateShape(contour, inner);
  const points = [...contour, ...inner.flat()];
  return indices.map(triangle => triangle.map(index => {
    const point = points[index];
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid ground triangle');
    return { x: point.x, y: point.y };
  })).filter(triangle => area(triangle) > DEGENERATE_AREA);
}

function touch(a: Polygon, b: Polygon): boolean {
  return a.some((p, i) => b.some((q, j) => segmentsTouch(p, a[(i + 1) % a.length]!, q, b[(j + 1) % b.length]!)));
}
function hasTouchingContours(outer: Polygon, holes: Polygon[]): boolean {
  return holes.some((hole, i) => touch(hole, outer) || holes.slice(0, i).some(other => touch(hole, other)));
}
function bounds(points: Polygon): Bounds {
  return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)),
    minY: Math.min(...points.map(p => p.y)), maxY: Math.max(...points.map(p => p.y)) };
}
function disjoint(a: Bounds, b: Bounds): boolean {
  return a.maxX <= b.minX || a.minX >= b.maxX || a.maxY <= b.minY || a.minY >= b.maxY;
}

/** 半平面裁剪只计算原边的精确交点，不移动/缩小孔洞，也不人为制造地面细缝。 */
function clip(points: Polygon, a: Point2, b: Point2, left: boolean): Polygon {
  const result: Polygon = [];
  const distance = (p: Point2): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const keep = (d: number): boolean => left ? d >= 0 : d <= 0;
  for (let i = 0; i < points.length; i++) {
    const current = points[i]!, next = points[(i + 1) % points.length]!;
    const dc = distance(current), dn = distance(next);
    if (keep(dc)) result.push(current);
    if (keep(dc) !== keep(dn)) {
      const ratio = dc / (dc - dn);
      result.push({ x: current.x + (next.x - current.x) * ratio, y: current.y + (next.y - current.y) * ratio });
    }
  }
  return result;
}

/** 凸片减去一个逆时针三角形：逐边保留外侧，只有内侧继续参加下一次裁剪。 */
function subtract(piece: Polygon, triangle: Polygon): Polygon[] {
  const outside: Polygon[] = [];
  let remaining = piece;
  for (let i = 0; i < triangle.length && remaining.length >= 3; i++) {
    const a = triangle[i]!, b = triangle[(i + 1) % triangle.length]!;
    const part = clip(remaining, a, b, false);
    if (area(part) > DEGENERATE_AREA) outside.push(part);
    remaining = clip(remaining, a, b, true);
  }
  return outside;
}

function fallback(outer: Polygon, holes: Polygon[]): Polygon[] {
  let pieces = triangulate(outer, []);
  if (!acceptable(pieces.reduce((sum, part) => sum + area(part), 0), area(outer))) {
    throw new Error('Incomplete ground contour triangulation');
  }
  for (const hole of holes) {
    const triangles = triangulate(hole, []);
    if (!acceptable(triangles.reduce((sum, part) => sum + area(part), 0), area(hole))) {
      throw new Error('Incomplete ground hole triangulation');
    }
    for (const raw of triangles) {
      const triangle = triangleArea(raw[0]!, raw[1]!, raw[2]!) < 0 ? [...raw].reverse() : raw;
      const box = bounds(triangle);
      pieces = pieces.flatMap(piece => disjoint(bounds(piece), box) ? [piece] : subtract(piece, triangle));
      if (pieces.length > MAX_PIECES) throw new Error('地面开口裁剪复杂度超出安全上限');
    }
  }
  // 半平面交集仍为凸片，可以扇形剖分；再次滤除共线点造成的零面积三角形。
  return pieces.flatMap(piece => {
    const triangles: Polygon[] = [];
    for (let i = 1; i + 1 < piece.length; i++) {
      const triangle = [piece[0]!, piece[i]!, piece[i + 1]!];
      if (area(triangle) > DEGENERATE_AREA) triangles.push(triangle);
    }
    return triangles;
  });
}

/**
 * 优先使用 earcut；仅在接触轮廓导致非空但面积错误时，改用外片减孔洞三角片。
 * 空结果或无接触的普通三角化错误仍会抛出，不能以 fallback 掩盖底层故障。
 * 主地面与岛面共用相同的面积守卫，输出不包含顶部开口内的地面。
 */
export function triangulateGround(outer: Polygon, holes: Polygon[], label = 'ground'): number[] {
  const expected = area(outer) - holes.reduce((sum, hole) => sum + area(hole), 0);
  let triangles = triangulate(outer, holes);
  let actual = triangles.reduce((sum, triangle) => sum + area(triangle), 0);
  if (!acceptable(actual, expected) && triangles.length && hasTouchingContours(outer, holes)) {
    triangles = fallback(outer, holes);
    actual = triangles.reduce((sum, triangle) => sum + area(triangle), 0);
  }
  if (!acceptable(actual, expected)) throw new Error(`Incomplete ${label} triangulation: actual ${actual} vs expected ${expected}`);
  return triangles.flatMap(triangle => triangle.flatMap(point => [point.x, point.y, 0]));
}
