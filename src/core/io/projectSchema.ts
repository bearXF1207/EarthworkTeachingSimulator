import type { ExcavationElement, Pit, Point2, Project, Result, ValidationIssue } from '../model/project';
import { validateProject } from '../validation/project';
import { MAX_ELEMENTS, MAX_NODES } from '../validation/limits';

/**
 * M8 项目文件（`.excavation`，version 1）：序列化与 `unknown` 输入的反序列化。
 * 反序列化是**原子操作**：先检查形状/version/units，再逐字段白名单重建，
 * 最后交给 `validateProject` 做数值、拓扑与开口校验；任何一步失败都返回 issues，
 * 调用方不得用半成品替换当前工程（不是"先清空再逐个尝试加载"）。
 */

export const PROJECT_VERSION = 1;
export const PROJECT_FILE_EXTENSION = '.excavation';
/** 解析前的文件大小上限（字符数）：先挡掉超大输入，再 parse。 */
export const MAX_FILE_CHARACTERS = 8 * 1024 * 1024;
const MAX_NAME_LENGTH = 200;
const MAX_ID_LENGTH = 80;

const fail = (path: string, message: string): Result<never> => ({ ok: false, issues: [{ code: 'invalid', path, message }] });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** 只按字段名取有限数值；缺失、非数值、NaN/Infinity 都记 issue 并返回 0 占位（整体最终会被拒绝）。 */
function num(source: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): number {
  const value = source[key];
  if (!isFiniteNumber(value)) {
    issues.push({ code: 'invalid', path: `${path}.${key}`, message: `字段 ${key} 必须是有限数值` });
    return 0;
  }
  return value;
}

function point(value: unknown, path: string, issues: ValidationIssue[]): Point2 {
  if (!isRecord(value)) {
    issues.push({ code: 'invalid', path, message: '坐标必须是 {x,y} 对象' });
    return { x: 0, y: 0 };
  }
  return { x: num(value, 'x', path, issues), y: num(value, 'y', path, issues) };
}

function element(value: unknown, path: string, issues: ValidationIssue[]): ExcavationElement | null {
  if (!isRecord(value)) {
    issues.push({ code: 'invalid', path, message: '开挖对象必须是对象' });
    return null;
  }
  const id = value.id;
  if (!isText(id) || id.length > MAX_ID_LENGTH) {
    issues.push({ code: 'invalid', path: `${path}.id`, message: 'id 必须是非空字符串且不超过 80 字符' });
    return null;
  }
  const position = () => point(value.position, `${path}.position`, issues);
  const base = { depth: num(value, 'depth', path, issues), slope: num(value, 'slope', path, issues) };
  switch (value.type) {
    case 'trench': {
      const points = value.points;
      if (!Array.isArray(points) || points.length < 2 || points.length > MAX_NODES) {
        issues.push({ code: 'limit', path: `${path}.points`, message: `节点数必须在 2–${MAX_NODES} 之间` });
        return null;
      }
      return {
        id, type: 'trench', points: points.map((entry, index) => point(entry, `${path}.points[${index}]`, issues)),
        bottomWidth: num(value, 'bottomWidth', path, issues), ...base,
      };
    }
    case 'square-pit':
      return { id, type: 'square-pit', position: position(), bottomSize: num(value, 'bottomSize', path, issues),
        rotation: num(value, 'rotation', path, issues), ...base } as Pit;
    case 'rect-pit':
      return { id, type: 'rect-pit', position: position(), bottomLength: num(value, 'bottomLength', path, issues),
        bottomWidth: num(value, 'bottomWidth', path, issues), rotation: num(value, 'rotation', path, issues), ...base } as Pit;
    case 'circular-pit':
      return { id, type: 'circular-pit', position: position(), bottomDiameter: num(value, 'bottomDiameter', path, issues), ...base } as Pit;
    default:
      issues.push({ code: 'invalid', path: `${path}.type`, message: `未知的开挖类型 ${JSON.stringify(value.type)}（v${PROJECT_VERSION} 只支持 trench / square-pit / rect-pit / circular-pit）` });
      return null;
  }
}

