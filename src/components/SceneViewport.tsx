import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { SceneManager } from '../scene/SceneManager';
import type { SceneStatus } from '../scene/SceneManager';
import { VIEW_LABELS } from '../scene/CameraManager';
import type { ViewMode } from '../scene/CameraManager';
import { ViewControls } from './ViewControls/ViewControls';

export function SceneViewport(): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const manager = useRef<SceneManager | null>(null);
  const [view, setView] = useState<ViewMode>('free');
  const [grid, setGrid] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<SceneStatus>({ ready: false, message: '正在初始化场景…' });

  useEffect(() => {
    if (!host.current) return;
    let active = true;
    const notify = (next: SceneStatus): void => { if (active) setStatus(next); };
    try {
      manager.current = new SceneManager(host.current, notify);
    } catch {
      notify({ ready: false, message: '无法启动三维场景。请确认浏览器支持 WebGL 2，并检查硬件加速或显卡驱动。' });
    }
    return () => { active = false; manager.current?.dispose(); manager.current = null; };
  }, [generation]);

  function changeView(next: ViewMode): void { manager.current?.setView(next); setView(next); }
  function changeGrid(visible: boolean): void { manager.current?.setGridVisible(visible); setGrid(visible); }
  function reload(): void {
    setView('free'); setGrid(true);
    setStatus({ ready: false, message: '正在初始化场景…' });
    setGeneration(value => value + 1);
  }

  return <section className="scene-panel" aria-label="基础三维场景">
    <div className="scene-heading"><h2>施工场地</h2><span>{VIEW_LABELS[view]} · 100m × 100m</span></div>
    <div className="viewport" ref={host} />
    <div className="scene-status" role={status.ready ? 'status' : 'alert'}>{status.message}</div>
    <ViewControls view={view} grid={grid} ready={status.ready} onView={changeView} onGrid={changeGrid} onReset={() => manager.current?.resetCamera()} />
    <div className="scene-help"><span>{view === 'free' ? '左键旋转 · 右键平移 · 滚轮缩放' : '左键或右键平移 · 滚轮缩放 · 正交视图锁定旋转'}<br />网格间距 1m · 坐标轴：X 红 / Y 绿 / Z 蓝</span>
      <button onClick={reload}>重新加载场景</button></div>
  </section>;
}
