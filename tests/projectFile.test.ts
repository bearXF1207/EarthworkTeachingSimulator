import { describe, expect, it } from 'vitest';
import { MAX_FILE_CHARACTERS, parseProject, serializeProject } from '../src/core/io/projectSchema';
import { emptyProject } from '../src/core/model/project';
import type { ExcavationElement, Pit, Point2, Project, Trench } from '../src/core/model/project';
import { totalVolume } from '../src/core/calculation/quantities';
import { validateProject } from '../src/core/validation/project';
import { ProjectStore } from '../src/store/ProjectStore';

const p = (x: number, y: number): Point2 => ({ x, y });
const trench = (id: string, points: Point2[]): Trench =>
  ({ id, type: 'trench', points, bottomWidth: 2, depth: 2, slope: .5 });
const square = (id: string, x: number, y: number): Pit =>
  ({ id, type: 'square-pit', position: p(x, y), bottomSize: 4, depth: 2, slope: .5, rotation: 30 });
const rect = (id: string, x: number, y: number): Pit =>
  ({ id, type: 'rect-pit', position: p(x, y), bottomLength: 6, bottomWidth: 4, depth: 1.5, slope: .25, rotation: -15 });
const circle = (id: string, x: number, y: number): Pit =>
  ({ id, type: 'circular-pit', position: p(x, y), bottomDiameter: 4, depth: 2, slope: .5 });

/** 三类基坑、直槽与折线槽各一，互不重叠，覆盖文件往返的全部字段。 */
const sample = (): Project => ({
  ...emptyProject(), name: '往返样例',
  elements: [trench('t-straight', [p(-40, 0), p(-20, 0)]), trench('t-poly', [p(-40, 20), p(-30, 20), p(-30, 30)]),
    square('p-square', 20, 0), rect('p-rect', 20, 30), circle('p-circle', -20, -30)],
});

const prepareStub = (): { commit: () => void; dispose: () => void } => ({ commit: () => undefined, dispose: () => undefined });
const withText = (project: Project, edit: (raw: Record<string, unknown>) => void): string => {
  const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>;
  edit(raw);
  return JSON.stringify(raw);
};

