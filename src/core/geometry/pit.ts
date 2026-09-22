import { BufferGeometry, Float32BufferAttribute } from 'three';
import type { Pit, Point2 } from '../model/project';

import { outline } from './pitOutline';
export { outline, CIRCLE_SEGMENTS } from './pitOutline';

export function buildPit(pit: Pit): { geometry: BufferGeometry; topOutline: Point2[]; bottomOutline: Point2[] } {
  const bottomOutline = outline(pit, false), topOutline = outline(pit, true);
  const positions: number[] = [];
  const vertex = (p: Point2, z: number): void => { positions.push(p.x, p.y, z); };
  for (let i = 0; i < bottomOutline.length; i++) {
    const b = bottomOutline[i]!, next = bottomOutline[(i + 1) % bottomOutline.length]!;
    vertex(pit.position, -pit.depth); vertex(b, -pit.depth); vertex(next, -pit.depth);
  }
  const bottomCount = positions.length / 3;
  for (let i = 0; i < bottomOutline.length; i++) {
    const j = (i + 1) % bottomOutline.length;
    const b = bottomOutline[i]!, bn = bottomOutline[j]!, t = topOutline[i]!, tn = topOutline[j]!;
    // CCW contours: these faces point inward, toward the excavation void.
    vertex(b, -pit.depth); vertex(t, 0); vertex(tn, 0);
    vertex(b, -pit.depth); vertex(tn, 0); vertex(bn, -pit.depth);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.addGroup(0, bottomCount, 0);
  geometry.addGroup(bottomCount, positions.length / 3 - bottomCount, 1);
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, topOutline, bottomOutline };
}
