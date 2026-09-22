import { outline } from '../geometry/pitOutline';
import { distanceToSegment, edgesProperlyCross, inside, ringsOverlap, segmentsTouch } from '../geometry/polygon';
import { trenchOutlines } from '../geometry/trenchOutline';
import type { ExcavationElement, Point2, Project, Result, ValidationIssue } from '../model/project';
import { normalizeDegrees } from '../model/project';
import { EPSILON, MAX_COORDINATE, MAX_ELEMENTS, MAX_SIZE, MAX_SLOPE, MIN_SIZE, MIN_SLOPE } from './limits';
import { validateTrench } from './trench';

export { EPSILON } from './limits';
// 平面谓词与几何模块共用一份实现，避免开口判定和轮廓校验出现两套容差。
export { distanceToSegment, inside };

type CircleOpening = { x: number; y: number; radius: number };
/** 顶部开口：统一用逆时针轮廓描述边界，圆坑额外保留解析半径，避免漏过内接弦之外的细小重叠。 */
/** 开挖对象在地面的开口：外圈 + 解析圆（圆坑），环形基槽再带一个内圈岛。 */
export type Opening = { ring: Point2[]; circle: CircleOpening | null; island?: Point2[] };

export function openingOf(element: ExcavationElement): Opening {
  if (element.type === 'circular-pit') return {
    ring: outline(element, true),
    circle: { x: element.position.x, y: element.position.y, radius: element.bottomDiameter / 2 + element.depth * element.slope },
  };
  if (element.type === 'trench') {
    const outlines = trenchOutlines(element);
    // 环形基槽的开口是“外圈减内圈岛”：岛仍属地面，允许继续在岛内开挖。
    return { ring: outlines.topOutline, circle: null, ...(outlines.topHole ? { island: outlines.topHole } : {}) };
  }
  return { ring: outline(element, true), circle: null };
}

/** 该环是否整体落在岛内（含贴边）：此时与外圈槽带没有交叠。 */
function insideIsland(ring: Point2[], island: Point2[]): boolean {
  return !edgesProperlyCross(ring, island) && ring.every(point => inside(point, island));
}

function ringTouchesCircle(ring: Point2[], circle: CircleOpening): boolean {
  const center = { x: circle.x, y: circle.y };
  return inside(center, ring) || ring.some((p, i) => distanceToSegment(center, p, ring[(i + 1) % ring.length]!) <= circle.radius + EPSILON);
}
function ringsTouch(a: Point2[], b: Point2[]): boolean {
  return inside(a[0]!, b) || inside(b[0]!, a) ||
    a.some((p, i) => b.some((q, j) => segmentsTouch(p, a[(i + 1) % a.length]!, q, b[(j + 1) % b.length]!)));
}
/**
 * 开口冲突判定。
 * 基槽之间允许边界接触（共边、共点、端面贴合），用于闭合连接；只有内部真正交叠才拒绝。
 * 基坑与基槽、基坑之间保持更严格的“重叠、包含或相切”判定。
 */
