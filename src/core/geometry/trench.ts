import type { BufferGeometry } from 'three';
import type { Point2, Trench } from '../model/project';

import { buildAnnularSolid, buildRingSolid } from './ringSolid';
import { trenchOutlines } from './trenchOutline';

export { trenchOutlines, isClosedRing, segmentVector } from './trenchOutline';

export type BuiltTrench = {
  geometry: BufferGeometry;
  topOutline: Point2[];
  bottomOutline: Point2[];
  /** 首尾闭合的环形基槽：内圈轮廓（地面开口的内岛边界）。 */
  topHole?: Point2[];
  bottomHole?: Point2[];
};

/** Standalone excavation is closed at its ends; connected surfaces come from trenchNetwork. */
export function buildTrench(trench: Trench): BuiltTrench {
  const outlines = trenchOutlines(trench);
  const { bottomOutline, topOutline, bottomHole, topHole } = outlines;
  const { geometry } = bottomHole && topHole
    ? buildAnnularSolid(bottomOutline, topOutline, bottomHole, topHole, -trench.depth, 0)
    : buildRingSolid(bottomOutline, topOutline, -trench.depth, 0);
  return { geometry, topOutline, bottomOutline, ...(bottomHole ? { bottomHole } : {}), ...(topHole ? { topHole } : {}) };
}
