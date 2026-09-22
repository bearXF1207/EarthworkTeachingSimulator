import type { Point2, Trench } from '../model/project';

export type TrenchOutlines = { bottomOutline: Point2[]; topOutline: Point2[] };

/** 单段基槽方向与长度；非法输入抛出可读错误，不返回 NaN。 */
export function segmentVector(a: Point2, b: Point2): { dx: number; dy: number; length: number } {
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= 0) throw new Error('基槽中心线长度必须大于 0');
  return { dx, dy, length };
}

/**
 * M3 直线基槽：两个节点、统一底宽/深度/坡比。
 * 底部半宽 b=B/2，顶部半宽 t=b+mH；端点断面垂直，不沿中心线方向额外放坡。
 * 两个环均逆时针给出，末点不重复首点，可直接用于地面开孔。
 */
export function trenchOutlines(trench: Trench): TrenchOutlines {
  const [first, second] = trench.points;
  if (trench.points.length !== 2 || !first || !second) throw new Error('当前仅支持两个节点的直线基槽');
  const { dx, dy, length } = segmentVector(first, second);
  const nx = -dy / length, ny = dx / length; // 左法向 n=(-d.y,d.x)
  const halfBottom = trench.bottomWidth / 2, halfTop = halfBottom + trench.depth * trench.slope;
  const ring = (halfWidth: number): Point2[] => [
    { x: first.x - nx * halfWidth, y: first.y - ny * halfWidth },
    { x: second.x - nx * halfWidth, y: second.y - ny * halfWidth },
    { x: second.x + nx * halfWidth, y: second.y + ny * halfWidth },
    { x: first.x + nx * halfWidth, y: first.y + ny * halfWidth },
  ];
  return { bottomOutline: ring(halfBottom), topOutline: ring(halfTop) };
}
