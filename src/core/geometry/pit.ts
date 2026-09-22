import type { BufferGeometry } from 'three';
import type { Pit, Point2 } from '../model/project';

import { outline } from './pitOutline';
import { buildRingSolid } from './ringSolid';

export { outline, CIRCLE_SEGMENTS } from './pitOutline';

export function buildPit(pit: Pit): { geometry: BufferGeometry; topOutline: Point2[]; bottomOutline: Point2[] } {
  const bottomOutline = outline(pit, false), topOutline = outline(pit, true);
  const { geometry } = buildRingSolid(bottomOutline, topOutline, -pit.depth, 0);
  return { geometry, topOutline, bottomOutline };
}
