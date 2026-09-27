import type { ReactElement } from 'react';
import type { ToolKind } from '../../scene/DrawingManager';
import { TOOL_HINTS, TOOL_LABELS } from './toolLabels';

type Props = {
  active: ToolKind;
  ready: boolean;
  /** 有选中对象时给出“删除当前基槽/基坑”的可用按钮；否则禁用并说明原因。 */
  deleteLabel: string;
  canDelete: boolean;
  deleteReason: string;
  onTool: (kind: ToolKind) => void;
  onDelete: () => void;
};

/**
 * M9 左侧施工工具面板：只负责切换工具与删除当前对象。
 * 工具面板不读写工程数据，删除与工具切换都通过外部传入的命令入口执行。
 */
export function ToolPanel({ active, ready, deleteLabel, canDelete, deleteReason, onTool, onDelete }: Props): ReactElement {
  return <aside className="tool-panel" aria-label="施工工具">
    <h2>施工工具</h2>
    <div className="tool-list" role="group" aria-label="工具">
      {(Object.keys(TOOL_LABELS) as ToolKind[]).map(kind =>
        <button key={kind} type="button" className="tool-button" aria-pressed={active === kind}
          title={ready ? TOOL_HINTS[kind] : '三维场景尚未就绪'} disabled={!ready}
          onClick={() => onTool(kind)}>{TOOL_LABELS[kind]}</button>)}
    </div>
    <button type="button" className="danger-button" disabled={!ready || !canDelete}
      title={ready ? deleteReason : '三维场景尚未就绪'} onClick={onDelete}>{deleteLabel}</button>
    <p className="tool-note">{ready ? deleteReason : '三维场景尚未就绪，工具暂不可用。'}</p>
    <p className="tool-note">{TOOL_HINTS[active]}</p>
  </aside>;
}