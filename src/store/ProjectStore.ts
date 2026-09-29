import { CommandManager, HISTORY_LIMIT } from '../core/commands/commandManager';
import { isClosedRing } from '../core/geometry/trenchOutline';
import { trimEndsToNeighbours } from '../core/geometry/trenchTrim';
import { serializeProject } from '../core/io/projectSchema';
import { emptyProject } from '../core/model/project';
import type { ExcavationElement, Project, Result } from '../core/model/project';
import { openingOf, validateProject } from '../core/validation/project';

export type Command = { type: 'add'; element: ExcavationElement } | { type: 'update'; element: ExcavationElement } |
  { type: 'delete'; id: string } | { type: 'grid'; visible: boolean } | { type: 'snap'; enabled: boolean };
export type Prepared = { commit: () => void; dispose: () => void };
/** 准备渲染资源：由场景层提供；撤销、重做、打开与新建都复用同一入口，不复用已释放的 Mesh。 */
export type PrepareProject = (project: Project) => Prepared;

/**
 * 新建基槽时按相邻开挖对象的槽顶边界自动收边：
 * 绘制中中心线可以吸附到相邻基槽的中心，确认后收边到对方槽顶边界，
 * 多条基槽的开口因此只共边接触、相互贯通而不交叠。
 * 环形基槽（首尾闭合）没有端部，不做收边，仍按开口冲突规则判定。
 * 返回 null 表示整条中心线都落在相邻槽内，无法生成。
 */
function trimForConnection(element: ExcavationElement, existing: ExcavationElement[]): ExcavationElement | null {
  if (element.type !== 'trench' || isClosedRing(element.points)) return element;
  const neighbours = existing
    .filter(other => other.id !== element.id && other.type !== 'circular-pit')
    .map(other => {
      const opening = openingOf(other);
      return opening.island ? { ring: opening.ring, island: opening.island } : { ring: opening.ring };
    });
  const halfWidth = element.bottomWidth / 2 + element.depth * element.slope;
  const points = trimEndsToNeighbours(element.points, halfWidth, neighbours);
  return points ? { ...element, points } : null;
}

const noHistory = (message: string): Result<never> => ({ ok: false, issues: [{ code: 'history', path: '', message }] });

/**
 * 文档 store：唯一的项目状态入口。
 * 所有已提交动作经 `dispatch` 校验并原子交换渲染资源，同时记录最多 50 步撤销历史；
 * 保存状态只比较稳定序列化内容，避免撤销后的新分支复用历史步数而误判已保存。
 */
export class ProjectStore {
  private project = emptyProject();
  private readonly history = new CommandManager<Project>(HISTORY_LIMIT);
  private savedText = serializeProject(emptyProject());

  getSnapshot(): Project { return structuredClone(this.project); }
  get canUndo(): boolean { return this.history.canUndo; }
  get canRedo(): boolean { return this.history.canRedo; }
  get undoDepth(): number { return this.history.undoDepth; }
  /** 稳定序列化的当前文档文本：保存与“确认已导出”比对同一份快照。 */
  snapshotText(): string { return serializeProject(this.project); }
  /** 是否有未保存修改：只以实际保存内容为基线，恢复相同内容后即为干净。 */
  isDirty(): boolean {
    return this.snapshotText() !== this.savedText;
  }

  /** 校验候选、准备并交换渲染资源；失败保留原工程、原 Mesh 与选择状态。 */
  private applyValidated(candidate: Project, prepare: PrepareProject): Result<Project> {
    let prepared: Prepared | undefined;
    try {
      prepared = prepare(candidate);
      prepared.commit(); // Prepared 的 commit 同步交换已建好的资源。
    } catch {
      prepared?.dispose();
      return { ok: false, issues: [{ code: 'render', path: '', message: '几何构建失败，已保留原工程与场景' }] };
    }
    this.project = candidate;
    return { ok: true, value: this.getSnapshot() };
  }

  dispatch(command: Command, prepare: PrepareProject): Result<Project> {
    const previous = this.getSnapshot();
    if (command.type === 'add') {
      const element = trimForConnection(command.element, previous.elements);
      // 岛内（含环形基槽围出的岛）允许继续开槽；只有整条中心线都压在相邻槽带里才算重复开挖。
      if (!element) return { ok: false, issues: [{ code: 'invalid', path: 'elements', message: '中心线整段落在相邻开挖的槽带内，与既有开挖重叠：请从槽带外起画，或改用属性面板调整既有对象' }] };
      command = { ...command, element };
    }
    const next = this.getSnapshot();
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
    // 无变化的命令（重复设置同一开关、把参数改回原值）不占历史、不重建场景。
    if (serializeProject(validated.value) === serializeProject(previous)) return { ok: true, value: this.getSnapshot() };
    const applied = this.applyValidated(validated.value, prepare);
    if (!applied.ok) return applied;
    this.history.record(previous);
    return applied;
  }

  undo(prepare: PrepareProject): Result<Project> { return this.step('undo', prepare); }
  redo(prepare: PrepareProject): Result<Project> { return this.step('redo', prepare); }

  /**
   * 撤销/重做：先用目标状态完成校验与资源准备，成功后才移动历史栈，
   * 因此准备失败不会破坏可撤销步骤，也不会出现“历史动了但画面没变”。
   */
  private step(direction: 'undo' | 'redo', prepare: PrepareProject): Result<Project> {
    const target = direction === 'undo' ? this.history.peekUndo() : this.history.peekRedo();
    if (!target) return noHistory(direction === 'undo' ? '没有可撤销的操作' : '没有可重做的操作');
    const validated = validateProject(structuredClone(target));
    if (!validated.ok) return validated;
    const previous = this.getSnapshot();
    const applied = this.applyValidated(validated.value, prepare);
    if (!applied.ok) return applied;
    if (direction === 'undo') this.history.commitUndo(previous);
    else this.history.commitRedo(previous);
    return applied;
  }

  /**
   * 新建/打开：建立**新的项目会话**——原子替换项目、清空历史并重置保存基线。
   * 校验或资源准备失败时保留原会话（不是先清空再尝试加载）。
   */
  load(project: Project, prepare: PrepareProject): Result<Project> {
    const validated = validateProject(structuredClone(project));
    if (!validated.ok) return validated;
    const applied = this.applyValidated(validated.value, prepare);
    if (!applied.ok) return applied;
    this.history.clear();
    this.savedText = serializeProject(validated.value);
    return applied;
  }

  /** 新建空工程（会话同 `load`）。 */
  reset(prepare: PrepareProject): Result<Project> { return this.load(emptyProject(), prepare); }

  /**
   * 保存成功，或用户明确确认已导出后，把**被写入的那份文本**设为新的保存基线。
   * 若等待期间文档已被修改，基线仍指向已写出的快照，界面保持 dirty。
   */
  markSaved(text: string): void {
    this.savedText = text;
  }
}
