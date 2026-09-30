import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { Command, Prepared } from '../store/ProjectStore';
import { createFileGateway } from '../core/io/desktopFileService';
import type { FileGateway, SaveTarget } from '../core/io/fileGateway';
import { confirmWindowClose, subscribeWindowCloseRequest } from '../core/io/desktopWindow';
import { PROJECT_FILE_EXTENSION, parseProject } from '../core/io/projectSchema';
import { PIT_LABELS, defaultPitDraft, pitFromDraft, trenchFromDraft } from '../core/model/project';
import type { ExcavationElement, PitDraftParams, Point2, Project, Result, TrenchSection } from '../core/model/project';
import { ViewControls } from './ViewControls/ViewControls';
import { DocumentBar } from './TopBar/DocumentBar';
import { ToolPanel } from './ToolPanel/ToolPanel';
import { StatusBar } from './StatusBar/StatusBar';
import { UnsavedDialog } from './dialogs/UnsavedDialog';
import type { UnsavedChoice } from './dialogs/UnsavedDialog';
import { DrawingPanel } from './DrawingPanel/DrawingPanel';
import { PitEditor } from './PropertyPanel/PitEditor';
import { TrenchEditor } from './PropertyPanel/TrenchEditor';
import { QuantityView } from './PropertyPanel/QuantityView';
import { distance } from '../core/calculation/measurement';
import { volumeSummary } from '../core/calculation/quantities';

const TRENCH_LABEL = '直线基槽';
const POLYLINE_LABEL = '折线基槽';
/** 拖动阈值（CSS 像素）：相机旋转/平移不应被误判为拖动编辑。 */
const DRAG_THRESHOLD = 3;
/** 节点拾取半径（米）：光标落在基槽节点附近才进入拖动。 */
const NODE_PICK_RADIUS = 2;
/** 两个节点按直线基槽呈现，多节点按折线基槽呈现。 */
const elementLabel = (element: ExcavationElement): string => element.type === 'trench'
  ? (element.points.length === 2 ? TRENCH_LABEL : POLYLINE_LABEL) : PIT_LABELS[element.type];

