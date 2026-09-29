import { describe, expect, it, vi } from 'vitest';
import { CommandManager, HISTORY_LIMIT } from '../src/core/commands/commandManager';
import { emptyProject } from '../src/core/model/project';
import type { Pit, Point2, Trench } from '../src/core/model/project';
import { ProjectStore } from '../src/store/ProjectStore';

const p = (x: number, y: number): Point2 => ({ x, y });
const trench = (id: string, points: Point2[]): Trench => ({ id, type: 'trench', points, bottomWidth: 2, depth: 2, slope: .5 });
const pit = (id: string, x: number): Pit =>
  ({ id, type: 'square-pit', position: p(x, 0), bottomSize: 4, depth: 2, slope: .5, rotation: 0 });
const prepare = (): { commit: () => void; dispose: () => void } => ({ commit: () => undefined, dispose: () => undefined });

describe('M8 撤销栈（纯数据结构）', () => {
  it('record/undo/redo 保持顺序，并在新记录后清空重做分支', () => {
    const history = new CommandManager<number>(3);
    history.record(1); history.record(2); history.record(3); history.record(4);
    expect(history.undoDepth).toBe(3); // 上限 3：最早的 1 被丢弃
    expect(history.commitUndo(5)).toBe(4);
    expect(history.commitUndo(4)).toBe(3);
    expect(history.peekRedo()).toBe(4);
    history.record(99); // 新动作清空重做
    expect(history.canRedo).toBe(false);
    expect(history.commitRedo(99)).toBeUndefined();
  });
});

