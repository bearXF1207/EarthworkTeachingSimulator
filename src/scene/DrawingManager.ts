import { polylineReport, samePoint, shouldAppendNode } from '../core/geometry/pointMath';
import type { SegmentReport } from '../core/geometry/pointMath';
import type { Point2 } from '../core/model/project';

export type ToolKind = 'select' | 'drawTrench' | 'placePit' | 'measure';

/** 判别联合描述当前工具与它自己的临时数据；一个时刻只有一个主要工具。 */
export type DrawingState =
  | { kind: 'select' }
  | { kind: 'measure' }
  | { kind: 'drawTrench'; nodes: Point2[]; cursor: Point2 | null }
  | { kind: 'placePit'; cursor: Point2 | null };

/** 草稿状态不进入 Project、历史或文件，只有成功结束绘制/放置才派发一次创建命令。 */
export const EMPTY_DRAWING: DrawingState = { kind: 'select' };

/** 文本输入、下拉与可编辑区域内的按键不触发场景命令。 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const editable = target.getAttribute('contenteditable');
  return target.isContentEditable || (editable !== null && editable !== 'false') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export class DrawingManager {
  private state: DrawingState = EMPTY_DRAWING;

  getState(): DrawingState { return this.state; }

  /** 切换工具先清空上一工具的临时状态。 */
  setTool(kind: ToolKind): DrawingState {
    this.state = kind === 'drawTrench' ? { kind, nodes: [], cursor: null }
      : kind === 'placePit' ? { kind, cursor: null }
      : kind === 'measure' ? { kind: 'measure' } : { kind: 'select' };
    return this.state;
  }

  /** Esc/工具栏取消：清空草稿并回到选择工具。 */
  cancel(): DrawingState { return this.setTool('select'); }

  /**
   * 单击追加节点：双击的第二下与重合点都不追加，返回是否真的有点被加入。
   * 只有绘制基槽时有效。
   */
  addNode(point: Point2, detail = 1): { state: DrawingState; added: boolean } {
    if (this.state.kind !== 'drawTrench') return { state: this.state, added: false };
    if (!shouldAppendNode(this.state.nodes, point, detail)) return { state: this.state, added: false };
    this.state = { ...this.state, nodes: [...this.state.nodes, { x: point.x, y: point.y }] };
    return { state: this.state, added: true };
  }

  /** 鼠标移动更新未提交预览；画布外或不可投影时光标为 null。 */
  moveCursor(point: Point2 | null): DrawingState {
    if (this.state.kind !== 'drawTrench' && this.state.kind !== 'placePit') return this.state;
    const cursor = point ? { x: point.x, y: point.y } : null;
    if (this.state.cursor && cursor && samePoint(this.state.cursor, cursor)) return this.state;
    this.state = { ...this.state, cursor };
    return this.state;
  }

  /** 已提交段的长度与方位角，以及光标橡皮筋段的读数（显示用，数值未四舍五入）。 */
  report(): { segments: SegmentReport[]; cursor: SegmentReport | null } {
    if (this.state.kind !== 'drawTrench') return { segments: [], cursor: null };
    const { nodes, cursor } = this.state;
    const last = nodes[nodes.length - 1];
    return { segments: polylineReport(nodes), cursor: last && cursor && !samePoint(last, cursor) ? polylineReport([last, cursor])[0]! : null };
  }

  /** 预览折线：已提交节点加上未提交的光标点；不生成重复末点。 */
  previewPoints(): Point2[] {
    if (this.state.kind !== 'drawTrench') return [];
    const { nodes, cursor } = this.state;
    const last = nodes[nodes.length - 1];
    const points = nodes.map(p => ({ x: p.x, y: p.y }));
    if (cursor && (!last || !samePoint(last, cursor))) points.push({ x: cursor.x, y: cursor.y });
    return points;
  }
}
