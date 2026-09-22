import type { ReactElement } from 'react';
import { VIEW_LABELS } from '../../scene/CameraManager';
import type { ViewMode } from '../../scene/CameraManager';

type Props = {
  view: ViewMode; grid: boolean; ready: boolean;
  onView: (view: ViewMode) => void; onGrid: (visible: boolean) => void; onReset: () => void;
};

export function ViewControls({ view, grid, ready, onView, onGrid, onReset }: Props): ReactElement {
  return <div className="view-controls" role="group" aria-label="场景显示控制">
    {(Object.keys(VIEW_LABELS) as ViewMode[]).map(mode =>
      <button key={mode} disabled={!ready} aria-pressed={view === mode} onClick={() => onView(mode)}>{VIEW_LABELS[mode]}</button>)}
    <button disabled={!ready} onClick={onReset}>重置镜头</button>
    <label><input type="checkbox" checked={grid} disabled={!ready} onChange={event => onGrid(event.target.checked)} />显示网格</label>
    <label>显示模式 <select disabled aria-label="显示模式" defaultValue="solid" title="M1 暂无开挖对象；实体/线框在 M2 启用">
      <option value="solid">实体</option><option value="wireframe">线框</option>
    </select></label>
  </div>;
}
