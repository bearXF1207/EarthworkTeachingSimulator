import type { Trench } from '../model/project';
import { polylineLength } from './measurement';

/**
 * M7 基槽工程量：整槽共用一个梯形断面，沿中心线拉伸。
 * `T = B + 2Hm`、`A = (B + T)H / 2 = BH + mH²`、`V = A·ΣL`。
 * 垂直端面的直线槽是精确值；折线按此式给出教学估算（转角处的边坡重叠不单独累加或扣减）。
 */

/** 槽顶宽度 T（m）。 */
export function trenchTopWidth(trench: Trench): number {
  return trench.bottomWidth + 2 * trench.depth * trench.slope;
}

/** 梯形断面面积 A（m²）。 */
export function trenchSectionArea(trench: Trench): number {
  return (trench.bottomWidth + trenchTopWidth(trench)) / 2 * trench.depth;
}

/** 预计土方量（m³）；参数或中心线不足时返回 null，不返回非有限值。 */
export function trenchVolume(trench: Trench): number | null {
  if (![trench.bottomWidth, trench.depth, trench.slope].every(value => Number.isFinite(value) && value >= 0)) return null;
  const length = polylineLength(trench.points);
  if (length === null) return null;
  const volume = trenchSectionArea(trench) * length;
  return Number.isFinite(volume) ? volume : null;
}
