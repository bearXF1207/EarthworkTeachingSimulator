import type { Point2 } from '../model/project';
import { GeometryError } from './geometryError';

/** miter 长 / 半宽 的上限；4 对应约 151° 的最大转向角，接近折返的尖角必须拒绝。 */
export const MITTER_LIMIT = 4;

export type Segment = { d: Point2; n: Point2; length: number };
/** 节点转角解：j 为角平分方向，denom=dot(j,n1)，偏移点取 p±j*w/denom，1/denom 即 miter 比。 */
export type Join = { node: number; j: Point2; denom: number; turn: number };

/** 单位方向的左法向 n=(-d.y,d.x)。 */
export const leftNormal = (d: Point2): Point2 => ({ x: -d.y, y: d.x });

/** 有向转向角：逆时针为正；≈0 直行，≈±π 折返。 */
export const turnAngle = (from: Point2, to: Point2): number =>
  Math.atan2(from.x * to.y - from.y * to.x, from.x * to.x + from.y * to.y);

/** 角度转度，仅用于错误提示。 */
const degrees = (radians: number): number => Math.abs(radians) * 180 / Math.PI;

/**
 * 相邻两段偏移直线的交点：j=normalize(n0+n1)、denom=dot(j,n1)。
 * 折返、近 180° 转向或超出 miter 上限时抛出带节点序号的可读错误，绝不返回 NaN。
 */
export function solveJoin(from: Segment, to: Segment, node: number): Join {
  const nx = from.n.x + to.n.x, ny = from.n.y + to.n.y, scale = Math.hypot(nx, ny);
  const turn = turnAngle(from.d, to.d);
  if (!Number.isFinite(scale) || scale <= 1e-9) {
    throw new GeometryError(`节点折返（转向角约 ${degrees(turn).toFixed(1)}°）：无法生成转角`, node, node);
  }
  const j = { x: nx / scale, y: ny / scale };
  const denom = j.x * to.n.x + j.y * to.n.y;
  if (!Number.isFinite(denom) || denom <= 1e-9) {
    throw new GeometryError(`节点处两条偏移线几乎平行（转向角约 ${degrees(turn).toFixed(1)}°）：无法求交点`, node, node);
  }
  const ratio = 1 / denom;
  if (ratio > MITTER_LIMIT + 1e-9) {
    throw new GeometryError(`节点转角 ${degrees(turn).toFixed(1)}° 的 miter 比 ${ratio.toFixed(2)} 超出上限 ${MITTER_LIMIT}，请减小坡比或放宽转角`, node, node);
  }
  return { node, j, denom, turn };
}
