import type { ReactElement } from 'react';
import type { Point2 } from '../../core/model/project';
import { TOOL_HINTS, TOOL_LABELS } from '../ToolPanel/toolLabels';
import type { ToolKind } from '../../scene/DrawingManager';

type Props = {
  tool: ToolKind;
  ready: boolean;
  /** 场景未就绪（或上下文丢失）时的说明；就绪时状态栏改为显示当前工具的操作提示。 */
  message: string;
  /** 俯视光标的地面坐标；非俯视或指针离开画布时为 null。 */
  cursor: Point2 | null;
  grid: boolean;
  snap: boolean;
  elementCount: number;
  dirty: boolean;
  busy: boolean;
};

const format = (value: number): string => value.toFixed(2);

/**
 * M9 状态栏：当前工具、光标坐标、网格/吸附开关、操作提示与保存状态。
 * 只读取界面已有状态，不触发任何命令；所有状态都给出文字名称，不依赖颜色表达。
 * 草稿的实时读数与吸附来源仍只在参数面板显示，状态栏不重复，避免同一提示出现两次。
 */
export function StatusBar({ tool, ready, message, cursor, grid, snap, elementCount, dirty, busy }: Props): ReactElement {
  const saveText = busy ? '正在保存或打开…' : dirty ? '未保存' : '已保存';
  return <div className="status-bar" role="group" aria-label="状态栏">
    <span className="status-item">工具：{TOOL_LABELS[tool]}</span>
    <span className="status-item">坐标：{cursor ? `X ${format(cursor.x)} · Y ${format(cursor.y)}` : '—'}</span>
    <span className="status-item">网格：{grid ? '显示' : '隐藏'}</span>
    <span className="status-item">吸附：{snap ? '1m 网格开' : '关'}</span>
    <span className="status-item status-wide">{ready ? TOOL_HINTS[tool] : message}</span>
    <span className="status-item">对象：{elementCount} 个</span>
    <span className="status-item">保存状态：{saveText}</span>
  </div>;
}