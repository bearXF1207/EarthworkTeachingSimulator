import type { Pit } from '../model/project';

/**
 * M7 基坑工程量：按坑型使用不同解析式，全部由参数直接计算，
 * 不对低精度圆周 Mesh 的三角形求和。
 *
 * 方形/矩形：从坑底向上量 s，截面 `A(s)=(L+2ms)(W+2ms)`，积分得
 * `V = LWH + m(L+W)H² + (4/3)m²H³`。等水平外扩的非正方形矩形上下截面不相似，
 * 因此通用棱台公式 `H/3(A底+A顶+√(A底·A顶))` 不适用（方形与圆形才符合相似条件）。
 * 圆形：`V = πH(R²+Rr+r²)/3`，`r=D/2`、`R=r+mH`。
 */

const valid = (...values: number[]): boolean => values.every(value => Number.isFinite(value) && value >= 0);

/** 矩形（含方形）基坑体积（m³）。 */
export function rectPitVolume(length: number, width: number, depth: number, slope: number): number | null {
  if (!valid(length, width, depth, slope)) return null;
  return length * width * depth + slope * (length + width) * depth * depth + (4 / 3) * slope * slope * depth ** 3;
}

/** 圆形基坑体积（m³）。 */
export function circularPitVolume(diameter: number, depth: number, slope: number): number | null {
  if (!valid(diameter, depth, slope)) return null;
  const bottom = diameter / 2, top = bottom + slope * depth;
  return Math.PI * depth * (top * top + top * bottom + bottom * bottom) / 3;
}

/** 按坑型分派的体积（m³）。 */
export function pitVolume(pit: Pit): number | null {
  if (pit.type === 'circular-pit') return circularPitVolume(pit.bottomDiameter, pit.depth, pit.slope);
  const length = pit.type === 'square-pit' ? pit.bottomSize : pit.bottomLength;
  const width = pit.type === 'square-pit' ? pit.bottomSize : pit.bottomWidth;
  return rectPitVolume(length, width, pit.depth, pit.slope);
}

/** 顶部尺寸（m）：水平外扩 = 深度 × 坡比；m=0 时与底部相同。 */
export function pitTopSize(pit: Pit): { length: number; width: number } | null {
  const spread = 2 * pit.depth * pit.slope;
  if (!Number.isFinite(spread)) return null;
  if (pit.type === 'circular-pit') { const d = pit.bottomDiameter + spread; return { length: d, width: d }; }
  const length = (pit.type === 'square-pit' ? pit.bottomSize : pit.bottomLength) + spread;
  const width = (pit.type === 'square-pit' ? pit.bottomSize : pit.bottomWidth) + spread;
  return { length, width };
}

/** 底部尺寸（m）：圆形返回直径，矩形返回长宽。 */
export function pitBottomSize(pit: Pit): { length: number; width: number } {
  if (pit.type === 'circular-pit') return { length: pit.bottomDiameter, width: pit.bottomDiameter };
  return { length: pit.type === 'square-pit' ? pit.bottomSize : pit.bottomLength, width: pit.type === 'square-pit' ? pit.bottomSize : pit.bottomWidth };
}

/** 底面积（m²）：矩形取长宽积，圆形取 πr²。 */
export function pitBottomArea(pit: Pit): number | null {
  const { length, width } = pitBottomSize(pit);
  if (pit.type === 'circular-pit') {
    const radius = length / 2;
    return Number.isFinite(radius) ? Math.PI * radius * radius : null;
  }
  return length * width;
}
