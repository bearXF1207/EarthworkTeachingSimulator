import type { Point2 } from '../model/project';

export type Vec3 = { x: number; y: number; z: number };
export type Face = { vertices: Vec3[]; material: 0 | 1 };
type Plane = { normal: Vec3; constant: number };
export type Cell = { id: string; faces: Face[]; planes: Plane[]; min: Vec3; max: Vec3 };
export type UnionTriangle = { id: string; material: 0 | 1; a: Vec3; b: Vec3; c: Vec3 };

// Coordinates remain doubles until the rendering boundary. Distances use unit normals.
// Match geometric validation tolerance, including 1e-8 m trim clearance plus
// floating-point roundoff after rotation/translation of a site.
const DISTANCE_EPSILON = 1e-7;
const AREA_EPSILON = 1e-12;
const MAX_FRAGMENTS = 100_000;
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const distance = (plane: Plane, point: Vec3): number => dot(plane.normal, point) + plane.constant;

function polygonNormal(vertices: Vec3[]): Vec3 {
  const origin = vertices[0]!;
  const total = { x: 0, y: 0, z: 0 };
  for (let i = 1; i + 1 < vertices.length; i++) {
    const normal = cross(sub(vertices[i]!, origin), sub(vertices[i + 1]!, origin));
    total.x += normal.x; total.y += normal.y; total.z += normal.z;
  }
  return total;
}

function validPolygon(vertices: Vec3[]): boolean {
  return vertices.length >= 3 && length(polygonNormal(vertices)) > 2 * AREA_EPSILON;
}

function cleanPolygon(vertices: Vec3[]): Vec3[] {
  const clean: Vec3[] = [];
  for (const point of vertices) {
    if (!clean.length || length(sub(point, clean[clean.length - 1]!)) > DISTANCE_EPSILON) clean.push(point);
  }
  if (clean.length > 1 && length(sub(clean[0]!, clean[clean.length - 1]!)) <= DISTANCE_EPSILON) clean.pop();
  return clean;
}

/** The interior of each plane is n·p+c <= 0; display faces point into the cavity. */
export function makeCell(id: string, bottom: Point2[], top: Point2[], depth: number): Cell {
  if (!id || !Number.isFinite(depth) || depth <= DISTANCE_EPSILON || bottom.length < 3 || bottom.length !== top.length) {
    throw new Error('开挖凸体的编号、深度或顶底轮廓无效');
  }
  const ring = (points: Point2[], z: number): Vec3[] => points.map(point => {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('开挖凸体包含非有限坐标');
    return { x: point.x, y: point.y, z };
  });
  const low = ring(bottom, -depth), high = ring(top, 0);
  // Checking every point against every edge rejects reversed, concave and self-crossing rings.
  for (const vertices of [low, high]) {
    if (polygonNormal(vertices).z <= 2 * AREA_EPSILON) throw new Error('开挖凸体轮廓必须逆时针且具有正面积');
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i]!, edge = sub(vertices[(i + 1) % vertices.length]!, a);
      if (length(edge) <= DISTANCE_EPSILON) throw new Error('开挖凸体轮廓包含重复顶点');
      for (const point of vertices) {
        if (cross(edge, sub(point, a)).z < -DISTANCE_EPSILON * length(edge)) throw new Error('开挖凸体轮廓必须为凸多边形');
      }
    }
  }
  const faces: Face[] = [{ vertices: low, material: 0 }];
  for (let i = 0; i < low.length; i++) {
    const j = (i + 1) % low.length;
    faces.push({ vertices: [low[i]!, high[i]!, high[j]!, low[j]!], material: 1 });
  }
  const vertices = [...low, ...high];
  const planes: Plane[] = faces.map(face => {
    const inward = polygonNormal(face.vertices), size = length(inward);
    if (!Number.isFinite(size) || size <= 2 * AREA_EPSILON) throw new Error('开挖凸体包含退化面');
    const normal = { x: -inward.x / size, y: -inward.y / size, z: -inward.z / size };
    const plane = { normal, constant: -dot(normal, face.vertices[0]!) };
    if (face.vertices.some(point => Math.abs(distance(plane, point)) > DISTANCE_EPSILON)) {
      throw new Error('开挖凸体顶底对应侧面不共面');
    }
    if (vertices.some(point => distance(plane, point) > DISTANCE_EPSILON)) throw new Error('开挖凸体侧面绕序错误或整体非凸');
    return plane;
  });
  planes.push({ normal: { x: 0, y: 0, z: 1 }, constant: 0 });
  const min = { x: Infinity, y: Infinity, z: Infinity }, max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const point of vertices) {
    for (const axis of ['x', 'y', 'z'] as const) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
  }
  return { id, faces, planes, min, max };
}

