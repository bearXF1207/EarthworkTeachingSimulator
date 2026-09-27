import type { ToolKind } from '../../scene/DrawingManager';

/** 工具名称是界面上唯一的中文来源：状态栏与工具按钮共用，避免两处文案漂移。 */
export const TOOL_LABELS: Record<ToolKind, string> = {
  select: '选择', drawTrench: '绘制基槽', placePit: '放置基坑', measure: '测量',
};

/** 每个工具的用途与操作方式：同时作为按钮提示与状态栏说明。 */
export const TOOL_HINTS: Record<ToolKind, string> = {
  select: '在俯视图点选开挖对象；选中后可拖动基槽节点或基坑中心',
  drawTrench: '在俯视图逐点单击绘制基槽中心线，双击/Enter 完成、Esc 取消',
  placePit: '选好类型后在场地单击放置基坑',
  measure: '在地面单击两点测量距离；结果不写入工程数据',
};