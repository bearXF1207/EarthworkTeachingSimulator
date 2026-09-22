import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { SceneManager } from '../scene/SceneManager';
import type { DisplayMode, SceneStatus } from '../scene/SceneManager';
import { VIEW_LABELS } from '../scene/CameraManager';
import type { ViewMode } from '../scene/CameraManager';
import { DrawingManager, isTextEntryTarget } from '../scene/DrawingManager';
import type { DrawingState, ToolKind } from '../scene/DrawingManager';
import { groundPointFromPointer } from '../scene/groundPointer';
import { isDragGesture, nextPoint, snapPoint } from '../core/geometry/pointMath';
import { outline } from '../core/geometry/pitOutline';
import { ProjectStore } from '../store/ProjectStore';
import type { Command } from '../store/ProjectStore';
import { PIT_LABELS, defaultPitDraft, pitFromDraft, trenchFromDraft } from '../core/model/project';
import type { ExcavationElement, PitDraftParams, Point2, Project, Result, TrenchSection } from '../core/model/project';
import { ViewControls } from './ViewControls/ViewControls';
import { DrawingPanel } from './DrawingPanel/DrawingPanel';
import { PitEditor } from './PropertyPanel/PitEditor';
import { TrenchEditor } from './PropertyPanel/TrenchEditor';

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
  const [error, setError] = useState('');
  const [drawing] = useState(() => new DrawingManager());
  const [draw, setDraw] = useState<DrawingState>(() => drawing.getState());
  const [drawMessage, setDrawMessage] = useState('');
  const [section, setSection] = useState<TrenchSection>({ bottomWidth: 2, depth: 2, slope: .5 });
  const [pit, setPit] = useState<PitDraftParams>(() => defaultPitDraft('square-pit'));
  const [displayMode, setDisplayMode] = useState<DisplayMode>('solid');
  const [view, setView] = useState<ViewMode>('free');
  const [grid, setGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<SceneStatus>({ ready: false, message: '正在初始化场景…' });
  const pointerDown = useRef<Point2 | null>(null);
  const viewBeforeTool = useRef<ViewMode>('free');
  const shortcuts = useRef<{ finish: () => void; cancel: () => void }>({ finish: () => undefined, cancel: () => undefined });

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
  const failure = (result: Result<Project>): string => result.ok ? '' : result.issues.map(i => `${i.path}：${i.message}`).join('；');
  const toolActive = draw.kind === 'drawTrench' || draw.kind === 'placePit';

  function changeView(next: ViewMode): void { manager.current?.setView(next); setView(next); }
  function restoreView(): void { if (view !== viewBeforeTool.current) changeView(viewBeforeTool.current); }

  /** 屏幕点投影到地面并吸附；只有俯视用于绘制，画布外返回 null。 */
  function projectionPoint(event: { clientX: number; clientY: number }): Point2 | null {
    const instance = manager.current;
    if (!instance || view !== 'top') return null;
    const ground = groundPointFromPointer(event.clientX, event.clientY, instance.cameras.active, instance.domElement.getBoundingClientRect());
    return ground ? snapPoint(ground, snap, store.getSnapshot().settings.snapSpacing) : null;
  }

  /** 预览只显示未提交草稿：基槽为中心线，基坑为槽顶轮廓。 */
  function refreshPreview(state: DrawingState, cursor: Point2 | null): void {
    const instance = manager.current;
    if (!instance) return;
    if (state.kind === 'drawTrench') { instance.setPreviewPoints(drawing.previewPoints()); return; }
    if (state.kind === 'placePit' && cursor) {
      try {
        const ring = outline(pitFromDraft('preview', cursor, pit), true);
        instance.setPreviewPoints([...ring, ring[0]!]);
      } catch { instance.setPreviewPoints([]); }
      return;
    }
    instance.setPreviewPoints([]);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    pointerDown.current = { x: event.clientX, y: event.clientY };
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!toolActive) return;
    const point = projectionPoint(event);
    const next = drawing.moveCursor(point);
    setDraw(next);
    refreshPreview(next, point);
  }
  function onClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const down = pointerDown.current; pointerDown.current = null;
    if (down && isDragGesture(down, { x: event.clientX, y: event.clientY })) return;
    const point = projectionPoint(event);
    if (!point) return;
    if (draw.kind === 'drawTrench') {
      const { state, added } = drawing.addNode(point, event.detail);
      setDraw(state);
      if (added) setDrawMessage('');
      refreshPreview(state, state.kind === 'drawTrench' ? state.cursor : null);
      return;
    }
    if (draw.kind === 'placePit') placePit(point);
  }
  function onDoubleClick(): void { if (draw.kind === 'drawTrench') finishTrench(); }

  /** 双击、Enter 与“完成基槽”按钮共用同一个校验/提交入口。 */
  function finishTrench(): void {
    if (draw.kind !== 'drawTrench') return;
    if (draw.nodes.length < 2) { setDrawMessage('至少需要两个节点才能完成基槽'); return; }
    const element = trenchFromDraft(crypto.randomUUID(), draw.nodes, section);
    const result = dispatch({ type: 'add', element });
    if (!result.ok) { setDrawMessage(failure(result)); return; }
    setSelected(element.id); setDrawMessage('');
    setDraw(drawing.cancel());
    manager.current?.setPreviewPoints([]);
    restoreView();
  }
  function cancelDrawing(): void {
    setDraw(drawing.cancel());
    setDrawMessage('');
    manager.current?.setPreviewPoints([]);
    restoreView();
  }
  function changeTool(kind: ToolKind): void {
    if (kind === 'measure') return;
    setDraw(drawing.setTool(kind));
    setDrawMessage(''); setError('');
    manager.current?.setPreviewPoints([]);
    if (kind === 'select') restoreView();
    else { viewBeforeTool.current = view; changeView('top'); }
  }
  /** 精确输入推算下一点：绝对方位角、不执行网格吸附。 */
  function advance(length: number, angle: number): void {
    if (draw.kind !== 'drawTrench') return;
    const last = draw.nodes[draw.nodes.length - 1];
    if (!last) { setDrawMessage('请先在俯视图单击设置起点'); return; }
    const { state } = drawing.addNode(nextPoint(last, length, angle), 1);
    setDraw(state); setDrawMessage('');
    refreshPreview(state, null);
  }
  /** 放置基坑：重叠等非法位置保留当前工具与提示。 */
  function placePit(position: Point2): void {
    const element = pitFromDraft(crypto.randomUUID(), position, pit);
    // 失败原因显示在绘制面板，避免与属性面板的错误提示重复。
    const result = dispatch({ type: 'add', element }, false);
    if (result.ok) { setSelected(element.id); setDrawMessage(''); manager.current?.setPreviewPoints([]); return; }
    setDrawMessage(failure(result));
  }
  function update(element: ExcavationElement): Result<Project> { return dispatch({ type: 'update', element }, false); }

  shortcuts.current = { finish: finishTrench, cancel: cancelDrawing };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 文本输入、下拉、可编辑区域与输入法组合状态中的按键不触发场景命令。
      if (isTextEntryTarget(event.target) || event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') shortcuts.current.finish();
      else if (event.key === 'Escape') shortcuts.current.cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function changeGrid(visible: boolean): void {
    if (dispatch({ type: 'grid', visible }).ok) { manager.current?.setGridVisible(visible); setGrid(visible); }
  }
  function changeSnap(enabled: boolean): void { if (dispatch({ type: 'snap', enabled }).ok) setSnap(enabled); }
  function reload(): void {
    setView('free'); setDisplayMode('solid'); setGrid(store.getSnapshot().settings.gridVisible);
    setDraw(drawing.cancel()); setDrawMessage('');
    setStatus({ ready: false, message: '正在初始化场景…' });
    setGeneration(value => value + 1);
  }

  const active = project.elements.find(e => e.id === selected);
  return <><section className="scene-panel" aria-label="基础三维场景">
    <div className="scene-heading"><h2>施工场地</h2><span>{VIEW_LABELS[view]} · {project.elements.length} 个开挖对象 · 场地自动扩展</span></div>
    <div className="viewport" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onClick={onClick} onDoubleClick={onDoubleClick}
      style={toolActive ? { cursor: 'crosshair' } : undefined} />
    <div className="scene-status" role={status.ready ? 'status' : 'alert'}>{status.message}</div>
    <ViewControls view={view} grid={grid} snap={snap} ready={status.ready} viewLocked={toolActive}
      onView={changeView} onGrid={changeGrid} onSnap={changeSnap} onReset={() => manager.current?.resetCamera()}
      displayMode={displayMode} hasElements={project.elements.length > 0} onDisplayMode={mode => { manager.current?.setDisplayMode(mode); setDisplayMode(mode); }} />
    <div className="scene-help"><span>{view === 'free' ? '左键旋转 · 右键平移 · 滚轮缩放' : '左键或右键平移 · 滚轮缩放 · 正交视图锁定旋转'}<br />网格间距 1m · 坐标轴：X 红 / Y 绿 / Z 蓝</span>
      <button onClick={reload}>重新加载场景</button></div>
  </section><aside className="next-stage" aria-label="绘制与开挖对象属性">
    <h2>绘制与参数</h2>
    <DrawingPanel state={draw} ready={status.ready} message={drawMessage} section={section} pit={pit}
      onTool={changeTool} onSection={setSection} onPit={setPit} onAdvance={advance} onFinish={finishTrench} onCancel={cancelDrawing} />
    <label>当前对象<select aria-label="当前对象" value={selected} onChange={e => { setSelected(e.target.value); setError(''); }}>
      <option value="">请选择对象</option>{project.elements.map(e => <option key={e.id} value={e.id}>{e.id} · {elementLabel(e)}</option>)}
    </select></label>
    {active && <fieldset disabled={!status.ready}>
      {active.type === 'trench' ? <TrenchEditor key={active.id} trench={active} onUpdate={update} />
        : <PitEditor key={active.id} pit={active} onUpdate={update} />}
      <button onClick={() => { if (dispatch({ type: 'delete', id: active.id }).ok) setSelected(''); }}>删除当前{active.type === 'trench' ? '基槽' : '基坑'}</button>
    </fieldset>}
    {error && <p role="alert" className="input-error">{error}</p>}
    <p className="scope-note">M5：俯视单击绘制基槽（双击/Enter 完成、Esc 取消）、单击放置基坑，中心线与坑心按开关吸附 1m 网格。输入框内 Enter 只提交输入段。体积计算与文件保存尚未实现。</p>
  </aside></>;
}
