import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { SceneManager } from '../scene/SceneManager';
import type { SceneStatus } from '../scene/SceneManager';
import { VIEW_LABELS } from '../scene/CameraManager';
import type { ViewMode } from '../scene/CameraManager';
import { ViewControls } from './ViewControls/ViewControls';
import { ProjectStore } from '../store/ProjectStore';
import type { Command } from '../store/ProjectStore';
import type { ExcavationElement, Pit, Project, Result, Trench } from '../core/model/project';
import type { DisplayMode } from '../scene/SceneManager';
import { PitEditor } from './PropertyPanel/PitEditor';
import { TrenchEditor } from './PropertyPanel/TrenchEditor';
import { PIT_LABELS } from '../core/model/project';

const TRENCH_LABEL = '直线基槽';
const POLYLINE_LABEL = '折线基槽';
/** 两个节点按直线基槽呈现，多节点按折线基槽呈现。 */
const elementLabel = (element: ExcavationElement): string => element.type === 'trench'
  ? (element.points.length === 2 ? TRENCH_LABEL : POLYLINE_LABEL) : PIT_LABELS[element.type];

export function SceneViewport(): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const manager = useRef<SceneManager | null>(null);
  const [store] = useState(() => new ProjectStore());
  const [project, setProject] = useState(() => store.getSnapshot());
  const [selected, setSelected] = useState('');
  const serial = useRef(0);
  const trenchSerial = useRef(0);
  const polylineSerial = useRef(0);
  const [error, setError] = useState('');
  const [displayMode, setDisplayMode] = useState<DisplayMode>('solid');
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
      if (store.getSnapshot().elements.length) manager.current.prepareProject(store.getSnapshot()).commit();
      manager.current.setGridVisible(store.getSnapshot().settings.gridVisible);
    } catch {
      manager.current?.dispose(); manager.current = null;
      notify({ ready: false, message: '无法启动三维场景。请确认浏览器支持 WebGL 2，并检查硬件加速或显卡驱动。' });
    }
    return () => { active = false; manager.current?.dispose(); manager.current = null; };
  }, [generation, store]);

  function dispatch(command: Command, reportError = true): Result<Project> {
    const result = store.dispatch(command, next => {
      if (!manager.current) throw new Error('Scene unavailable');
      return manager.current.prepareProject(next);
    });
    if (result.ok) { setProject(result.value); setError(''); }
    else if (reportError) setError(result.issues.map(i => `${i.path}：${i.message}`).join('；'));
    return result;
  }
  function add(type: Pit['type']): void {
    const index = serial.current++;
    const base = { id: `pit-${index + 1}`, position: { x: (index % 8) * 12 - 12, y: Math.floor(index / 8) * 12 }, depth: 2, slope: .5 };
    const element: Pit = type === 'square-pit' ? { ...base, type, bottomSize: 4, rotation: 0 } :
      type === 'rect-pit' ? { ...base, type, bottomLength: 6, bottomWidth: 4, rotation: 0 } : { ...base, type, bottomDiameter: 4 };
    if (dispatch({ type: 'add', element }).ok) setSelected(element.id);
  }
  // 演示入口：直线基槽按 10m 间距排在基坑演示行下方，90° 折线基槽再向下按 30m 间距排列；正式绘制交互留给 M5。
  function addTrench(): void {
    const index = trenchSerial.current++;
    const y = -20 - index * 10;
    const element: Trench = { id: `trench-${index + 1}`, type: 'trench', points: [{ x: -12, y }, { x: 8, y }],
      bottomWidth: 2, depth: 2, slope: .5 };
    if (dispatch({ type: 'add', element }).ok) setSelected(element.id);
  }
  function addPolylineTrench(): void {
    const index = polylineSerial.current++;
    const y = -220 - index * 30;
    const element: Trench = { id: `polyline-${index + 1}`, type: 'trench',
      points: [{ x: -12, y }, { x: 8, y }, { x: 8, y: y - 12 }], bottomWidth: 2, depth: 2, slope: .5 };
    if (dispatch({ type: 'add', element }).ok) setSelected(element.id);
  }
  function update(element: ExcavationElement): Result<Project> { return dispatch({ type: 'update', element }, false); }

  function changeView(next: ViewMode): void { manager.current?.setView(next); setView(next); }
  function changeGrid(visible: boolean): void {
    if (dispatch({ type: 'grid', visible }).ok) { manager.current?.setGridVisible(visible); setGrid(visible); }
  }
  function reload(): void {
    setView('free'); setDisplayMode('solid'); setGrid(store.getSnapshot().settings.gridVisible);
    setStatus({ ready: false, message: '正在初始化场景…' });
    setGeneration(value => value + 1);
  }

  const active = project.elements.find(e => e.id === selected);
  return <><section className="scene-panel" aria-label="基础三维场景">
    <div className="scene-heading"><h2>施工场地</h2><span>{VIEW_LABELS[view]} · {project.elements.length} 个开挖对象 · 场地自动扩展</span></div>
    <div className="viewport" ref={host} />
    <div className="scene-status" role={status.ready ? 'status' : 'alert'}>{status.message}</div>
    <ViewControls view={view} grid={grid} ready={status.ready} onView={changeView} onGrid={changeGrid} onReset={() => manager.current?.resetCamera()}
      displayMode={displayMode} hasElements={project.elements.length > 0} onDisplayMode={mode => { manager.current?.setDisplayMode(mode); setDisplayMode(mode); }} />
    <div className="scene-help"><span>{view === 'free' ? '左键旋转 · 右键平移 · 滚轮缩放' : '左键或右键平移 · 滚轮缩放 · 正交视图锁定旋转'}<br />网格间距 1m · 坐标轴：X 红 / Y 绿 / Z 蓝</span>
      <button onClick={reload}>重新加载场景</button></div>
  </section><aside className="next-stage" aria-label="开挖对象属性">
    <h2>参数化开挖对象</h2>
    <div className="create-elements">
      <button disabled={!status.ready} onClick={addTrench}>添加{TRENCH_LABEL}</button>
      <button disabled={!status.ready} onClick={addPolylineTrench}>添加{POLYLINE_LABEL}</button>
      {(Object.keys(PIT_LABELS) as Pit['type'][]).map(type =>
        <button key={type} disabled={!status.ready} onClick={() => add(type)}>添加{PIT_LABELS[type]}</button>)}</div>
    <label>当前对象<select aria-label="当前对象" value={selected} onChange={e => { setSelected(e.target.value); setError(''); }}>
      <option value="">请选择对象</option>{project.elements.map(e => <option key={e.id} value={e.id}>{e.id} · {elementLabel(e)}</option>)}
    </select></label>
    {active && <fieldset disabled={!status.ready}>
      {active.type === 'trench' ? <TrenchEditor key={active.id} trench={active} onUpdate={update} />
        : <PitEditor key={active.id} pit={active} onUpdate={update} />}
      <button onClick={() => { if (dispatch({ type: 'delete', id: active.id }).ok) setSelected(''); }}>删除当前{active.type === 'trench' ? '基槽' : '基坑'}</button>
    </fieldset>}
    {error && <p role="alert" className="input-error">{error}</p>}
    <p className="scope-note">M4 演示入口：按预设位置添加直线/折线基槽与基坑，再编辑节点和截面参数。顶部开口禁止重叠、包含或相切；折返、自交与超出 miter 上限的转角会被拒绝。正式鼠标绘制、体积计算和文件保存尚未实现。</p>
  </aside></>;
}
