import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import { SceneManager } from '../scene/SceneManager';
import type { DisplayMode, SceneStatus } from '../scene/SceneManager';
import { VIEW_LABELS } from '../scene/CameraManager';
import type { ViewMode } from '../scene/CameraManager';
import { DrawingManager, isTextEntryTarget } from '../scene/DrawingManager';
import type { DrawingState, ToolKind } from '../scene/DrawingManager';
import { groundPointFromPointer } from '../scene/groundPointer';
import { applyLock, isDragGesture, nextPoint, orthoLock, snapPoint } from '../core/geometry/pointMath';
import { outline } from '../core/geometry/pitOutline';
import { resolveSnap, ringCloseTarget, snapLabel, trenchSnapTargets } from '../core/geometry/snapTargets';
import { MIN_RING_NODES } from '../core/geometry/trenchOutline';
import type { SnapResolution, SnapTarget } from '../core/geometry/snapTargets';
import { ProjectStore } from '../store/ProjectStore';
import type { Command } from '../store/ProjectStore';
import { PIT_LABELS, defaultPitDraft, pitFromDraft, trenchFromDraft } from '../core/model/project';
import type { ExcavationElement, PitDraftParams, Point2, Project, Result, TrenchSection } from '../core/model/project';
import { ViewControls } from './ViewControls/ViewControls';
import { DrawingPanel } from './DrawingPanel/DrawingPanel';
import { PitEditor } from './PropertyPanel/PitEditor';
import { TrenchEditor } from './PropertyPanel/TrenchEditor';
import { QuantityView } from './PropertyPanel/QuantityView';
import { distance } from '../core/calculation/measurement';
import { totalVolume } from '../core/calculation/quantities';

