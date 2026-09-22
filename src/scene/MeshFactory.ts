import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial } from 'three';
import type { ExcavationElement, Point2 } from '../core/model/project';
import { buildPit } from '../core/geometry/pit';
import { buildTrench } from '../core/geometry/trench';

/** 基槽中心线的常态与选中高亮颜色，稍微抬高避免与地面共面闪烁。 */
const CENTERLINE_COLOR = 0x8fa396;
const SELECTED_CENTERLINE_COLOR = 0xffc266;
const CENTERLINE_Z = 0.02;

/** 把已校验的开挖对象转换为场景 Mesh，并输出与几何同源的地面开口轮廓。 */
export class ExcavationMeshes {
  readonly root = new Group();
  readonly holes: Point2[][] = [];
  /** 环形基槽内部保持地面的岛（在外圈孔洞内补回地面）。 */
  readonly islands: Point2[][] = [];
  /** 基槽中心线：3D 视图下保持可见，选中对象高亮。 */
  private readonly centerlines = new Map<string, Line<BufferGeometry, LineBasicMaterial>>();
  private selectedId: string | null = null;
  private disposed = false;
  constructor(elements: ExcavationElement[], wireframe = false) {
    try {
      for (const element of elements) {
        if (element.type === 'trench') {
          const built = buildTrench(element);
          this.add(element.id, built, wireframe, built.topHole);
          this.addCenterline(element.id, element.points);
        } else this.add(element.id, buildPit(element), wireframe);
      }
      this.applySelection();
    } catch (error) { this.dispose(); throw error; }
  }
  /** 单个开挖对象的 Mesh 与地面开口；环形基槽额外登记内圈岛。 */
  private add(id: string, built: { geometry: BufferGeometry; topOutline: Point2[] }, wireframe: boolean, island?: Point2[]): void {
    const materials = [new MeshStandardMaterial({ color: 0xb8a77c, roughness: 1, wireframe }),
      new MeshStandardMaterial({ color: 0x936c43, roughness: 1, wireframe })];
    const mesh = new Mesh(built.geometry, materials); mesh.name = id;
    this.root.add(mesh); this.holes.push(built.topOutline);
    if (island) this.islands.push(island);
  }
  /** 中心线用独立折线绘制：直接取中心线节点，环形基槽数据本身已首尾闭合。 */
  private addCenterline(id: string, points: Point2[]): void {
    if (points.length < 2) return;
    const positions: number[] = [];
    for (const point of points) positions.push(point.x, point.y, CENTERLINE_Z);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const line = new Line(geometry, new LineBasicMaterial({ color: CENTERLINE_COLOR }));
    line.name = `${id}:centerline`;
    this.centerlines.set(id, line);
    this.root.add(line);
  }
  /** 选中对象时高亮其中心线；传 null 表示全部回到常态颜色。 */
  setSelected(id: string | null): void {
    if (this.disposed) return;
    this.selectedId = id;
    this.applySelection();
  }
  /** 供测试与验收读取当前中心线高亮情况的只读快照。 */
  centerlineColors(): Record<string, string> {
    const colors: Record<string, string> = {};
    for (const [id, line] of this.centerlines) colors[id] = `#${line.material.color.getHexString()}`;
    return colors;
  }
  get selectedCenterlineId(): string | null { return this.selectedId; }
  private applySelection(): void {
    for (const [id, line] of this.centerlines) {
      line.material.color.set(id === this.selectedId ? SELECTED_CENTERLINE_COLOR : CENTERLINE_COLOR);
    }
  }
  setWireframe(value: boolean): void {
    for (const child of this.root.children) if (child instanceof Mesh) {
      for (const material of child.material as MeshStandardMaterial[]) material.wireframe = value;
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const line of this.centerlines.values()) {
      line.geometry.dispose(); line.material.dispose();
    }
    this.centerlines.clear();
    for (const child of this.root.children) if (child instanceof Mesh) {
      child.geometry.dispose();
      for (const material of child.material as MeshStandardMaterial[]) material.dispose();
    }
    this.root.clear(); this.root.removeFromParent();
  }
}
