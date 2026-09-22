import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Points, PointsMaterial } from 'three';
import type { Point2 } from '../core/model/project';

const PREVIEW_COLOR = 0xffd479;

/**
 * 绘制/放置过程中的未提交预览：中心线折线加起点像素标记。
 * 只服务于界面提示，资源由 SceneManager 拥有并随其释放；不进入项目数据。
 */
export class PreviewLine {
  readonly root = new Group();
  readonly line: Line<BufferGeometry, LineBasicMaterial>;
  readonly start: Points<BufferGeometry, PointsMaterial>;
  private disposed = false;

  constructor() {
    this.line = new Line(new BufferGeometry(), new LineBasicMaterial({ color: PREVIEW_COLOR }));
    this.line.name = 'preview-line';
    this.line.frustumCulled = false;
    this.start = new Points(new BufferGeometry(), new PointsMaterial({ color: PREVIEW_COLOR, size: 9, sizeAttenuation: false }));
    this.start.name = 'preview-start';
    this.start.frustumCulled = false;
    this.root.name = 'preview';
    this.root.add(this.line, this.start);
    this.setPoints([]);
  }

  /** 依次更新折线、起点标记；少于两个点时折线为空，起点标记仍显示第一个点。 */
  setPoints(points: Point2[]): void {
    if (this.disposed) return;
    this.line.geometry.dispose();
    const positions: number[] = [];
    for (const point of points) positions.push(point.x, point.y, 0.02);
    this.line.geometry = new BufferGeometry();
    this.line.geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    this.line.visible = points.length > 1;
    this.start.geometry.dispose();
    const first = points[0];
    this.start.geometry = new BufferGeometry();
    this.start.geometry.setAttribute('position', new Float32BufferAttribute(first ? [first.x, first.y, 0.02] : [], 3));
    this.start.visible = first !== undefined;
  }

  clear(): void { this.setPoints([]); }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.line.geometry.dispose(); this.line.material.dispose();
    this.start.geometry.dispose(); this.start.material.dispose();
    this.root.clear(); this.root.removeFromParent();
  }
}
