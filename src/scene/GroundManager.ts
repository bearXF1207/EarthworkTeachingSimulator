import { AxesHelper, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshStandardMaterial, ShapeUtils, Vector2 } from 'three';
import type { Point2 } from '../core/model/project';
import { edgesProperlyCross, inside } from '../core/geometry/polygon';

/** 视作退化的地面三角形面积上限（m²）：亚微米级碎片不计入面积，也不生成面片。 */
const DEGENERATE_GROUND_AREA = 1e-9;

/** 该环是否整体落在岛内（含贴边、无真交叉）：用于把岛内开挖从岛面中挖掉。 */
function insideIslandRing(ring: Point2[], island: Point2[]): boolean {
  return !edgesProperlyCross(ring, island) && ring.every(point => inside(point, island));
}

export class GroundManager {
  readonly root = new Group();
  readonly ground: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly grid: LineSegments<BufferGeometry, LineBasicMaterial>;
  readonly axes: AxesHelper;
  private readonly islands: Mesh<BufferGeometry, MeshStandardMaterial>[] = [];
  private disposed = false;
  constructor(holes: Point2[][] = [], size = 100, islandRings: Point2[][] = []) {
    let minX = -size / 2, maxX = size / 2, minY = -size / 2, maxY = size / 2;
    for (const ring of holes) for (const p of ring) {
      minX = Math.min(minX, Math.floor(p.x - 10)); maxX = Math.max(maxX, Math.ceil(p.x + 10));
      minY = Math.min(minY, Math.floor(p.y - 10)); maxY = Math.max(maxY, Math.ceil(p.y + 10));
    }
    const outer = [new Vector2(minX, minY), new Vector2(minX, maxY), new Vector2(maxX, maxY), new Vector2(maxX, minY)];
    // 岛内开挖（例如环形基槽岛内的基槽）不能作为主地面的孔洞：earcut 不支持嵌套孔洞，
    // 这些孔洞只从对应的岛面里挖掉，主地面只保留顶层开口。
    const nestedInIsland = (ring: Point2[]): boolean => islandRings.some(island => insideIslandRing(ring, island));
    const topHoles = holes.filter(ring => !nestedInIsland(ring));
    const rings = topHoles.map(ring => ring.map(p => new Vector2(p.x, p.y)));
    const triangles = ShapeUtils.triangulateShape(outer, rings);
    const points = [...outer, ...rings.flat()];
    const expectedArea = (maxX - minX) * (maxY - minY) - rings.reduce((sum, ring) => sum + Math.abs(ShapeUtils.area(ring)), 0);
    let actualArea = 0;
    const positions: number[] = [];
    for (const triangle of triangles) {
      const vertices = triangle.map(index => points[index]!);
      const area = Math.abs(ShapeUtils.area(vertices));
      if (!Number.isFinite(area)) throw new Error('Invalid ground triangle');
      // 孔洞共边或近乎相切时 earcut 会产出面积趋于 0 的碎片三角形，按退化处理跳过；
      // 真正的三角化错误仍由下面的总面积守卫拦下。
      if (area <= DEGENERATE_GROUND_AREA) continue;
      actualArea += area;
      for (const p of vertices) positions.push(p.x, p.y, 0);
    }
    const areaError = Math.abs(actualArea - expectedArea);
    if (areaError > Math.max(1e-6, expectedArea * 1e-10)) {
      throw new Error(`Incomplete ground triangulation: actual ${actualArea} vs expected ${expectedArea}`);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3)); geometry.computeVertexNormals();
    this.ground = new Mesh(geometry, new MeshStandardMaterial({ color: 0x7d8060, roughness: 1, side: DoubleSide }));
    const lines: number[] = [];
    // Subtract convex-hole intervals from each integer grid line.
    const clip = (fixed: number, vertical: boolean, low: number, high: number): void => {
      const intervals: [number, number][] = [];
      for (const ring of holes) {
        const hits: number[] = [];
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i]!, b = ring[(i + 1) % ring.length]!;
          const af = vertical ? a.x : a.y, bf = vertical ? b.x : b.y;
          const av = vertical ? a.y : a.x, bv = vertical ? b.y : b.x;
          if (af === bf) { if (Math.abs(fixed - af) < 1e-7) hits.push(av, bv); }
          else if (fixed >= Math.min(af, bf) && fixed <= Math.max(af, bf)) hits.push(av + (fixed - af) / (bf - af) * (bv - av));
        }
        if (hits.length) intervals.push([Math.min(...hits), Math.max(...hits)]);
      }
      intervals.sort((a, b) => a[0] - b[0]);
      const segment = (a: number, b: number): void => {
        if (b - a < 1e-7) return;
        if (vertical) lines.push(fixed, a, 0, fixed, b, 0);
        else lines.push(a, fixed, 0, b, fixed, 0);
      };
      let cursor = low;
      for (const [start, end] of intervals) { segment(cursor, start); cursor = Math.max(cursor, end); }
      segment(cursor, high);
    };
    for (let x = Math.ceil(minX); x <= maxX; x++) clip(x, true, minY, maxY);
    for (let y = Math.ceil(minY); y <= maxY; y++) clip(y, false, minX, maxX);
    const gridGeometry = new BufferGeometry(); gridGeometry.setAttribute('position', new Float32BufferAttribute(lines, 3));
    this.grid = new LineSegments(gridGeometry, new LineBasicMaterial({ color: 0x52634e }));
    this.axes = new AxesHelper(12);
    this.root.name = 'ground'; this.grid.position.z = .015; this.axes.position.z = .03;
    this.root.add(this.ground, this.grid, this.axes);
    // 环形基槽的岛：外圈被切成孔洞，岛上原地面用一块共面补片补回（网格线不跨越岛，属于已知简化）。
    for (const ring of islandRings) {
      const patch = this.buildIsland(ring, holes);
      if (!patch) continue;
      this.islands.push(patch);
      this.root.add(patch);
    }
  }
  /**
   * 岛的三角化：与主地面共面、同一材质参数，独立材质便于释放。
   * 岛内还可能有独立开挖（例如环形基槽岛内的基槽），这些孔洞要从岛面里一并挖掉，
   * 使岛内的沟槽能真正开在岛上；贴边接触也视为落在岛内。
   */
  private buildIsland(ring: Point2[], holes: Point2[][]): Mesh<BufferGeometry, MeshStandardMaterial> | null {
    const shape = ring.map(p => new Vector2(p.x, p.y));
    const inner = holes.filter(hole => insideIslandRing(hole, ring));
    const innerShapes = inner.map(hole => hole.map(p => new Vector2(p.x, p.y)));
    const triangles = ShapeUtils.triangulateShape(shape, innerShapes);
    const points = [...shape, ...innerShapes.flat()];
    const positions: number[] = [];
    for (const triangle of triangles) {
      const vertices = triangle.map(index => points[index]!);
      const area = Math.abs(ShapeUtils.area(vertices));
      if (!Number.isFinite(area) || area <= DEGENERATE_GROUND_AREA) continue;
      for (const p of vertices) positions.push(p.x, p.y, 0);
    }
    if (!positions.length) return null;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const patch = new Mesh(geometry, new MeshStandardMaterial({ color: 0x7d8060, roughness: 1, side: DoubleSide }));
    patch.name = 'ground-island';
    return patch;
  }
  setGridVisible(visible: boolean): void { this.grid.visible = visible; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const object of [this.ground, this.grid, this.axes, ...this.islands]) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    }
    this.islands.length = 0;
    this.root.clear(); this.root.removeFromParent();
  }
}
