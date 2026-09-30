import type { ReactElement } from 'react';

type Props = {
  name: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  gatewayKind: 'file-system' | 'download';
  /** 上一次保存只请求了下载：在用户确认导出前保持 dirty。 */
  pendingExportName: string | null;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onConfirmExport: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

/** 保存/打开等待期间所有文档按钮都禁用，提示统一说明原因，而不是只靠变灰。 */
const busyReason = '正在保存或打开文件，请稍候';

/**
 * M8 文档栏：新建/打开/保存/另存为、撤销/重做与保存状态。
 * 只调用外部传入的动作，不直接接触浏览器文件 API。
 */
export function DocumentBar({
  name, dirty, canUndo, canRedo, busy, gatewayKind, pendingExportName,
  onNew, onOpen, onSave, onSaveAs, onConfirmExport, onUndo, onRedo,
}: Props): ReactElement {
  return <section className="document-bar" aria-label="工程文件">
    <div className="document-toolbar" role="group" aria-label="工程工具栏">
      <p className="document-name">
        <strong>{name}</strong>
        <span className={dirty ? 'dirty-badge' : 'clean-badge'}>{dirty ? '未保存' : '已保存'}</span>
      </p>
      <div className="document-actions" role="group" aria-label="文件操作">
        <button disabled={busy} title={busy ? busyReason : '新建一个空工程（未保存时会先询问）'} onClick={onNew}>新建</button>
        <button disabled={busy} title={busy ? busyReason : '打开本地 .excavation 工程文件'} onClick={onOpen}>打开…</button>
        <button disabled={busy} title={busy ? busyReason : '保存到原文件；无写入权限时改用下载副本'} onClick={onSave}>保存</button>
        <button disabled={busy} title={busy ? busyReason : '选择新位置保存一份副本'} onClick={onSaveAs}>另存为…</button>
      </div>
      <div className="document-actions" role="group" aria-label="编辑历史">
        <button disabled={busy || !canUndo} title={busy ? busyReason : canUndo ? '撤销上一步编辑（Ctrl+Z）' : '没有可撤销的编辑'} onClick={onUndo}>撤销（Ctrl+Z）</button>
        <button disabled={busy || !canRedo} title={busy ? busyReason : canRedo ? '重做被撤销的编辑（Ctrl+Y）' : '没有可重做的编辑'} onClick={onRedo}>重做（Ctrl+Y）</button>
      </div>
    </div>
    {pendingExportName !== null && <div className="export-confirm" role="status">
      <p>已请求导出 {pendingExportName}；浏览器无法确认是否写入成功，请确认文件已保存后再继续。</p>
      <button disabled={busy} onClick={onConfirmExport}>确认已导出</button>
    </div>}
    {gatewayKind === 'download' && <p className="scope-note">
      当前浏览器不支持直接写回文件：保存与另存为会请求下载副本，无法覆盖原路径。
    </p>}
  </section>;
}