describe('M8 项目文件：序列化与严格反序列化', () => {
  it('保存再打开后参数、id、位置、旋转、设置与预计体积一致，且不含渲染对象', () => {
    // 工程里保存的始终是通过校验的规范化数据（角度会正规化），因此以校验结果为往返基线。
    const validated = validateProject(sample());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    const before = validated.value;
    const text = serializeProject(before);
    for (const forbidden of ['Mesh', 'geometry', 'material', 'Scene', 'camera', 'selected']) {
      expect(text).not.toContain(forbidden);
    }
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(before);
    expect(parsed.value.settings).toEqual(before.settings);
    expect(totalVolume(parsed.value.elements)).toBeCloseTo(totalVolume(before.elements), 10);
    // 二次往返稳定：稳定序列化保证文本逐字节一致
    expect(serializeProject(parsed.value)).toBe(text);
  });

  it('未知额外字段按白名单忽略，不进入重建后的项目', () => {
    const text = withText(sample(), raw => {
      raw.extra = { anything: true };
      (raw.settings as Record<string, unknown>).theme = 'dark';
      const elements = raw.elements as Record<string, unknown>[];
      elements[0]!.note = '备注';
    });
    const parsed = parseProject(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.keys(parsed.value).sort()).toEqual(['elements', 'name', 'settings', 'units', 'version']);
    expect(Object.keys(parsed.value.settings).sort()).toEqual(['gridVisible', 'groundSize', 'snapEnabled', 'snapSpacing']);
    expect(Object.keys(parsed.value.elements[0]!).sort()).toEqual(['bottomWidth', 'depth', 'id', 'points', 'slope', 'type']);
  });

  it('拒绝非法 JSON、空文件与超大输入', () => {
    expect(parseProject('{ not json').ok).toBe(false);
    expect(parseProject('   ').ok).toBe(false);
    expect(parseProject(`{"version":1,${'x'.repeat(MAX_FILE_CHARACTERS)}`).ok).toBe(false);
  });

  it('拒绝缺失/未来 version、错误 units 与非法 name', () => {
    const missing = parseProject(JSON.stringify({ ...JSON.parse(serializeProject(emptyProject())) as object, version: undefined }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.issues[0]?.message).toContain('version');
    const future = parseProject(withText(emptyProject(), raw => { raw.version = 999; }));
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.issues[0]?.message).toContain('不支持的项目版本');
    const units = parseProject(withText(emptyProject(), raw => { raw.units = 'mm'; }));
    expect(units.ok).toBe(false);
    if (!units.ok) expect(units.issues[0]?.path).toBe('units');
    expect(parseProject(withText(emptyProject(), raw => { raw.name = ''; })).ok).toBe(false);
  });

  it('拒绝未知类型、重复 id、超量对象与非有限/错误类型字段', () => {
    const unknown = parseProject(withText(sample(), raw => { (raw.elements as Record<string, unknown>[])[0]!.type = 'ditch'; }));
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.issues.some(issue => issue.message.includes('未知的开挖类型'))).toBe(true);
    const duplicate = parseProject(withText(sample(), raw => { (raw.elements as Record<string, unknown>[])[1]!.id = 't-straight'; }));
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.issues.some(issue => issue.message.includes('重复'))).toBe(true);
    const many = { ...emptyProject(), elements: Array.from({ length: 501 }, (_, index) => square(`p-${index}`, index * 10, 0)) };
    expect(parseProject(serializeProject(many)).ok).toBe(false);
    const badNumber = parseProject(withText(sample(), raw => { (raw.elements as Record<string, unknown>[])[0]!.depth = '2'; }));
    expect(badNumber.ok).toBe(false);
    if (!badNumber.ok) expect(badNumber.issues.some(issue => issue.message.includes('有限数值'))).toBe(true);
    const nan = parseProject(serializeProject(sample()).replace('"depth": 2', '"depth": null'));
    expect(nan.ok).toBe(false);
  });

  it('拒绝超节点数、错误 settings 与几何非法内容', () => {
    const tooManyNodes = parseProject(serializeProject({
      ...emptyProject(), elements: [{ ...trench('t', []), points: Array.from({ length: 201 }, (_, i) => p(i, 0)) }],
    }));
    expect(tooManyNodes.ok).toBe(false);
    if (!tooManyNodes.ok) expect(tooManyNodes.issues[0]?.message).toContain('节点数');
    expect(parseProject(withText(emptyProject(), raw => { delete raw.settings; })).ok).toBe(false);
    expect(parseProject(withText(emptyProject(), raw => { (raw.settings as Record<string, unknown>).snapSpacing = 2; })).ok).toBe(false);
    expect(parseProject(withText(emptyProject(), raw => { (raw.settings as Record<string, unknown>).groundSize = 'big'; })).ok).toBe(false);
    // 几何校验复用 validateProject：自交中心线（八字形）与重合开口都必须被拒
    const crossing = parseProject(serializeProject({
      ...emptyProject(), elements: [trench('t-cross', [p(0, 0), p(20, 20), p(20, 0), p(0, 20)])],
    }));
    expect(crossing.ok).toBe(false);
    const overlap = parseProject(serializeProject({ ...emptyProject(), elements: [square('a', 0, 0), square('b', 1, 1)] }));
    expect(overlap.ok).toBe(false);
  });

  it('打开失败保持原工程：load 是原子操作', () => {
    const store = new ProjectStore();
    store.dispatch({ type: 'add', element: trench('keep', [p(-40, 0), p(-20, 0)]) }, prepareStub);
    const before = store.snapshotText();
    const broken: ExcavationElement[] = [square('x', 0, 0), square('y', 1, 1)];
    const loaded = store.load({ ...emptyProject(), elements: broken }, prepareStub);
    expect(loaded.ok).toBe(false);
    expect(store.snapshotText()).toBe(before);
    expect(store.undoDepth).toBe(1);
  });
});
