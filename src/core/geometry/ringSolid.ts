import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import type { Point2 } from '../model/project';
import { triangleArea } from './polygon';

export type RingSolid = { geometry: BufferGeometry; bottomTriangleCount: number };

/** 共线顶点产生的退化三角形面积上限（平方米）。 */
const DEGENERATE_AREA = 1e-10;

/**
 * 由一一对应的底部/顶部轮廓生成开口开挖实体：底面三角化 + 一圈侧面。
 * 两个轮廓都以逆时针给出时，底面法向朝上、侧面法向朝向开挖空间；不生成顶部盖板。
 * 基坑底部四边形、基槽端面与折线槽底由同一绕序规则得到。
 * 折线槽底可能是凹多边形并含共线顶点，因此使用支持凹多边形的三角化并剔除退化三角形。
 */
export function buildRingSolid(bottom: Point2[], top: Point2[], bottomZ: number, topZ: number): RingSolid {
  if (bottom.length < 3 || bottom.length !== top.length) throw new Error('开挖轮廓点数不足或顶底不匹配');
  const positions: number[] = [];
  const vertex = (p: Point2, z: number): void => { positions.push(p.x, p.y, z); };
  for (const triangle of ShapeUtils.triangulateShape(bottom.map(p => new Vector2(p.x, p.y)), [])) {
    const a = bottom[triangle[0]!]!, b = bottom[triangle[1]!]!, c = bottom[triangle[2]!]!;
    const area = triangleArea(a, b, c);
    if (!Number.isFinite(area) || Math.abs(area) <= DEGENERATE_AREA) continue;
    if (area > 0) { vertex(a, bottomZ); vertex(b, bottomZ); vertex(c, bottomZ); }
    else { vertex(a, bottomZ); vertex(c, bottomZ); vertex(b, bottomZ); }
  }
  // 非索引几何的材质组按顶点序号划分。
  const bottomVertexCount = positions.length / 3;
  if (!bottomVertexCount) throw new Error('开挖底面三角化失败');
  // Never omit a standalone wall based only on z=0 contact. True connections
  // need derived excavation and internal-face clipping in trenchNetwork.
  for (let i = 0; i < bottom.length; i++) {
    const j = (i + 1) % bottom.length;
    const b = bottom[i]!, bn = bottom[j]!, t = top[i]!, tn = top[j]!;
    // 逆时针轮廓：这些面朝向开挖空腔，绕序与底面相反。
    vertex(b, bottomZ); vertex(t, topZ); vertex(tn, topZ);
    vertex(b, bottomZ); vertex(tn, topZ); vertex(bn, bottomZ);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.addGroup(0, bottomVertexCount, 0);
  geometry.addGroup(bottomVertexCount, positions.length / 3 - bottomVertexCount, 1);
  const bottomTriangleCount = bottomVertexCount / 3;
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, bottomTriangleCount };
}

/** 由一对逆时针轮廓生成一圈侧面（朝向开挖空间）。 */
function pushWall(positions: number[], inner: Point2[], outer: Point2[], bottomZ: number, topZ: number): void {
  const vertex = (p: Point2, z: number): void => { positions.push(p.x, p.y, z); };
  for (let i = 0; i < inner.length; i++) {
    const j = (i + 1) % inner.length;
    const b = inner[i]!, bn = inner[j]!, t = outer[i]!, tn = outer[j]!;
    vertex(b, bottomZ); vertex(t, topZ); vertex(tn, topZ);
    vertex(b, bottomZ); vertex(tn, topZ); vertex(bn, bottomZ);
  }
}

/**
 * 环形开挖实体（首尾闭合基槽）：底部为“外圈减内圈”的环形面，外圈与内圈各生成一圈侧面。
 * 外圈逆时针时侧面朝向槽内；内圈反向遍历，侧面因此背向岛、同样朝向槽内。
 */
export function buildAnnularSolid(
  bottomOuter: Point2[], topOuter: Point2[], bottomHole: Point2[], topHole: Point2[],
  bottomZ: number, topZ: number,
): RingSolid {
  if (bottomOuter.length < 3 || bottomOuter.length !== topOuter.length) throw new Error('开挖轮廓点数不足或顶底不匹配');
  if (bottomHole.length < 3 || bottomHole.length !== topHole.length) throw new Error('环形基槽内圈点数不足或顶底不匹配');
  const positions: number[] = [];
  const vertex = (p: Point2, z: number): void => { positions.push(p.x, p.y, z); };
  // earcut 的三角形索引指向“外圈 + 内圈”拼接后的点表，必须先拼好再取值。
  const combined = [...bottomOuter, ...bottomHole];
  for (const triangle of ShapeUtils.triangulateShape(
    bottomOuter.map(p => new Vector2(p.x, p.y)), [bottomHole.map(p => new Vector2(p.x, p.y))])) {
    const a = combined[triangle[0]!]!, b = combined[triangle[1]!]!, c = combined[triangle[2]!]!;
    const area = triangleArea(a, b, c);
    if (!Number.isFinite(area) || Math.abs(area) <= DEGENERATE_AREA) continue;
    if (area > 0) { vertex(a, bottomZ); vertex(b, bottomZ); vertex(c, bottomZ); }
    else { vertex(a, bottomZ); vertex(c, bottomZ); vertex(b, bottomZ); }
  }
  const bottomVertexCount = positions.length / 3;
  if (!bottomVertexCount) throw new Error('开挖底面三角化失败');
  pushWall(positions, bottomOuter, topOuter, bottomZ, topZ);
  pushWall(positions, [...bottomHole].reverse(), [...topHole].reverse(), bottomZ, topZ);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.addGroup(0, bottomVertexCount, 0);
  geometry.addGroup(bottomVertexCount, positions.length / 3 - bottomVertexCount, 1);
  const bottomTriangleCount = bottomVertexCount / 3;
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, bottomTriangleCount };
}
