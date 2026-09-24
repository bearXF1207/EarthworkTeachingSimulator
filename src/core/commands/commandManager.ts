/**
 * M8 撤销/重做栈：只保存**已提交**的文档快照，最多 50 步。
 * 输入打字、拖动中的中间态与相机变换都不是命令，不入栈；
 * 失败或无变化的命令由调用方判定后不调用 `record`。
 * `peek*` 与 `commit*` 分离，使"先准备几何、成功后再移动栈"成为可能：
 * 准备失败时历史栈保持原样，不会丢掉可撤销的步骤。
 */
export const HISTORY_LIMIT = 50;

export class CommandManager<T> {
  private readonly past: T[] = [];
  private readonly future: T[] = [];

  constructor(private readonly limit: number = HISTORY_LIMIT) {}

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  /** 当前可撤销步数（测试与界面提示用）。 */
  get undoDepth(): number { return this.past.length; }
  get redoDepth(): number { return this.future.length; }

  /** 记录一次已提交动作的**前一状态**，并清空重做分支。 */
  record(previous: T): void {
    this.past.push(previous);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }

  peekUndo(): T | undefined { return this.past[this.past.length - 1]; }
  peekRedo(): T | undefined { return this.future[this.future.length - 1]; }

  /** 撤销：把当前状态压入重做栈，返回目标状态。调用前应已用 `peekUndo` 完成准备。 */
  commitUndo(current: T): T | undefined {
    const target = this.past.pop();
    if (target === undefined) return undefined;
    this.future.push(current);
    return target;
  }

  /** 重做：把当前状态压回撤销栈（仍受限 50 步），返回目标状态。 */
  commitRedo(current: T): T | undefined {
    const target = this.future.pop();
    if (target === undefined) return undefined;
    this.past.push(current);
    if (this.past.length > this.limit) this.past.shift();
    return target;
  }

  clear(): void { this.past.length = 0; this.future.length = 0; }
}
