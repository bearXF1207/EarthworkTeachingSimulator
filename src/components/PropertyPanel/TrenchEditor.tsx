import type { ReactElement } from 'react';
import type { Project, Result, Trench } from '../../core/model/project';
import { isClosedRing } from '../../core/geometry/trenchOutline';
import { NumberFields } from './NumberFields';
import type { NumberField } from './NumberFields';

/** 首个节点叫起点、末个叫终点，中间节点按序号命名；节点增删属 M5 绘制交互。 */
const nodeLabel = (index: number, last: number): string =>
  index === 0 ? '起点' : index === last ? '终点' : `节点 ${index + 1}`;

export function TrenchEditor({ trench, onUpdate }: { trench: Trench; onUpdate: (trench: Trench) => Result<Project> }): ReactElement {
  const last = trench.points.length - 1;
  const fields: NumberField[] = [
    ...trench.points.flatMap((point, i) => [
      { key: `x${i}`, label: `${nodeLabel(i, last)} X（m）`, value: point.x },
      { key: `y${i}`, label: `${nodeLabel(i, last)} Y（m）`, value: point.y },
    ]),
    { key: 'bottomWidth', label: '底宽（m）', value: trench.bottomWidth },
    { key: 'depth', label: '开挖深度（m）', value: trench.depth }, { key: 'slope', label: '放坡系数 m', value: trench.slope },
  ];
  return <div className="object-editor">
    <h3>折线基槽参数</h3>
    <NumberFields fields={fields} apply={values => onUpdate({ ...trench,
      bottomWidth: values.bottomWidth!, depth: values.depth!, slope: values.slope!,
      points: trench.points.map((_, i) => ({ x: values[`x${i}`]!, y: values[`y${i}`]! })) })} />
    <p className="scope-note">{trench.points.length} 个节点{isClosedRing(trench.points) ? '（首尾闭合，环形基槽）' : ''}、整槽统一截面；内部转角取相邻偏移线的 miter 交点。完整贴合的端部派生补充开挖、裁除内部墙；不同深度保留台阶，未连接端面垂直。边坡水平外扩 = 深度 × 放坡系数。折返、自交、miter 比超过 4 或槽宽贴近自身都会被拒绝。</p>
  </div>;
}
