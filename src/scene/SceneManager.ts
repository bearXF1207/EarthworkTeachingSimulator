import { Color, DirectionalLight, HemisphereLight, MOUSE, Scene, TOUCH, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CameraManager } from './CameraManager';
import type { ViewMode } from './CameraManager';
import { GroundManager } from './GroundManager';
import { ExcavationMeshes } from './MeshFactory';
import type { Project } from '../core/model/project';
import type { Prepared } from '../store/ProjectStore';

export type DisplayMode = 'solid' | 'wireframe';
export type SceneStatus = { ready: boolean; message: string };
// Lifecycle tests substitute only the GPU boundary, retaining real managers and controls.
export type RendererPort = Pick<WebGLRenderer, 'domElement' | 'setSize' | 'setPixelRatio' | 'setAnimationLoop' | 'render' | 'dispose' | 'forceContextLoss'>;

export class SceneManager {
  readonly cameras = new CameraManager();
  private readonly scene = new Scene();
  private readonly renderer: RendererPort;
  private ground: GroundManager | null = null;
  private excavation: ExcavationMeshes | null = null;
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
      this.scene.add(this.ground.root, new HemisphereLight(0xeaf2ff, 0x665438, 2));
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

  setGridVisible(visible: boolean): void { this.ground?.setGridVisible(visible); }
  setDisplayMode(mode: DisplayMode): void { this.displayMode = mode; this.excavation?.setWireframe(mode === 'wireframe'); }
  getDisplayMode(): DisplayMode { return this.displayMode; }

  prepareProject(project: Project): Prepared {
    if (this.disposed) throw new Error('Scene disposed');
    const excavation = new ExcavationMeshes(project.elements, this.displayMode === 'wireframe');
    let ground: GroundManager;
    try { ground = new GroundManager(excavation.holes, project.settings.groundSize); }
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
