import { GeometryError } from '../geometry/geometryError';
import { segmentsTouch } from '../geometry/polygon';
import { isClosedRing, trenchOutlines } from '../geometry/trenchOutline';
import type { Point2, Result, Trench, ValidationIssue } from '../model/project';
import { EPSILON, MAX_COORDINATE, MAX_NODES, MAX_SIZE, MAX_SLOPE, MIN_NODES, MIN_SEGMENT_LENGTH, MIN_SIZE, MIN_SLOPE } from './limits';

export { MAX_NODES, MIN_NODES, MIN_SEGMENT_LENGTH } from './limits';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function segmentLength(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 中心线拓扑检查：每段长度、重复节点、非相邻段的相交/接触/共线重叠。
 * 首尾闭合的环形中心线（closed=true）里，末点回到首点是闭合标记：
 * 它不算重复节点，首段与末段也互为相邻而不算接触，其余规则不变。
 */
function centerlineIssues(points: Point2[], closed: boolean, fail: (suffix: string, message: string) => void): void {
  for (let i = 0; i + 1 < points.length; i++) {
    if (!(segmentLength(points[i]!, points[i + 1]!) > MIN_SEGMENT_LENGTH)) {
      fail('points', `第 ${i + 1} 段中心线长度必须大于 ${MIN_SEGMENT_LENGTH}m`);
    }
  }
  const lastSegment = points.length - 2;
  for (let i = 0; i + 1 < points.length; i++) {
    for (let k = i + 2; k + 1 < points.length; k++) {
      if (closed && i === 0 && k === lastSegment) continue;
      if (segmentsTouch(points[i]!, points[i + 1]!, points[k]!, points[k + 1]!)) {
        fail(`points[${k}]`, `第 ${i + 1} 段与第 ${k + 1} 段相交、接触或共线重叠`);
      }
    }
  }
  for (let k = 1; k < points.length; k++) {
    for (let m = 0; m < k; m++) {
      if (closed && k === points.length - 1 && m === 0) continue;
      if (segmentLength(points[m]!, points[k]!) <= EPSILON) {
        fail(`points[${k}]`, `第 ${k + 1} 个节点与第 ${m + 1} 个节点重合，折线不允许重复节点`);
      }
    }
  }
}

/**
 * 校验单条基槽的节点、截面参数与偏移轮廓，成功后重建白名单字段。
 * id 由调用方在通过唯一性检查后传入，错误包含字段路径与中文原因；
 * 偏移失效的错误定位到具体节点或线段，不做静默删除节点、截短或改坡比。
 */
export function validateTrench(input: Record<string, unknown>, id: string, path: string): Result<Trench> {
  const issues: ValidationIssue[] = [];
  const fail = (suffix: string, message: string): void => { issues.push({ code: 'invalid', path: `${path}.${suffix}`, message }); };
  const coordinate = (value: unknown, suffix: string): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) {
      fail(suffix, `必须是 ±${MAX_COORDINATE} 范围内的有限数值`);
      return null;
    }
    return value;
  };
  const measure = (key: string, min: number, max: number): number | null => {
    const value = input[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      fail(key, `必须是 ${min}～${max} 范围内的有限数值`);
      return null;
    }
    return value;
  };

  const source = input.points;
  if (!Array.isArray(source) || source.length < MIN_NODES || source.length > MAX_NODES) {
    fail('points', `基槽节点数量必须为 ${MIN_NODES}～${MAX_NODES}`);
    return { ok: false, issues };
  }
  const nodes = source.map((node: unknown, i: number): Point2 | null => {
    if (!record(node)) { fail(`points[${i}]`, '节点必须是 { x, y } 对象'); return null; }
    const x = coordinate(node.x, `points[${i}].x`), y = coordinate(node.y, `points[${i}].y`);
    return x === null || y === null ? null : { x, y };
  });
  const bottomWidth = measure('bottomWidth', MIN_SIZE, MAX_SIZE);
  const depth = measure('depth', MIN_SIZE, MAX_SIZE);
  const slope = measure('slope', MIN_SLOPE, MAX_SLOPE);
  if (nodes.includes(null) || bottomWidth === null || depth === null || slope === null) return { ok: false, issues };

  const points = nodes.filter((node): node is Point2 => node !== null);
  // 闭合标记写入规范坐标：末点与首点完全一致，几何与地面开孔才能严丝合缝。
  const closed = isClosedRing(points);
  if (closed) points[points.length - 1] = { x: points[0]!.x, y: points[0]!.y };
  centerlineIssues(points, closed, fail);
  if (!issues.length) {
    try {
      trenchOutlines({ id, type: 'trench', points, bottomWidth, depth, slope });
    } catch (error) {
      if (!(error instanceof GeometryError)) throw error;
      fail(error.node === null ? 'points' : `points[${error.node}]`, error.message);
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { id, type: 'trench', points, bottomWidth, depth, slope } };
}
