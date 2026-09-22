import type { ExcavationElement } from '../model/project';
import { pitBottomArea, pitBottomSize, pitTopSize, pitVolume } from './pitVolume';
import { polylineLength } from './measurement';
import { trenchSectionArea, trenchTopWidth, trenchVolume } from './trenchVolume';

/**
 * M7 工程量汇总：把纯数值计算整理成界面可直接展示的读数。
 * 计算层保留完整精度，四舍五入只发生在显示层；这里不回写任何参数。
 */

export type QuantityRow = { label: string; value: number; unit: string };
export type Quantity = { volume: number | null; rows: QuantityRow[] };

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

/** 单个开挖对象的工程量读数；无法计算的读数不出现在 rows 里，volume 为 null 时界面显示“—”。 */
export function quantityOf(element: ExcavationElement): Quantity {
  if (element.type === 'trench') {
    const length = polylineLength(element.points);
    const rows: QuantityRow[] = [];
    if (finite(length)) rows.push({ label: '中心线长度', value: length, unit: 'm' });
    rows.push({ label: '底宽 B', value: element.bottomWidth, unit: 'm' });
    rows.push({ label: '顶宽 T', value: trenchTopWidth(element), unit: 'm' });
    rows.push({ label: '断面面积 A', value: trenchSectionArea(element), unit: 'm²' });
    return { volume: trenchVolume(element), rows };
  }
  const bottom = pitBottomSize(element), top = pitTopSize(element), area = pitBottomArea(element);
  const circular = element.type === 'circular-pit';
  const rows: QuantityRow[] = [];
  if (circular) {
    rows.push({ label: '底部直径', value: bottom.length, unit: 'm' });
    if (top) rows.push({ label: '顶部直径', value: top.length, unit: 'm' });
  } else {
    rows.push({ label: '底部尺寸', value: bottom.length, unit: 'm' });
    rows.push({ label: '底部宽度', value: bottom.width, unit: 'm' });
    if (top) {
      rows.push({ label: '顶部尺寸', value: top.length, unit: 'm' });
      rows.push({ label: '顶部宽度', value: top.width, unit: 'm' });
    }
  }
  if (finite(area)) rows.push({ label: '底面积', value: area, unit: 'm²' });
  return { volume: pitVolume(element), rows };
}

/**
 * 全项目合计（m³）：只对已通过校验并进入工程的元素求和，草稿与临时测量不计入。
 * 单个元素无法计算时跳过；不宣称支持相交开挖的合并计量。
 */
export function totalVolume(elements: ExcavationElement[]): number {
  return elements.reduce((sum, element) => {
    const volume = quantityOf(element).volume;
    return finite(volume) ? sum + volume : sum;
  }, 0);
}