/** Split only genuinely crossing polygons; a coplanar polygon belongs to the interior. */
function splitPolygon(vertices: Vec3[], plane: Plane): { inside: Vec3[]; outside: Vec3[] } {
  const distances = vertices.map(point => {
    const value = distance(plane, point);
    return Math.abs(value) <= DISTANCE_EPSILON ? 0 : value;
  });
  if (distances.every(value => value <= 0)) return { inside: vertices, outside: [] };
  if (distances.every(value => value >= 0)) return { inside: [], outside: vertices };
  const inside: Vec3[] = [], outside: Vec3[] = [];
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const a = vertices[i]!, b = vertices[j]!, da = distances[i]!, db = distances[j]!;
    if (da <= 0) inside.push(a);
    if (da >= 0) outside.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      const point = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) };
      inside.push(point); outside.push(point);
    }
  }
  return { inside: cleanPolygon(inside), outside: cleanPolygon(outside) };
}

/** Partition P \ cell into convex polygons, without overlapping exterior fragments. */
function subtractCell(vertices: Vec3[], cell: Cell): Vec3[][] {
  const exterior: Vec3[][] = [];
  let interior = vertices;
  for (const plane of cell.planes) {
    const split = splitPolygon(interior, plane);
    if (validPolygon(split.outside)) exterior.push(split.outside);
    if (!validPolygon(split.inside)) return exterior;
    interior = split.inside;
  }
  return exterior;
}

const boxesOverlap = (a: Cell, b: Cell): boolean => (['x', 'y', 'z'] as const).every(axis =>
  a.min[axis] <= b.max[axis] + DISTANCE_EPSILON && b.min[axis] <= a.max[axis] + DISTANCE_EPSILON);

/**
 * Boundary of the true union of convex excavation cells, excluding the z=0 lid.
 * Shared opposite-facing walls disappear from both cells. Coincident exterior
 * faces belong to the first cell, avoiding both doubled surfaces and missing bottoms.
 */
export function unionSurfaces(cells: Cell[]): UnionTriangle[] {
  const triangles: UnionTriangle[] = [];
  for (let sourceIndex = 0; sourceIndex < cells.length; sourceIndex++) {
    const source = cells[sourceIndex]!;
    const candidates = cells.map((cell, index) => ({ cell, index })).filter(({ cell, index }) => index !== sourceIndex && boxesOverlap(source, cell));
    for (const face of source.faces) {
      const inward = polygonNormal(face.vertices), size = length(inward);
      let fragments = [face.vertices];
      for (const { cell, index } of candidates) {
        // Equal exterior planes have the same inward normal. The earlier source
        // keeps its face; later sources subtract exactly the overlapping portion.
        if (sourceIndex < index && cell.planes.some(plane =>
          dot(inward, plane.normal) / size < -1 + 1e-10 &&
          face.vertices.every(point => Math.abs(distance(plane, point)) <= DISTANCE_EPSILON))) continue;
        fragments = fragments.flatMap(fragment => subtractCell(fragment, cell));
        if (fragments.length > MAX_FRAGMENTS) throw new Error('开挖联通面片数量超出安全上限');
        if (!fragments.length) break;
      }
      for (const fragment of fragments) {
        for (let i = 1; i + 1 < fragment.length; i++) {
          const a = fragment[0]!, b = fragment[i]!, c = fragment[i + 1]!;
          if (length(cross(sub(b, a), sub(c, a))) > 2 * AREA_EPSILON) triangles.push({ id: source.id, material: face.material, a, b, c });
        }
      }
    }
  }
  return triangles;
}

/** Signed divergence integral; inward-facing excavation boundaries give positive m³. */
export function signedUnionVolume(triangles: UnionTriangle[]): number {
  if (!triangles.length) return 0;
  // Move the integration origin in XY for stability at large site coordinates.
  // Keep z=0: the omitted horizontal lid then contributes exactly zero.
  const origin = { x: triangles[0]!.a.x, y: triangles[0]!.a.y, z: 0 };
  let sum = 0, compensation = 0;
  for (const triangle of triangles) {
    const value = -dot(sub(triangle.a, origin), cross(sub(triangle.b, origin), sub(triangle.c, origin))) / 6;
    const adjusted = value - compensation, next = sum + adjusted;
    compensation = (next - sum) - adjusted;
    sum = next;
  }
  return sum === 0 ? 0 : sum;
}
