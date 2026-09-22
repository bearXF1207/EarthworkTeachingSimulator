import type { Point2, Result, Trench, ValidationIssue } from '../model/project';
import { MAX_COORDINATE, MAX_SIZE, MAX_SLOPE, MIN_SIZE, MIN_SLOPE } from './limits';

export const MIN_NODES = 2;
export const MAX_NODES = 200;
/** M3 只支持两个节点的直线基槽；M4 放宽到 2–200 段折线。 */
export const STRAIGHT_NODES = 2;
export const MIN_SEGMENT_LENGTH = 0.01;

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function segmentLength(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * 校验单条基槽的节点与截面参数，成功后重建白名单字段。
 * id 由调用方在通过唯一性检查后传入，错误包含字段路径与中文原因。
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
  if (source.length !== STRAIGHT_NODES) fail('points', `当前阶段仅支持 ${STRAIGHT_NODES} 个节点的直线基槽`);
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
  const first = points[0]!, last = points[points.length - 1]!;
  if (!(segmentLength(first, last) > MIN_SEGMENT_LENGTH)) fail('points', `每段中心线长度必须大于 ${MIN_SEGMENT_LENGTH}m`);
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { id, type: 'trench', points, bottomWidth, depth, slope } };
}
