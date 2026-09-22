import { outline } from '../geometry/pitOutline';
import type { Pit, Point2, Project, Result, ValidationIssue } from '../model/project';
import { normalizeDegrees } from '../model/project';

export const EPSILON = 1e-7;
export function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function inside(p: Point2, ring: Point2[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (distanceToSegment(p, a, b) <= EPSILON) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}
function segmentsTouch(a: Point2, b: Point2, c: Point2, d: Point2): boolean {
  const cross = (p: Point2, q: Point2, r: Point2): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return Math.min(distanceToSegment(a, c, d), distanceToSegment(b, c, d), distanceToSegment(c, a, b), distanceToSegment(d, a, b)) <= EPSILON ||
    (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0);
}
export function openingsConflict(a: Pit, b: Pit): boolean {
  if (a.type === 'circular-pit') {
    const r = a.bottomDiameter / 2 + a.depth * a.slope;
    if (b.type === 'circular-pit') return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) <= r + b.bottomDiameter / 2 + b.depth * b.slope + EPSILON;
    const ring = outline(b, true);
    return inside(a.position, ring) || ring.some((p, i) => distanceToSegment(a.position, p, ring[(i + 1) % ring.length]!) <= r + EPSILON);
  }
  if (b.type === 'circular-pit') return openingsConflict(b, a);
  const ar = outline(a, true), br = outline(b, true);
  return inside(ar[0]!, br) || inside(br[0]!, ar) || ar.some((p, i) => br.some((q, j) => segmentsTouch(p, ar[(i + 1) % ar.length]!, q, br[(j + 1) % br.length]!)));
}
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function validateProject(input: unknown): Result<Project> {
  const issues: ValidationIssue[] = [];
  const fail = (path: string, message: string): void => { issues.push({ code: 'invalid', path, message }); };
  const number = (v: unknown, path: string, min: number, max: number): void => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) fail(path, `必须是 ${min}～${max} 范围内的有限数值`);
  };
  if (!record(input)) return { ok: false, issues: [{ code: 'invalid', path: '', message: '工程必须是对象' }] };
  if (input.version !== 1) fail('version', '仅支持版本 1');
  if (input.units !== 'm') fail('units', '单位必须为米');
  if (typeof input.name !== 'string' || !input.name.trim()) fail('name', '工程名称不能为空');
  const settings = input.settings;
  if (!record(settings)) fail('settings', '缺少场地设置');
  else {
    for (const key of ['gridVisible', 'snapEnabled']) if (typeof settings[key] !== 'boolean') fail(`settings.${key}`, '必须是布尔值');
    if (settings.snapSpacing !== 1) fail('settings.snapSpacing', '网格间距必须为 1m');
    number(settings.groundSize, 'settings.groundSize', 100, 22000);
  }
  if (!Array.isArray(input.elements) || input.elements.length > 500) fail('elements', '对象数组最多允许 500 个对象');
  else {
    const ids = new Set<string>();
    input.elements.forEach((e: unknown, i: number) => {
      const path = `elements[${i}]`;
      if (!record(e)) { fail(path, '对象格式错误'); return; }
      if (typeof e.id !== 'string' || !e.id.trim() || ids.has(e.id)) fail(`${path}.id`, '对象 ID 必须非空且唯一');
      else ids.add(e.id);
      if (!['square-pit', 'rect-pit', 'circular-pit'].includes(String(e.type))) { fail(`${path}.type`, '当前阶段仅支持三类基坑'); return; }
      if (!record(e.position)) fail(`${path}.position`, '缺少位置');
      else for (const key of ['x', 'y']) number(e.position[key], `${path}.position.${key}`, -10000, 10000);
      number(e.depth, `${path}.depth`, .02, 1000); number(e.slope, `${path}.slope`, 0, 5);
      const dimensions = e.type === 'square-pit' ? ['bottomSize'] : e.type === 'rect-pit' ? ['bottomLength', 'bottomWidth'] : ['bottomDiameter'];
      for (const key of dimensions) number(e[key], `${path}.${key}`, .02, 1000);
      if (e.type !== 'circular-pit') number(e.rotation, `${path}.rotation`, -Number.MAX_VALUE, Number.MAX_VALUE);
    });
  }
  if (issues.length) return { ok: false, issues };
  // Reconstruct whitelisted JSON fields; caller-owned references never enter the store.
  const source = input as unknown as Project;
  const pits = (source.elements as Pit[]).map(e => {
    const base = { id: e.id, position: { x: e.position.x, y: e.position.y }, depth: e.depth, slope: e.slope };
    if (e.type === 'circular-pit') return { ...base, type: e.type, bottomDiameter: e.bottomDiameter };
    if (e.type === 'square-pit') return { ...base, type: e.type, bottomSize: e.bottomSize, rotation: normalizeDegrees(e.rotation) };
    return { ...base, type: e.type, bottomLength: e.bottomLength, bottomWidth: e.bottomWidth, rotation: normalizeDegrees(e.rotation) };
  });
  pits.forEach((pit, i) => {
    if (outline(pit, true).some(p => Math.abs(p.x) > 10000 || Math.abs(p.y) > 10000)) fail(`elements[${i}].position`, '顶部开口超出 ±10000m 坐标范围');
    for (let j = 0; j < i; j++) if (openingsConflict(pit, pits[j]!)) fail(`elements[${i}]`, `顶部开口与 ${pits[j]!.id} 重叠、包含或相切`);
  });
  return issues.length ? { ok: false, issues } : { ok: true, value: { version: 1, name: source.name, units: 'm', elements: pits,
    settings: { gridVisible: source.settings.gridVisible, snapEnabled: source.settings.snapEnabled, snapSpacing: 1, groundSize: source.settings.groundSize } } };
}
