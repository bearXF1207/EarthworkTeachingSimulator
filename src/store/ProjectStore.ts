import { isClosedRing } from '../core/geometry/trenchOutline';
import { trimEndsToNeighbours } from '../core/geometry/trenchTrim';
import { emptyProject } from '../core/model/project';
import type { ExcavationElement, Project, Result } from '../core/model/project';
import { openingOf, validateProject } from '../core/validation/project';

export type Command = { type: 'add'; element: ExcavationElement } | { type: 'update'; element: ExcavationElement } |
  { type: 'delete'; id: string } | { type: 'grid'; visible: boolean } | { type: 'snap'; enabled: boolean };
export type Prepared = { commit: () => void; dispose: () => void };

/**
 * 新建基槽时按相邻开挖对象的槽顶边界自动收边：
 * 绘制中中心线可以吸附到相邻基槽的中心，确认后收边到对方槽顶边界，
 * 多条基槽的开口因此只共边接触、相互贯通而不交叠。
 * 环形基槽（首尾闭合）没有端部，不做收边，仍按开口冲突规则判定。
 * 返回 null 表示整条中心线都落在相邻槽内，无法生成。
 */
function trimForConnection(element: ExcavationElement, existing: ExcavationElement[]): ExcavationElement | null {
  if (element.type !== 'trench' || isClosedRing(element.points)) return element;
  const neighbourRings = existing
    .filter(other => other.id !== element.id && other.type !== 'circular-pit')
    .map(other => openingOf(other).ring);
  const halfWidth = element.bottomWidth / 2 + element.depth * element.slope;
  const points = trimEndsToNeighbours(element.points, halfWidth, neighbourRings);
  return points ? { ...element, points } : null;
}

export class ProjectStore {
  private project = emptyProject();
  getSnapshot(): Project { return structuredClone(this.project); }
  dispatch(command: Command, prepare: (project: Project) => Prepared): Result<Project> {
    const next = this.getSnapshot();
    if (command.type === 'add') {
      const element = trimForConnection(command.element, next.elements);
      if (!element) return { ok: false, issues: [{ code: 'invalid', path: 'elements', message: '中心线完全落在相邻开挖范围内，无法生成基槽' }] };
      command = { ...command, element };
    }
    if (command.type === 'add') next.elements.push(command.element);
    else if (command.type === 'grid') next.settings.gridVisible = command.visible;
    else if (command.type === 'snap') next.settings.snapEnabled = command.enabled;
    else {
      const id = command.type === 'delete' ? command.id : command.element.id;
      const index = next.elements.findIndex(e => e.id === id);
      if (index < 0) return { ok: false, issues: [{ code: 'missing', path: 'id', message: '对象不存在' }] };
      if (command.type === 'delete') next.elements.splice(index, 1);
      else next.elements[index] = command.element;
    }
    const validated = validateProject(next);
    if (!validated.ok) return validated;
    let prepared: Prepared | undefined;
    try {
      prepared = prepare(validated.value);
      prepared.commit(); // Prepared commit swaps already-built resources synchronously.
      this.project = validated.value;
      return { ok: true, value: this.getSnapshot() };
    } catch {
      prepared?.dispose();
      return { ok: false, issues: [{ code: 'render', path: '', message: '几何构建失败，已保留原工程与场景' }] };
    }
  }
}
