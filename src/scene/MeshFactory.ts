import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshStandardMaterial } from 'three';
import type { ExcavationElement, Point2, Trench } from '../core/model/project';
import { buildPit } from '../core/geometry/pit';
import { distanceToSegment } from '../core/geometry/polygon';
import { buildTrench } from '../core/geometry/trench';
import { isClosedRing, trenchOutlines } from '../core/geometry/trenchOutline';
import { openingOf } from '../core/validation/project';
import type { Opening } from '../core/validation/project';

/** 端面贴到相邻开口边界上的判定容差（米）。 */
const ABUT_TOLERANCE = 1e-6;

/** 实体常态与选中高亮颜色：[槽底/坑底, 侧面]。 */
const BASE_COLORS = [0xb8a77c, 0x936c43];
const HIGHLIGHT_COLORS = [0xe2cd98, 0xb3833f];

/**
 * 判定基槽两端是否与相邻开挖贯通（收边或端点对接得到的共边连接）。
 * 贯通的端部省略端面，接口处不会留一堵墙，视觉上真正打通。
 */
function abuttingEnds(element: Trench, openings: Opening[], index: number): { openStart?: boolean; openEnd?: boolean } {
  if (isClosedRing(element.points)) return {};
  const ring = trenchOutlines(element).topOutline;
  const nodeCount = element.points.length;
  if (ring.length !== 2 * nodeCount) return {};
  const onRing = (point: Point2, loop: Point2[]): boolean => {
    for (let i = 0; i < loop.length; i++) {
      if (distanceToSegment(point, loop[i]!, loop[(i + 1) % loop.length]!) <= ABUT_TOLERANCE) return true;
    }
    return false;
  };
  // 相邻开口的外圈与岛（环形基槽内壁）都算贯通边界。
  const onNeighbourBoundary = (point: Point2): boolean => openings.some((other, otherIndex) =>
    otherIndex !== index && (onRing(point, other.ring) || (other.island ? onRing(point, other.island) : false)));
  // 起点端面是回绕边 ring[2n-1]→ring[0]，终点端面是 ring[n-1]→ring[n]。
  const startCap = [ring[2 * nodeCount - 1]!, ring[0]!] as const;
  const endCap = [ring[nodeCount - 1]!, ring[nodeCount]!] as const;
  const openStart = startCap.every(onNeighbourBoundary);
  const openEnd = endCap.every(onNeighbourBoundary);
  return { ...(openStart ? { openStart: true } : {}), ...(openEnd ? { openEnd: true } : {}) };
}

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
      const openings = elements.map(element => openingOf(element));
      for (const [index, element] of elements.entries()) {
        if (element.type === 'trench') {
          const built = buildTrench(element, abuttingEnds(element, openings, index));
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
    // 选中的开挖实体同步换色：只在材质基色之间切换，不影响线框与其他属性。
    for (const child of this.root.children) {
      if (!(child instanceof Mesh)) continue;
      const materials = child.material as MeshStandardMaterial[];
      const highlight = child.name === this.selectedId;
      materials.forEach((material, index) => {
        material.color.set((highlight ? HIGHLIGHT_COLORS : BASE_COLORS)[index] ?? BASE_COLORS[0]!);
      });
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
