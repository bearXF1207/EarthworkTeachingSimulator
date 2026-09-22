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

/** `openEnds` 由场景层根据相邻开口判定：与相邻开挖贯通的端部省略端面，接口处不留墙。 */
export type TrenchBuildOptions = { openStart?: boolean; openEnd?: boolean };

export function buildTrench(trench: Trench, options: TrenchBuildOptions = {}): BuiltTrench {
  const outlines = trenchOutlines(trench);
  const { bottomOutline, topOutline, bottomHole, topHole } = outlines;
  const { geometry } = bottomHole && topHole
    ? buildAnnularSolid(bottomOutline, topOutline, bottomHole, topHole, -trench.depth, 0)
    : buildRingSolid(bottomOutline, topOutline, -trench.depth, 0, options);
  return { geometry, topOutline, bottomOutline, ...(bottomHole ? { bottomHole } : {}), ...(topHole ? { topHole } : {}) };
}