type DragState = {
  id: string; index: number; pointerId: number; canvas: HTMLCanvasElement;
  start: Point2; active: boolean; target: Point2;
};

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
  /** M9 状态栏坐标：只在俯视图跟随光标，取整到厘米以避免无意义的重复渲染。 */
  const [cursor, setCursor] = useState<Point2 | null>(null);
  // M8 文档会话：文件服务（M10 起自动选择桌面/浏览器实现）、当前写入目的地、保存状态与未保存确认。
  const [gateway] = useState<FileGateway>(() => createFileGateway());
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null);
  const [doc, setDoc] = useState(() => ({ name: store.getSnapshot().name, dirty: store.isDirty(), canUndo: store.canUndo, canRedo: store.canRedo }));
  const [busy, setBusy] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ kind: 'new' | 'open' | 'close'; message: string } | null>(null);
  const [pendingExport, setPendingExport] = useState<{ text: string; name: string } | null>(null);
  const busyRef = useRef(false);
  const snapTargets = useRef<SnapTarget[]>([]);
  const [generation, setGeneration] = useState(0);
  const [status, setStatus] = useState<SceneStatus>({ ready: false, message: '正在初始化场景…' });
  const pointerDown = useRef<Point2 | null>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  const viewBeforeTool = useRef<ViewMode>('free');
  const shortcuts = useRef<{ finish: () => void; cancel: () => void; undo: () => void; redo: () => void }>(
    { finish: () => undefined, cancel: () => undefined, undo: () => undefined, redo: () => undefined });

  /** 先清空所有权再释放捕获，避免 lostpointercapture 重入提交或取消。 */
  const releaseDrag = useCallback((): DragState | null => {
    const state = drag.current;
    drag.current = null;
    if (state) {
      if (state.canvas.hasPointerCapture(state.pointerId)) state.canvas.releasePointerCapture(state.pointerId);
      manager.current?.setPreviewPoints([]);
      manager.current?.setCameraControlsEnabled(true);
    }
    return state;
  }, []);
  const cancelDrag = useCallback((): void => {
    if (releaseDrag()) { pointerDown.current = null; suppressClick.current = true; }
  }, [releaseDrag]);

  useEffect(() => {
    window.addEventListener('blur', cancelDrag);
    return () => window.removeEventListener('blur', cancelDrag);
  }, [cancelDrag]);

  useEffect(() => {
    if (!host.current) return;
    let active = true;
    const notify = (next: SceneStatus): void => {
      if (!next.ready) cancelDrag();
      if (active) setStatus(next);
    };
    try {
      manager.current = new SceneManager(host.current, notify);
      if (store.getSnapshot().elements.length) manager.current.prepareProject(store.getSnapshot()).commit();
      manager.current.setGridVisible(store.getSnapshot().settings.gridVisible);
    } catch {
      manager.current?.dispose(); manager.current = null;
      notify({ ready: false, message: '无法启动三维场景。请确认浏览器支持 WebGL 2，并检查硬件加速或显卡驱动。' });
    }
    return () => { active = false; cancelDrag(); manager.current?.dispose(); manager.current = null; };
  }, [cancelDrag, generation, store]);

  // 吸附目标随工程与当前截面更新：中心线骨架为主、贴合线为辅，指针移动时直接复用。
  useEffect(() => {
    const halfWidth = section.bottomWidth / 2 + section.depth * section.slope;
    snapTargets.current = trenchSnapTargets(project.elements, { halfWidth });
  }, [project, section]);

  /** 撤销、重做、打开与新建都走同一份场景准备入口，不复用已释放的 Mesh。 */
  function prepareProject(next: Project): Prepared {
    if (!manager.current) throw new Error('Scene unavailable');
    return manager.current.prepareProject(next);
  }
  /** 文档状态（名称、保存状态、历史可用性）从 store 实时同步到界面。 */
  function syncDoc(): void {
    const snapshot = store.getSnapshot();
    setProject(snapshot);
    setDoc({ name: snapshot.name, dirty: store.isDirty(), canUndo: store.canUndo, canRedo: store.canRedo });
  }
  function markBusy(value: boolean): void { if (value) cancelDrag(); busyRef.current = value; setBusy(value); }

  function dispatch(command: Command, reportError = true): Result<Project> {
    // 保存/打开等待期间禁止并发文档修改，避免把后续编辑误标为已保存。
    if (busyRef.current) return { ok: false, issues: [{ code: 'busy', path: '', message: '正在保存或打开文件，请稍候再编辑' }] };
    const result = store.dispatch(command, prepareProject);
    if (result.ok) { setProject(result.value); setError(''); syncDoc(); }
    else if (reportError) setError(result.issues.map(i => `${i.path}：${i.message}`).join('；'));
    return result;
  }
  const failure = (result: Result<Project>): string => result.ok ? '' : result.issues.map(i => `${i.path}：${i.message}`).join('；');
  const toolActive = draw.kind === 'drawTrench' || draw.kind === 'placePit' || draw.kind === 'measure';

  function changeView(next: ViewMode): void { cancelDrag(); manager.current?.setView(next); setView(next); setCursor(null); }
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

  /** M9 状态栏坐标：俯视且指针在画布内时才更新；取整到厘米，数值未变化时不触发重渲染。 */
  function trackCursor(event: { clientX: number; clientY: number }): void {
    const instance = manager.current;
    if (!instance || instance.cameras.mode !== 'top') return;
    const ground = groundPointFromPointer(event.clientX, event.clientY, instance.cameras.active, instance.domElement.getBoundingClientRect());
    const next = ground ? { x: Math.round(ground.x * 100) / 100, y: Math.round(ground.y * 100) / 100 } : null;
    setCursor(previous => previous && next && previous.x === next.x && previous.y === next.y ? previous : next);
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
    if (!instance || instance.cameras.mode !== 'top' || liveState().kind !== 'select' || !status.ready || busyRef.current) return;
    const ground = groundPointFromPointer(event.clientX, event.clientY, instance.cameras.active, instance.domElement.getBoundingClientRect());
    const hit = instance.pickAt(event.clientX, event.clientY);
    const element = project.elements.find(item => item.id === (hit ?? selected));
    if (!element || !ground) return;
    let index = -1, target: Point2;
    if (element.type === 'trench') {
      let best = -1, bestDistance = Infinity;
      element.points.forEach((point, index) => {
        const distance = Math.hypot(point.x - ground.x, point.y - ground.y);
        if (distance <= NODE_PICK_RADIUS && distance < bestDistance) { best = index; bestDistance = distance; }
      });
      if (best < 0) return;
      index = best; target = element.points[best]!;
    } else {
      // 基坑必须命中实体；空白处不能借用当前选中对象进入编辑。
      if (hit !== element.id) return;
      target = element.position;
    }
    drag.current = { id: element.id, index, pointerId: event.pointerId, canvas: instance.domElement,
      start: { x: event.clientX, y: event.clientY }, active: false, target };
    // 捕获阶段先暂停相机，防止 canvas 的原生 OrbitControls 提前开始平移。
    instance.setCameraControlsEnabled(false);
    instance.domElement.setPointerCapture(event.pointerId);
  }
  function commitDrag(): void {
    const state = releaseDrag();
    if (!state?.active) return;
    suppressClick.current = true;
    const element = project.elements.find(item => item.id === state.id);
    if (!element) return;
    const next = element.type === 'trench'
      ? { ...element, points: element.points.map((point, index) => index === state.index ? state.target : point) }
      : { ...element, position: state.target };
    // 只在释放时提交一次，失败保留原数据并提示原因。
    const result = dispatch({ type: 'update', element: next });
    if (!result.ok) setError(failure(result));
    else setError('');
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0 || event.isPrimary === false || drag.current) return;
    suppressClick.current = false;
    pointerDown.current = { x: event.clientX, y: event.clientY };
    beginDrag(event);
  }
  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current?.pointerId !== event.pointerId) return;
    if (event.button === 0) commitDrag(); else cancelDrag();
  }
  function onPointerCancel(event: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current?.pointerId === event.pointerId) cancelDrag();
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    trackCursor(event);
    const pending = drag.current;
    if (pending) {
      if (event.pointerId !== pending.pointerId) return;
      if ((event.buttons & 1) === 0) { cancelDrag(); return; }
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
    if (event.button !== 0) return;
    if (suppressClick.current) { suppressClick.current = false; pointerDown.current = null; return; }
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
    if (drag.current) { cancelDrag(); return; }
    setDraw(drawing.cancel());
    setDrawMessage(''); setSnapHint(''); setMeasureLabel(null);
    manager.current?.setPreviewPoints([]);
    restoreView();
  }
  function changeTool(kind: ToolKind): void {
    cancelDrag();
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

  /** 新会话（新建/打开）后清空草稿、选择、临时测量与视角，再按新工程的设置同步开关。 */
  function resetSessionUi(): void {
    cancelDrag();
    setDraw(drawing.cancel()); setDrawMessage(''); setSnapHint(''); setMeasureLabel(null);
    manager.current?.setPreviewPoints([]); manager.current?.setSelected(null);
    setSelected(''); setError('');
    const settings = store.getSnapshot().settings;
    setGrid(settings.gridVisible); setSnap(settings.snapEnabled);
    changeView('free'); setDisplayMode('solid'); manager.current?.setDisplayMode('solid');
  }
  /** 撤销/重做后同步场景与选择：被撤销掉的对象不能继续处于选中状态。 */
  function afterHistory(): void {
    const next = store.getSnapshot();
    cancelDrag();
    setDraw(drawing.cancel()); setDrawMessage(''); setSnapHint(''); setMeasureLabel(null);
    manager.current?.setPreviewPoints([]);
    setSelected(previous => previous && next.elements.some(element => element.id === previous) ? previous : '');
    setError(''); syncDoc();
  }
  function undo(): void {
    const result = store.undo(prepareProject);
    if (!result.ok) { setError(failure(result)); return; }
    afterHistory();
  }
  function redo(): void {
    const result = store.redo(prepareProject);
    if (!result.ok) { setError(failure(result)); return; }
    afterHistory();
  }

  /**
   * 保存：只有 status=saved（真实写入）或用户随后确认导出才更新保存基线。
   * export-requested 只是请求浏览器下载副本，不能据此清 dirty。
   */
  async function saveDocument(saveAs: boolean): Promise<'saved' | 'export-requested' | 'cancelled' | 'failed'> {
    const text = store.snapshotText();
    const suggestedName = `${store.getSnapshot().name}${PROJECT_FILE_EXTENSION}`;
    markBusy(true);
    const result = await gateway.save({ text, suggestedName, target: saveAs ? null : saveTarget });
    markBusy(false);
    if (!result.ok) { setError(result.issues.map(issue => issue.message).join('；')); return 'failed'; }
    const outcome = result.value;
    if (outcome.status === 'cancelled') { setError(''); return 'cancelled'; }
    if (outcome.status === 'saved') {
      store.markSaved(text);
      setSaveTarget(outcome.target);
      setPendingExport(null); setError(''); syncDoc();
      return 'saved';
    }
    setPendingExport({ text, name: outcome.file.name }); setError(''); syncDoc();
    return 'export-requested';
  }

  /** 用户确认刚刚导出的副本已保存：只对同一份快照生效，之后才允许继续原动作。 */
  function confirmExport(): void {
    const pending = pendingExport;
    if (!pending) return;
    if (store.snapshotText() !== pending.text) {
      setPendingExport(null);
      setError('文档在导出后又发生了变化：请重新导出后再确认。');
      syncDoc();
      return;
    }
    store.markSaved(pending.text);
    setPendingExport(null); setError(''); syncDoc();
    const action = pendingAction;
    if (action) void continueAction(action);
  }

  function startNew(): void {
    const result = store.reset(prepareProject);
    if (!result.ok) { setError(failure(result)); return; }
    setSaveTarget(null); setPendingExport(null); setPendingAction(null);
    resetSessionUi(); syncDoc();
  }
  async function openFromFile(): Promise<void> {
    markBusy(true);
    const opened = await gateway.open();
    markBusy(false);
    setPendingAction(null);
    if (!opened.ok) { setError(opened.issues.map(issue => issue.message).join('；')); return; }
    if (!opened.value) return; // 用户取消：保持当前工程
    const parsed = parseProject(opened.value.text);
    if (!parsed.ok) {
      setError(`打开失败，已保留当前工程：${parsed.issues.map(issue => `${issue.path}：${issue.message}`).join('；')}`);
      return;
    }
    const result = store.load(parsed.value, prepareProject);
    if (!result.ok) { setError(failure(result)); return; }
    setSaveTarget(opened.value.target); setPendingExport(null);
    resetSessionUi(); syncDoc();
  }
  async function continueAction(action: { kind: 'new' | 'open' | 'close' }): Promise<void> {
    if (action.kind === 'new') startNew();
    else if (action.kind === 'close') { setPendingAction(null); confirmWindowClose(); }
    else await openFromFile();
  }
  function requestNew(): void {
    if (busyRef.current) return;
    if (store.isDirty()) { setPendingAction({ kind: 'new', message: '' }); return; }
    startNew();
  }
  function requestOpen(): void {
    if (busyRef.current) return;
    if (store.isDirty()) { setPendingAction({ kind: 'open', message: '' }); return; }
    void openFromFile();
  }
  async function chooseUnsaved(choice: UnsavedChoice): Promise<void> {
    const action = pendingAction;
    if (!action) return;
    if (choice === 'cancel') { setPendingAction(null); return; }
    if (choice === 'discard') { await continueAction(action); return; }
    const outcome = await saveDocument(false);
    if (outcome === 'saved') { await continueAction(action); return; }
    setPendingAction({ ...action, message: outcome === 'export-requested'
      ? '已请求下载副本，但还没有确认写入成功：请先点击“确认已导出”，再继续。'
      : outcome === 'cancelled' ? '已取消保存，未执行原动作。' : '保存失败，未执行原动作。' });
  }

  // 未保存时离开页面：只用浏览器原生提醒（自定义三按钮对话框在页面内新建/打开时才可用）。
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!store.isDirty()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store]);

  // M10 桌面关闭流程：主进程拦截关闭后请求 renderer 决定；浏览器环境订阅是无操作。
  // 忙碌或已有待确认动作时忽略本次关闭请求，等用户完成当前决定后再次关闭。
  useEffect(() => subscribeWindowCloseRequest(() => {
    if (busyRef.current || pendingAction !== null) return;
    if (store.isDirty()) setPendingAction({ kind: 'close', message: '' });
    else confirmWindowClose();
  }), [store, pendingAction]);

  // 每次渲染后刷新确认/取消入口，键盘监听始终调用最新实现（确认本身也读实时草稿）。
  useEffect(() => { shortcuts.current = { finish: finishTrench, cancel: cancelDrawing, undo, redo }; });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // 输入法组合状态中的按键一律不触发场景命令。
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && drag.current) { event.preventDefault(); shortcuts.current.cancel(); return; }
      // Ctrl/Cmd+Enter 在任意焦点下都完成整槽：即使焦点还在长度/角度输入框里也能确认。
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        shortcuts.current.finish();
        return;
      }
      // 文本输入、下拉与可编辑区域内的按键不触发场景命令（输入框内 Enter 只提交本段，Ctrl+Z 保留文本撤销）。
      if (isTextEntryTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) shortcuts.current.redo(); else shortcuts.current.undo();
        return;
      }
      if (modifier && (event.key === 'y' || event.key === 'Y')) { event.preventDefault(); shortcuts.current.redo(); return; }
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
    cancelDrag();
    setView('free'); setDisplayMode('solid'); setGrid(store.getSnapshot().settings.gridVisible);
    setDraw(drawing.cancel()); setDrawMessage('');
    setStatus({ ready: false, message: '正在初始化场景…' });
    setGeneration(value => value + 1);
  }

  const active = project.elements.find(e => e.id === selected);
  // 渲染期只读取带保护的合计：连接并集触发几何守卫时退回单槽估算，不中断界面。
  const summary = volumeSummary(project.elements);
  // 删除入口的唯一可见位置在左侧工具面板：无选中对象时禁用并把原因写进提示与说明。
  const deleteLabel = active ? `删除当前${active.type === 'trench' ? '基槽' : '基坑'}` : '删除对象';
  const deleteReason = active
    ? `删除当前选中的${elementLabel(active)}`
    : '未选择对象：请先在画布或“当前对象”中选择要删除的对象';
  function deleteActive(): void {
    if (!active) return;
    cancelDrag();
    if (dispatch({ type: 'delete', id: active.id }).ok) setSelected('');
  }
  return <>
    {/* M9 布局：顶部文档工具栏横跨整行，其下是左侧工具 / 中间场地 / 右侧参数，底部视角与状态栏横跨整行。 */}
    <DocumentBar name={doc.name} dirty={doc.dirty} canUndo={doc.canUndo} canRedo={doc.canRedo} busy={busy}
      gatewayKind={gateway.kind} pendingExportName={pendingExport?.name ?? null}
      onNew={requestNew} onOpen={requestOpen} onSave={() => void saveDocument(false)} onSaveAs={() => void saveDocument(true)}
      onConfirmExport={confirmExport} onUndo={undo} onRedo={redo} />
    <ToolPanel active={draw.kind} ready={status.ready} deleteLabel={deleteLabel} canDelete={active !== undefined}
      deleteReason={deleteReason} onTool={changeTool} onDelete={deleteActive} />
    <section className="scene-panel" aria-label="基础三维场景">
    <div className="scene-heading"><h2>施工场地</h2><span>{VIEW_LABELS[view]} · {project.elements.length} 个开挖对象 · 场地自动扩展</span></div>
    <div className="viewport" ref={host} onPointerDownCapture={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onClick={onClick} onDoubleClick={onDoubleClick}
      onPointerCancel={onPointerCancel} onLostPointerCapture={onPointerCancel}
      onPointerLeave={() => setCursor(null)}
      style={toolActive ? { cursor: 'crosshair' } : undefined}>
      {measureLabel && <span className="measure-label" style={{ left: measureLabel.x, top: measureLabel.y }}>{measureLabel.text}</span>}
    </div>
    <div className="scene-status" role={status.ready ? 'status' : 'alert'}>{status.message}</div>
    <div className="scene-help"><span>{view === 'free' ? '左键旋转 · 右键平移 · 滚轮缩放'
      : view === 'top' && draw.kind === 'select' ? '左键拖动对象或节点 · 空白处拖动或右键平移 · 滚轮缩放'
        : '左键或右键平移 · 滚轮缩放 · 正交视图锁定旋转'}<br />网格间距 1m · 坐标轴：X 红 / Y 绿 / Z 蓝</span>
      <button onClick={reload}>重新加载场景</button></div>
    </section>
    <aside className="next-stage" aria-label="绘制与开挖对象属性">
    <h2>绘制与参数</h2>
    <DrawingPanel state={draw} ready={status.ready} message={drawMessage} section={section} pit={pit}
      ortho={ortho} onOrtho={setOrtho} hint={snapHint}
      onSection={setSection} onPit={setPit} onAdvance={advance} onFinish={finishTrench} onCancel={cancelDrawing}
      onResetMeasure={resetMeasure} />
    <label>当前对象<select aria-label="当前对象" value={selected} onChange={e => { cancelDrag(); setSelected(e.target.value); setError(''); }}>
      <option value="">请选择对象</option>{project.elements.map(e => <option key={e.id} value={e.id}>{e.id} · {elementLabel(e)}</option>)}
    </select></label>
    {active && <fieldset disabled={!status.ready}>
      {active.type === 'trench' ? <TrenchEditor key={active.id} trench={active} onUpdate={update} />
        : <PitEditor key={active.id} pit={active} onUpdate={update} />}
    </fieldset>}
    {active && <QuantityView key={`q-${active.id}`} element={active} title={elementLabel(active)} />}
    <section className="quantity-summary" aria-label="工程量合计">
      <h3>工程量合计</h3>
      <p><strong>预计土方量合计 {summary.total.toFixed(2)} m³</strong></p>
      <p>其中连接补充开挖 {summary.correction.toFixed(2)} m³</p>
      {summary.degraded && <p role="alert" className="input-error">连接并集几何不可用，合计暂时只含单槽估算。</p>}
      <p className="scope-note">单槽估算之和加连接修正。连接增量按显示同源的合并几何计算，不重复计入已有开挖；草稿与临时测量不计入。不同深度接口保留高差台阶。</p>
    </section>
    {error && <p role="alert" className="input-error">{error}</p>}
    <p className="scope-note">M9：左侧选择/绘制基槽/放置基坑/测量与删除，俯视单击绘制（双击/Enter 完成、Esc 取消），画布点选与拖动编辑、两点距离测量；中心线与坑心按开关吸附 1m 网格，输入框内 Enter 只提交输入段。单槽土方量按解析公式估算，连接补挖按合并几何修正。文件打开/保存与 50 步撤销重做已可用；桌面（Electron）版本文件读写走原生对话框与可恢复写入，关闭窗口前会确认未保存修改。</p>
    </aside>
    <div className="bottom-bar">
      <ViewControls view={view} grid={grid} snap={snap} ready={status.ready} viewLocked={toolActive}
        onView={changeView} onGrid={changeGrid} onSnap={changeSnap} onReset={() => { cancelDrag(); manager.current?.resetCamera(); }}
        displayMode={displayMode} hasElements={project.elements.length > 0} onDisplayMode={mode => { manager.current?.setDisplayMode(mode); setDisplayMode(mode); }} />
      <StatusBar tool={draw.kind} ready={status.ready} message={status.message} cursor={cursor}
        grid={grid} snap={snap} elementCount={project.elements.length} dirty={doc.dirty} busy={busy} />
    </div>
  {pendingAction && <UnsavedDialog action={pendingAction.kind} message={pendingAction.message} busy={busy}
    gatewayKind={gateway.kind} onChoose={choice => void chooseUnsaved(choice)} />}</>;
}
