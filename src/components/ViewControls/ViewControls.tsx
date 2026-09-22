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
  return <div className="view-controls" role="group" aria-label="场景显示控制">
    {(Object.keys(VIEW_LABELS) as ViewMode[]).map(mode =>
      <button key={mode} disabled={!ready || viewLocked} aria-pressed={view === mode} onClick={() => onView(mode)}>{VIEW_LABELS[mode]}</button>)}
    <button disabled={!ready || viewLocked} onClick={onReset}>重置镜头</button>
    <label><input type="checkbox" checked={grid} disabled={!ready} onChange={event => onGrid(event.target.checked)} />显示网格</label>
    <label><input type="checkbox" checked={snap} disabled={!ready} onChange={event => onSnap(event.target.checked)} />吸附1m网格</label>
    <label>显示模式 <select disabled={!ready || !hasElements} aria-label="显示模式" value={displayMode} onChange={e => onDisplayMode(e.target.value as DisplayMode)}>
      <option value="solid">实体</option><option value="wireframe">线框</option>
    </select></label>
  </div>;
}