const TRENCH_LABEL = '直线基槽';
const POLYLINE_LABEL = '折线基槽';
/** 拖动阈值（CSS 像素）：相机旋转/平移不应被误判为拖动编辑。 */
const DRAG_THRESHOLD = 3;
/** 节点拾取半径（米）：光标落在基槽节点附近才进入拖动。 */
const NODE_PICK_RADIUS = 2;
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
  const [ortho, setOrtho] = useState(false);
  const [snapHint, setSnapHint] = useState('');
  const [measureLabel, setMeasureLabel] = useState<{ x: number; y: number; text: string } | null>(null);
  const snapTargets = useRef<SnapTarget[]>([]);
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

  // 吸附目标随工程与当前截面更新：中心线骨架为主、贴合线为辅，指针移动时直接复用。
  useEffect(() => {
    const halfWidth = section.bottomWidth / 2 + section.depth * section.slope;
    snapTargets.current = trenchSnapTargets(project.elements, { halfWidth });
  }, [project, section]);

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
  const toolActive = draw.kind === 'drawTrench' || draw.kind === 'placePit' || draw.kind === 'measure';

  function changeView(next: ViewMode): void { manager.current?.setView(next); setView(next); }
  function restoreView(): void { if (view !== viewBeforeTool.current) changeView(viewBeforeTool.current); }

  /**
   * 工具状态一律从状态机实时读取：确认、取消与落点都在同一帧内也能拿到最新草稿，
   * 不再依赖渲染闭包里的快照（否则紧接在同一次点击后的 Enter/双击会读到旧节点）。
   */
  const liveState = (): DrawingState => drawing.getState();

  /**
   * 绘制点解析：投影到地面 → 正交约束（仅鼠标绘制）→ 相邻基槽吸附 → 1m 网格兜底。
   * 只有俯视用于绘制，画布外返回 null；基坑放置只做网格吸附。
   */
  function draftPoint(event: { clientX: number; clientY: number }, state: DrawingState): SnapResolution | null {
    const instance = manager.current;
    // 视角也读相机实时模式：刚切进绘制工具就落点时，渲染状态可能还没更新。
    if (!instance || instance.cameras.mode !== 'top') return null;
    const ground = groundPointFromPointer(event.clientX, event.clientY, instance.cameras.active, instance.domElement.getBoundingClientRect());
    if (!ground) return null;
    const spacing = store.getSnapshot().settings.snapSpacing;
    if (state.kind !== 'drawTrench') return { point: snapPoint(ground, snap, spacing), kind: 'grid', sourceId: null };
    const last = state.nodes[state.nodes.length - 1];
    const lock = ortho && last ? orthoLock(last, ground) : null;
    const raw = lock ? applyLock(lock, ground) : ground;
    // 草稿自身的起点也参与吸附：鼠标回到起点即可首尾闭合成环形基槽。
    const closure = state.nodes.length >= MIN_RING_NODES ? [ringCloseTarget(state.nodes[0]!)] : [];
    return resolveSnap(raw, [...closure, ...snapTargets.current], { grid: snap, spacing, lock });
  }

  /** 预览只显示未提交草稿：基槽为中心线，基坑为槽顶轮廓，测量为两点连线。 */
  function refreshPreview(state: DrawingState, cursor: Point2 | null): void {
    const instance = manager.current;
    if (!instance) return;
    if (state.kind === 'measure') { instance.setPreviewPoints(drawing.previewPoints()); return; }
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

  /**
   * 测量标签：贴在第二个点旁显示距离，坐标相对画布宿主。
   * 结果只用于现场提示，不进入工程数据、历史或文件。
   */
  function updateMeasureLabel(value: number | null, event: { clientX: number; clientY: number }): void {
    const rect = host.current?.getBoundingClientRect();
    if (value === null || !rect) { setMeasureLabel(null); return; }
    setMeasureLabel({ x: event.clientX - rect.left, y: event.clientY - rect.top, text: `${value.toFixed(2)} m` });
  }
  /** 当前测量距离：两点齐全为最终结果，只有一个点时随光标给出实时距离。 */
  function measureValue(points: Point2[], cursor: Point2 | null): number | null {
    if (points.length >= 2) return distance(points[0]!, points[1]!);
    return points.length === 1 && cursor ? distance(points[0]!, cursor) : null;
  }
  function resetMeasure(): void {
    setDraw(drawing.resetMeasure());
    setMeasureLabel(null);
    manager.current?.setPreviewPoints([]);
  }

  /** 拖动编辑：记录对象、节点与起始屏幕坐标，超过 3 CSS 像素才真正开始。 */
  type DragState = { id: string; kind: 'node' | 'pit'; index: number; start: { x: number; y: number }; active: boolean; target: Point2 };
  const drag = useRef<DragState | null>(null);

  /** 光标在地面上的位置（俯视投影 + 相邻基槽中心线吸附）。 */
  function dragPoint(event: { clientX: number; clientY: number }): Point2 | null {
    const instance = manager.current;
    if (!instance || instance.cameras.mode !== 'top') return null;
    const ground = groundPointFromPointer(event.clientX, event.clientY, instance.cameras.active, instance.domElement.getBoundingClientRect());
    if (!ground) return null;
    const exclude = drag.current?.id;
    const targets = trenchSnapTargets(project.elements, exclude ? { excludeId: exclude } : {});
    const resolved = resolveSnap(ground, targets, { grid: snap, spacing: store.getSnapshot().settings.snapSpacing });
    return resolved.point;
  }
  /** 拖动中的预览：基槽显示改后的中心线，基坑显示改后的槽顶轮廓。 */
  function previewDrag(state: DragState): void {
    const element = project.elements.find(item => item.id === state.id);
    const instance = manager.current;
    if (!element || !instance) return;
    if (element.type === 'trench') {
      const points = element.points.map((point, index) => index === state.index ? state.target : point);
      instance.setPreviewPoints(points);
      return;
    }
    try {
      const ring = outline({ ...element, position: state.target }, true);
      instance.setPreviewPoints([...ring, ring[0]!]);
    } catch { instance.setPreviewPoints([]); }
  }
  function beginDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const instance = manager.current;
    if (!instance || liveState().kind !== 'select') return;
    const ground = groundPointFromPointer(event.clientX, event.clientY, instance.cameras.active, instance.domElement.getBoundingClientRect());
    const hit = instance.pickAt(event.clientX, event.clientY);
    const element = project.elements.find(item => item.id === (hit ?? selected));
    if (!element || !ground) return;
    if (element.type === 'trench') {
      let best = -1, bestDistance = Infinity;
      element.points.forEach((point, index) => {
        const distance = Math.hypot(point.x - ground.x, point.y - ground.y);
        if (distance <= NODE_PICK_RADIUS && distance < bestDistance) { best = index; bestDistance = distance; }
      });
      if (best < 0) return;
      drag.current = { id: element.id, kind: 'node', index: best, start: { x: event.clientX, y: event.clientY }, active: false, target: element.points[best]! };
      return;
    }
    drag.current = { id: element.id, kind: 'pit', index: -1, start: { x: event.clientX, y: event.clientY }, active: false, target: element.position };
  }
  function commitDrag(): void {
    const state = drag.current;
    drag.current = null;
    if (!state?.active) return;
    const element = project.elements.find(item => item.id === state.id);
    if (!element) return;
    const next = element.type === 'trench'
      ? { ...element, points: element.points.map((point, index) => index === state.index ? state.target : point) }
      : { ...element, position: state.target };
    // 只在释放时提交一次，失败保留原数据并提示原因。
    const result = dispatch({ type: 'update', element: next });
    if (!result.ok) setError(failure(result));
    else setError('');
    manager.current?.setPreviewPoints([]);
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    pointerDown.current = { x: event.clientX, y: event.clientY };
    beginDrag(event);
  }
  function onPointerUp(): void { commitDrag(); }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const pending = drag.current;
    if (pending) {
      const moved = Math.hypot(event.clientX - pending.start.x, event.clientY - pending.start.y) > DRAG_THRESHOLD;
      const point = dragPoint(event);
      if (point && moved) {
        pending.active = true; pending.target = point;
        previewDrag(pending);
      }
      return;
    }
    if (!toolActive) return;
    const state = liveState();
    const resolved = draftPoint(event, state);
    const point = resolved?.point ?? null;
    setSnapHint(state.kind === 'drawTrench' && resolved ? snapLabel(resolved) : '');
    const next = drawing.moveCursor(point);
    setDraw(next);
    refreshPreview(next, point);
    if (next.kind === 'measure') updateMeasureLabel(measureValue(next.points, point), event);
  }
  function onClick(event: ReactMouseEvent<HTMLDivElement>): void {
    const down = pointerDown.current; pointerDown.current = null;
    if (down && isDragGesture(down, { x: event.clientX, y: event.clientY })) return;
    const state = liveState();
    if (state.kind === 'select') {
      const hit = manager.current?.pickAt(event.clientX, event.clientY);
      if (hit) { setSelected(hit); setError(''); }
      return;
    }
    const resolved = draftPoint(event, state);
    if (!resolved) return;
    if (state.kind === 'measure') {
      // 前两点定一次测量；再点一下即从该点重新开始，历史与工程数据不受影响。
      const next = drawing.addMeasurePoint(resolved.point);
      setDraw(next);
      refreshPreview(next, null);
      updateMeasureLabel(next.kind === 'measure' ? measureValue(next.points, null) : null, event);
      return;
    }
    if (state.kind === 'drawTrench') {
      const { state: next, added } = drawing.addNode(resolved.point, event.detail);
      setDraw(next);
      setSnapHint(snapLabel(resolved));
      if (added) setDrawMessage('');
      refreshPreview(next, next.kind === 'drawTrench' ? next.cursor : null);
      return;
    }
    if (state.kind === 'placePit') placePit(resolved.point);
  }
  function onDoubleClick(): void { if (liveState().kind === 'drawTrench') finishTrench(); }

  // 选中对象时高亮其中心线；重建场景后同样重新应用。
  useEffect(() => { manager.current?.setSelected(selected || null); }, [selected, project, generation]);

  /**
   * 双击、Enter、Ctrl/Cmd+Enter 与“完成基槽”按钮共用同一个校验/提交入口。
   * 成功时整槽只提交一次；失败保留可修改草稿并显示原因。重复触发自然成为空操作。
   */
  function finishTrench(): void {
    const state = liveState();
    if (state.kind !== 'drawTrench') return;
    if (state.nodes.length < 2) { setDrawMessage('至少需要两个节点才能完成基槽'); return; }
    const element = trenchFromDraft(crypto.randomUUID(), state.nodes, section);
    // 失败原因显示在绘制面板，避免与属性面板的错误提示重复。
    const result = dispatch({ type: 'add', element }, false);
    if (!result.ok) { setDrawMessage(failure(result)); return; }
    setSelected(element.id); setDrawMessage(''); setSnapHint('');
    setDraw(drawing.cancel());
    manager.current?.setPreviewPoints([]);
    restoreView();
  }
  function cancelDrawing(): void {
    setDraw(drawing.cancel());
    setDrawMessage(''); setSnapHint(''); setMeasureLabel(null);
    manager.current?.setPreviewPoints([]);
    restoreView();
  }
  function changeTool(kind: ToolKind): void {
    setDraw(drawing.setTool(kind));
    setDrawMessage(''); setError(''); setSnapHint(''); setMeasureLabel(null);
    manager.current?.setPreviewPoints([]);
    if (kind === 'select') restoreView();
    else { viewBeforeTool.current = view; changeView('top'); }
  }
  /** 精确输入推算下一点：绝对方位角、不执行网格吸附。 */
  function advance(length: number, angle: number): void {
    const current = liveState();
    if (current.kind !== 'drawTrench') return;
    const last = current.nodes[current.nodes.length - 1];
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

  // 每次渲染后刷新确认/取消入口，键盘监听始终调用最新实现（确认本身也读实时草稿）。
  useEffect(() => { shortcuts.current = { finish: finishTrench, cancel: cancelDrawing }; });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 输入法组合状态中的按键一律不触发场景命令。
      if (event.isComposing || event.keyCode === 229) return;
      // Ctrl/Cmd+Enter 在任意焦点下都完成整槽：即使焦点还在长度/角度输入框里也能确认。
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        shortcuts.current.finish();
        return;
      }
      // 文本输入、下拉与可编辑区域内的按键不触发场景命令（输入框内 Enter 只提交本段）。
      if (isTextEntryTarget(event.target)) return;
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
    <div className="viewport" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onClick={onClick} onDoubleClick={onDoubleClick}
      style={toolActive ? { cursor: 'crosshair' } : undefined}>
      {measureLabel && <span className="measure-label" style={{ left: measureLabel.x, top: measureLabel.y }}>{measureLabel.text}</span>}
    </div>
    <div className="scene-status" role={status.ready ? 'status' : 'alert'}>{status.message}</div>
    <ViewControls view={view} grid={grid} snap={snap} ready={status.ready} viewLocked={toolActive}
      onView={changeView} onGrid={changeGrid} onSnap={changeSnap} onReset={() => manager.current?.resetCamera()}
      displayMode={displayMode} hasElements={project.elements.length > 0} onDisplayMode={mode => { manager.current?.setDisplayMode(mode); setDisplayMode(mode); }} />
    <div className="scene-help"><span>{view === 'free' ? '左键旋转 · 右键平移 · 滚轮缩放' : '左键或右键平移 · 滚轮缩放 · 正交视图锁定旋转'}<br />网格间距 1m · 坐标轴：X 红 / Y 绿 / Z 蓝</span>
      <button onClick={reload}>重新加载场景</button></div>
  </section><aside className="next-stage" aria-label="绘制与开挖对象属性">
    <h2>绘制与参数</h2>
    <DrawingPanel state={draw} ready={status.ready} message={drawMessage} section={section} pit={pit}
      ortho={ortho} onOrtho={setOrtho} hint={snapHint}
      onTool={changeTool} onSection={setSection} onPit={setPit} onAdvance={advance} onFinish={finishTrench} onCancel={cancelDrawing}
      onResetMeasure={resetMeasure} />
    <label>当前对象<select aria-label="当前对象" value={selected} onChange={e => { setSelected(e.target.value); setError(''); }}>
      <option value="">请选择对象</option>{project.elements.map(e => <option key={e.id} value={e.id}>{e.id} · {elementLabel(e)}</option>)}
    </select></label>
    {active && <fieldset disabled={!status.ready}>
      {active.type === 'trench' ? <TrenchEditor key={active.id} trench={active} onUpdate={update} />
        : <PitEditor key={active.id} pit={active} onUpdate={update} />}
      <button onClick={() => { if (dispatch({ type: 'delete', id: active.id }).ok) setSelected(''); }}>删除当前{active.type === 'trench' ? '基槽' : '基坑'}</button>
    </fieldset>}
    {active && <QuantityView key={`q-${active.id}`} element={active} title={elementLabel(active)} />}
    <section className="quantity-summary" aria-label="工程量合计">
      <h3>工程量合计</h3>
      <p><strong>预计土方量合计 {totalVolume(project.elements).toFixed(2)} m³</strong></p>
      <p className="scope-note">只对已通过校验的对象求和；草稿与临时测量不计入，也不合并相交开挖的工程量。</p>
    </section>
    {error && <p role="alert" className="input-error">{error}</p>}
    <p className="scope-note">M7：俯视单击绘制基槽（双击/Enter 完成、Esc 取消）、单击放置三类基坑，画布点选与拖动编辑、两点距离测量；中心线与坑心按开关吸附 1m 网格，输入框内 Enter 只提交输入段。预计土方量按解析公式计算，文件保存与撤销历史尚未实现。</p>
  </aside></>;
}