export function openingsConflict(a: ExcavationElement, b: ExcavationElement): boolean {
  const first = openingOf(a), second = openingOf(b);
  // 岛是地面：任一方的开口整体落在对方岛内时不冲突（允许在环形基槽的岛内继续开槽）。
  if (first.island && insideIsland(second.ring, first.island)) return false;
  if (second.island && insideIsland(first.ring, second.island)) return false;
  if (a.type === 'trench' && b.type === 'trench') return ringsOverlap(first.ring, second.ring);
  if (first.circle && second.circle) {
    return Math.hypot(first.circle.x - second.circle.x, first.circle.y - second.circle.y) <= first.circle.radius + second.circle.radius + EPSILON;
  }
  if (first.circle) return ringTouchesCircle(second.ring, first.circle);
  if (second.circle) return ringTouchesCircle(first.ring, second.circle);
  return ringsTouch(first.ring, second.ring);
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateProject(input: unknown): Result<Project> {
  const issues: ValidationIssue[] = [];
  const fail = (path: string, message: string): void => { issues.push({ code: 'invalid', path, message }); };
  const measure = (value: unknown, path: string, min: number, max: number): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      fail(path, `必须是 ${min}～${max} 范围内的有限数值`);
      return null;
    }
    return value;
  };
  if (!record(input)) return { ok: false, issues: [{ code: 'invalid', path: '', message: '工程必须是对象' }] };
  if (input.version !== 1) fail('version', '仅支持版本 1');
  if (input.units !== 'm') fail('units', '单位必须为米');
  const rawName = input.name;
  const name = typeof rawName === 'string' && rawName.trim() ? rawName : '';
  if (!name) fail('name', '工程名称不能为空');

  let settings: Project['settings'] | null = null;
  const rawSettings = input.settings;
  if (!record(rawSettings)) fail('settings', '缺少场地设置');
  else {
    for (const key of ['gridVisible', 'snapEnabled'] as const) if (typeof rawSettings[key] !== 'boolean') fail(`settings.${key}`, '必须是布尔值');
    if (rawSettings.snapSpacing !== 1) fail('settings.snapSpacing', '网格间距必须为 1m');
    const gridVisible = rawSettings.gridVisible, snapEnabled = rawSettings.snapEnabled;
    const groundSize = measure(rawSettings.groundSize, 'settings.groundSize', 100, 22000);
    if (!issues.length && typeof gridVisible === 'boolean' && typeof snapEnabled === 'boolean' && groundSize !== null) {
      settings = { gridVisible, snapEnabled, snapSpacing: 1, groundSize };
    }
  }

  const elements: ExcavationElement[] = [];
  if (!Array.isArray(input.elements) || input.elements.length > MAX_ELEMENTS) fail('elements', `对象数组最多允许 ${MAX_ELEMENTS} 个对象`);
  else {
    const ids = new Set<string>();
    input.elements.forEach((e: unknown, i: number) => {
      const path = `elements[${i}]`;
      if (!record(e)) { fail(path, '对象格式错误'); return; }
      const rawId = e.id;
      if (typeof rawId !== 'string' || !rawId.trim() || ids.has(rawId)) { fail(`${path}.id`, '对象 ID 必须非空且唯一'); return; }
      const id = rawId;
      ids.add(id);
      if (e.type === 'trench') {
        const checked = validateTrench(e, id, path);
        if (checked.ok) elements.push(checked.value); else issues.push(...checked.issues);
        return;
      }
      if (!['square-pit', 'rect-pit', 'circular-pit'].includes(String(e.type))) { fail(`${path}.type`, '仅支持三类基坑与基槽'); return; }
      const position = record(e.position) ? {
        x: measure(e.position.x, `${path}.position.x`, -MAX_COORDINATE, MAX_COORDINATE),
        y: measure(e.position.y, `${path}.position.y`, -MAX_COORDINATE, MAX_COORDINATE),
      } : null;
      if (!position || position.x === null || position.y === null) {
        if (!position) fail(`${path}.position`, '缺少位置');
        return;
      }
      const center = { x: position.x, y: position.y };
      const depth = measure(e.depth, `${path}.depth`, MIN_SIZE, MAX_SIZE);
      const slope = measure(e.slope, `${path}.slope`, MIN_SLOPE, MAX_SLOPE);
      if (depth === null || slope === null) return;
      if (e.type === 'square-pit') {
        const bottomSize = measure(e.bottomSize, `${path}.bottomSize`, MIN_SIZE, MAX_SIZE);
        const rotation = measure(e.rotation, `${path}.rotation`, -Number.MAX_VALUE, Number.MAX_VALUE);
        if (bottomSize === null || rotation === null) return;
        elements.push({ id, type: 'square-pit', position: center, depth, slope, bottomSize, rotation: normalizeDegrees(rotation) });
      } else if (e.type === 'rect-pit') {
        const bottomLength = measure(e.bottomLength, `${path}.bottomLength`, MIN_SIZE, MAX_SIZE);
        const bottomWidth = measure(e.bottomWidth, `${path}.bottomWidth`, MIN_SIZE, MAX_SIZE);
        const rotation = measure(e.rotation, `${path}.rotation`, -Number.MAX_VALUE, Number.MAX_VALUE);
        if (bottomLength === null || bottomWidth === null || rotation === null) return;
        elements.push({ id, type: 'rect-pit', position: center, depth, slope, bottomLength, bottomWidth, rotation: normalizeDegrees(rotation) });
      } else {
        const bottomDiameter = measure(e.bottomDiameter, `${path}.bottomDiameter`, MIN_SIZE, MAX_SIZE);
        if (bottomDiameter === null) return;
        elements.push({ id, type: 'circular-pit', position: center, depth, slope, bottomDiameter });
      }
    });
  }
  if (issues.length) return { ok: false, issues };
  if (!settings) return { ok: false, issues: [{ code: 'invalid', path: 'settings', message: '缺少场地设置' }] };
  // 派生坐标与开口关系校验：顶部开口必须在坐标范围内，且与更早的元素不重叠、不包含、不相切。
  elements.forEach((element, i) => {
    if (openingOf(element).ring.some(p => Math.abs(p.x) > MAX_COORDINATE || Math.abs(p.y) > MAX_COORDINATE)) {
      fail(`elements[${i}].position`, `顶部开口超出 ±${MAX_COORDINATE}m 坐标范围`);
    }
    for (let j = 0; j < i; j++) {
      const other = elements[j]!;
      if (!openingsConflict(element, other)) continue;
      fail(`elements[${i}]`, element.type === 'trench' && other.type === 'trench'
        ? `顶部开口与 ${other.id} 内部交叠（基槽之间只允许边界接触：端点相接请吸附到对方端点，贴边请用贴合线；转角相接请并入同一条折线基槽，T 形分叉暂不支持）`
        : `顶部开口与 ${other.id} 重叠、包含或相切`);
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true,
    value: { version: 1, name, units: 'm', elements, settings } };
}