/** 稳定序列化：字段顺序固定，便于比对“内容是否改变”并写出可重复的保存基线。 */
export function serializeProject(project: Project): string {
  const ordered = {
    version: project.version,
    name: project.name,
    units: project.units,
    elements: project.elements.map(element => element.type === 'trench'
      ? { id: element.id, type: element.type, points: element.points.map(p => ({ x: p.x, y: p.y })),
        bottomWidth: element.bottomWidth, depth: element.depth, slope: element.slope }
      : element.type === 'circular-pit'
        ? { id: element.id, type: element.type, position: { x: element.position.x, y: element.position.y },
          bottomDiameter: element.bottomDiameter, depth: element.depth, slope: element.slope }
        : element.type === 'square-pit'
          ? { id: element.id, type: element.type, position: { x: element.position.x, y: element.position.y },
            bottomSize: element.bottomSize, depth: element.depth, slope: element.slope, rotation: element.rotation }
          : { id: element.id, type: element.type, position: { x: element.position.x, y: element.position.y },
            bottomLength: element.bottomLength, bottomWidth: element.bottomWidth, depth: element.depth,
            slope: element.slope, rotation: element.rotation }),
    settings: {
      gridVisible: project.settings.gridVisible, snapEnabled: project.settings.snapEnabled,
      snapSpacing: project.settings.snapSpacing, groundSize: project.settings.groundSize,
    },
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/**
 * 解析项目文件文本。返回的 Project 已通过完整工程校验；失败时原工程必须保持不变。
 * 未知字段按白名单忽略（不猜测未来格式）；缺字段、错 units、未知类型一律拒绝。
 */
export function parseProject(text: string): Result<Project> {
  if (typeof text !== 'string' || text.trim().length === 0) return fail('', '文件为空');
  if (text.length > MAX_FILE_CHARACTERS) return fail('', '文件过大，已拒绝解析');
  let raw: unknown;
  try { raw = JSON.parse(text) as unknown; }
  catch { return fail('', 'JSON 解析失败：文件不是合法 JSON'); }
  if (!isRecord(raw)) return fail('', '项目根必须是对象');
  if (raw.version !== PROJECT_VERSION) {
    const detail = isFiniteNumber(raw.version) && raw.version > PROJECT_VERSION
      ? `不支持的项目版本 ${raw.version}：当前只支持 version=${PROJECT_VERSION}，请勿用旧版打开未来格式`
      : `缺少或非法 version：version=${PROJECT_VERSION} 的文件必须显式声明 version`;
    return fail('version', detail);
  }
  if (raw.units !== 'm') return fail('units', `units 必须是 'm'，收到 ${JSON.stringify(raw.units)}`);
  if (!isText(raw.name) || raw.name.length > MAX_NAME_LENGTH) return fail('name', `name 必须是非空字符串且不超过 ${MAX_NAME_LENGTH} 字符`);
  if (!Array.isArray(raw.elements)) return fail('elements', 'elements 必须是数组');
  if (raw.elements.length > MAX_ELEMENTS) return fail('elements', `开挖对象数量超过上限 ${MAX_ELEMENTS}`);
  if (!isRecord(raw.settings)) return fail('settings', 'settings 必须是对象');
  const settings = raw.settings;
  if (typeof settings.gridVisible !== 'boolean' || typeof settings.snapEnabled !== 'boolean') {
    return fail('settings', 'settings.gridVisible 与 settings.snapEnabled 必须是布尔值');
  }
  if (settings.snapSpacing !== 1) return fail('settings.snapSpacing', 'settings.snapSpacing 必须是 1');
  if (!isFiniteNumber(settings.groundSize)) return fail('settings.groundSize', 'settings.groundSize 必须是有限数值');

  const issues: ValidationIssue[] = [];
  const elements: ExcavationElement[] = [];
  raw.elements.forEach((entry, index) => {
    const parsed = element(entry, `elements[${index}]`, issues);
    if (parsed) elements.push(parsed);
  });
  const ids = new Set<string>();
  for (const item of elements) {
    if (ids.has(item.id)) issues.push({ code: 'duplicate', path: 'elements', message: `id ${item.id} 重复` });
    ids.add(item.id);
  }
  if (issues.length) return { ok: false, issues };

  const project: Project = {
    version: PROJECT_VERSION, name: raw.name, units: 'm', elements,
    settings: { gridVisible: settings.gridVisible, snapEnabled: settings.snapEnabled, snapSpacing: 1, groundSize: settings.groundSize },
  };
  return validateProject(project);
}