describe('M8 编辑历史与 dirty', () => {
  it('创建→改参数→移动→删除可逐步撤销并重做，数据完全一致', () => {
    const store = new ProjectStore();
    expect(store.dispatch({ type: 'add', element: trench('t1', [p(0, 0), p(20, 0)]) }, prepare).ok).toBe(true);
    const created = store.getSnapshot();
    store.dispatch({ type: 'update', element: { ...created.elements[0]!, bottomWidth: 3 } as Trench }, prepare);
    const resized = store.getSnapshot();
    store.dispatch({ type: 'update', element: { ...resized.elements[0]!, points: [p(0, 0), p(30, 0)] } as Trench }, prepare);
    const moved = store.getSnapshot();
    store.dispatch({ type: 'delete', id: 't1' }, prepare);
    expect(store.getSnapshot().elements).toHaveLength(0);
    expect(store.undoDepth).toBe(4);

    expect(store.undo(prepare).ok).toBe(true);
    expect(store.getSnapshot()).toEqual(moved);
    expect(store.undo(prepare).ok).toBe(true);
    expect(store.getSnapshot()).toEqual(resized);
    expect(store.undo(prepare).ok).toBe(true);
    expect(store.getSnapshot()).toEqual(created);
    expect(store.undo(prepare).ok).toBe(true);
    expect(store.getSnapshot().elements).toHaveLength(0);
    expect(store.undo(prepare).ok).toBe(false); // 已到会话起点

    expect(store.redo(prepare).ok).toBe(true);
    expect(store.getSnapshot()).toEqual(created);
    expect(store.redo(prepare).ok).toBe(true);
    expect(store.redo(prepare).ok).toBe(true);
    expect(store.redo(prepare).ok).toBe(true);
    expect(store.getSnapshot()).toEqual({ ...emptyProject(), settings: store.getSnapshot().settings });
    expect(store.redo(prepare).ok).toBe(false);
  });

  it('连续 51 次有效编辑只保留最近 50 步，撤销不足时明确拒绝', () => {
    const store = new ProjectStore();
    for (let i = 0; i < 51; i++) expect(store.dispatch({ type: 'add', element: pit(`p-${i}`, i * 10) }, prepare).ok).toBe(true);
    expect(store.undoDepth).toBe(HISTORY_LIMIT);
    for (let i = 0; i < HISTORY_LIMIT; i++) expect(store.undo(prepare).ok).toBe(true);
    // 第 1 次创建已滑出 50 步窗口，无法再撤销
    expect(store.getSnapshot().elements).toHaveLength(1);
    expect(store.undo(prepare).ok).toBe(false);
  });

  it('撤销后的新编辑清空重做分支；无变化与失败命令都不占历史', () => {
    const store = new ProjectStore();
    store.dispatch({ type: 'add', element: trench('t1', [p(0, 0), p(20, 0)]) }, prepare);
    store.dispatch({ type: 'update', element: { ...store.getSnapshot().elements[0]!, bottomWidth: 4 } as Trench }, prepare);
    expect(store.undoDepth).toBe(2);
    expect(store.undo(prepare).ok).toBe(true);
    expect(store.canRedo).toBe(true);
    store.dispatch({ type: 'add', element: pit('p1', 60) }, prepare);
    expect(store.canRedo).toBe(false);

    const depth = store.undoDepth, snapshot = store.snapshotText();
    // 无变化：参数改回原值、重复设置同一开关
    expect(store.dispatch({ type: 'update', element: store.getSnapshot().elements[0] as Trench }, prepare).ok).toBe(true);
    expect(store.dispatch({ type: 'grid', visible: store.getSnapshot().settings.gridVisible }, prepare).ok).toBe(true);
    expect(store.undoDepth).toBe(depth);
    expect(store.snapshotText()).toBe(snapshot);
    // 失败：删除不存在的对象、新增与既有开口重叠的对象
    expect(store.dispatch({ type: 'delete', id: 'missing' }, prepare).ok).toBe(false);
    expect(store.dispatch({ type: 'add', element: pit('p1', 60) }, prepare).ok).toBe(false);
    expect(store.undoDepth).toBe(depth);
  });

  it('租户设置属于文档：网格开关可撤销，且计入 dirty', () => {
    const store = new ProjectStore();
    expect(store.dispatch({ type: 'grid', visible: false }, prepare).ok).toBe(true);
    expect(store.isDirty()).toBe(true);
    expect(store.undo(prepare).ok).toBe(true);
    expect(store.getSnapshot().settings.gridVisible).toBe(true);
    expect(store.isDirty()).toBe(false);
  });

  it('保存基线：保存→编辑→撤销回保存内容即干净，重做后再次变脏', () => {
    const store = new ProjectStore();
    expect(store.isDirty()).toBe(false); // 全新空工程是干净的
    store.dispatch({ type: 'add', element: trench('t1', [p(0, 0), p(20, 0)]) }, prepare);
    expect(store.isDirty()).toBe(true);
    store.markSaved(store.snapshotText());
    expect(store.isDirty()).toBe(false);
    store.dispatch({ type: 'update', element: { ...store.getSnapshot().elements[0]!, depth: 3 } as Trench }, prepare);
    expect(store.isDirty()).toBe(true);
    expect(store.undo(prepare).ok).toBe(true);
    expect(store.isDirty()).toBe(false); // 撤销回保存内容
    expect(store.redo(prepare).ok).toBe(true);
    expect(store.isDirty()).toBe(true);
    store.markSaved(store.snapshotText());
    expect(store.isDirty()).toBe(false);
  });

  it('保存期间并发编辑不会把新内容误标为已保存', () => {
    const store = new ProjectStore();
    store.dispatch({ type: 'add', element: trench('t1', [p(0, 0), p(20, 0)]) }, prepare);
    const exported = store.snapshotText();
    store.dispatch({ type: 'update', element: { ...store.getSnapshot().elements[0]!, depth: 5 } as Trench }, prepare);
    store.markSaved(exported); // 写出的仍是旧快照
    expect(store.isDirty()).toBe(true);
    store.markSaved(store.snapshotText());
    expect(store.isDirty()).toBe(false);
  });

  it('保存后撤销并创建不同分支，即使历史步数相同也保持未保存', () => {
    const store = new ProjectStore();
    const original = pit('p1', 0);
    expect(store.dispatch({ type: 'add', element: original }, prepare).ok).toBe(true);
    const saved = store.snapshotText();
    store.markSaved(saved);

    expect(store.undo(prepare).ok).toBe(true);
    expect(store.isDirty()).toBe(true);
    expect(store.dispatch({ type: 'add', element: { ...original, depth: 5 } }, prepare).ok).toBe(true);
    expect(store.canRedo).toBe(false);
    expect(store.snapshotText()).not.toBe(saved);
    expect(store.isDirty()).toBe(true);

    // 新分支上的撤销/重做同样不能复用旧分支的保存状态。
    expect(store.undo(prepare).ok).toBe(true);
    expect(store.isDirty()).toBe(true);
    expect(store.redo(prepare).ok).toBe(true);
    expect(store.isDirty()).toBe(true);
    store.markSaved(store.snapshotText());
    expect(store.isDirty()).toBe(false);
  });

  it('新分支重新编辑回已保存内容时恢复干净，撤销离开该内容后仍未保存', () => {
    const store = new ProjectStore();
    const original = pit('p1', 0);
    expect(store.dispatch({ type: 'add', element: original }, prepare).ok).toBe(true);
    const saved = store.snapshotText();
    store.markSaved(saved);

    expect(store.undo(prepare).ok).toBe(true);
    expect(store.dispatch({ type: 'add', element: { ...original, depth: 5 } }, prepare).ok).toBe(true);
    expect(store.dispatch({ type: 'update', element: original }, prepare).ok).toBe(true);
    expect(store.snapshotText()).toBe(saved);
    expect(store.isDirty()).toBe(false);

    expect(store.undo(prepare).ok).toBe(true);
    expect(store.snapshotText()).not.toBe(saved);
    expect(store.isDirty()).toBe(true);
    expect(store.redo(prepare).ok).toBe(true);
    expect(store.snapshotText()).toBe(saved);
    expect(store.isDirty()).toBe(false);
  });

  it('打开/新建是新会话：清空历史与基线；准备失败时历史栈不被破坏', () => {
    const store = new ProjectStore();
    store.dispatch({ type: 'add', element: trench('t1', [p(0, 0), p(20, 0)]) }, prepare);
    const loaded = store.load({ ...emptyProject(), name: '打开的工程' }, prepare);
    expect(loaded.ok).toBe(true);
    expect(store.getSnapshot().name).toBe('打开的工程');
    expect(store.canUndo).toBe(false);
    expect(store.isDirty()).toBe(false);

    store.dispatch({ type: 'add', element: pit('p1', 0) }, prepare);
    const depth = store.undoDepth;
    const failing = vi.fn(() => { throw new Error('render failed'); });
    expect(store.undo(failing).ok).toBe(false);
    expect(store.undoDepth).toBe(depth); // 准备失败不移动栈：该步仍可再次撤销
    expect(store.undo(prepare).ok).toBe(true);
  });
});
