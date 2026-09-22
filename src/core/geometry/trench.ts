import type { BufferGeometry } from 'three';
import type { Point2, Trench } from '../model/project';

import { buildRingSolid } from './ringSolid';
import { trenchOutlines } from './trenchOutline';

export { trenchOutlines, segmentVector } from './trenchOutline';

export function buildTrench(trench: Trench): { geometry: BufferGeometry; topOutline: Point2[]; bottomOutline: Point2[] } {
  const { bottomOutline, topOutline } = trenchOutlines(trench);
  const { geometry } = buildRingSolid(bottomOutline, topOutline, -trench.depth, 0);
  return { geometry, topOutline, bottomOutline };
}
