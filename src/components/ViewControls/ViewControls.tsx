import type { ReactElement } from 'react';
import { VIEW_LABELS } from '../../scene/CameraManager';
import type { ViewMode } from '../../scene/CameraManager';
import type { DisplayMode } from '../../scene/SceneManager';

type Props = {
  view: ViewMode; grid: boolean; snap: boolean; ready: boolean; viewLocked: boolean;
  onView: (view: ViewMode) => void; onGrid: (visible: boolean) => void; onSnap: (enabled: boolean) => void; onReset: () => void;
  displayMode: DisplayMode; hasElements: boolean; onDisplayMode: (mode: DisplayMode) => void;
};

export function ViewControls({ view, grid, snap, ready, viewLocked, onView, onGrid, onSnap, onReset, displayMode, hasElements, onDisplayMode }: Props): ReactElement {
  // 禁用原因写成提示文本，屏幕上也能由状态栏读到，不只用变灰表达。
  const viewReason = !ready ? '三维场景尚未就绪' : viewLocked ? '绘制期间锁定视角' : '';
  return <div className="view-controls" role="group" aria-label="场景显示控制">
    {(Object.keys(VIEW_LABELS) as ViewMode[]).map(mode =>
      <button key={mode} disabled={!ready || viewLocked} aria-pressed={view === mode}
        title={viewReason || `切换到${VIEW_LABELS[mode]}`} onClick={() => onView(mode)}>{VIEW_LABELS[mode]}</button>)}
    <button disabled={!ready || viewLocked} title={viewReason || '恢复默认拍摄角度'} onClick={onReset}>重置镜头</button>
    <label><input type="checkbox" checked={grid} disabled={!ready} title={ready ? '只控制网格显隐，不影响吸附与工程尺寸' : '三维场景尚未就绪'}
      onChange={event => onGrid(event.target.checked)} />显示网格</label>
    <label><input type="checkbox" checked={snap} disabled={!ready} title={ready ? '控制鼠标落点是否吸附 1m 网格；精确输入不受影响' : '三维场景尚未就绪'}
      onChange={event => onSnap(event.target.checked)} />吸附1m网格</label>
    <label>显示模式 <select disabled={!ready || !hasElements} aria-label="显示模式" value={displayMode}
      title={!hasElements ? '还没有开挖对象可切换显示模式' : '只改变显示方式，不改变几何与土方量'}
      onChange={e => onDisplayMode(e.target.value as DisplayMode)}>
      <option value="solid">实体</option><option value="wireframe">线框</option>
    </select></label>
  </div>;
}
