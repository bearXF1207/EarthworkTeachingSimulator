import { Color, DirectionalLight, HemisphereLight, Mesh, MOUSE, Raycaster, Scene, TOUCH, Vector2, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CameraManager } from './CameraManager';
import type { ViewMode } from './CameraManager';
import { GroundManager } from './GroundManager';
import { ExcavationMeshes } from './MeshFactory';
import { PreviewLine } from './PreviewLine';
import type { Point2, Project } from '../core/model/project';
import type { Prepared } from '../store/ProjectStore';

export type DisplayMode = 'solid' | 'wireframe';
export type SceneStatus = { ready: boolean; message: string };
// 生命周期测试只替换 GPU 边界，其余管理器与控制器仍用真实实现。
export type RendererPort = Pick<WebGLRenderer, 'domElement' | 'setSize' | 'setPixelRatio' | 'setAnimationLoop' | 'render' | 'dispose' | 'forceContextLoss'>;

export class SceneManager {
  readonly cameras = new CameraManager();
  /** 绘制中的未提交预览；由 SceneManager 统一拥有与释放。 */
  readonly preview = new PreviewLine();
  private readonly scene = new Scene();
  private readonly renderer: RendererPort;
  private ground: GroundManager | null = null;
  private excavation: ExcavationMeshes | null = null;
  private selectedId: string | null = null;
  private controls: OrbitControls | null = null;
  private observer: ResizeObserver | null = null;
  private disposed = false;
  private displayMode: DisplayMode = 'solid';

  constructor(private readonly container: HTMLElement,
    private readonly onStatus: (status: SceneStatus) => void,
    createRenderer: () => RendererPort = () => new WebGLRenderer({ antialias: true }),
  ) {
    this.renderer = createRenderer();
    try {
      this.scene.background = new Color(0x17231f);
      this.ground = new GroundManager();
      this.scene.add(this.ground.root, this.preview.root, new HemisphereLight(0xeaf2ff, 0x665438, 2));
      const sun = new DirectionalLight(0xffefcf, 2.5);
      sun.position.set(30, -40, 80);
      this.scene.add(sun);
      const canvas = this.renderer.domElement;
      canvas.setAttribute('aria-label', '三维施工场地');
      canvas.setAttribute('role', 'img');
      canvas.tabIndex = 0;
      canvas.addEventListener('webglcontextlost', this.onContextLost);
      canvas.addEventListener('webglcontextrestored', this.onContextRestored);
      container.append(canvas);
      this.resize();
      this.cameras.reset();
      this.installControls();
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(container);
      this.renderer.setAnimationLoop(this.render);
      this.onStatus({ ready: true, message: '场景已就绪' });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  setView(mode: ViewMode): void {
    if (this.disposed || mode === this.cameras.mode) return;
    if (this.controls) this.cameras.target.copy(this.controls.target);
    this.controls?.dispose();
    this.controls = null;
    this.cameras.setView(mode);
    this.installControls();
  }

  resetCamera(): void {
    if (this.disposed) return;
    this.controls?.dispose();
    this.controls = null;
    this.cameras.reset();
    this.installControls();
  }

  /** 投影与事件绑定必须使用画布自身的 bounding rect。 */
  get domElement(): HTMLCanvasElement { return this.renderer.domElement; }

  setPreviewPoints(points: Point2[]): void { if (!this.disposed) this.preview.setPoints(points); }

  setGridVisible(visible: boolean): void { this.ground?.setGridVisible(visible); }
  setDisplayMode(mode: DisplayMode): void { this.displayMode = mode; this.excavation?.setWireframe(mode === 'wireframe'); }
  getDisplayMode(): DisplayMode { return this.displayMode; }
  /** 选中对象时高亮其基槽中心线与实体（3D 视图下同样可见）。 */
  setSelected(id: string | null): void { this.selectedId = id; if (!this.disposed) this.excavation?.setSelected(id); }
  getSelected(): string | null { return this.selectedId; }
  /**
   * 画布拾取：返回光标下开挖对象的 id（Mesh 的 name 就是 id），没有命中返回 null。
   * 只用开挖实体求交，忽略中心线、地面与辅助线。
   */
  pickAt(clientX: number, clientY: number): string | null {
    if (this.disposed || !this.excavation) return null;
    const rect = this.domElement.getBoundingClientRect();
    if (!(rect.width > 0) || !(rect.height > 0)) return null;
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new Raycaster();
    raycaster.setFromCamera(ndc, this.cameras.active);
    const targets = this.excavation.root.children.filter(child => child instanceof Mesh);
    return raycaster.intersectObjects(targets, false)[0]?.object.name || null;
  }
  /** 供测试与验收读取当前开挖网格（含中心线高亮状态）。 */
  get excavationMeshes(): ExcavationMeshes | null { return this.excavation; }

  prepareProject(project: Project): Prepared {
    if (this.disposed) throw new Error('Scene disposed');
    const excavation = new ExcavationMeshes(project.elements, this.displayMode === 'wireframe');
    excavation.setSelected(this.selectedId);
    let ground: GroundManager;
    try { ground = new GroundManager(excavation.holes, project.settings.groundSize, excavation.islands); }
    catch (error) { excavation.dispose(); throw error; }
    ground.setGridVisible(project.settings.gridVisible);
    let finished = false;
    return {
      commit: () => {
        if (finished || this.disposed) throw new Error('Invalid prepared scene');
        this.scene.add(ground.root, excavation.root);
        this.ground?.dispose(); this.excavation?.dispose();
        this.ground = ground; this.excavation = excavation; finished = true;
      },
      dispose: () => { if (!finished) { ground.dispose(); excavation.dispose(); finished = true; } },
    };
  }

  private installControls(): void {
    const controls = new OrbitControls(this.cameras.active, this.renderer.domElement);
    controls.target.copy(this.cameras.target);
    controls.enableDamping = true;
    controls.enableRotate = this.cameras.mode === 'free';
    controls.screenSpacePanning = this.cameras.mode !== 'free';
    controls.maxPolarAngle = Math.PI / 2;
    controls.minDistance = 2;
    controls.maxDistance = 2400;
    controls.minZoom = 0.1;
    controls.maxZoom = 60;
    controls.mouseButtons.LEFT = controls.enableRotate ? MOUSE.ROTATE : MOUSE.PAN;
    controls.touches.ONE = controls.enableRotate ? TOUCH.ROTATE : TOUCH.PAN;
    controls.update();
    this.controls = controls;
  }

  private readonly resize = (): void => {
    if (this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.cameras.resize(width, height);
  };

  private readonly render = (): void => {
    if (this.disposed) return;
    this.controls?.update();
    this.renderer.render(this.scene, this.cameras.active);
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.renderer.setAnimationLoop(null);
    this.onStatus({ ready: false, message: '图形上下文已丢失，等待恢复；也可点击重新加载场景。' });
  };

  private readonly onContextRestored = (): void => {
    if (this.disposed) return;
    this.resize();
    this.renderer.setAnimationLoop(this.render);
    this.onStatus({ ready: true, message: '场景已恢复' });
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.observer?.disconnect();
    this.controls?.dispose();
    this.preview.dispose();
    this.ground?.dispose();
    this.excavation?.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
