import type { ReactElement } from 'react';
import { quantityOf } from '../../core/calculation/quantities';
import type { ExcavationElement } from '../../core/model/project';

/** 显示层才格式化：计算层保留完整精度，四舍五入不回写参数。 */
const format = (value: number, digits = 2): string => value.toFixed(digits);

/**
 * M7 工程量读数：只读取已校验元素并展示解析计算结果，
 * 不修改任何参数，也不参与校验与提交。
 */
export function QuantityView({ element, title }: { element: ExcavationElement; title: string }): ReactElement {
  const { volume, rows } = quantityOf(element);
  return <div className="quantity-view">
    <h3>{title}工程量</h3>
    <dl className="quantity-list">
      {rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd>{format(row.value)} {row.unit}</dd></div>)}
      <div className="quantity-total"><dt>预计土方量</dt><dd>{volume === null ? '—' : `${format(volume)} m³`}</dd></div>
    </dl>
    <p className="scope-note">按设计几何解析计算，仅用于教学演示；不是工程计价、放坡安全建议或松方/压实方换算。</p>
  </div>;
}
