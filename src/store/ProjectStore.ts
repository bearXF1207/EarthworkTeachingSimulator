import { emptyProject } from '../core/model/project';
import type { ExcavationElement, Project, Result } from '../core/model/project';
import { validateProject } from '../core/validation/project';

export type Command = { type: 'add'; element: ExcavationElement } | { type: 'update'; element: ExcavationElement } |
  { type: 'delete'; id: string } | { type: 'grid'; visible: boolean };
export type Prepared = { commit: () => void; dispose: () => void };
export class ProjectStore {
  private project = emptyProject();
  getSnapshot(): Project { return structuredClone(this.project); }
  dispatch(command: Command, prepare: (project: Project) => Prepared): Result<Project> {
    const next = this.getSnapshot();
    if (command.type === 'add') next.elements.push(command.element);
    else if (command.type === 'grid') next.settings.gridVisible = command.visible;
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
