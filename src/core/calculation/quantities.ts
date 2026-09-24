import type { ExcavationElement } from '../model/project';
import { pitBottomArea, pitBottomSize, pitTopSize, pitVolume } from './pitVolume';
import { polylineLength } from './measurement';
import { trenchSectionArea, trenchTopWidth, trenchVolume } from './trenchVolume';
import { buildTrenchNetwork } from '../geometry/trenchNetwork';

/**
 * M7 工程量汇总：把纯数值计算整理成界面可直接展示的读数。
 * 计算层保留完整精度，四舍五入只发生在显示层；这里不回写任何参数。
 */

export type QuantityRow = { label: string; value: number; unit: string };
export type Quantity = { volume: number | null; rows: QuantityRow[] };

const finite = (value: number | null): value is number => value !== null && Number.isFinite(value);

/** 单个开挖对象的工程量读数；无法计算的读数不出现在 rows 里，volume 为 null 时界面显示"—"。 */
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
 * 单个元素无法计算时跳过；连接处以显示同源的并集几何增量修正，不重复计入已有槽体。
 */
export function totalVolume(elements: ExcavationElement[]): number {
  return elements.reduce((sum, element) => {
    const volume = quantityOf(element).volume;
    return finite(volume) ? sum + volume : sum;
  }, 0) + connectionCorrection(elements);
}

/** 单槽读数保持原设计断面估算；连接新增的开挖在工程合计中单独列出。 */
export function connectionCorrection(elements: ExcavationElement[]): number {
  const computable = elements.filter(e => e.type === 'trench' && trenchVolume(e) !== null);
  return buildTrenchNetwork(computable).correction;
}

export type VolumeSummary = { total: number; correction: number; degraded: boolean };

/**
 * 界面用的合计读数。连接并集在极端数据下可能触发几何守卫抛错，
 * 这里捕获后退回"单槽估算之和"，并置 `degraded` 让界面明示连接修正不可用——
 * 渲染期不允许因为一次计量失败而中断整个界面。
 */
export function volumeSummary(elements: ExcavationElement[]): VolumeSummary {
  const sum = elements.reduce((total, element) => {
    const volume = quantityOf(element).volume;
    return finite(volume) ? total + volume : total;
  }, 0);
  try {
    const correction = connectionCorrection(elements);
    return { total: sum + correction, correction, degraded: false };
  } catch {
    return { total: sum, correction: 0, degraded: true };
  }
}
