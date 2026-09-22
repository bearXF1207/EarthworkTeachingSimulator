import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { Point2 } from '../model/project';

export type RingSolid = { geometry: BufferGeometry; bottomTriangleCount: number };

/**
 * 由一一对应的底部/顶部轮廓生成开口开挖实体：底部扇形三角化 + 一圈侧面。
 * 两个轮廓都以逆时针给出时，底面法向朝上、侧面法向朝向开挖空间；不生成顶部盖板。
 * 基坑底部四边形与基槽两端垂直端面都由同一绕序规则得到。
 */
export function buildRingSolid(bottom: Point2[], top: Point2[], bottomZ: number, topZ: number): RingSolid {
  if (bottom.length < 3 || bottom.length !== top.length) throw new Error('开挖轮廓点数不足或顶底不匹配');
  const positions: number[] = [];
  const vertex = (p: Point2, z: number): void => { positions.push(p.x, p.y, z); };
  for (let i = 1; i + 1 < bottom.length; i++) {
    vertex(bottom[0]!, bottomZ); vertex(bottom[i]!, bottomZ); vertex(bottom[i + 1]!, bottomZ);
  }
  const bottomTriangleCount = positions.length / 3;
  for (let i = 0; i < bottom.length; i++) {
    const j = (i + 1) % bottom.length;
    const b = bottom[i]!, bn = bottom[j]!, t = top[i]!, tn = top[j]!;
    // 逆时针轮廓：这些面朝向开挖空腔，绕序与底面相反。
    vertex(b, bottomZ); vertex(t, topZ); vertex(tn, topZ);
    vertex(b, bottomZ); vertex(tn, topZ); vertex(bn, bottomZ);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.addGroup(0, bottomTriangleCount, 0);
  geometry.addGroup(bottomTriangleCount, positions.length / 3 - bottomTriangleCount, 1);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, bottomTriangleCount };
}
