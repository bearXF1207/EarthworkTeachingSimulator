import { MathUtils, OrthographicCamera, PerspectiveCamera, Vector3 } from 'three';

export type ViewMode = 'free' | 'top' | 'front' | 'side';
export const VIEW_LABELS: Record<ViewMode, string> = {
  free: '自由视角', top: '俯视', front: '前视', side: '侧视',
};

export class CameraManager {
  readonly perspective = new PerspectiveCamera(45, 1, 0.1, 5000);
  readonly orthographic = new OrthographicCamera(-60, 60, 60, -60, 0.1, 5000);
  readonly target = new Vector3();
  mode: ViewMode = 'free';
  private aspect = 1;
  private height = 140;
  constructor() { this.reset(); }

  get active(): PerspectiveCamera | OrthographicCamera {
    return this.mode === 'free' ? this.perspective : this.orthographic;
  }

  resize(width: number, height: number): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.aspect = width / height;
    this.perspective.aspect = this.aspect;
    this.perspective.updateProjectionMatrix();
    this.orthographic.left = -this.height * this.aspect / 2;
    this.orthographic.right = this.height * this.aspect / 2;
    this.orthographic.top = this.height / 2;
    this.orthographic.bottom = -this.height / 2;
    this.orthographic.updateProjectionMatrix();
  }

  setView(mode: ViewMode): void {
    if (mode === this.mode) return;
    const span = this.mode === 'free'
      ? 2 * this.perspective.position.distanceTo(this.target) * Math.tan(MathUtils.degToRad(22.5))
      : this.height / this.orthographic.zoom;
    this.mode = mode;
    this.height = MathUtils.clamp(span, 2, 2000);
    this.place();
  }

  reset(): void {
    this.target.set(0, 0, 0);
    this.height = 140 / Math.min(this.aspect, 1);
    this.place();
  }

  private place(): void {
    const camera = this.active;
    const direction = this.mode === 'free' ? new Vector3(1, -1.2, 1).normalize()
      : this.mode === 'top' ? new Vector3(0, 0, 1)
      : this.mode === 'front' ? new Vector3(0, -1, 0) : new Vector3(1, 0, 0);
    camera.up.set(0, this.mode === 'top' ? 1 : 0, this.mode === 'top' ? 0 : 1);
    const distance = this.mode === 'free' ? this.height / (2 * Math.tan(MathUtils.degToRad(22.5))) : 1500;
    camera.position.copy(this.target).addScaledVector(direction, distance);
    camera.zoom = 1;
    camera.lookAt(this.target);
    camera.updateMatrixWorld();
    this.resize(this.aspect, 1);
  }
}
